// src/handlers/thumbnail.rs

use crate::utils;
use actix_files::NamedFile;
use actix_web::{
    Error, HttpRequest, HttpResponse,
    error::{ErrorBadRequest, ErrorInternalServerError, ErrorNotFound},
    web,
};
use std::{env, path::{Component, Path, PathBuf}};
use tokio::fs;

pub async fn handle_thumbnail(
    req: HttpRequest,
    path: web::Path<String>,
) -> Result<HttpResponse, Error> {
    let requested = path.into_inner(); // "e.g. filename.mp4.jpg"
    
    if !requested.ends_with(".jpg") { 
        return Err(ErrorBadRequest("Invalid thumbnail format"));
    }
    let video_rel_path = &requested[..requested.len() - 4];
    let video_root = env::var("VIDEO_SHARE_PATH")
        .map(PathBuf::from)
        .map_err(|_| ErrorInternalServerError("VIDEO_SHARE_PATH not set"))?;
    let thumb_root = env::var("FUNSCRIPT_SHARE_PATH")
        .map(|p| PathBuf::from(p).join(".thumbnails"))
        .map_err(|_| ErrorInternalServerError("FUNSCRIPT_SHARE_PATH not set"))?;

    let video_full_path = utils::resolve_safe_path(&video_root, video_rel_path)?;
    let thumb_full_path = utils::resolve_safe_path(&thumb_root, &requested)?;

    if thumb_full_path.exists() {
        return serve_file(thumb_full_path, &req).await;
    }
    if !video_full_path.exists() {
        return Err(ErrorNotFound("Source video not found"));
    }

    if let Some(parent) = thumb_full_path.parent() {
        fs::create_dir_all(parent).await.map_err(|e| ErrorInternalServerError(e))?;
    }
    let output = tokio::process::Command::new("ffmpeg")
        .args([
            "-ss", "00:00:05",
            "-i", video_full_path.to_str().unwrap(),
            "-vframes", "1",
            "-vf", "scale=-1:400", 
            thumb_full_path.to_str().unwrap(),
            "-y",
        ])
        .output()
        .await
        .map_err(|e| ErrorInternalServerError(format!("ffmpeg error: {}", e)))?;

    if !output.status.success() {
        return Err(ErrorInternalServerError("Failed to generate thumbnail"));
    }

    serve_file(thumb_full_path, &req).await
}

async fn serve_file(path: PathBuf, req: &HttpRequest) -> Result<HttpResponse, Error> {
    let file = NamedFile::open(&path).map_err(|_| ErrorNotFound("File lost"))?;
    Ok(file.into_response(req))
}
