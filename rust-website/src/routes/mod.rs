use actix_web::{web};
use actix_files::Files;
use crate::handlers;

pub fn setup_routes(cfg: &mut web::ServiceConfig) {
    cfg.service(
        web::scope("")
            .route("/", web::get().to(handlers::handle_index))
            .route("/video/{filename:.*}", web::get().to(handlers::handle_video))
            .service(Files::new("/static", "./static").show_files_listing())
    );
}