// src/handlers/calibration.rs

use actix_files::NamedFile;
use actix_web::{Error, Responder};

pub async fn handle_calibration_page() -> Result<impl Responder, Error> {
    Ok(NamedFile::open("./static/calibration.html")?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}
