// src/buttplug/device_manager.rs

//! Device connection and control module
//! 
//! This module manages communication with hardware devices through the Buttplug protocol.
//! It provides functionality to:
//! - Connect to devices via WebSocket
//! - Monitor device connections/disconnections
//! - Send real-time oscillation commands
//! - Maintain device state

use std::{
    sync::Arc,
    time::Duration,
};
use atomic_float::AtomicF64;
use buttplug::{
    client::{
        device::ScalarValueCommand,
        ButtplugClient,
        ButtplugClientDevice,
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
/// 
/// This structure maintains the state of the device connection and provides
/// methods to send commands to the device.
pub struct DeviceManager {
    /// Client connection to the Buttplug server
    #[allow(dead_code)]
    client: Arc<ButtplugClient>,
    
    /// Currently connected device, if any
    device: Arc<Mutex<Option<Arc<ButtplugClientDevice>>>>,
    
    /// Latest command value to be sent to the device
    latest_value: Arc<AtomicF64>,
    
    /// Whether the manager is currently scanning for devices
    scanning: Arc<RwLock<bool>>,
}

impl DeviceManager {
    /// Creates a new DeviceManager instance
    /// 
    /// # Arguments
    /// * `client` - Connected Buttplug client
    /// 
    /// # Returns
    /// * `Arc<DeviceManager>` - Thread-safe reference to the manager
    fn new(client: Arc<ButtplugClient>) -> Arc<Self> {
        let device = Arc::new(Mutex::new(None));
        let latest_value = Arc::new(AtomicF64::new(0.0));
        let scanning = Arc::new(RwLock::new(false));

        let manager = Arc::new(Self {
            client: Arc::clone(&client),
            device: device.clone(),
            latest_value: latest_value.clone(),
            scanning: scanning.clone(),
        });

        // Start control loop for sending commands
        let manager_clone = Arc::clone(&manager);
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                interval.tick().await;
                let device_lock = manager_clone.device.lock().await;
                if let Some(device) = &*device_lock {
                    let value = manager_clone
                        .latest_value
                        .load(std::sync::atomic::Ordering::Relaxed);
                    if let Err(e) = device
                        .oscillate(&ScalarValueCommand::ScalarValue(value))
                        .await
                    {
                        eprintln!("Error sending oscillation command: {}", e);
                    }
                }
            }
        });

        manager
    }

    /// Sets the oscillation value to be sent to the device
    /// 
    /// # Arguments
    /// * `value` - Oscillation value between 0.0 and 1.0
    pub async fn set_value(&self, value: f64) {
        self.latest_value
            .store(value, std::sync::atomic::Ordering::Relaxed);
    }
}

/// Initializes the device connection and event handling loops
/// 
/// This function:
/// 1. Connects to the Buttplug server
/// 2. Creates a device manager
/// 3. Starts event monitoring for device connections
/// 4. Begins periodic device scanning
/// 
/// # Returns
/// * `Ok(())` - Connection established successfully
/// * `Err(ButtplugClientError)` - Connection failed
pub async fn initialize_intiface() -> Result<(), ButtplugClientError> {
    // Connect to Buttplug server
    let connector = new_json_ws_client_connector("ws://127.0.0.1:12345/buttplug");
    let client = ButtplugClient::new("Video player Client");

    if let Err(err) = client.connect(connector).await {
        eprintln!("Failed to connect to Buttplug server: {}", err);
        return Err(err);
    }

    // Initialize device manager
    let client = Arc::new(client);
    let manager = DeviceManager::new(client.clone());
    DEVICE_MANAGER.set(manager.clone()).ok();

    let device_ref = manager.device.clone();
    let scanning_flag = manager.scanning.clone();
    let client_for_events = client.clone();

    // Spawn task to handle Buttplug events
    tokio::spawn(async move {
        let mut events = client_for_events.event_stream();
        while let Some(event) = events.next().await {
            match event {
                // Handle device connection
                ButtplugClientEvent::DeviceAdded(device) => {
                    println!("Device '{}' connected", device.name());

                    // Check if device supports oscillation
                    let supports_oscillate = device
                        .message_attributes()
                        .scalar_cmd()
                        .as_ref()
                        .map(|features| {
                            features.iter().any(|attr| *attr.actuator_type() == ActuatorType::Oscillate)
                        })
                        .unwrap_or(false);

                    if supports_oscillate {
                        println!("Device supports oscillation. Accepting.");
                        let mut lock = device_ref.lock().await;
                        *lock = Some(device);

                        // Stop scanning once device is connected
                        let mut scanning = scanning_flag.write().await;
                        if *scanning {
                            if let Err(e) = client_for_events.stop_scanning().await {
                                eprintln!("Failed to stop scanning: {}", e);
                            } else {
                                println!("Stopped scanning after compatible device connected.");
                                *scanning = false;
                            }
                        }
                    } else {
                        println!("Device '{}' does not support oscillation. Ignoring.", device.name());
                    }
                }

                // Handle device disconnection
                ButtplugClientEvent::DeviceRemoved(info) => {
                    println!("Device '{}' removed", info.name());
                    let mut lock = device_ref.lock().await;
                    if let Some(current) = &*lock {
                        if current.name() == info.name() {
                            *lock = None;
                            println!("Cleared removed device from manager");
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

    // Spawn periodic device scanning task
    let device_ref = manager.device.clone();
    let client_for_scan = client.clone();
    let scanning_flag = manager.scanning.clone();
    tokio::spawn(async move {
        loop {
            let has_device = {
                let lock = device_ref.lock().await;
                lock.is_some()
            };

            // Start scanning if no device is connected
            if !has_device {
                let mut scanning = scanning_flag.write().await;
                if !*scanning {
                    println!("No device connected, starting scan...");
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

/// Sends an oscillation command to the connected device
/// 
/// # Arguments
/// * `value` - Oscillation intensity between 0.0 and 1.0
/// 
/// # Returns
/// * `Ok(())` - Command sent successfully
/// * `Err(ButtplugClientError)` - Command failed
pub async fn oscillate(value: f64) -> Result<(), ButtplugClientError> {
    if let Some(manager) = DEVICE_MANAGER.get() {
        manager.set_value(value).await;
    }
    Ok(())
}