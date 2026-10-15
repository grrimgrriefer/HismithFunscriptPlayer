// src/handlers/funscript.rs

//! Funscript request handler module
//!
//! This module handles requests for funscript files, which contain synchronized motion
//! data for videos. It loads the original funscript and generates real-time intensity
//! data used for device control.

use crate::AppConfig;
use crate::device::device_manager;
use crate::funscript::{self, FunscriptData};
use crate::utils;
use actix_web::{HttpResponse, web};
use log::{info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::fs as stdfs;
use std::path::{Path, PathBuf};
use tokio::fs;

#[derive(Serialize, Debug)]
pub struct FunscriptResponse {
    pub original: Option<FunscriptData>,
    pub intensity: Option<FunscriptData>,
    pub peak: f64,
    pub average: f64,
    pub volatility: f64,
    pub duration: u64,
}

pub async fn handle_funscript(
    config: web::Data<AppConfig>,
    path: web::Path<String>,
    query: web::Query<HashMap<String, String>>,
) -> HttpResponse {
    let video_path = path.into_inner();
    let base_path = &config.funscript_share_path;

    if query.contains_key("list") {
        let variants = list_variants(base_path, &video_path);
        return HttpResponse::Ok().json(serde_json::json!({ "variants": variants }));
    }

    let variant = query
        .get("variant")
        .map(|s| s.as_str())
        .unwrap_or("original");

    let funscript_path = build_funscript_path(&video_path, base_path, variant);

    let mut original_res = read_funscript(&funscript_path).await;

    if original_res.is_err() {
        if let Some(parent_path) = build_parent_funscript_path(&video_path, base_path, variant) {
            if let Ok(data) = read_funscript(&parent_path).await {
                original_res = Ok(data);
            }
        }
    }

    let mut original = match original_res {
        Ok(data) => data,
        Err(e) => {
            info!("Funscript not found for {} (tried primary and parent): {}", video_path, e);
            return HttpResponse::NotFound().json(FunscriptResponse {
                original: None,
                intensity: None,
                volatility: f64::NAN,
                peak: f64::NAN,
                average: f64::NAN,
                duration: 0,
            });
        }
    };

    let speed = query.get("speed").map(|s| s.as_str()).unwrap_or("normal");
    if speed == "halfbeat" {
        original.actions = funscript::half_beat_actions(&original.actions);
    } else if speed == "quarterbeat" {
        original.actions = funscript::quarter_beat_actions(&original.actions);
    } else if speed == "doublebeat" {
        original.actions = funscript::double_beat_actions(&original.actions);
    }

    let cal_points = device_manager::get_active_calibration_points();
    let intensity = match generate_intensity(&original, &cal_points) {
        Ok(data) => Some(data),
        Err(e) => {
            warn!("Could not generate intensity for {}: {}", video_path, e);
            None
        }
    };

    let (average, peak) = intensity
        .as_ref()
        .map(|i| funscript::calculate_intensity_stats(&i.actions))
        .unwrap_or((0.0, 0.0));

    let volatility = funscript::calculate_volatility(&original.actions);
    let duration = original.actions.last().map(|a| a.at / 1000).unwrap_or(0);

    HttpResponse::Ok().json(FunscriptResponse {
        original: Some(original),
        intensity,
        peak,
        average,
        volatility,
        duration,
    })
}

fn list_variants(base_path: &Path, video_path: &str) -> Vec<String> {
    let v_path = Path::new(video_path);
    let stem = v_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let mut variants = Vec::new();

    let primary_dir = base_path
        .join(v_path)
        .parent()
        .unwrap_or(base_path)
        .to_path_buf();
    variants.extend(collect_variants_from_disk(&primary_dir, stem));

    if let Some(fallback_rel) = utils::get_parent_fallback_path(v_path) {
        let parent_dir = base_path
            .join(fallback_rel)
            .parent()
            .unwrap_or(base_path)
            .to_path_buf();
        variants.extend(collect_variants_from_disk(&parent_dir, stem));
    }

    variants.sort();
    variants.dedup();
    variants
}

fn collect_variants_from_disk(dir: &Path, stem: &str) -> Vec<String> {
    let mut variants = Vec::new();
    let Ok(entries) = stdfs::read_dir(dir) else {
        return variants;
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("funscript") {
            continue;
        }
        let Some(file_stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        if file_stem == stem {
            variants.push("original".to_string());
        } else if let Some(suffix) = file_stem.strip_prefix(&format!("{}.", stem)) {
            variants.push(suffix.to_string());
        }
    }
    variants
}

fn build_funscript_path(video_path: &str, base_path: &Path, variant: &str) -> PathBuf {
    let full_path = base_path.join(video_path);
    if variant.is_empty() || variant == "original" {
        full_path.with_extension("funscript")
    } else {
        full_path.with_extension(format!("{}.funscript", variant))
    }
}

fn build_parent_funscript_path(video_path: &str, base_path: &Path, variant: &str) -> Option<PathBuf> {
    let fallback_rel = utils::get_parent_fallback_path(Path::new(video_path))?;
    Some(build_funscript_path(&fallback_rel.to_string_lossy(), base_path, variant))
}

async fn read_funscript(path: &Path) -> Result<FunscriptData, String> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|e| format!("Read error {:?}: {}", path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error {:?}: {}", path, e))
}

fn generate_intensity(original: &FunscriptData, cal_points: &[(f64, f64)]) -> Result<FunscriptData, String> {
    if original.actions.len() < 2 {
        return Err("Funscript has fewer than 2 actions".to_string());
    }

    let actions = original.actions.clone();
    let intensity_actions = funscript::actions_to_intensity_curve(&actions, cal_points);

    if intensity_actions.is_empty() {
        return Err(
            "Could not generate intensity curve. \
             The funscript may not be a binary (0/100) script or has insufficient data."
                .to_string(),
        );
    }

    Ok(FunscriptData {
        actions: intensity_actions,
        ..Default::default()
    })
}
