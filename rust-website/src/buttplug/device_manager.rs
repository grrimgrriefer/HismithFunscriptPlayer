// src/device_manager.rs

//! Device management module
//! 
//! This module handles communication with hardware devices through the Buttplug protocol.
//! It provides functionality to:
//! - Initialize device connections
//! - Handle device events (connect/disconnect)
//! - Send real-time control commands
//! - Manage device state

use std::{
    thread, 
    time::Duration, 
    sync::{
        Arc,
        atomic::Ordering
    }
};
use atomic_float::AtomicF64;
use buttplug::{
    client::{
        device::ScalarValueCommand,
        ButtplugClientEvent,
        ButtplugClient,
        ButtplugClientError,
        ButtplugClientDevice
    },
    core::connector::new_json_ws_client_connector
};
use futures::StreamExt;
use once_cell::sync::OnceCell;

/// Global singleton instance of the device manager
static DEVICE_MANAGER: OnceCell<DeviceManager> = OnceCell::new();

/// Manages communication with connected devices
/// 
/// Provides an interface for controlling devices and maintains the connection state.
/// Uses atomic values for thread-safe communication between the web interface
/// and device control loop.
pub struct DeviceManager {
    /// Buttplug client for device communication
    client: ButtplugClient,
    /// Currently connected device (if any)
    device: Option<Arc<ButtplugClientDevice>>,
    /// Current intensity value shared between threads
    latest_value: Arc<AtomicF64>,
}

impl DeviceManager {
    /// Creates a new device manager instance
    /// 
    /// Sets up a background task that continuously updates the device with
    /// the latest intensity value at 10Hz (100ms intervals).
    ///
    /// # Arguments
    /// * `client` - Initialized Buttplug client
    ///
    /// # Returns
    /// * `DeviceManager` - Configured manager instance
    fn new(client: ButtplugClient) -> Self {
        let manager = Self {
            client,
            device: None,
            latest_value: Arc::new(AtomicF64::new(0.0)),
        };

        // Start the device update loop
        let value_ref = manager.latest_value.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_millis(100));
            loop {
                interval.tick().await;
                if let Some(device_manager) = DEVICE_MANAGER.get() {
                    if let Some(device) = &device_manager.device {
                        let value = value_ref.load(Ordering::Relaxed);
                        if let Err(e) = device.oscillate(&ScalarValueCommand::ScalarValue(value)).await {
                            eprintln!("Error in update loop: {}", e);
                        }
                    }
                }
            }
        });

        manager
    }

    /// Updates the current intensity value
    ///
    /// # Arguments
    /// * `value` - New intensity value between 0.0 and 1.0
    pub async fn set_value(&self, value: f64) {
        self.latest_value.store(value, Ordering::Relaxed);
    }
}

/// Initializes the device connection and scanning
///
/// Connects to the Buttplug server, scans for available devices, and sets up
/// the device manager when a compatible device is found.
///
/// # Returns
/// * `Ok(())` - Device initialization successful (or no devices found)
/// * `Err(ButtplugClientError)` - Connection or scanning error
pub async fn initialize_device() -> Result<(), ButtplugClientError> {
    // Connect to local Buttplug server
    let connector = new_json_ws_client_connector("ws://127.0.0.1:12345/buttplug");
    let client = ButtplugClient::new("Video player Client");

    // Handle connection errors
    if let Err(err) = client.connect(connector).await {
        eprintln!("Failed to connect to the Buttplug server: {}", err);
        return Err(err);
    }

    // Set up device event handling
    let mut events = client.event_stream();
    tokio::spawn(async move {
        while let Some(event) = events.next().await {
            match event {
                ButtplugClientEvent::DeviceAdded(device) => {
                    println!("Device {} connected", device.name());
                }
                ButtplugClientEvent::DeviceRemoved(info) => {
                    println!("Device {} removed", info.name());
                }
                ButtplugClientEvent::ScanningFinished => {
                    println!("Device scanning finished");
                }
                _ => {}
            }
        }
    });

    // Scan for devices
    client.start_scanning().await?;
    thread::sleep(Duration::from_secs(3));
    client.stop_scanning().await?;
    thread::sleep(Duration::from_secs(3));

    // Handle device detection results
    if client.devices().is_empty() {
        println!("No devices connected");
        return Ok(());
    }

    // Initialize device manager with first found device
    println!("Available devices:");
    for device in client.devices() {
        println!("- {}", device.name());
    }

    let mut manager = DeviceManager::new(client);
    manager.device = Some(manager.client.devices()[0].clone());
    DEVICE_MANAGER.set(manager).ok();

    Ok(())
}

/// Sends an oscillation command to the connected device
///
/// Updates the device's intensity value through the device manager.
///
/// # Arguments
/// * `value` - Intensity value between 0.0 and 1.0
///
/// # Returns
/// * `Ok(())` - Command sent successfully
/// * `Err(ButtplugClientError)` - Error sending command
pub async fn oscillate(value: f64) -> Result<(), ButtplugClientError> {
    if let Some(manager) = DEVICE_MANAGER.get() {
        manager.set_value(value).await;
    }
    Ok(())
}