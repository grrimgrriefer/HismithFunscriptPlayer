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
//! - `intiface_socket`: WebSocket handler for device communication
//! - `buttplug`: Device control and funscript processing

pub mod routes;
pub mod handlers {
    pub mod calibration;
    pub mod editor;
    pub mod funscript;
    pub mod index;
    pub mod video;
}

pub mod directory_browser;
pub mod funscript_cache;
pub mod intiface_socket;

/// Buttplug-related functionality for device control and funscript processing
pub mod buttplug {
    pub mod device_manager;
    pub mod funscript_utils;
}
