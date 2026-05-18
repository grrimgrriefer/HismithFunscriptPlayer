// src/routes.rs

//! Route configuration for the Video Player web server.
//! Defines all HTTP endpoints and WebSocket connections.

use actix_web::{
    web, 
    middleware::DefaultHeaders
};
use actix_files::Files;
use crate::{
    handlers::{
        index, 
        video,
        funscript,
        editor,
        calibration
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
        .service(
            web::resource("/ws")
                .route(web::get().to(intiface_socket::handle_ws_start))
        )
        .service(
            web::scope("/api")
                .route("/directory-tree", web::get().to(index::get_directory_tree))
                .route("/funscripts", web::post().to(editor::save_funscript))
        )
        .service(
            web::scope("/site")
                .route("/", web::get().to(index::handle_index))
                .route("/editor", web::get().to(editor::handle_editor_page))
                .route("/calibration", web::get().to(calibration::handle_calibration_page))
                .route("/video/{filename:.*}", web::get().to(video::handle_video))
                .route("/funscripts/{filename:.*}", web::get().to(funscript::handle_funscript))
                .service(
                    web::scope("/static")
                        .wrap(DefaultHeaders::new().add(("Cache-Control", "no-cache")))
                        .default_service(
                            Files::new("", "./static")
                                .show_files_listing()
                                .use_last_modified(true)
                                .prefer_utf8(true)
                        )
                )
        );
}