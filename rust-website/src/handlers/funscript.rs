// src/handlers/funscript.rs

//! Funscript request handler module
//! 
//! This module handles requests for funscript files, which contain synchronized motion
//! data for videos. It loads the original funscript and generates real-time intensity
//! data used for device control.

use log::{info, warn, error};
use actix_web::{
    web, 
    HttpResponse
};
use std::{
    env, 
    path::{
        PathBuf, 
        Path
    }
};
use tokio::fs;
use crate::buttplug::funscript_utils::{
    self, 
    FunscriptData
};
use super::types::FunscriptResponse;

/// Handles requests for funscript files and generates intensity data
///
/// This handler:
/// 1. Loads the original funscript file for a video
/// 2. Generates intensity data based on motion patterns
/// 3. Returns both original and processed data as JSON
///
/// # Arguments
/// * `path` - The path to the video file (funscript has same name, different extension)
///
/// # Returns
/// * `HttpResponse` - JSON response containing original and intensity data
/// * Returns 404 if funscript not found
/// * Returns 500 for server configuration errors
pub async fn handle_funscript(path: web::Path<String>) -> HttpResponse {
    let requested_video_path = path.into_inner();
    info!("Handling funscript request for video: {}", &requested_video_path);

    // Get base path from environment
    let video_base_path = match env::var("VIDEO_SHARE_PATH") {
        Ok(p) => p,
        Err(e) => {
            error!("VIDEO_SHARE_PATH environment variable not set: {}", e);
            return HttpResponse::InternalServerError().json(FunscriptResponse {
                original: None,
                intensity: None,
            });
        }
    };

    // Construct full path to funscript file
    let funscript_filepath = match get_funscript_path_for_video(&requested_video_path, &video_base_path) {
        Ok(p) => p,
        Err(e) => {
            error!("Path determination error: {}", e);
            return HttpResponse::BadRequest().json(FunscriptResponse {
                original: None,
                intensity: None,
            });
        }
    };

    let filename_only = funscript_filepath.file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_else(|| requested_video_path.clone());

    // Load and process funscript data
    let original_result = read_and_deserialize_funscript(&funscript_filepath).await;
    let mut intensity_error_message: Option<String> = None;

    let intensity_result = match &original_result {
        Ok(orig_data) => {
            info!("Original loaded, generating intensity for: {}", &filename_only);
            match generate_intensity_funscript(orig_data) {
                Ok(generated_data) => {
                    info!("Successfully generated intensity for: {}", &filename_only);
                    Ok(generated_data)
                },
                Err(e) => {
                    error!("Failed to generate intensity for {}: {}", &filename_only, e.clone());
                    intensity_error_message = Some(e);
                    Err("Intensity generation failed.".to_string())
                }
            }
        }
        Err(e) => {
            let err_msg = format!("Original funscript failed to load: {}", e);
            info!("Original script {} failed to load, cannot generate intensity: {}", &filename_only, e);
            intensity_error_message = Some(err_msg.clone());
            Err(err_msg)
        }
    };

    // Prepare response
    let response_payload = FunscriptResponse {
        original: original_result.ok(),
        intensity: intensity_result.ok(),
    };

    let status_code = if response_payload.original.is_some() {
        actix_web::http::StatusCode::OK
    } else {
        actix_web::http::StatusCode::NOT_FOUND
    };

    // Log response status
    if status_code == actix_web::http::StatusCode::NOT_FOUND {
        info!("Responding with 404 Not Found for: {}", requested_video_path);
    } else {
        info!("Responding with 200 OK for: {}", requested_video_path);
        if response_payload.intensity.is_none() {
            if let Some(e) = intensity_error_message {
                warn!("Intensity data is missing for {}: {}", &filename_only, e);
            }
        }
    }

    HttpResponse::build(status_code)
        .content_type("application/json")
        .json(response_payload)
}

/// Constructs the path to a funscript file based on the video path
///
/// # Arguments
/// * `requested_video_path` - Relative path to the video file
/// * `video_base_path` - Base directory for video files
///
/// # Returns
/// * `Ok(PathBuf)` - Full path to the funscript file
/// * `Err(String)` - Error message if path construction fails
fn get_funscript_path_for_video(
    requested_video_path: &str,
    video_base_path: &str,
) -> Result<PathBuf, String> {
    let video_path = PathBuf::from(video_base_path).join(requested_video_path);
    let funscript_path = video_path.with_extension("funscript");
    Ok(funscript_path)
}

/// Reads and parses a funscript file from disk
///
/// # Arguments
/// * `filepath` - Path to the funscript file
///
/// # Returns
/// * `Ok(FunscriptData)` - Parsed funscript data
/// * `Err(String)` - Error message if reading or parsing fails
async fn read_and_deserialize_funscript(filepath: &Path) -> Result<FunscriptData, String> {
    let content = fs::read_to_string(filepath)
        .await
        .map_err(|e| format!("Failed to read file {:?}: {}", filepath, e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to deserialize file {:?}: {}", filepath, e))
}

/// Generates intensity data from original funscript actions
///
/// Processes the original motion data to calculate continuous intensity values
/// that represent the speed and amplitude of movements.
///
/// # Arguments
/// * `original_data` - The original funscript motion data
///
/// # Returns
/// * `Ok(FunscriptData)` - Generated intensity data
/// * `Err(String)` - Error message if generation fails
fn generate_intensity_funscript(
    original_data: &FunscriptData,
) -> Result<FunscriptData, String> {
    let mut actions_to_process = original_data.actions.clone();

    if actions_to_process.len() < 2 {
        return Err("Cannot generate intensity: requires at least 2 actions.".to_string());
    }

    let sample_rate_ms = 50;    // Sample every 50ms
    let window_radius_ms = 500;  // Look at ±500ms around each point

    let intensity_actions = funscript_utils::calculate_thrust_intensity_by_scaled_speed(
        &mut actions_to_process,
        sample_rate_ms,
        window_radius_ms
    );

    Ok(FunscriptData {
        actions: intensity_actions,
    })
}