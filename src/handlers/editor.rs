// src/handlers/editor.rs

//! Funscript editor handler module
//!
//! Serves the in-browser funscript editor page and handles saving edited
//! funscript data. Accepts a video path, action list, and optional variant
//! name, validates inputs for path safety and variant format, then writes
//! the resulting .funscript file under FUNSCRIPT_SHARE_PATH. Triggers a
//! background cache refresh after successful writes.

use crate::buttplug::funscript_utils::{Action, FunscriptData};
use crate::funscript_cache;
use actix_files::NamedFile;
use actix_web::{Error, HttpResponse, Responder, web};
use serde::Deserialize;
use std::{
    env,
    path::{Component, Path, PathBuf},
};
use tokio::fs;

/// Serve the in-browser funscript editor page (static HTML).
pub async fn handle_editor_page() -> Result<impl Responder, Error> {
    Ok(NamedFile::open("./static/editor.html")?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}

#[derive(Deserialize, Debug)]
pub struct SaveFunscriptPayload {
    pub video_path: String,
    pub actions: Vec<Action>,
    pub variant: Option<String>,
}

pub async fn save_funscript(payload: web::Json<SaveFunscriptPayload>) -> impl Responder {
    let request = payload.into_inner();

    let share_path = match read_share_path() {
        Ok(path) => path,
        Err(msg) => {
            log::error!("{msg}");
            return HttpResponse::InternalServerError().json(msg);
        }
    };

    let relative_video_path = PathBuf::from(&request.video_path);
    if !is_safe_relative_path(&relative_video_path) {
        log::warn!("Rejected unsafe video path: {}", request.video_path);
        return HttpResponse::BadRequest().json("Invalid video path.");
    }

    let variant = match normalize_variant(request.variant.as_deref()) {
        Ok(v) => v,
        Err(msg) => return HttpResponse::BadRequest().json(msg),
    };

    let output_path = build_funscript_path(&share_path, &relative_video_path, variant.as_deref());

    let funscript_data = FunscriptData {
        actions: request.actions,
        ..Default::default()
    };

    let funscript_json = match serde_json::to_string_pretty(&funscript_data) {
        Ok(json) => json,
        Err(err) => {
            log::error!("Failed to serialize funscript: {err}");
            return HttpResponse::InternalServerError().json("Failed to generate funscript file.");
        }
    };

    if let Some(parent_dir) = output_path.parent() {
        if let Err(err) = fs::create_dir_all(parent_dir).await {
            log::error!("Failed to create directory {:?}: {}", parent_dir, err);
            return HttpResponse::InternalServerError()
                .json("Failed to create directory for funscript.");
        }
    }

    if let Err(err) = fs::write(&output_path, funscript_json).await {
        log::error!("Failed to write funscript file {:?}: {}", output_path, err);
        return HttpResponse::InternalServerError().json("Failed to save funscript file.");
    }

    refresh_cache_in_background(share_path);

    log::info!("Saved funscript to {:?}", output_path);
    HttpResponse::Ok().json("Funscript saved successfully.")
}

fn read_share_path() -> Result<PathBuf, String> {
    env::var("FUNSCRIPT_SHARE_PATH")
        .map(PathBuf::from)
        .map_err(|err| format!("Server configuration error: FUNSCRIPT_SHARE_PATH not set ({err})"))
}

fn is_safe_relative_path(path: &Path) -> bool {
    !path.is_absolute() && path.components().all(|c| matches!(c, Component::Normal(_)))
}

fn normalize_variant(variant: Option<&str>) -> Result<Option<String>, &'static str> {
    let Some(v) = variant
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != "original")
    else {
        return Ok(None);
    };

    if v.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        Ok(Some(v.to_string()))
    } else {
        Err("Invalid variant. Use letters, numbers, '_' or '-'.")
    }
}

fn build_funscript_path(root: &Path, relative_video_path: &Path, variant: Option<&str>) -> PathBuf {
    let mut path = root.join(relative_video_path);
    let extension = match variant {
        Some(v) => format!("{v}.funscript"),
        None => "funscript".to_string(),
    };
    path.set_extension(extension);
    path
}

fn refresh_cache_in_background(share_path: PathBuf) {
    tokio::spawn(async move {
        let _ = funscript_cache::get_cache_for_base(&share_path).await;
    });
}
