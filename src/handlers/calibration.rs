// src/handlers/calibration.rs

//! Calibration profile and BPM mapping handler module
//!
//! This module exposes API endpoints for managing device calibration profiles
//! and redirects requests for the calibration page to the in-app modal overlay.
//! Profiles are stored as a JSON file (.calibration_profiles.json) under
//! FUNSCRIPT_SHARE_PATH and map named profiles to per-range intensity actual
//! measured BPMs.

use crate::AppConfig;
use crate::utils;
use actix_web::{http::header, HttpResponse, Responder, web};
use log::{error, info};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, path::{Path, PathBuf}};

type ProfileBpms = HashMap<String, f64>;
pub type CalibrationProfiles = HashMap<String, ProfileBpms>;

const CALIBRATION_FILE_NAME: &str = ".calibration_profiles.json";

#[derive(Deserialize, Serialize)]
pub struct SaveProfilePayload {
    pub name: String,
    pub bpms: ProfileBpms,
}

fn profile_store_path(base_dir: &Path) -> PathBuf {
    base_dir.join(CALIBRATION_FILE_NAME)
}

async fn read_profiles_file(base_dir: &Path) -> Result<CalibrationProfiles, String> {
    utils::read_json_file(&profile_store_path(base_dir)).await
}

async fn write_profiles_file(base_dir: &Path, profiles: &CalibrationProfiles) -> Result<(), String> {
    utils::write_json_file(&profile_store_path(base_dir), profiles).await
}

pub async fn handle_calibration_page() -> impl Responder {
    HttpResponse::Found()
        .insert_header((header::LOCATION, "/site/?calibration=1"))
        .finish()
}

#[derive(Serialize)]
pub struct BpmMappingResponse {
    pub points: Vec<crate::funscript::structs::BpmIntensityPoint>,
    pub lut: HashMap<String, f64>,
}

pub async fn get_bpm_mapping() -> impl Responder {
    let points = crate::funscript::curves::get_bpm_intensity_mapping();
    let mut lut = HashMap::new();
    for i in 0..=100 {
        let bpm = crate::funscript::curves::intensity_to_bpm(i as f64);
        lut.insert(i.to_string(), bpm);
    }
    HttpResponse::Ok().json(BpmMappingResponse { points, lut })
}

pub async fn get_profiles(config: web::Data<AppConfig>) -> impl Responder {
    match read_profiles_file(&config.funscript_share_path).await {
        Ok(profiles) => HttpResponse::Ok().json(profiles),
        Err(e) => {
            error!("Failed to load calibration profiles: {e}");
            HttpResponse::InternalServerError().body("Failed to load calibration profiles")
        }
    }
}

pub async fn save_profile(
    config: web::Data<AppConfig>,
    payload: web::Json<SaveProfilePayload>,
) -> impl Responder {
    let profile_name = payload.name.trim();
    if profile_name.is_empty() {
        return HttpResponse::BadRequest().body("Profile name cannot be empty");
    }

    let mut profiles = match read_profiles_file(&config.funscript_share_path).await {
        Ok(p) => p,
        Err(e) => {
            error!("Failed to load existing calibration profiles before save: {e}");
            return HttpResponse::InternalServerError().body("Failed to save calibration profile");
        }
    };

    profiles.insert(profile_name.to_string(), payload.bpms.clone());

    match write_profiles_file(&config.funscript_share_path, &profiles).await {
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

#[derive(Deserialize)]
pub struct SetActiveProfilePayload {
    pub bpms: HashMap<String, f64>,
}

pub async fn set_active_profile(payload: web::Json<SetActiveProfilePayload>) -> impl Responder {
    let mut points = vec![(0.0, 0.0)];

    for (preset_str, bpm_val) in &payload.bpms {
        if let Ok(preset_intensity) = preset_str.parse::<f64>() {
            points.push((*bpm_val, preset_intensity));
        }
    }

    points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    crate::device::device_manager::set_active_calibration_points(points);

    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}

#[derive(Deserialize)]
pub struct SetMaxLimitPayload {
    pub max_intensity_limit: f64,
}

pub async fn set_max_intensity_limit(payload: web::Json<SetMaxLimitPayload>) -> impl Responder {
    let normalized_limit = (payload.max_intensity_limit / 100.0).clamp(0.0, 1.0);
    crate::device::device_manager::set_max_intensity_limit(normalized_limit);
    HttpResponse::Ok().json(serde_json::json!({ "ok": true }))
}
