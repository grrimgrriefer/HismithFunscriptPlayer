// src/handlers/recommendations.rs

//! Recommendation API handler module
//!
//! Provides endpoints for next-video and folder-start recommendations
//! by analyzing peak/average intensity statistics of videos in the directory tree.

use crate::directory_browser::{self, FileNode};
use crate::funscript_cache;
use actix_web::{HttpResponse, Responder, web};
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::env;
use std::path::{Path, PathBuf};

const VIDEO_SHARE_ENV: &str = "VIDEO_SHARE_PATH";
const FUNSCRIPT_SHARE_ENV: &str = "FUNSCRIPT_SHARE_PATH";

#[derive(Deserialize)]
pub struct NextQuery {
    pub video: String,
    pub exclude: Option<String>,
}

#[derive(Deserialize)]
pub struct FolderStartQuery {
    pub folder: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct RecommendedVideo {
    pub path: String,
    pub name: String,
    pub peak: f64,
    pub avg: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_peak: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_avg: Option<f64>,
}

#[derive(Serialize)]
pub struct NextRecommendationsResponse {
    pub lower: Option<RecommendedVideo>,
    pub similar: Option<RecommendedVideo>,
    pub higher: Option<RecommendedVideo>,
}

#[derive(Serialize)]
pub struct FolderStartRecommendationsResponse {
    pub low: Option<RecommendedVideo>,
    pub med: Option<RecommendedVideo>,
    pub high: Option<RecommendedVideo>,
}

/// GET /api/recommendations/next?video=...&exclude=...
pub async fn get_next_recommendations(query: web::Query<NextQuery>) -> impl Responder {
    let video_base = match env::var(VIDEO_SHARE_ENV) {
        Ok(p) => PathBuf::from(p),
        Err(_) => return HttpResponse::InternalServerError().body("VIDEO_SHARE_PATH not set"),
    };

    let funscript_base = env::var(FUNSCRIPT_SHARE_ENV).map(PathBuf::from).ok();
    let cache = if let Some(ref fb) = funscript_base {
        funscript_cache::get_cache_for_base(fb).await.unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let tree = match directory_browser::build_directory_tree(&video_base, "") {
        Ok(t) => t,
        Err(_) => return HttpResponse::InternalServerError().body("Failed to build directory tree"),
    };

    let target_path = &query.video;
    let excluded_paths: HashSet<String> = query
        .exclude
        .as_deref()
        .unwrap_or("")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    let parent_path = Path::new(target_path)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();

    let sibling_videos = get_videos_in_folder(&tree, &parent_path);

    let mut videos_with_stats = Vec::new();
    let mut current_video_peak = None;
    let mut current_video_avg = None;

    for v in sibling_videos {
        if let Some((peak, avg)) = get_stats_for_video(&v.path, &cache) {
            if v.path == *target_path {
                current_video_peak = Some(peak);
                current_video_avg = Some(avg);
            }
            videos_with_stats.push(RecommendedVideo {
                path: v.path,
                name: v.name,
                peak,
                avg,
                delta_peak: None,
                delta_avg: None,
            });
        }
    }

    let Some(current_peak) = current_video_peak else {
        return HttpResponse::Ok().json(NextRecommendationsResponse {
            lower: None,
            similar: None,
            higher: None,
        });
    };

    let mut lower = find_random_video(&videos_with_stats, target_path, current_peak, -22.5, -7.5, &excluded_paths);
    let mut similar = find_random_video(&videos_with_stats, target_path, current_peak, -7.5, 7.5, &excluded_paths)
        .or_else(|| find_closest_video(&videos_with_stats, target_path, current_peak, &excluded_paths));
    let mut higher = find_random_video(&videos_with_stats, target_path, current_peak, 7.5, 22.5, &excluded_paths);

    if let Some(ca) = current_video_avg {
        if let Some(ref mut r) = lower {
            r.delta_peak = Some(r.peak - current_peak);
            r.delta_avg = Some(r.avg - ca);
        }
        if let Some(ref mut r) = similar {
            r.delta_peak = Some(r.peak - current_peak);
            r.delta_avg = Some(r.avg - ca);
        }
        if let Some(ref mut r) = higher {
            r.delta_peak = Some(r.peak - current_peak);
            r.delta_avg = Some(r.avg - ca);
        }
    }

    HttpResponse::Ok().json(NextRecommendationsResponse {
        lower,
        similar,
        higher,
    })
}

/// GET /api/recommendations/folder-start?folder=...
pub async fn get_folder_start_recommendations(query: web::Query<FolderStartQuery>) -> impl Responder {
    let video_base = match env::var(VIDEO_SHARE_ENV) {
        Ok(p) => PathBuf::from(p),
        Err(_) => return HttpResponse::InternalServerError().body("VIDEO_SHARE_PATH not set"),
    };

    let funscript_base = env::var(FUNSCRIPT_SHARE_ENV).map(PathBuf::from).ok();
    let cache = if let Some(ref fb) = funscript_base {
        funscript_cache::get_cache_for_base(fb).await.unwrap_or_default()
    } else {
        std::collections::HashMap::new()
    };

    let tree = match directory_browser::build_directory_tree(&video_base, "") {
        Ok(t) => t,
        Err(_) => return HttpResponse::InternalServerError().body("Failed to build directory tree"),
    };

    let folder_videos = get_videos_in_folder(&tree, &query.folder);

    let mut videos_with_stats = Vec::new();
    for v in folder_videos {
        if let Some((peak, avg)) = get_stats_for_video(&v.path, &cache) {
            videos_with_stats.push(RecommendedVideo {
                path: v.path,
                name: v.name,
                peak,
                avg,
                delta_peak: None,
                delta_avg: None,
            });
        }
    }

    let mut selected_paths = HashSet::new();

    let low = find_closest_to_intensity(&videos_with_stats, 20.0, &selected_paths);
    if let Some(ref r) = low {
        selected_paths.insert(r.path.clone());
    }

    let med = find_closest_to_intensity(&videos_with_stats, 35.0, &selected_paths);
    if let Some(ref r) = med {
        selected_paths.insert(r.path.clone());
    }

    let high = find_closest_to_intensity(&videos_with_stats, 50.0, &selected_paths);

    HttpResponse::Ok().json(FolderStartRecommendationsResponse {
        low,
        med,
        high,
    })
}

fn get_videos_in_folder(tree: &FileNode, folder_path: &str) -> Vec<FileNode> {
    fn find_node<'a>(node: &'a FileNode, path: &str) -> Option<&'a FileNode> {
        if node.path == path && node.is_dir {
            return Some(node);
        }
        if let Some(ref children) = node.children {
            for child in children {
                if let Some(found) = find_node(child, path) {
                    return Some(found);
                }
            }
        }
        None
    }

    let target_node = if folder_path.is_empty() {
        Some(tree)
    } else {
        find_node(tree, folder_path)
    };

    let mut result = Vec::new();
    if let Some(node) = target_node {
        if let Some(ref children) = node.children {
            for child in children {
                if !child.is_dir {
                    result.push(child.clone());
                }
            }
        }
    }
    result
}

fn get_stats_for_video(
    file_path: &str,
    cache: &funscript_cache::FunscriptCache,
) -> Option<(f64, f64)> {
    let stem_path = Path::new(file_path).with_extension("");
    let stem_str = stem_path.to_string_lossy();
    let exact_match = format!("{stem_str}.funscript");
    let variant_prefix = format!("{stem_str}.");

    for (key, val) in cache {
        let is_exact = key == &exact_match;
        let is_variant = key.starts_with(&variant_prefix) && key.ends_with(".funscript");

        if is_exact || is_variant {
            return Some((val.peak_intensity, val.average_intensity));
        }
    }
    None
}

fn find_random_video(
    videos: &[RecommendedVideo],
    current_path: &str,
    current_peak: f64,
    min_diff: f64,
    max_diff: f64,
    excluded: &HashSet<String>,
) -> Option<RecommendedVideo> {
    let mut rng = rand::rng();

    let candidates: Vec<&RecommendedVideo> = videos
        .iter()
        .filter(|v| v.path != current_path && !excluded.contains(&v.path))
        .filter(|v| {
            let diff = v.peak - current_peak;
            diff >= min_diff && diff <= max_diff
        })
        .collect();

    if let Some(&choice) = candidates.choose(&mut rng) {
        return Some(choice.clone());
    }

    let fallback_candidates: Vec<&RecommendedVideo> = videos
        .iter()
        .filter(|v| v.path != current_path)
        .filter(|v| {
            let diff = v.peak - current_peak;
            diff >= min_diff && diff <= max_diff
        })
        .collect();

    fallback_candidates.choose(&mut rng).map(|&v| v.clone())
}

fn find_closest_video(
    videos: &[RecommendedVideo],
    current_path: &str,
    current_peak: f64,
    excluded: &HashSet<String>,
) -> Option<RecommendedVideo> {
    videos
        .iter()
        .filter(|v| v.path != current_path && !excluded.contains(&v.path))
        .min_by(|a, b| {
            let diff_a = (a.peak - current_peak).abs();
            let diff_b = (b.peak - current_peak).abs();
            diff_a.partial_cmp(&diff_b).unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned()
}

fn find_closest_to_intensity(
    videos: &[RecommendedVideo],
    target_intensity: f64,
    excluded: &HashSet<String>,
) -> Option<RecommendedVideo> {
    videos
        .iter()
        .filter(|v| !excluded.contains(&v.path))
        .min_by(|a, b| {
            let diff_a = (a.peak - target_intensity).abs();
            let diff_b = (b.peak - target_intensity).abs();
            diff_a.partial_cmp(&diff_b).unwrap_or(std::cmp::Ordering::Equal)
        })
        .cloned()
}
