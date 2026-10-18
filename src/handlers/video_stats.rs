// src/handlers/video_stats.rs

use crate::utils;
use actix_web::{HttpResponse, Responder, web};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::sync::{mpsc, oneshot};

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

pub enum StatsCommand {
    RecordView {
        path: String,
        responder: oneshot::Sender<VideoUserStats>,
    },
    RecordLike {
        path: String,
        responder: oneshot::Sender<VideoUserStats>,
    },
    RecordUnlike {
        path: String,
        responder: oneshot::Sender<VideoUserStats>,
    },
    GetStats {
        responder: oneshot::Sender<VideoStatsMap>,
    },
}

#[derive(Clone)]
pub struct StatsQueue {
    sender: mpsc::Sender<StatsCommand>,
}

impl StatsQueue {
    pub fn new(sender: mpsc::Sender<StatsCommand>) -> Self {
        Self { sender }
    }

    pub async fn record_view(&self, path: String) -> Result<VideoUserStats, &'static str> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(StatsCommand::RecordView { path, responder: tx })
            .await
            .map_err(|_| "Stats worker disconnected")?;
        rx.await.map_err(|_| "Failed to receive worker response")
    }

    pub async fn record_like(&self, path: String) -> Result<VideoUserStats, &'static str> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(StatsCommand::RecordLike { path, responder: tx })
            .await
            .map_err(|_| "Stats worker disconnected")?;
        rx.await.map_err(|_| "Failed to receive worker response")
    }

    pub async fn record_unlike(&self, path: String) -> Result<VideoUserStats, &'static str> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(StatsCommand::RecordUnlike { path, responder: tx })
            .await
            .map_err(|_| "Stats worker disconnected")?;
        rx.await.map_err(|_| "Failed to receive worker response")
    }

    pub async fn get_stats(&self) -> Result<VideoStatsMap, &'static str> {
        let (tx, rx) = oneshot::channel();
        self.sender
            .send(StatsCommand::GetStats { responder: tx })
            .await
            .map_err(|_| "Stats worker disconnected")?;
        rx.await.map_err(|_| "Failed to receive worker response")
    }
}

pub async fn run_stats_worker(
    base_dir: PathBuf,
    mut receiver: mpsc::Receiver<StatsCommand>,
) {
    let mut stats = read_video_stats(&base_dir).await;

    while let Some(cmd) = receiver.recv().await {
        match cmd {
            StatsCommand::RecordView { path, responder } => {
                let entry = stats.entry(path).or_default();
                entry.views += 1;
                entry.last_watched = Some(
                    SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs(),
                );
                let updated = entry.clone();
                if let Err(e) = write_video_stats(&base_dir, &stats).await {
                    log::error!("Failed to persist stats: {e}");
                }
                let _ = responder.send(updated);
            }
            StatsCommand::RecordLike { path, responder } => {
                let entry = stats.entry(path).or_default();
                entry.likes += 1;
                let updated = entry.clone();
                if let Err(e) = write_video_stats(&base_dir, &stats).await {
                    log::error!("Failed to persist stats: {e}");
                }
                let _ = responder.send(updated);
            }
            StatsCommand::RecordUnlike { path, responder } => {
                let entry = stats.entry(path).or_default();
                entry.likes = entry.likes.saturating_sub(1);
                let updated = entry.clone();
                if let Err(e) = write_video_stats(&base_dir, &stats).await {
                    log::error!("Failed to persist stats: {e}");
                }
                let _ = responder.send(updated);
            }
            StatsCommand::GetStats { responder } => {
                let _ = responder.send(stats.clone());
            }
        }
    }
}

fn stats_file_path(base_dir: &Path) -> PathBuf {
    base_dir.join(VIDEO_STATS_FILE)
}

pub async fn read_video_stats(base_dir: &Path) -> VideoStatsMap {
    let path = stats_file_path(base_dir);
    match utils::read_json_file::<VideoStatsMap>(&path).await {
        Ok(stats) => stats,
        Err(e) => {
            log::warn!("Failed to read video stats file {:?}: {}", path, e);
            HashMap::new()
        }
    }
}

async fn write_video_stats(base_dir: &Path, stats: &VideoStatsMap) -> Result<(), String> {
    utils::write_json_file(&stats_file_path(base_dir), stats).await
}

#[derive(Deserialize)]
pub struct VideoActionPayload {
    pub video_path: String,
}

pub async fn get_stats(queue: web::Data<StatsQueue>) -> impl Responder {
    match queue.get_stats().await {
        Ok(stats) => HttpResponse::Ok().json(stats),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn record_view(
    queue: web::Data<StatsQueue>,
    payload: web::Json<VideoActionPayload>,
) -> impl Responder {
    let path = payload.video_path.trim().to_string();
    if path.is_empty() {
        return HttpResponse::BadRequest().body("Missing video path");
    }

    match queue.record_view(path).await {
        Ok(entry) => HttpResponse::Ok().json(entry),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn record_like(
    queue: web::Data<StatsQueue>,
    payload: web::Json<VideoActionPayload>,
) -> impl Responder {
    let path = payload.video_path.trim().to_string();
    if path.is_empty() {
        return HttpResponse::BadRequest().body("Missing video path");
    }

    match queue.record_like(path).await {
        Ok(entry) => HttpResponse::Ok().json(entry),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}

pub async fn record_unlike(
    queue: web::Data<StatsQueue>,
    payload: web::Json<VideoActionPayload>,
) -> impl Responder {
    let path = payload.video_path.trim().to_string();
    if path.is_empty() {
        return HttpResponse::BadRequest().body("Missing video path");
    }

    match queue.record_unlike(path).await {
        Ok(entry) => HttpResponse::Ok().json(entry),
        Err(e) => HttpResponse::InternalServerError().body(e),
    }
}
