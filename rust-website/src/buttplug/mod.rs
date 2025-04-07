use std::{thread, time::Duration, sync::Arc};
use buttplug::{client::{device::ScalarValueCommand, ButtplugClientEvent, ButtplugClient, ButtplugClientError, ButtplugClientDevice}, core::connector::new_json_ws_client_connector};use futures::StreamExt;
use once_cell::sync::OnceCell;

static DEVICE_MANAGER: OnceCell<DeviceManager> = OnceCell::new();

pub struct DeviceManager {
    client: ButtplugClient,
    device: Option<Arc<ButtplugClientDevice>>,
}

impl DeviceManager {
    fn new(client: ButtplugClient) -> Self {
        Self {
            client,
            device: None,
        }
    }

    pub async fn oscillate(&self, value: f64) -> Result<(), ButtplugClientError> {
        if let Some(device) = &self.device {
            device.oscillate(&ScalarValueCommand::ScalarValue(value)).await?;
        }
        Ok(())
    }
}

pub async fn initialize_device() -> Result<(), ButtplugClientError> {
    let connector = new_json_ws_client_connector("ws://127.0.0.1:12345/buttplug");
    let client = ButtplugClient::new("Video player Client");
    client.connect(connector).await?;
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
        manager.oscillate(value).await?;
    }
    Ok(())
}