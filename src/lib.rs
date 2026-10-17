// src/lib.rs

//! # Interactive Video Player
//!
//! A web application that provides synchronized video playback with hardware control
//! through funscript files. Features include:
//!
//! - Video streaming and playback
//! - Funscript parsing and processing
//! - Real-time hardware synchronization
//! - Interactive UI controls
//!
//! ## Architecture
//!
//! The application is split into several modules:
//!
//! - `routes`: HTTP routing configuration
//! - `handlers`: Request handlers for videos and funscripts
//! - `directory_browser`: File system navigation
//! - `client_socket`: WebSocket handler for device communication
//! - `funscript`: Mathematical funscript parsing, curve processing, and volatility calculations
//! - `device`: Hardware device manager and control loop

pub mod routes;
pub mod handlers {
    pub mod analysis;
    pub mod calibration;
    pub mod editor;
    pub mod funscript;
    pub mod index;
    pub mod recommendations;
    pub mod thumbnail;
    pub mod video;
    pub mod video_stats;
}

pub mod config;
pub use config::AppConfig;

pub mod directory_browser;
pub mod funscripts_cache;
pub mod client_socket;
pub mod utils;

pub mod device {
    pub mod device_manager;
}

pub mod funscript {
    pub mod curves;
    pub mod generation;
    pub mod structs;
    pub mod volatility;
}
