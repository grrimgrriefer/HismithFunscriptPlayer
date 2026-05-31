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
        ButtplugClient, ButtplugClientError, ButtplugClientEvent,
        device::{ButtplugClientDevice, ScalarValueCommand},
    },
    core::{connector::new_json_ws_client_connector, message::ActuatorType},
};
use futures::StreamExt;
use log::{error, info, warn};
use once_cell::sync::OnceCell;
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;

static MANAGER: OnceCell<Arc<DeviceManager>> = OnceCell::new();

const SERVER_URL: &str = "ws://127.0.0.1:12345/buttplug";
const CONTROL_INTERVAL_MS: u64 = 100;
const SCAN_INTERVAL_SECS: u64 = 5;
const RECONNECT_DELAY_SECS: u64 = 5;

struct DevicePair {
    oscillator: Option<Arc<ButtplugClientDevice>>,
    vibrator: Option<Arc<ButtplugClientDevice>>,
}

struct DeviceManager {
    devices: Arc<Mutex<DevicePair>>,
    oscillate_intensity: AtomicF64,
    vibrate_intensity: AtomicF64,
}

impl DeviceManager {
    fn new() -> Arc<Self> {
        Arc::new(Self {
            devices: Arc::new(Mutex::new(DevicePair {
                oscillator: None,
                vibrator: None,
            })),
            oscillate_intensity: AtomicF64::new(0.0),
            vibrate_intensity: AtomicF64::new(0.0),
        })
    }

    async fn send_commands(&self) {
        let devices = self.devices.lock().await;

        let osc_val = self
            .oscillate_intensity
            .load(std::sync::atomic::Ordering::Relaxed)
            .clamp(0.0, 1.0);
        let vib_val = self
            .vibrate_intensity
            .load(std::sync::atomic::Ordering::Relaxed)
            .clamp(0.0, 1.0);

        if let Some(ref dev) = devices.oscillator {
            if let Err(e) = dev.oscillate(&ScalarValueCommand::ScalarValue(osc_val)).await {
                error!("Failed to send oscillate command: {}", e);
            }
        }

        if let Some(ref dev) = devices.vibrator {
            if let Err(e) = dev.vibrate(&ScalarValueCommand::ScalarValue(vib_val)).await {
                error!("Failed to send vibrate command: {}", e);
            }
        }
    }

    fn has_both(pair: &DevicePair) -> bool {
        pair.oscillator.is_some() && pair.vibrator.is_some()
    }

    async fn assign_device(&self, device: Arc<ButtplugClientDevice>) {
        let mut devices = self.devices.lock().await;

        let dominated_actuators: Vec<_> = device
            .message_attributes()
            .scalar_cmd()
            .as_ref()
            .map(|cmds| cmds.iter().map(|c| c.actuator_type().clone()).collect())
            .unwrap_or_default();

        if dominated_actuators.contains(&ActuatorType::Oscillate) {
            info!("Assigned oscillator: {}", device.name());
            devices.oscillator = Some(device.clone());
        }

        if dominated_actuators.contains(&ActuatorType::Vibrate) {
            info!("Assigned vibrator: {}", device.name());
            devices.vibrator = Some(device);
        }
    }

    async fn remove_device(&self, device_index: u32) {
        let mut devices = self.devices.lock().await;

        if devices
            .oscillator
            .as_ref()
            .map(|d| d.index() == device_index)
            .unwrap_or(false)
        {
            info!("Oscillator disconnected");
            devices.oscillator = None;
        }

        if devices
            .vibrator
            .as_ref()
            .map(|d| d.index() == device_index)
            .unwrap_or(false)
        {
            info!("Vibrator disconnected");
            devices.vibrator = None;
        }
    }

    async fn needs_scan(&self) -> bool {
        let devices = self.devices.lock().await;
        !Self::has_both(&devices)
    }
}

pub async fn initialize() -> Result<(), ButtplugClientError> {
    let mgr = DeviceManager::new();
    MANAGER.set(mgr.clone()).ok();

    let client = Arc::new(ButtplugClient::new("Video Player"));

    // Connect with retries
    let c = client.clone();
    tokio::spawn(async move {
        loop {
            let connector = new_json_ws_client_connector(SERVER_URL);
            match c.connect(connector).await {
                Ok(_) => {
                    info!("Connected to Intiface server at {}", SERVER_URL);
                    break;
                }
                Err(e) => {
                    warn!(
                        "Failed to connect to Intiface (retrying in {}s): {}",
                        RECONNECT_DELAY_SECS, e
                    );
                    tokio::time::sleep(Duration::from_secs(RECONNECT_DELAY_SECS)).await;
                }
            }
        }
    });

    // Event stream handler
    let m = mgr.clone();
    let mut events = client.event_stream();
    tokio::spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                ButtplugClientEvent::DeviceAdded(dev) => {
                    let dev: Arc<ButtplugClientDevice> = dev;
                    m.assign_device(dev).await;
                }
                ButtplugClientEvent::DeviceRemoved(dev) => {
                    m.remove_device(dev.index()).await;
                }
                ButtplugClientEvent::ServerDisconnect => {
                    warn!("Intiface server disconnected");
                }
                _ => {}
            }
        }
    });

    // Control loop
    let m = mgr.clone();
    tokio::spawn(async move {
        loop {
            m.send_commands().await;
            tokio::time::sleep(Duration::from_millis(CONTROL_INTERVAL_MS)).await;
        }
    });

    // Periodic re-scan when devices are missing
    let m = mgr.clone();
    let c = client.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(SCAN_INTERVAL_SECS)).await;
            if m.needs_scan().await {
                if let Err(e) = c.start_scanning().await {
                    warn!("Scan failed: {}", e);
                }
            }
        }
    });

    Ok(())
}

pub fn set_oscillate(value: f64) {
    if let Some(m) = MANAGER.get() {
        m.oscillate_intensity
            .store(value.clamp(0.0, 1.0), std::sync::atomic::Ordering::Relaxed);
    }
}

pub fn set_vibrate(value: f64) {
    if let Some(m) = MANAGER.get() {
        m.vibrate_intensity
            .store(value.clamp(0.0, 1.0), std::sync::atomic::Ordering::Relaxed);
    }
}
