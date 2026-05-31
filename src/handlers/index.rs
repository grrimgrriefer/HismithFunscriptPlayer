// src/handlers/index.rs

//! Index page and directory tree API handler module
//!
//! Serves the main index.html page and provides a JSON API endpoint that
//! returns the video directory tree (from VIDEO_SHARE_PATH) along with
//! precomputed funscript cache data (from FUNSCRIPT_SHARE_PATH) including
//! average/peak intensity statistics for each funscript file.

use crate::directory_browser;
use crate::funscript_cache;
use actix_files::NamedFile;
use actix_web::{HttpResponse, Responder, Result};
use log::{error, info, warn};
use serde_json::{json, Value};
use std::{env, path::PathBuf};

const VIDEO_SHARE_ENV: &str = "VIDEO_SHARE_PATH";
const FUNSCRIPT_SHARE_ENV: &str = "FUNSCRIPT_SHARE_PATH";
const FUNSCRIPT_PERMISSION_ERROR: &str =
    "Server cannot write to the funscripts directory; caching disabled. \
Please ensure the server process has write permissions to the FUNSCRIPT_SHARE_PATH.";

/// Handles the main index page request by serving the static `index.html` file.
pub async fn handle_index() -> Result<impl Responder> {
    Ok(NamedFile::open("./static/index.html")?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}

/// API endpoint to get the directory structure as JSON.
///
/// Builds the directory tree from `VIDEO_SHARE_PATH` and optionally includes
/// funscript cache data from `FUNSCRIPT_SHARE_PATH`.
pub async fn get_directory_tree() -> impl Responder {
    info!("Building directory tree for API request.");

    let video_base = match required_env_path(VIDEO_SHARE_ENV) {
        Ok(path) => path,
        Err(response) => return response,
    };

    let directory_tree = match directory_browser::build_directory_tree(&video_base, "") {
        Ok(tree) => tree,
        Err(e) => {
            error!("Failed to read video directory: {}", e);
            return HttpResponse::InternalServerError().body("Failed to load video directory.");
        }
    };

    let (funscript_cache, funscript_cache_error) = load_funscript_cache().await;

    HttpResponse::Ok().json(json!({
        "tree": directory_tree,
        "funscripts": funscript_cache,
        "funscript_cache_error": funscript_cache_error
    }))
}

fn required_env_path(key: &str) -> Result<PathBuf, HttpResponse> {
    env::var(key).map(PathBuf::from).map_err(|e| {
        error!("{key} not set: {e}");
        HttpResponse::InternalServerError()
            .body(format!("Server configuration error: {key} not set"))
    })
}

async fn load_funscript_cache() -> (Value, Option<String>) {
    let base = match env::var(FUNSCRIPT_SHARE_ENV) {
        Ok(path) => path,
        Err(_) => return (json!({}), None), // Optional feature: no env var means no cache data.
    };

    match funscript_cache::get_cache_for_base(&PathBuf::from(base)).await {
        Ok(cache_map) => (json!(cache_map), None),
        Err(e) => {
            warn!("Funscript cache build failed: {}", e);
            let message = if is_permission_like_error(&e) {
                FUNSCRIPT_PERMISSION_ERROR.to_string()
            } else {
                format!("Funscript cache build failed: {e}")
            };
            (json!({}), Some(message))
        }
    }
}

fn is_permission_like_error(error_text: &str) -> bool {
    let text = error_text.to_lowercase();
    text.contains("permission denied") || text.contains("failed write") || text.contains("permission")
}
