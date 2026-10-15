// src/config.rs

use std::env;
use std::path::PathBuf;

const DEFAULT_INTIFACE_URL: &str = "ws://127.0.0.1:12345/buttplug";

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub video_share_path: PathBuf,
    pub funscript_share_path: PathBuf,
    pub host_ip: String,
    pub server_port: u16,
    pub intiface_server_url: String,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let video_share_path = env::var("VIDEO_SHARE_PATH")
            .map(PathBuf::from)
            .map_err(|_| "VIDEO_SHARE_PATH environment variable must be set".to_string())?;

        let funscript_share_path = env::var("FUNSCRIPT_SHARE_PATH")
            .map(PathBuf::from)
            .map_err(|_| "FUNSCRIPT_SHARE_PATH environment variable must be set".to_string())?;

        let host_ip = env::var("HOST_IP")
            .map_err(|_| "HOST_IP environment variable must be set".to_string())?;

        let server_port = env::var("SERVER_PORT")
            .map_err(|_| "SERVER_PORT environment variable must be set".to_string())?
            .parse::<u16>()
            .map_err(|_| "SERVER_PORT must be a valid port number (0-65535)".to_string())?;

        let intiface_server_url = env::var("INTIFACE_SERVER_URL")
            .unwrap_or_else(|_| DEFAULT_INTIFACE_URL.to_string());

        Ok(Self {
            video_share_path,
            funscript_share_path,
            host_ip,
            server_port,
            intiface_server_url,
        })
    }

    pub fn bind_address(&self) -> String {
        format!("{}:{}", self.host_ip, self.server_port)
    }
}
