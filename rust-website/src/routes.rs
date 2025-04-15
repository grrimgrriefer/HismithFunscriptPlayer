// src/routes.rs

//! Route configuration for the Video Player web server.
//! Defines all HTTP endpoints and WebSocket connections.

use actix_web::web;
use actix_files::Files;
use crate::{
    handlers::{
        index, 
        video,
        funscript
    },
    intiface_socket
};

/// Configures all routes for the web server.
/// 
/// # Routes
/// - `/ws` - WebSocket endpoint for device control
/// - `/site` - Main web application routes:
///   - `/` - Index page
///   - `/video/{filename}` - Video streaming
///   - `/funscripts/{filename}` - Funscript files
///   - `/static/*` - Static file serving
/// 
/// # Arguments
/// * `cfg` - Service configuration to add routes to
pub fn setup_routes(cfg: &mut web::ServiceConfig) {
    cfg
        // WebSocket route for device communication
        .service(
            web::resource("/ws")
                .route(web::get().to(intiface_socket::handle_ws_start))
        )
        // Main site routes
        .service(
            web::scope("/site")
                .route("/", web::get().to(index::handle_index))
                .route("/video/{filename:.*}", web::get().to(video::handle_video))
                .route("/funscripts/{filename:.*}", web::get().to(funscript::handle_funscript))
                // Static file serving configuration
                .service(
                    Files::new("/static", "./static")
                        .show_files_listing()
                        .use_last_modified(true)
                        .prefer_utf8(true)
                )
        );
}