// src/handlers/metadata.rs

use actix_web::{web, HttpResponse};
use crate::db::database::{Database, VideoMetadataUpdatePayload, GetOrCreateResult};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap};
use std::env;
use std::path::PathBuf;
use crate::directory_browser;

#[derive(Deserialize)]
pub struct MetadataUpdate {
    id: i64,
    rating: Option<i32>,
    tags: Option<Vec<String>>,
    avg_intensity: Option<f64>,
    max_intensity: Option<f64>,
    duration: Option<f64>,
    has_funscript: Option<bool>,
}

pub async fn update_metadata(
    payload: web::Json<MetadataUpdate>,
    db: web::Data<Database>,
) -> HttpResponse {
    let db_payload = VideoMetadataUpdatePayload {
        id: payload.id,
        rating: payload.rating,
        tags: payload.tags.clone(),
        avg_intensity: payload.avg_intensity.map(|f| f.round() as i64),
        max_intensity: payload.max_intensity.map(|f| f.round() as i64),
        duration: payload.duration.map(|d| d.round() as i64),
        has_funscript: payload.has_funscript,
    };

    match db.update_video_metadata(&db_payload) {
        Ok(_) => HttpResponse::Ok().json(serde_json::json!({ "status": "success" })),
        Err(e) => {
            log::error!("Failed to update metadata: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "status": "error",
                "message": "Failed to update metadata"
            }))
        }
    }
}

#[derive(Deserialize)]
pub struct EnsureVideoPayload {
    path: String,
    filename: String,
}

pub async fn ensure_video(
    payload: web::Json<EnsureVideoPayload>,
    db: web::Data<Database>,
) -> HttpResponse {
    match db.get_or_create_video(&payload.path, &payload.filename) {
        Ok(GetOrCreateResult::Created(metadata)) => HttpResponse::Created().json(metadata),
        Ok(GetOrCreateResult::FoundByPath(metadata)) => HttpResponse::Ok().json(metadata),
        Ok(GetOrCreateResult::FoundByContent(mut metadata)) => {
            if let Ok(base_path) = env::var("VIDEO_SHARE_PATH") {
                let full_path = PathBuf::from(base_path).join(&metadata.path);
                metadata.path = format!("file://{}", full_path.to_string_lossy());
            }
            HttpResponse::Conflict().json(metadata)
        }
        Err(e) => {
            log::error!("Failed to ensure video exists: {}", e);
            HttpResponse::InternalServerError().json(serde_json::json!({
                "error": "Failed to get or create video metadata"
            }))
        }
    }
}

pub async fn get_all_tags(
    db: web::Data<Database>,
) -> HttpResponse {
    match db.get_all_tags() {
        Ok(tags) => HttpResponse::Ok()
            .content_type("application/json")
            .json(tags),
        Err(e) => {
            log::error!("Failed to get all tags: {}", e);
            HttpResponse::InternalServerError()
                .content_type("application/json")
                .json(serde_json::json!({ "error": "Failed to retrieve tags" }))
        }
    }
}

pub async fn get_metadata(
    id: web::Path<i64>,
    db: web::Data<Database>,
) -> HttpResponse {
    match db.get_video_metadata(*id) {
        Ok(metadata) => HttpResponse::Ok()
            .content_type("application/json")
            .json(metadata),
        Err(e) => {
            log::error!("Failed to get metadata: {}", e);
            HttpResponse::InternalServerError()
                .content_type("application/json")
                .json(serde_json::json!({
                    "error": "Failed to get metadata"
                }))
        }
    }
}

#[derive(Serialize)]
pub struct CleanupSuggestion {
    orphan_id: i64,
    orphan_path: String,
    potential_match_path: String,
}

pub async fn cleanup_check(db: web::Data<Database>) -> HttpResponse {
    let base_path_str = match env::var("VIDEO_SHARE_PATH") {
        Ok(p) => p,
        Err(_) => return HttpResponse::InternalServerError().json("VIDEO_SHARE_PATH not set"),
    };
    let base_path = PathBuf::from(base_path_str);

    let db_videos = match db.get_all_videos_for_check() {
        Ok(v) => v,
        Err(e) => {
            log::error!("Cleanup check failed to query DB: {}", e);
            return HttpResponse::InternalServerError().json("Failed to query database");
        }
    };

    let disk_files = match directory_browser::get_all_files_with_size(&base_path) {
        Ok(f) => f,
        Err(e) => {
            log::error!("Cleanup check failed to scan directory: {}", e);
            return HttpResponse::InternalServerError().json("Failed to scan video directory");
        }
    };

    let mut orphans = Vec::new();
    for video in &db_videos {
        if !base_path.join(&video.path).exists() {
            orphans.push(video);
        }
    }

    let mut files_on_disk_by_size: HashMap<i64, Vec<String>> = HashMap::new();
    for (path, size) in disk_files {
        files_on_disk_by_size
            .entry(size as i64)
            .or_default()
            .push(path.to_string_lossy().into_owned());
    }

    let suggestions: Vec<CleanupSuggestion> = orphans
        .into_iter()
        .filter_map(|orphan| {
            if let Some(matching_files) = files_on_disk_by_size.get(&orphan.file_size) {
                if matching_files.len() == 1 {
                    return Some(CleanupSuggestion {
                        orphan_id: orphan.id,
                        orphan_path: orphan.path.clone(),
                        potential_match_path: matching_files[0].clone(),
                    });
                }
            }
            None
        })
        .collect();

    HttpResponse::Ok().json(suggestions)
}

#[derive(Deserialize)]
pub struct RemapPayload {
    orphan_id: i64,
    new_path: String,
}

pub async fn remap_video(
    payload: web::Json<RemapPayload>,
    db: web::Data<Database>,
) -> HttpResponse {
    match db.video_exists_by_path(&payload.new_path) {
        Ok(Some(existing_id)) => {
            if db.delete_video(existing_id).is_err() {
                return HttpResponse::InternalServerError().json("Failed to delete stale record at target path.");
            }

            match db.update_video_path(payload.orphan_id, &payload.new_path) {
                Ok(_) => HttpResponse::Ok().json("Stale record deleted and video path remapped successfully."),
                Err(_) => HttpResponse::InternalServerError().json("Failed to remap video path after deleting stale record."),
            }
        }
        Ok(None) => {
            match db.update_video_path(payload.orphan_id, &payload.new_path) {
                Ok(_) => HttpResponse::Ok().json("Video path remapped successfully."),
                Err(_) => HttpResponse::InternalServerError().json("Failed to remap video path."),
            }
        }
        Err(_) => HttpResponse::InternalServerError().json("Database error during check."),
    }
}

pub async fn get_untracked_videos(db: web::Data<Database>) -> HttpResponse {
    let base_path_str = match env::var("VIDEO_SHARE_PATH") {
        Ok(p) => p,
        Err(_) => return HttpResponse::InternalServerError().json("VIDEO_SHARE_PATH not set"),
    };
    let base_path = PathBuf::from(base_path_str);

    let db_paths = match db.get_all_video_paths() {
        Ok(p) => p,
        Err(e) => {
            log::error!("Failed to get video paths from DB: {}", e);
            return HttpResponse::InternalServerError().json("Failed to query database");
        }
    };

    let disk_files = match directory_browser::get_all_files_with_size(&base_path) {
        Ok(f) => f,
        Err(e) => {
            log::error!("Failed to scan directory for untracked files: {}", e);
            return HttpResponse::InternalServerError().json("Failed to scan video directory");
        }
    };

    let mut untracked_files: Vec<String> = disk_files
        .keys()
        .filter_map(|disk_path| {
            let path_str = disk_path.to_string_lossy().to_string();
            if !db_paths.contains(&path_str) {
                Some(path_str)
            } else {
                None
            }
        })
        .collect();
    
    untracked_files.sort();

    HttpResponse::Ok().json(untracked_files)
}