// src/routes.rs

//! Route configuration for the Video Player web server.
//!
//! Registers endpoints used by the frontend and API:
//! - /ws -> WebSocket handshake to intiface_socket::handle_ws_start
//! - /api/* -> REST API endpoints (directory-tree, funscripts, calibration)
//! - /site/* -> UI pages and static assets; /site/static serves files from ./static
//!   with a Cache-Control: no-cache header applied.

use crate::{
    handlers::{calibration, editor, funscript, index, video},
    intiface_socket,
};
use actix_files::Files;
use actix_web::{middleware::DefaultHeaders, web};

pub fn setup_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(web::resource("/ws").route(web::get().to(intiface_socket::handle_ws_start)))
        .service(
            web::scope("/api")
                .route("/directory-tree", web::get().to(index::get_directory_tree))
                .route("/funscripts", web::post().to(editor::save_funscript))
                .route("/calibration-mapping", web::get().to(calibration::get_bpm_mapping))
                .route("/calibration-profiles", web::get().to(calibration::get_profiles))
                .route("/calibration-profiles", web::post().to(calibration::save_profile))
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
                                .prefer_utf8(true),
                        ),
                ),
        );
}
