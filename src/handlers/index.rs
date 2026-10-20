// src/handlers/index.rs

//! Index page and directory tree API handler module
//!
//! Serves the main index.html page and provides a JSON API endpoint that
//! returns the video directory tree (from VIDEO_SHARE_PATH) along with
//! precomputed funscript cache data (from FUNSCRIPT_SHARE_PATH) including
//! average/peak intensity statistics for each funscript file.

use crate::AppConfig;
use crate::directory_browser::{self, FileNode};
use crate::funscripts_cache;
use crate::handlers::video_stats::{self, VideoStatsMap};
use crate::funscript::structs::FunscriptStats;
use crate::utils;
use actix_files::NamedFile;
use actix_web::{HttpResponse, Responder, Result, web};
use log::{error, info, warn};
use serde_json::{Value, json};
use std::path::Path;

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
pub async fn get_directory_tree(config: web::Data<AppConfig>) -> impl Responder {
    info!("Building directory tree for API request.");

    let video_base = &config.video_share_path;

    let mut directory_tree = match directory_browser::build_directory_tree(video_base, "") {
        Ok(tree) => tree,
        Err(e) => {
            error!("Failed to read video directory: {}", e);
            return HttpResponse::InternalServerError().body("Failed to load video directory.");
        }
    };

    let (mut funscripts_cache, funscripts_cache_error) = load_funscripts_cache(&config.funscript_share_path).await;
    let user_stats = video_stats::read_video_stats(&config.funscript_share_path).await;

    if let Some(cache_obj) = funscripts_cache.as_object_mut() {
        apply_cache_fallbacks(cache_obj, video_base);
        populate_and_sort_tree(&mut directory_tree, cache_obj, &user_stats);
    } else {
        let empty_cache = serde_json::Map::new();
        populate_and_sort_tree(&mut directory_tree, &empty_cache, &user_stats);
    }

    HttpResponse::Ok().json(json!({
        "tree": directory_tree,
        "funscripts": funscripts_cache,
        "funscripts_cache_error": funscripts_cache_error
    }))
}

fn populate_and_sort_tree(node: &mut FileNode, cache: &serde_json::Map<String, serde_json::Value>, user_stats: &VideoStatsMap) {
    if node.is_dir {
        if let Some(children) = &mut node.children {
            for child in children.iter_mut() {
                populate_and_sort_tree(child, cache, user_stats);
            }
        }
    } else {
        node.stats = extract_stats_for_file(&node.path, cache);
        node.user_stats = Some(user_stats.get(&node.path).cloned().unwrap_or_default());
    }
}

fn extract_stats_for_file(
    file_path: &str,
    cache: &serde_json::Map<String, serde_json::Value>,
) -> Option<Vec<FunscriptStats>> {
    let mut stats = Vec::new();

    for (_key, val) in funscripts_cache::query_cache(cache, file_path) {
        let peak = val.get("peak").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let avg = val.get("avg").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let volatility = val.get("volatility").and_then(|v| v.as_f64()).unwrap_or(0.0);
        let duration = val.get("duration").and_then(|v| v.as_u64()).unwrap_or(0);

        if peak.is_finite() || avg.is_finite() {
            // Rounding required by JS badges
            let rounded_peak = if peak.is_finite() { peak.round() } else { f64::NAN };
            let rounded_avg = if avg.is_finite() { avg.round() } else { f64::NAN };
            let rounded_vol = if volatility.is_finite() { (volatility * 10.0).round() / 10.0 } else { f64::NAN };
            stats.push(FunscriptStats {
                peak: rounded_peak,
                avg: rounded_avg,
                volatility: rounded_vol,
                duration,
            });
        }
    }

    if stats.is_empty() {
        return None;
    }

    // Sort ascending: peak first, then average
    stats.sort_by(|a, b| {
        let ap = if a.peak.is_finite() { a.peak } else { f64::INFINITY };
        let bp = if b.peak.is_finite() { b.peak } else { f64::INFINITY };
        if ap != bp {
            return ap.partial_cmp(&bp).unwrap_or(std::cmp::Ordering::Equal);
        }
        let aa = if a.avg.is_finite() { a.avg } else { 0.0 };
        let ba = if b.avg.is_finite() { b.avg } else { 0.0 };
        aa.partial_cmp(&ba).unwrap_or(std::cmp::Ordering::Equal)
    });

    // Deduplicate rounded peak/avg combinations using a HashSet
    let mut deduped = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for s in stats {
        let key = format!(
            "{}|{}",
            if s.peak.is_finite() { s.peak.to_string() } else { "_".to_string() },
            if s.avg.is_finite() { s.avg.to_string() } else { "_".to_string() }
        );
        if !seen.contains(&key) {
            seen.insert(key);
            deduped.push(s);
        }
    }

    if deduped.is_empty() {
        None
    } else {
        Some(deduped)
    }
}

async fn load_funscripts_cache(base: &Path) -> (Value, Option<String>) {
    match funscripts_cache::get_cache_for_base(base).await {
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
    let video_files = directory_browser::get_all_file_paths(video_base);

    let mut aliases = Vec::new();

    for video_full_path in &video_files {
        let rel_video = match video_full_path.strip_prefix(video_base) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let video_stem_str = rel_video.with_extension("").to_string_lossy().to_string();

        let has_metadata = cache.keys().any(|k| k.starts_with(&video_stem_str));
        if has_metadata {
            continue;
        }

        // Fallback: /Path/To/Video.mp4 -> /Path/Video.funscript (and all variants)
        if let Some(fallback_path) = utils::get_parent_fallback_path(rel_video) {
            let fallback_base = fallback_path.with_extension("").to_string_lossy().to_string();

            for (cache_key, stats) in funscripts_cache::query_cache(&*cache, &fallback_path.to_string_lossy()) {
                let suffix = &cache_key[fallback_base.len()..];
                let alias_key = format!("{}{}", video_stem_str, suffix);
                aliases.push((alias_key, stats.clone()));
            }
        }
    }

    for (k, v) in aliases {
        cache.insert(k, v);
    }
}
