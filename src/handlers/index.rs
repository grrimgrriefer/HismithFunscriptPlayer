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
use serde_json::{Value, json};
use std::{
    env,
    path::{PathBuf,Path},
};

const VIDEO_SHARE_ENV: &str = "VIDEO_SHARE_PATH";
const FUNSCRIPT_SHARE_ENV: &str = "FUNSCRIPT_SHARE_PATH";
const FUNSCRIPT_PERMISSION_ERROR: &str = "Server cannot write to the funscripts directory; caching disabled. \
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

    let (mut funscript_cache, funscript_cache_error) = load_funscript_cache().await;

    // Apply parent-directory fallback logic to the cache map, for 3D SBS video variants of 2D videos
    if let Some(cache_obj) = funscript_cache.as_object_mut() {
        apply_cache_fallbacks(cache_obj, &video_base);
    }

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
    text.contains("permission denied")
        || text.contains("failed write")
        || text.contains("permission")
}

fn apply_cache_fallbacks(cache: &mut serde_json::Map<String, serde_json::Value>, video_base: &Path) {
    let video_files = match directory_browser::get_all_files_with_size(video_base) {
        Ok(f) => f,
        Err(_) => return,
    };

    let mut aliases = Vec::new();

    for video_full_path in video_files.keys() {
        let rel_video = match video_full_path.strip_prefix(video_base) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let video_stem_str = rel_video.with_extension("").to_string_lossy().to_string();

        // Only look for fallbacks if the video doesn't already have metadata (direct or variant)
        let has_metadata = cache.keys().any(|k| k.starts_with(&video_stem_str));
        if has_metadata {
            continue;
        }

        // Fallback: /Path/To/Video.mp4 -> /Path/Video.funscript (and all variants)
        if let (Some(parent), Some(stem)) = (rel_video.parent(), rel_video.file_stem()) {
            if let Some(grandparent) = parent.parent() {
                let stem_str = stem.to_string_lossy();
                let fallback_base = grandparent.join(&*stem_str).to_string_lossy().to_string();

                let exact_match = format!("{}.funscript", fallback_base);
                let variant_prefix = format!("{}.", fallback_base);

                for (cache_key, stats) in cache.iter() {
                    let is_exact = cache_key == &exact_match;
                    let is_variant = cache_key.starts_with(&variant_prefix) && cache_key.ends_with(".funscript");

                    if is_exact || is_variant {
                        let suffix = &cache_key[fallback_base.len()..];
                        let alias_key = format!("{}{}", video_stem_str, suffix);
                        aliases.push((alias_key, stats.clone()));
                    }
                }
            }
        }
    }

    for (k, v) in aliases {
        cache.insert(k, v);
    }
}
