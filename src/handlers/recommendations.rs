// src/handlers/recommendations.rs

//! Recommendation API handler module
//!
//! Provides endpoints for next-video and folder-start recommendations
//! by analyzing peak/average intensity statistics of videos in the directory tree.

use crate::AppConfig;
use crate::directory_browser::{self, FileNode};
use crate::handlers::video_stats;
use crate::funscripts_cache;
use actix_web::{HttpResponse, Responder, web};
use rand::seq::IndexedRandom;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;

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
    pub volatility: f64,
    #[serde(default)]
    pub duration: u64,
    #[serde(default)]
    pub views: u32,
    #[serde(default)]
    pub likes: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_peak: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_avg: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub delta_volatility: Option<f64>,
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
pub async fn get_next_recommendations(
    config: web::Data<AppConfig>,
    query: web::Query<NextQuery>,
) -> impl Responder {
    let video_base = &config.video_share_path;
    let cache = funscripts_cache::get_cache_for_base(&config.funscript_share_path)
        .await
        .unwrap_or_default();

    let tree = match directory_browser::build_directory_tree(video_base, "") {
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
    let user_stats = video_stats::read_video_stats(&config.funscript_share_path).await;

    let mut videos_with_stats = Vec::new();
    let mut current_video_peak = None;
    let mut current_video_avg = None;
    let mut current_video_volatility = None;

    for v in sibling_videos {
        if let Some((peak, avg, volatility, duration)) = get_stats_for_video(&v.path, &cache) {
            if v.path == *target_path {
                current_video_peak = Some(peak);
                current_video_avg = Some(avg);
                current_video_volatility = Some(volatility);
            }
            let (views, likes) = user_stats
                .get(&v.path)
                .map(|s| (s.views, s.likes))
                .unwrap_or((0, 0));

            videos_with_stats.push(RecommendedVideo {
                path: v.path,
                name: v.name,
                peak,
                avg,
                volatility,
                duration,
                views,
                likes,
                delta_peak: None,
                delta_avg: None,
                delta_volatility: None,
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

    if let (Some(cp), Some(ca), Some(cv)) = (current_video_peak, current_video_avg, current_video_volatility) {
        if let Some(ref mut r) = lower {
            r.delta_peak = Some(r.peak - cp);
            r.delta_avg = Some(r.avg - ca);
            r.delta_volatility = Some(r.volatility - cv);
        }
        if let Some(ref mut r) = similar {
            r.delta_peak = Some(r.peak - cp);
            r.delta_avg = Some(r.avg - ca);
            r.delta_volatility = Some(r.volatility - cv);
        }
        if let Some(ref mut r) = higher {
            r.delta_peak = Some(r.peak - cp);
            r.delta_avg = Some(r.avg - ca);
            r.delta_volatility = Some(r.volatility - cv);
        }
    }

    HttpResponse::Ok().json(NextRecommendationsResponse {
        lower,
        similar,
        higher,
    })
}

/// GET /api/recommendations/folder-start?folder=...
pub async fn get_folder_start_recommendations(
    config: web::Data<AppConfig>,
    query: web::Query<FolderStartQuery>,
) -> impl Responder {
    let video_base = &config.video_share_path;
    let cache = funscripts_cache::get_cache_for_base(&config.funscript_share_path)
        .await
        .unwrap_or_default();

    let tree = match directory_browser::build_directory_tree(video_base, "") {
        Ok(t) => t,
        Err(_) => return HttpResponse::InternalServerError().body("Failed to build directory tree"),
    };

    let folder_videos = get_videos_in_folder(&tree, &query.folder);
    let user_stats = video_stats::read_video_stats(&config.funscript_share_path).await;

    let mut videos_with_stats = Vec::new();
    for v in folder_videos {
        if let Some((peak, avg, volatility, duration)) = get_stats_for_video(&v.path, &cache) {
            let (views, likes) = user_stats
                .get(&v.path)
                .map(|s| (s.views, s.likes))
                .unwrap_or((0, 0));

            videos_with_stats.push(RecommendedVideo {
                path: v.path,
                name: v.name,
                peak,
                avg,
                volatility,
                duration,
                views,
                likes,
                delta_peak: None,
                delta_avg: None,
                delta_volatility: None,
            });
        }
    }

    if videos_with_stats.is_empty() {
        return HttpResponse::Ok().json(FolderStartRecommendationsResponse {
            low: None,
            med: None,
            high: None,
        });
    }

    // Sort videos by avg intensity ascending
    videos_with_stats.sort_by(|a, b| {
        a.avg.partial_cmp(&b.avg).unwrap_or(std::cmp::Ordering::Equal)
    });

    let total = videos_with_stats.len();
    let low_end = ((total as f64) * 0.30).round() as usize;
    let high_start = ((total as f64) * 0.70).round() as usize;

    let low_end = low_end.clamp(1, total);
    let high_start = high_start.clamp(low_end, total);

    let low_slice = &videos_with_stats[..low_end];
    let med_slice = &videos_with_stats[low_end..high_start];
    let high_slice = &videos_with_stats[high_start..];

    let mut selected_paths = HashSet::new();

    let low = pick_random_from_bucket(low_slice, &videos_with_stats, &selected_paths);
    if let Some(ref r) = low {
        selected_paths.insert(r.path.clone());
    }

    let med = pick_random_from_bucket(med_slice, &videos_with_stats, &selected_paths);
    if let Some(ref r) = med {
        selected_paths.insert(r.path.clone());
    }

    let high = pick_random_from_bucket(high_slice, &videos_with_stats, &selected_paths);

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
    cache: &funscripts_cache::FunscriptCache,
) -> Option<(f64, f64, f64, u64)> {
    let (exact_match, variant_prefix) = funscripts_cache::get_cache_match_keys(file_path);

    for (key, val) in cache {
        if funscripts_cache::is_matching_key(key, &exact_match, &variant_prefix) {
            return Some((val.peak_intensity, val.average_intensity, val.volatility, val.duration));
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

fn pick_random_from_bucket(
    bucket: &[RecommendedVideo],
    fallback_all: &[RecommendedVideo],
    excluded: &HashSet<String>,
) -> Option<RecommendedVideo> {
    let mut rng = rand::rng();

    let candidates: Vec<&RecommendedVideo> = bucket
        .iter()
        .filter(|v| !excluded.contains(&v.path))
        .collect();

    if let Some(&choice) = candidates.choose(&mut rng) {
        return Some(choice.clone());
    }

    let fallback_candidates: Vec<&RecommendedVideo> = fallback_all
        .iter()
        .filter(|v| !excluded.contains(&v.path))
        .collect();

    if let Some(&choice) = fallback_candidates.choose(&mut rng) {
        return Some(choice.clone());
    }

    bucket.choose(&mut rng).or_else(|| fallback_all.choose(&mut rng)).cloned()
}
