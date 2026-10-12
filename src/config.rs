// src/config.rs

use std::env;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct AppConfig {
    pub video_share_path: PathBuf,
    pub funscript_share_path: PathBuf,
}

impl AppConfig {
    pub fn from_env() -> Result<Self, String> {
        let video_share_path = env::var("VIDEO_SHARE_PATH")
            .map(PathBuf::from)
            .map_err(|_| "VIDEO_SHARE_PATH environment variable must be set".to_string())?;

        let funscript_share_path = env::var("FUNSCRIPT_SHARE_PATH")
            .map(PathBuf::from)
            .map_err(|_| "FUNSCRIPT_SHARE_PATH environment variable must be set".to_string())?;

        Ok(Self {
            video_share_path,
            funscript_share_path,
        })
    }
}
