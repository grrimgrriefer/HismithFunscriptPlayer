// src/handlers/search.rs

use actix_web::{web, HttpResponse};
use crate::db::database::Database;
use serde::Deserialize;

#[derive(Deserialize)]
pub struct SearchQuery {
    q: String,
}

pub async fn search(
    query: web::Query<SearchQuery>,
    db: web::Data<Database>,
) -> HttpResponse {
    match db.search_videos(&query.q) {
        Ok(videos) => HttpResponse::Ok()
            .content_type("application/json")
            .json(videos),
        Err(e) => {
            log::error!("Search failed: {}", e);
            HttpResponse::InternalServerError()
                .content_type("application/json")
                .json(serde_json::json!({
                    "error": "Search failed"
                }))
        }
    }
}

#[derive(Deserialize)]
pub struct MetadataUpdate {
    id: i64,
    title: Option<String>,
    rating: Option<i32>,
    tags: Vec<String>,
}

pub async fn update_metadata(
    metadata: web::Json<MetadataUpdate>,
    db: web::Data<Database>,
) -> HttpResponse {
    let mut success = true;

    // Update title if provided
    if let Some(title) = &metadata.title {
        if let Err(e) = db.get_ref().update_title(metadata.id, title) {
            log::error!("Failed to update title: {}", e);
            success = false;
        }
    }

    // Update rating if provided
    if let Some(rating) = metadata.rating {
        if let Err(e) = db.get_ref().set_rating(metadata.id, rating) {
            log::error!("Failed to update rating: {}", e);
            success = false;
        }
    }

    // Update tags
    if let Err(e) = db.get_ref().update_tags(metadata.id, &metadata.tags) {
        log::error!("Failed to update tags: {}", e);
        success = false;
    }

    if success {
        HttpResponse::Ok().json(serde_json::json!({ "status": "success" }))
    } else {
        HttpResponse::InternalServerError().json(serde_json::json!({
            "status": "error",
            "message": "Failed to update metadata"
        }))
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