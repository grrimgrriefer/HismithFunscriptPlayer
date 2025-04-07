use actix_web::{web};
use actix_files::Files;
use crate::handlers;
use crate::websocket;

pub fn setup_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::resource("/ws")
            .route(web::get().to(websocket::handle_ws_start))
    ).service(
        web::scope("/site")
            .route("/", web::get().to(handlers::handle_index))
            .route("/video/{filename:.*}", web::get().to(handlers::handle_video))
            .route("/funscripts/{filename:.*}", web::get().to(handlers::handle_funscript))
            .service(
                Files::new("/static", "./static")
                    .show_files_listing()
                    .use_last_modified(true)
                    .prefer_utf8(true)
            )
    );
}