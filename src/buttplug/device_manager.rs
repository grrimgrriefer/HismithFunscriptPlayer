// src/buttplug/device_manager.rs

//! Device connection and control module
//!
//! This module manages communication with hardware devices through the Buttplug protocol.
//! It coordinates scanning, connects compatible devices (oscillate/vibrate), and runs a
//! small control loop that periodically sends the latest intensity values to connected devices.
//!
//! The module exposes a global singleton managed by a OnceCell and convenience async wrappers
//! for setting current intensities from other parts of the application.

use atomic_float::AtomicF64;
use buttplug::{
    client::{
        device::{ButtplugClientDevice, ScalarValueCommand},
        ButtplugClient, ButtplugClientError, ButtplugClientEvent,
    },
    core::{connector::new_json_ws_client_connector, message::ActuatorType},
};
use futures::StreamExt;
use once_cell::sync::OnceCell;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

static MANAGER: OnceCell<Arc<DeviceManager>> = OnceCell::new();

const SERVER_URL: &str = "ws://127.0.0.1:12345/buttplug";
const CONTROL_INTERVAL_MS: u64 = 100;
const SCAN_INTERVAL_SECS: u64 = 5;
const RECONNECT_DELAY_SECS: u64 = 5;

struct DeviceManager {
    oscillator: Arc<Mutex<Option<Arc<ButtplugClientDevice>>>>,
    vibrator: Arc<Mutex<Option<Arc<ButtplugClientDevice>>>>,
    oscillate_intensity: AtomicF64,
    vibrate_intensity: AtomicF64,
}

impl DeviceManager {
    fn new() -> Arc<Self> {
        let mgr = Arc::new(Self {
            oscillator: Default::default(),
            vibrator: Default::default(),
            oscillate_intensity: AtomicF64::new(0.0),
            vibrate_intensity: AtomicF64::new(0.0),
        });

        // loop: push current intensities to devices
        let m = mgr.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_millis(CONTROL_INTERVAL_MS));
            loop {
                tick.tick().await;
                m.send_commands().await;
            }
        });

        mgr
    }

    async fn send_commands(&self) {
        let osc_val = self.oscillate_intensity.load(std::sync::atomic::Ordering::Relaxed).clamp(0.0, 1.0);
        let vib_val = self.vibrate_intensity.load(std::sync::atomic::Ordering::Relaxed).clamp(0.0, 1.0);

        if let Some(dev) = &*self.oscillator.lock().await {
            if let Err(e) = dev.oscillate(&ScalarValueCommand::ScalarValue(osc_val)).await {
                eprintln!("Oscillate error: {e}");
            }
        }

        if let Some(dev) = &*self.vibrator.lock().await {
            if let Err(e) = dev.vibrate(&ScalarValueCommand::ScalarValue(vib_val)).await {
                eprintln!("Vibrate error: {e}");
            }
        }
    }

    fn has_both_sync(osc: &Option<Arc<ButtplugClientDevice>>, vib: &Option<Arc<ButtplugClientDevice>>) -> bool {
        osc.is_some() && vib.is_some()
    }
}

pub async fn initialize() -> Result<(), ButtplugClientError> {
    let client = Arc::new(ButtplugClient::new("Video Player"));
    let mgr = DeviceManager::new();
    MANAGER.set(mgr.clone()).ok();

    // Connect with retries
    let c = client.clone();
    tokio::spawn(async move {
        loop {
            let connector = new_json_ws_client_connector(SERVER_URL);
            match c.connect(connector).await {
                Ok(_) => { println!("Connected to Buttplug server"); break; }
                Err(e) => {
                    println!("Connection failed: {e}, retrying in {RECONNECT_DELAY_SECS}s...");
                    tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)).await;
                }
            }
        }
    });

    let m = mgr.clone();
    let c = client.clone();
    let mut events = client.event_stream();
    tokio::spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                ButtplugClientEvent::DeviceAdded(dev) => {
                    println!("Device connected: {}", dev.name());

                    if let Some(attrs) = dev.message_attributes().scalar_cmd() {
                        for attr in attrs {
                            match attr.actuator_type() {
                                ActuatorType::Oscillate => {
                                    println!("  -> oscillate device");
                                    *m.oscillator.lock().await = Some(dev.clone());
                                }
                                ActuatorType::Vibrate => {
                                    println!("  -> vibrate device");
                                    *m.vibrator.lock().await = Some(dev.clone());
                                }
                                _ => {}
                            }
                        }
                    }

                    // Stop scanning if we have everything
                    let both = DeviceManager::has_both_sync(
                        &*m.oscillator.lock().await,
                        &*m.vibrator.lock().await,
                    );
                    if both {
                        let _ = c.stop_scanning().await;
                        println!("Both devices found, scanning stopped.");
                    }
                }

                ButtplugClientEvent::DeviceRemoved(dev) => {
                    println!("Device removed: {}", dev.name());
                    let name = dev.name().to_string();

                    let mut osc = m.oscillator.lock().await;
                    if osc.as_ref().is_some_and(|d| d.name() == &name) { *osc = None; }

                    let mut vib = m.vibrator.lock().await;
                    if vib.as_ref().is_some_and(|d| d.name() == &name) { *vib = None; }
                }

                _ => {}
            }
        }
    });

    // Periodic re-scan when devices are missing
    let m = mgr.clone();
    let c = client.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(SCAN_INTERVAL_SECS)).await;

            let both = DeviceManager::has_both_sync(
                &*m.oscillator.lock().await,
                &*m.vibrator.lock().await,
            );
            if !both {
                println!("Missing device(s), scanning...");
                let _ = c.start_scanning().await;
            }
        }
    });

    Ok(())
}

pub fn set_oscillate(value: f64) {
    if let Some(m) = MANAGER.get() {
        m.oscillate_intensity.store(value, std::sync::atomic::Ordering::Relaxed);
    }
}

pub fn set_vibrate(value: f64) {
    if let Some(m) = MANAGER.get() {
        m.vibrate_intensity.store(value, std::sync::atomic::Ordering::Relaxed);
    }
}
