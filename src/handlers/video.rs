// src/handlers/video.rs

//! Video streaming handler module
//!
//! This module handles HTTP requests for video file streaming. It provides
//! functionality to serve video files from a configured directory with proper
//! HTTP headers for streaming and caching.

use crate::AppConfig;
use crate::utils;
use actix_files::NamedFile;
use actix_web::{
    Error, HttpRequest, HttpResponse,
    error::ErrorNotFound,
    http::header::{self, ContentDisposition, DispositionType},
    web,
};
use log::{error, info};

/// Streams a video file from VIDEO_SHARE_PATH.
pub async fn handle_video(
    config: web::Data<AppConfig>,
    req: HttpRequest,
    path: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let requested = path.into_inner();
    let root = &config.video_share_path;

    let full_path = utils::resolve_safe_path(root, &requested)?;

    info!("Serving video: {}", full_path.display());

    let file = NamedFile::open(&full_path).map_err(|e| {
        error!("Failed to open file '{}': {}", full_path.display(), e);
        ErrorNotFound("Video file not found or inaccessible")
    })?;

    let mut response = file
        .use_last_modified(true)
        .set_content_disposition(ContentDisposition {
            disposition: DispositionType::Inline,
            parameters: vec![],
        })
        .into_response(&req);

    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000"),
    );

    Ok(response)
}
