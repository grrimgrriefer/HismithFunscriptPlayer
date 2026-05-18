// src/handlers/editor.rs

use actix_files::NamedFile;
use actix_web::{web, HttpResponse, Error, Responder};
use serde::Deserialize;
use std::{env, path::{PathBuf}};
use tokio::fs;
use crate::buttplug::funscript_utils::{Action, FunscriptData};
use crate::funscript_cache;

pub async fn handle_editor_page() -> Result<impl Responder, Error> {
    Ok(NamedFile::open("./static/editor.html")?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}

#[derive(Deserialize, Debug)]
pub struct SaveFunscriptPayload {
    video_path: String,
    actions: Vec<Action>,
    variant: Option<String>,
}

pub async fn save_funscript(
    payload: web::Json<SaveFunscriptPayload>
) -> impl Responder {
    let funscript_share_path = match env::var("FUNSCRIPT_SHARE_PATH") {
        Ok(p) => p,
        Err(e) => {
            log::error!("FUNSCRIPT_SHARE_PATH not set: {}", e);
            return HttpResponse::InternalServerError().json("Server configuration error: FUNSCRIPT_SHARE_PATH not set");
        }
    };

    // ensure the path from the client is relative and doesn't escape.
    let video_path = PathBuf::from(&payload.video_path);
    if video_path.has_root() || video_path.components().any(|c| c == std::path::Component::ParentDir) {
        log::error!("Potential path traversal attempt: {}", payload.video_path);
        return HttpResponse::BadRequest().json("Invalid path format.");
    }
    
    let full_funscript_path = PathBuf::from(&funscript_share_path).join(&video_path);

    let ext = match payload.variant.as_deref() {
        Some(v) if !v.is_empty() && v != "original" => format!("{}.funscript", v),
        _ => "funscript".to_string(),
    };
    let funscript_path = full_funscript_path.with_extension(ext);

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

    let _share = funscript_share_path.clone();
    tokio::spawn(async move {
        let _ = funscript_cache::get_cache_for_base(&std::path::PathBuf::from(_share)).await;
    });

    log::info!("Successfully saved funscript to {:?}", funscript_path);
    HttpResponse::Ok().json("Funscript saved successfully.")
}