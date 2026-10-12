// src/handlers/video_stats.rs

use crate::AppConfig;
use actix_web::{HttpResponse, Responder, web};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, io::ErrorKind, path::{Path, PathBuf}};
use tokio::fs;

const VIDEO_STATS_FILE: &str = ".video_stats.json";

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
pub struct VideoUserStats {
    #[serde(default)]
    pub views: u32,
    #[serde(default, alias = "liked", deserialize_with = "deserialize_likes")]
    pub likes: u32,
    #[serde(default)]
    pub last_watched: Option<u64>,
}

fn deserialize_likes<'de, D>(deserializer: D) -> Result<u32, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de;
    struct LikesVisitor;
    impl<'de> de::Visitor<'de> for LikesVisitor {
        type Value = u32;
        fn expecting(&self, formatter: &mut std::fmt::Formatter) -> std::fmt::Result {
            formatter.write_str("a u32 or boolean for likes")
        }
        fn visit_u64<E>(self, v: u64) -> Result<u32, E> {
            Ok(v as u32)
        }
        fn visit_i64<E>(self, v: i64) -> Result<u32, E> {
            Ok(v.max(0) as u32)
        }
        fn visit_bool<E>(self, v: bool) -> Result<u32, E> {
            Ok(if v { 1 } else { 0 })
        }
    }
    deserializer.deserialize_any(LikesVisitor)
}

pub type VideoStatsMap = HashMap<String, VideoUserStats>;

fn stats_file_path(base_dir: &Path) -> PathBuf {
    base_dir.join(VIDEO_STATS_FILE)
}

pub async fn read_video_stats(base_dir: &Path) -> VideoStatsMap {
    let path = stats_file_path(base_dir);
    match fs::read_to_string(&path).await {
        Ok(json) => serde_json::from_str(&json).unwrap_or_default(),
        Err(e) if e.kind() == ErrorKind::NotFound => HashMap::new(),
        Err(e) => {
            log::warn!("Failed to read video stats file {:?}: {}", path, e);
            HashMap::new()
        }
    }
}

async fn write_video_stats(base_dir: &Path, stats: &VideoStatsMap) -> Result<(), String> {
    let path = stats_file_path(base_dir);
    let json = serde_json::to_string_pretty(stats)
        .map_err(|e| format!("Failed to serialize stats: {e}"))?;

    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }

    fs::write(&path, json)
        .await
        .map_err(|e| format!("Failed to write stats file: {e}"))
}

#[derive(Deserialize)]
pub struct VideoActionPayload {
    pub video_path: String,
}

pub async fn get_stats(config: web::Data<AppConfig>) -> impl Responder {
    let stats = read_video_stats(&config.funscript_share_path).await;
    HttpResponse::Ok().json(stats)
}

pub async fn record_view(
    config: web::Data<AppConfig>,
    payload: web::Json<VideoActionPayload>,
) -> impl Responder {
    let path = payload.video_path.trim().to_string();
    if path.is_empty() {
        return HttpResponse::BadRequest().body("Missing video path");
    }

    let mut stats = read_video_stats(&config.funscript_share_path).await;
    let entry = stats.entry(path).or_default();
    entry.views += 1;
    entry.last_watched = Some(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0),
    );

    let updated_entry = entry.clone();
    if let Err(e) = write_video_stats(&config.funscript_share_path, &stats).await {
        log::error!("Failed to save view count: {}", e);
        return HttpResponse::InternalServerError().body("Failed to persist stats");
    }

    HttpResponse::Ok().json(updated_entry)
}

pub async fn record_like(
    config: web::Data<AppConfig>,
    payload: web::Json<VideoActionPayload>,
) -> impl Responder {
    let path = payload.video_path.trim().to_string();
    if path.is_empty() {
        return HttpResponse::BadRequest().body("Missing video path");
    }

    let mut stats = read_video_stats(&config.funscript_share_path).await;
    let entry = stats.entry(path).or_default();
    entry.likes += 1;

    let updated_entry = entry.clone();
    if let Err(e) = write_video_stats(&config.funscript_share_path, &stats).await {
        log::error!("Failed to save like count: {}", e);
        return HttpResponse::InternalServerError().body("Failed to persist stats");
    }

    HttpResponse::Ok().json(updated_entry)
}
