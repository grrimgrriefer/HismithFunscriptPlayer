// src/handlers/editor.rs

use actix_files::NamedFile;
use actix_web::{web, HttpResponse, Error, Responder};
use serde::Deserialize;
use std::{env, path::{PathBuf}};
use tokio::fs;
use crate::buttplug::funscript_utils::{Action, FunscriptData};
use crate::db::database::{Database, VideoMetadataUpdatePayload};

pub async fn handle_editor_page() -> Result<NamedFile, Error> {
    Ok(NamedFile::open("./static/editor.html")?)
}

#[derive(Deserialize, Debug)]
pub struct SaveFunscriptPayload {
    video_path: String,
    actions: Vec<Action>,
}

pub async fn save_funscript(
    payload: web::Json<SaveFunscriptPayload>,
    db: web::Data<Database>,
) -> impl Responder {
    let video_share_path = match env::var("VIDEO_SHARE_PATH") {
        Ok(p) => p,
        Err(e) => {
            log::error!("VIDEO_SHARE_PATH not set: {}", e);
            return HttpResponse::InternalServerError().json("Server configuration error: VIDEO_SHARE_PATH not set");
        }
    };

    // Security: ensure the path from the client is relative and doesn't escape.
    let video_path = PathBuf::from(&payload.video_path);
    if video_path.has_root() || video_path.components().any(|c| c == std::path::Component::ParentDir) {
        log::error!("Potential path traversal attempt: {}", payload.video_path);
        return HttpResponse::BadRequest().json("Invalid path format.");
    }
    
    let full_video_path = PathBuf::from(&video_share_path).join(&video_path);

    let funscript_path = full_video_path.with_extension("funscript");

    let funscript_data = FunscriptData {
        actions: payload.actions.clone(),
        ..Default::default()
    };

    let funscript_json = match serde_json::to_string_pretty(&funscript_data) {
        Ok(json) => json,
        Err(e) => {
            log::error!("Failed to serialize funscript: {}", e);
            return HttpResponse::InternalServerError().json("Failed to generate funscript file");
        }
    };

    if let Some(parent) = funscript_path.parent() {
        if let Err(e) = fs::create_dir_all(parent).await {
             log::error!("Failed to create directory for funscript: {}", e);
            return HttpResponse::InternalServerError().json("Failed to create directory for funscript");
        }
    }

    if let Err(e) = fs::write(&funscript_path, funscript_json).await {
        log::error!("Failed to write funscript file to {:?}: {}", funscript_path, e);
        return HttpResponse::InternalServerError().json("Failed to save funscript file");
    }

    // Update has_funscript in DB
    match db.video_exists_by_path(&payload.video_path) {
        Ok(Some(video_id)) => {
            let update_payload = VideoMetadataUpdatePayload {
                id: video_id,
                rating: None,
                tags: None,
                avg_intensity: None,
                max_intensity: None,
                duration: None,
                has_funscript: Some(true),
            };
            if let Err(e) = db.update_video_metadata(&update_payload) {
                log::error!("Failed to update has_funscript for {}: {}", payload.video_path, e);
                // Don't fail the whole request, saving the file is more important.
            }
        },
        _ => {
            log::warn!("Could not find video with path {} to update has_funscript flag.", payload.video_path);
        }
    }

    log::info!("Successfully saved funscript to {:?}", funscript_path);
    HttpResponse::Ok().json("Funscript saved successfully.")
}