// src/buttplug/device_manager.js

//! Device connection and control module
//! 
//! This module manages communication with hardware devices through the Buttplug protocol.
//! It supports both an oscillating device and a vibrating device simultaneously.

use std::{
    sync::Arc,
    time::Duration,
};
use atomic_float::AtomicF64;
use buttplug::{
    client::{
        device::{ButtplugClientDevice, ScalarValueCommand},
        ButtplugClient,
        ButtplugClientError,
        ButtplugClientEvent,
    },
    core::{
        connector::new_json_ws_client_connector,
        message::ActuatorType,
    },
};
use futures::StreamExt;
use once_cell::sync::OnceCell;
use tokio::sync::{Mutex, RwLock};

/// Global singleton instance of the device manager
static DEVICE_MANAGER: OnceCell<Arc<DeviceManager>> = OnceCell::new();

/// Manages communication with connected devices
pub struct DeviceManager {
    /// Client connection to the Buttplug server
    #[allow(dead_code)]
    client: Arc<ButtplugClient>,

    /// Currently connected oscillate-capable device
    oscillate_device: Arc<Mutex<Option<Arc<ButtplugClientDevice>>>>,

    /// Currently connected vibrate-capable device
    vibrate_device: Arc<Mutex<Option<Arc<ButtplugClientDevice>>>>,

    /// Latest command value to be sent
    latest_value: Arc<AtomicF64>,

    /// Whether currently scanning
    scanning: Arc<RwLock<bool>>,
}

impl DeviceManager {
    /// Creates a new DeviceManager instance and starts control loop
    fn new(client: Arc<ButtplugClient>) -> Arc<Self> {
        let oscillate_device = Arc::new(Mutex::new(None));
        let vibrate_device = Arc::new(Mutex::new(None));
        let latest_value = Arc::new(AtomicF64::new(0.0));
        let scanning = Arc::new(RwLock::new(false));

        let manager = Arc::new(Self {
            client: Arc::clone(&client),
            oscillate_device: oscillate_device.clone(),
            vibrate_device: vibrate_device.clone(),
            latest_value: latest_value.clone(),
            scanning: scanning.clone(),
        });

        // Control loop: send latest_value to both devices
        let manager_clone = Arc::clone(&manager);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                interval.tick().await;
                let value = manager_clone
                    .latest_value
                    .load(std::sync::atomic::Ordering::Relaxed);

                // Send to oscillate device
                let oscillate_lock = manager_clone.oscillate_device.lock().await;
                if let Some(device) = &*oscillate_lock {
                    if let Err(e) = device
                        .oscillate(&ScalarValueCommand::ScalarValue(value.max(0.0).min(1.0)))
                        .await
                    {
                        eprintln!("Error sending oscillate command: {}", e);
                    }
                }

                // Send to vibrate device
                let vibrate_lock = manager_clone.vibrate_device.lock().await;
                if let Some(device) = &*vibrate_lock {
                    let adjusted = if value < 0.03 { 0.0 } else { (value - 0.03) * 1.5 };
                    if let Err(e) = device
                        .vibrate(&ScalarValueCommand::ScalarValue(adjusted.max(0.0).min(1.0)))
                        .await
                    {
                        eprintln!("Error sending vibrate command: {}", e);
                    }
                }
            }
        });

        manager
    }

    /// Sets the value to send to devices (0.0 .. 1.0)
    pub async fn set_value(&self, value: f64) {
        self.latest_value
            .store(value, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Initializes device connection and event loop
pub async fn initialize_intiface() -> Result<(), ButtplugClientError> {
    let connector = new_json_ws_client_connector("ws://127.0.0.1:12345/buttplug");
    let client = ButtplugClient::new("Video player Client");

    if let Err(err) = client.connect(connector).await {
        eprintln!("Failed to connect to Buttplug server: {}", err);
        return Err(err);
    }

    let client = Arc::new(client);
    let manager = DeviceManager::new(client.clone());
    DEVICE_MANAGER.set(manager.clone()).ok();

    let oscillate_ref = manager.oscillate_device.clone();
    let vibrate_ref = manager.vibrate_device.clone();
    let scanning_flag = manager.scanning.clone();

    // clone client for each task
    let client_for_events = client.clone();
    let client_for_scan = client.clone();

    let mut events = client_for_events.event_stream();

    // Event loop
    tokio::spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                ButtplugClientEvent::DeviceAdded(device) => {
                    println!("Device '{}' connected", device.name());

                    if let Some(attrs) = device.message_attributes().scalar_cmd().as_ref() {
                        for attr in attrs {
                            match attr.actuator_type() {
                                ActuatorType::Oscillate => {
                                    println!("Device supports oscillate. Adding.");
                                    let mut lock = oscillate_ref.lock().await;
                                    *lock = Some(device.clone());
                                }
                                ActuatorType::Vibrate => {
                                    println!("Device supports vibrate. Adding.");
                                    let mut lock = vibrate_ref.lock().await;
                                    *lock = Some(device.clone());
                                }
                                _ => {}
                            }
                        }
                    }

                    // Stop scanning only if both devices are now connected
                    let has_both = {
                        let o = oscillate_ref.lock().await;
                        let v = vibrate_ref.lock().await;
                        o.is_some() && v.is_some()
                    };

                    if has_both {
                        let mut scanning = scanning_flag.write().await;
                        if *scanning {
                            if let Err(e) = client_for_events.stop_scanning().await {
                                eprintln!("Failed to stop scanning: {}", e);
                            } else {
                                println!("Stopped scanning: both devices connected.");
                                *scanning = false;
                            }
                        }
                    }
                }

                ButtplugClientEvent::DeviceRemoved(info) => {
                    println!("Device '{}' removed", info.name());

                    let mut lock = oscillate_ref.lock().await;
                    if let Some(current) = &*lock {
                        if current.name() == info.name() {
                            *lock = None;
                            println!("Removed oscillate device.");
                        }
                    }

                    let mut lock = vibrate_ref.lock().await;
                    if let Some(current) = &*lock {
                        if current.name() == info.name() {
                            *lock = None;
                            println!("Removed vibrate device.");
                        }
                    }
                }

                ButtplugClientEvent::ScanningFinished => {
                    println!("Device scanning finished.");
                }

                _ => {}
            }
        }
    });

    // Periodic scanning loop
    let oscillate_ref = manager.oscillate_device.clone();
    let vibrate_ref = manager.vibrate_device.clone();
    let scanning_flag = manager.scanning.clone();

    tokio::spawn(async move {
        loop {
            let has_both = {
                let o = oscillate_ref.lock().await;
                let v = vibrate_ref.lock().await;
                o.is_some() && v.is_some()
            };

            if !has_both {
                let mut scanning = scanning_flag.write().await;
                if !*scanning {
                    println!("One or both devices missing, starting scan...");
                    if let Err(e) = client_for_scan.start_scanning().await {
                        eprintln!("Error starting scan: {}", e);
                    } else {
                        *scanning = true;
                        println!("Scan started.");
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(5)).await;
        }
    });

    Ok(())
}

/// Sets the value to send to connected devices (0.0 .. 1.0)
pub async fn oscillate(value: f64) -> Result<(), ButtplugClientError> {
    if let Some(manager) = DEVICE_MANAGER.get() {
        manager.set_value(value).await;
    }
    Ok(())
}
