// src/handlers/index.rs

//! Index page handler module
//! 
//! This module handles requests for the main index page of the application
//! and provides API endpoints for site-wide data like the directory structure.
use crate::directory_browser;
use actix_files::NamedFile;
use actix_web::{HttpResponse, Responder, Result};
use log::{error, info};
use std::{env, path::PathBuf};

/// Handles the main index page request by serving the static `index.html` file.
///
/// # Returns
/// * `Ok(NamedFile)` - A file responder for the `index.html` file.
/// * `Err(Error)` - An error if the file cannot be found or accessed.
pub async fn handle_index() -> Result<NamedFile> {
    info!("Serving static index page");
    Ok(NamedFile::open("./static/index.html")?)
}

/// API endpoint to get the directory structure as JSON.
///
/// Builds the directory tree from the `VIDEO_SHARE_PATH` and returns it.
pub async fn get_directory_tree() -> impl Responder {
    info!("Building directory tree for API request.");

    let base_path = match env::var("VIDEO_SHARE_PATH").map(PathBuf::from) {
        Ok(path) => path,
        Err(e) => {
            error!("VIDEO_SHARE_PATH not set: {}", e);
            return HttpResponse::InternalServerError()
                .body("Server configuration error: VIDEO_SHARE_PATH not set");
        }
    };

    match directory_browser::build_directory_tree(&base_path, "") {
        Ok(tree) => HttpResponse::Ok().json(tree),
        Err(e) => {
            error!("Failed to read video directory: {}", e);
            HttpResponse::InternalServerError().body("Failed to load video directory.")
        }
    }
}
