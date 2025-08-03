// src/routes.rs

//! Route configuration for the Video Player web server.
//! Defines all HTTP endpoints and WebSocket connections.

use actix_web::web;
use actix_files::Files;
use crate::{
    handlers::{
        index, 
        video,
        funscript,
        metadata
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
        // search route
        .service(
            web::scope("/api")
                .route("/search", web::get().to(video::search_videos))
                .route("/metadata/{id}", web::get().to(metadata::get_metadata))
                .route("/metadata", web::post().to(metadata::update_metadata))
                .route("/tags", web::get().to(metadata::get_all_tags))
                .route("/videos/cleanup-check", web::get().to(metadata::cleanup_check))
                .route("/videos/remap", web::post().to(metadata::remap_video))
                .route("/videos/untracked", web::get().to(metadata::get_untracked_videos))
                .route("/video/ensure", web::post().to(metadata::ensure_video))
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