// src/handlers/editor.rs

//! Funscript editor handler module
//!
//! Serves the in-browser funscript editor page and handles saving edited
//! funscript data. Accepts a video path, tap-timestamps list, and optional variant
//! name, validates inputs for path safety and variant format, then writes
//! the resulting .funscript file under FUNSCRIPT_SHARE_PATH. Triggers a
//! background cache refresh after successful writes.

use crate::AppConfig;
use crate::device::device_manager;
use crate::funscript::{self, structs::FunscriptData};
use crate::funscripts_cache;
use crate::utils;
use actix_files::NamedFile;
use actix_web::{Error, HttpResponse, Responder, web};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use tokio::fs;

/// Serve the in-browser funscript editor page (static HTML).
pub async fn handle_editor_page() -> Result<impl Responder, Error> {
    Ok(NamedFile::open("./static/editor.html")?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}

#[derive(Deserialize)]
pub struct CalculateDraftIntensityPayload {
    pub taps: Vec<u64>,
}

/// Provide intensity values for the 'draft' funscript the user is authoring in the editor page.
pub async fn calculate_draft_intensity(
    payload: web::Json<CalculateDraftIntensityPayload>,
) -> impl Responder {
    let taps = payload.into_inner().taps;
    let actions = funscript::generation::generate_funscript_actions_from_taps(&taps);

    if taps.len() < 2 {
        return HttpResponse::Ok().json(serde_json::json!({
            "peak": 0.0,
            "average": 0.0,
            "volatility": 0.0,
            "sections": [],
            "actions": actions
        }));
    }

    let cal_points = device_manager::get_active_calibration_points();
    let intensity_curve = funscript::curves::actions_to_intensity_curve(&actions, &cal_points);
    let (average, peak) = funscript::curves::calculate_intensity_stats(&intensity_curve);
    let (volatility, sections) = funscript::volatility::calculate_volatility_with_sections(&actions);

    HttpResponse::Ok().json(serde_json::json!({
        "peak": peak,
        "average": average,
        "volatility": volatility,
        "sections": sections,
        "actions": actions
    }))
}

#[derive(Deserialize, Debug)]
pub struct SaveFunscriptPayload {
    pub video_path: String,
    pub taps: Vec<u64>,
    pub variant: Option<String>,
}

pub async fn save_funscript(
    config: web::Data<AppConfig>,
    payload: web::Json<SaveFunscriptPayload>,
) -> impl Responder {
    let request = payload.into_inner();
    let share_path = &config.funscript_share_path;

    let relative_video_path = PathBuf::from(&request.video_path);
    if !utils::is_safe_relative_path(&relative_video_path) {
        log::warn!("Rejected unsafe video path: {}", request.video_path);
        return HttpResponse::BadRequest().json("Invalid video path.");
    }

    let variant = match normalize_variant(request.variant.as_deref()) {
        Ok(v) => v,
        Err(msg) => return HttpResponse::BadRequest().json(msg),
    };

    let output_path = utils::build_funscript_path(share_path, &relative_video_path, variant.as_deref());

    let actions = funscript::generation::generate_funscript_actions_from_taps(&request.taps);
    let funscript_data = FunscriptData {
        actions,
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

    refresh_cache_in_background(share_path.clone());

    log::info!("Saved funscript to {:?}", output_path);
    HttpResponse::Ok().json("Funscript saved successfully.")
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

fn refresh_cache_in_background(share_path: PathBuf) {
    tokio::spawn(async move {
        let _ = funscripts_cache::get_cache_for_base(&share_path).await;
    });
}
