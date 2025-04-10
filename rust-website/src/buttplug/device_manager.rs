use std::{thread, time::Duration, sync::Arc};
use atomic_float::AtomicF64;
use std::sync::atomic::{Ordering};
use buttplug::{client::{device::ScalarValueCommand, ButtplugClientEvent, ButtplugClient, ButtplugClientError, ButtplugClientDevice}, core::connector::new_json_ws_client_connector};use futures::StreamExt;
use once_cell::sync::OnceCell;

static DEVICE_MANAGER: OnceCell<DeviceManager> = OnceCell::new();

pub struct DeviceManager {
    client: ButtplugClient,
    device: Option<Arc<ButtplugClientDevice>>,
    latest_value: Arc<AtomicF64>,
}

impl DeviceManager {
    fn new(client: ButtplugClient) -> Self {
        let manager = Self {
            client,
            device: None,
            latest_value: Arc::new(AtomicF64::new(0.0)),
        };

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

    pub async fn set_value(&self, value: f64) {
        self.latest_value.store(value, Ordering::Relaxed);
    }
}

pub async fn initialize_device() -> Result<(), ButtplugClientError> {
    let connector = new_json_ws_client_connector("ws://127.0.0.1:12345/buttplug");
    let client = ButtplugClient::new("Video player Client");

    // Handle connection errors
    if let Err(err) = client.connect(connector).await {
        eprintln!("Failed to connect to the Buttplug server: {}", err);
        return Err(err);
    }

    let mut events = client.event_stream();

    tokio::spawn(async move {
        while let Some(event) = events.next().await {
        match event {
            ButtplugClientEvent::DeviceAdded(device) => {
            println!("device {} connected", device.name());
            }
            ButtplugClientEvent::DeviceRemoved(info) => {
            println!("device {} removed", info.name());
            }
            ButtplugClientEvent::ScanningFinished => {
            println!("device scanning is finished!");
            }
            _ => {}
        }
        }
    });

    client.start_scanning().await?;
    thread::sleep(Duration::from_secs(3));
    client.stop_scanning().await?;
    thread::sleep(Duration::from_secs(3));

    if client.devices().is_empty() {
        println!("No devices connected, exiting");
        return Ok(());
    }
    else
    {
        println!("Devices:");
        for device in client.devices() {
            println!("- {}", device.name());
        }
    
        if !client.devices().is_empty() {
            let mut manager = DeviceManager::new(client);
            manager.device = Some(manager.client.devices()[0].clone());
            DEVICE_MANAGER.set(manager).ok();
        }
    }

    Ok(())
}

pub async fn oscillate(value: f64) -> Result<(), ButtplugClientError> {
    if let Some(manager) = DEVICE_MANAGER.get() {
        manager.set_value(value).await;
    }
    Ok(())
}