// src/handlers/search.rs

use actix_web::{web, HttpResponse};
use crate::db::database::{Database, VideoMetadataUpdatePayload};
use serde::Deserialize;

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
        Ok(metadata) => HttpResponse::Ok().json(metadata),
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