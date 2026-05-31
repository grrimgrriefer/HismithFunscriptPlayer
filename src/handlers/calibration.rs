// src/handlers/calibration.rs

//! Calibration profile and BPM mapping handler module
//!
//! This module serves the calibration UI page and exposes API endpoints for
//! managing device calibration profiles. Profiles are stored as a JSON file
//! (.calibration_profiles.json) under FUNSCRIPT_SHARE_PATH and map named
//! profiles to per-range intensity multipliers. Also provides the BPM-to-intensity
//! lookup table used by the frontend calibration interface.

use actix_files::NamedFile;
use actix_web::{Error, HttpResponse, Responder, web};
use log::{error, info};
use serde::Deserialize;
use std::{collections::HashMap, env, io::ErrorKind, path::PathBuf};
use tokio::fs;

type ProfileMultipliers = HashMap<String, f64>;
pub type CalibrationProfiles = HashMap<String, ProfileMultipliers>;

const CALIBRATION_FILE_NAME: &str = ".calibration_profiles.json";
const CALIBRATION_PAGE_PATH: &str = "./static/calibration.html";

#[derive(Deserialize)]
pub struct SaveProfilePayload {
    pub name: String,
    pub multipliers: ProfileMultipliers,
}

fn profile_store_path() -> PathBuf {
    let base_dir = env::var("FUNSCRIPT_SHARE_PATH").unwrap_or_else(|_| ".".to_string());
    PathBuf::from(base_dir).join(CALIBRATION_FILE_NAME)
}

async fn read_profiles_file() -> Result<CalibrationProfiles, String> {
    let path = profile_store_path();

    match fs::read_to_string(&path).await {
        Ok(raw_json) => serde_json::from_str(&raw_json)
            .map_err(|e| format!("Failed to parse calibration profile JSON: {e}")),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!(
            "Failed to read calibration profile file {:?}: {e}",
            path
        )),
    }
}

async fn write_profiles_file(profiles: &CalibrationProfiles) -> Result<(), String> {
    let path = profile_store_path();
    let json = serde_json::to_string_pretty(profiles)
        .map_err(|e| format!("Failed to serialize calibration profiles: {e}"))?;

    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir)
            .await
            .map_err(|e| format!("Failed to create directory {:?}: {e}", parent_dir))?;
    }

    fs::write(&path, json)
        .await
        .map_err(|e| format!("Failed to write calibration profile file {:?}: {e}", path))
}

pub async fn handle_calibration_page() -> Result<impl Responder, Error> {
    Ok(NamedFile::open(CALIBRATION_PAGE_PATH)?
        .customize()
        .insert_header(("Cache-Control", "no-cache")))
}

pub async fn get_bpm_mapping() -> impl Responder {
    let mapping = crate::buttplug::funscript_utils::get_bpm_intensity_mapping();
    HttpResponse::Ok().json(mapping)
}

pub async fn get_profiles() -> impl Responder {
    match read_profiles_file().await {
        Ok(profiles) => HttpResponse::Ok().json(profiles),
        Err(e) => {
            error!("Failed to load calibration profiles: {e}");
            HttpResponse::InternalServerError().body("Failed to load calibration profiles")
        }
    }
}

pub async fn save_profile(payload: web::Json<SaveProfilePayload>) -> impl Responder {
    let profile_name = payload.name.trim();
    if profile_name.is_empty() {
        return HttpResponse::BadRequest().body("Profile name cannot be empty");
    }

    let mut profiles = match read_profiles_file().await {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to load existing calibration profiles before save: {e}");
            return HttpResponse::InternalServerError().body("Failed to save calibration profile");
        }
    };

    profiles.insert(profile_name.to_string(), payload.multipliers.clone());

    match write_profiles_file(&profiles).await {
        Ok(()) => {
            info!("Saved calibration profile: {profile_name}");
            HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
        }
        Err(e) => {
            error!("Failed to save calibration profile {profile_name}: {e}");
            HttpResponse::InternalServerError().body("Failed to save calibration profile")
        }
    }
}
