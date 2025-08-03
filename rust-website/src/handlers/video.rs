// src/handlers/video.rs

//! Video streaming handler module
//! 
//! This module handles HTTP requests for video file streaming. It provides
//! functionality to serve video files from a configured directory with proper
//! HTTP headers for streaming and caching.

use log::{info, error};
use actix_web::{
    web, 
    HttpRequest, 
    HttpResponse, 
    Error,
    http::header::{
        self, 
        ContentDisposition, 
        DispositionType
    }
};
use actix_files::NamedFile;
use std::{
    env, 
    path::PathBuf
};
use crate::db::database::{Database, VideoMetadata};
use serde::Deserialize;

/// Handles video file streaming requests
///
/// Processes incoming HTTP requests for video files and returns them as streaming
/// responses with appropriate headers for browser playback.
///
/// # Arguments
/// * `req` - The HTTP request containing headers and metadata
/// * `path` - The requested video file path (relative to VIDEO_SHARE_PATH)
///
/// # Returns
/// * `Ok(HttpResponse)` - Streaming response for the video file with headers:
///   - Content-Type: video/*
///   - Content-Disposition: inline
///   - Cache-Control: public, max-age=31536000
/// * `Err(Error)` - If file cannot be accessed or environment is not configured
pub async fn handle_video(req: HttpRequest, path: web::Path<String>) -> Result<HttpResponse, Error> {
    let filename = normalize_path(path.into_inner());
    info!("Serving video: {}", &filename);

    let full_path = get_full_video_path(&filename)?;
    let named_file = open_video_file(&full_path).await?;
    
    Ok(create_video_response(named_file, req))
}

/// Normalizes file paths by removing leading slashes
///
/// Ensures consistent path handling regardless of how the path was provided
/// in the HTTP request.
///
/// # Arguments
/// * `path` - The raw path from the HTTP request
///
/// # Returns
/// * `String` - Normalized path without leading slashes
fn normalize_path(path: String) -> String {
    if path.starts_with('/') || path.starts_with('\\') {
        path[1..].to_string()
    } else {
        path
    }
}

/// Constructs the full filesystem path to a video file
///
/// Combines the base video directory path from environment variables with
/// the requested filename.
///
/// # Arguments
/// * `filename` - The relative path/filename of the requested video
///
/// # Returns
/// * `Ok(PathBuf)` - Full filesystem path to the video file
/// * `Err(Error)` - If VIDEO_SHARE_PATH environment variable is not set
fn get_full_video_path(filename: &str) -> Result<PathBuf, Error> {
    let base_path = env::var("VIDEO_SHARE_PATH")
        .map_err(|e| {
            error!("VIDEO_SHARE_PATH not set: {}", e);
            actix_web::error::ErrorInternalServerError("Server configuration error")
        })?;
    
    Ok(PathBuf::from(base_path).join(filename))
}

/// Opens a video file for streaming
///
/// Attempts to open the video file and prepare it for streaming using
/// actix_files::NamedFile.
///
/// # Arguments
/// * `path` - Full filesystem path to the video file
///
/// # Returns
/// * `Ok(NamedFile)` - File handle ready for streaming
/// * `Err(Error)` - If file cannot be opened or accessed
async fn open_video_file(path: &PathBuf) -> Result<NamedFile, Error> {
    NamedFile::open_async(path)
        .await
        .map_err(|e| {
            error!("Failed to open file: {}", e);
            actix_web::error::ErrorNotFound("Video file not found or inaccessible")
        })
}

/// Creates an HTTP response for video streaming
///
/// Configures the HTTP response with appropriate headers for video streaming
/// and browser caching.
///
/// # Arguments
/// * `file` - The video file prepared for streaming
/// * `req` - Original HTTP request (used for response construction)
///
/// # Returns
/// * `HttpResponse` - Configured HTTP response ready for streaming
fn create_video_response(file: NamedFile, req: HttpRequest) -> HttpResponse {
    let mut response = file
        .use_last_modified(true)
        .prefer_utf8(true)
        .set_content_disposition(ContentDisposition {
            disposition: DispositionType::Inline,
            parameters: vec![],
        })
        .into_response(&req);

    // Add cache control headers for better performance
    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000"),
    );

    response
}

#[derive(Debug, Deserialize)]
pub struct SearchQuery {
    q: String,
    min_duration: Option<i64>,
    max_duration: Option<i64>,
    min_avg_intensity: Option<f64>,
    max_avg_intensity: Option<f64>,
}

pub async fn search_videos(
    params: web::Query<SearchQuery>,
    db: web::Data<Database>,
) -> HttpResponse {
    match db.search_videos(
        &params.q,
        params.min_duration,
        params.max_duration,
        params.min_avg_intensity,
        params.max_avg_intensity,
    ) {
        Ok(videos) => HttpResponse::Ok().json(videos),
        Err(e) => {
            error!("Failed to search videos: {}", e);
            HttpResponse::InternalServerError().json("Failed to search videos")
        }
    }
}