// src/handlers/funscript.rs

//! Funscript request handler module
//!
//! This module handles requests for funscript files, which contain synchronized motion
//! data for videos. It loads the original funscript and generates real-time intensity
//! data used for device control.

use crate::buttplug::funscript_utils::{self, FunscriptData};
use actix_web::{HttpResponse, web};
use log::{error, info, warn};
use serde::Serialize;
use std::collections::HashMap;
use std::fs as stdfs;
use std::{
    env,
    path::{Path, PathBuf},
};
use tokio::fs;

#[derive(Serialize, Debug)]
pub struct FunscriptResponse {
    pub original: Option<FunscriptData>,
    pub intensity: Option<FunscriptData>,
}

pub async fn handle_funscript(
    path: web::Path<String>,
    query: web::Query<HashMap<String, String>>,
) -> HttpResponse {
    let video_path = path.into_inner();

    let base_path = match env::var("FUNSCRIPT_SHARE_PATH") {
        Ok(p) => p,
        Err(_) => {
            error!("FUNSCRIPT_SHARE_PATH not set");
            return HttpResponse::InternalServerError().finish();
        }
    };

    // List available variants for this video
    if query.contains_key("list") {
        let variants = list_variants(&base_path, &video_path);
        return HttpResponse::Ok().json(serde_json::json!({ "variants": variants }));
    }

    let variant = query
        .get("variant")
        .map(|s| s.as_str())
        .unwrap_or("original");

    let funscript_path = build_funscript_path(&video_path, &base_path, variant);

    let original = match read_funscript(&funscript_path).await {
        Ok(data) => data,
        Err(e) => {
            info!("Funscript not found for {}: {}", video_path, e);
            return HttpResponse::NotFound().json(FunscriptResponse {
                original: None,
                intensity: None,
            });
        }
    };

    let intensity = match generate_intensity(&original) {
        Ok(data) => Some(data),
        Err(e) => {
            warn!("Could not generate intensity for {}: {}", video_path, e);
            None
        }
    };

    HttpResponse::Ok().json(FunscriptResponse {
        original: Some(original),
        intensity,
    })
}

fn list_variants(base_path: &str, video_path: &str) -> Vec<String> {
    let full_path = PathBuf::from(base_path).join(video_path);
    let dir = full_path.parent().unwrap_or(Path::new(base_path));
    let stem = full_path.file_stem().and_then(|s| s.to_str()).unwrap_or("");

    let mut variants: Vec<String> = Vec::new();
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

    variants.sort();
    variants.dedup();
    variants
}

fn build_funscript_path(video_path: &str, base_path: &str, variant: &str) -> PathBuf {
    let full_path = PathBuf::from(base_path).join(video_path);
    if variant.is_empty() || variant == "original" {
        full_path.with_extension("funscript")
    } else {
        full_path.with_extension(format!("{}.funscript", variant))
    }
}

async fn read_funscript(path: &Path) -> Result<FunscriptData, String> {
    let content = fs::read_to_string(path)
        .await
        .map_err(|e| format!("Read error {:?}: {}", path, e))?;
    serde_json::from_str(&content).map_err(|e| format!("Parse error {:?}: {}", path, e))
}

fn generate_intensity(original: &FunscriptData) -> Result<FunscriptData, String> {
    if original.actions.len() < 2 {
        return Err("Funscript has fewer than 2 actions".to_string());
    }

    let mut actions = original.actions.clone();
    let intensity_actions = funscript_utils::actions_to_intensity_curve(&mut actions, 50, 500);

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
