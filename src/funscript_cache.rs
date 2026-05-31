// src/funscript_cache.rs

//! Funscript cache utilities
//!
//! This module provides a lightweight cache for precomputing intensity statistics
//! for funscript files under a base directory. The cache is stored as a JSON file
//! (.funscript_cache.json) beside the funscript base and maps relative file paths
//! to computed entries (sha256, average/peak intensity, sample counts, timestamp).

use crate::buttplug::funscript_utils::{
    actions_to_intensity_curve, Action, FunscriptData,
};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use walkdir::WalkDir;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FunscriptCacheEntry {
    pub sha256: String,
    pub average_intensity: f64,
    pub peak_intensity: f64,
    pub sample_count: usize,
    pub last_updated: u64,
}

pub type FunscriptCache = HashMap<String, FunscriptCacheEntry>;

fn unix_now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn is_funscript_file(path: &Path) -> bool {
    path.is_file()
        && path
            .extension()
            .and_then(|e| e.to_str())
            .map(|s| s.eq_ignore_ascii_case("funscript"))
            .unwrap_or(false)
}

fn cache_key(base: &Path, file: &Path) -> String {
    file.strip_prefix(base)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file.to_string_lossy().to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn intensity_stats(samples: &[Action]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let peak = samples.iter().map(|a| a.pos).fold(0.0, f64::max);

    if samples.len() == 1 {
        return (samples[0].pos, peak);
    }

    let mut weighted_sum = 0.0;
    let mut total_dt = 0.0;

    for pair in samples.windows(2) {
        let dt = (pair[1].at as f64 - pair[0].at as f64).max(0.0);
        if dt == 0.0 {
            continue;
        }
        let avg_pos = (pair[0].pos + pair[1].pos) / 2.0;
        weighted_sum += avg_pos * dt;
        total_dt += dt;
    }

    if total_dt > 0.0 {
        (weighted_sum / total_dt, peak)
    } else {
        let mean = samples.iter().map(|a| a.pos).sum::<f64>() / samples.len() as f64;
        (mean, peak)
    }
}

fn build_entry(content: &str, sha256: String) -> Result<FunscriptCacheEntry, String> {
    let data: FunscriptData = serde_json::from_str(content)
        .map_err(|e| format!("Failed to parse funscript json: {}", e))?;

    if data.actions.len() < 2 {
        return Ok(FunscriptCacheEntry {
            sha256,
            average_intensity: 0.0,
            peak_intensity: 0.0,
            sample_count: 0,
            last_updated: unix_now_secs(),
        });
    }

    let mut actions = data.actions.clone();
    let intensity = actions_to_intensity_curve(&mut actions, 100, 500);
    let (average_intensity, peak_intensity) = intensity_stats(&intensity);

    Ok(FunscriptCacheEntry {
        sha256,
        average_intensity,
        peak_intensity,
        sample_count: intensity.len(),
        last_updated: unix_now_secs(),
    })
}

async fn read_cache(path: &Path) -> Result<FunscriptCache, String> {
    match fs::read_to_string(path).await {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| format!("Failed parse cache json: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("Failed read cache file {:?}: {}", path, e)),
    }
}

async fn write_cache(path: &Path, cache: &FunscriptCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }

    let json = serde_json::to_string_pretty(cache).map_err(|e| format!("Ser failed: {}", e))?;
    fs::write(path, json)
        .await
        .map_err(|e| format!("Failed write cache {:?}: {}", path, e))
}

pub async fn scan_and_update_cache(
    funscript_base: &Path,
    cache_path: &Path,
) -> Result<FunscriptCache, String> {
    let mut cache = read_cache(cache_path).await.unwrap_or_default();
    let mut seen: HashSet<String> = HashSet::new();

    for item in WalkDir::new(funscript_base).into_iter().filter_map(Result::ok) {
        let path = item.path();
        if !is_funscript_file(path) {
            continue;
        }

        let key = cache_key(funscript_base, path);
        seen.insert(key.clone());

        let content = match fs::read_to_string(path).await {
            Ok(s) => s,
            Err(e) => {
                log::error!("Failed read funscript {:?}: {}", path, e);
                continue;
            }
        };

        let sha = sha256_hex(content.as_bytes());
        let unchanged = cache
            .get(&key)
            .map(|entry| entry.sha256 == sha)
            .unwrap_or(false);

        if unchanged {
            continue;
        }

        match build_entry(&content, sha) {
            Ok(entry) => {
                cache.insert(key, entry);
            }
            Err(e) => {
                cache.remove(&key);
                log::error!("Failed compute stats for {:?}: {}", path, e);
            }
        }
    }

    cache.retain(|k, _| seen.contains(k));
    write_cache(cache_path, &cache).await?;
    Ok(cache)
}

pub async fn get_cache_for_base(funscript_base: &Path) -> Result<FunscriptCache, String> {
    let cache_path = funscript_base.join(".funscript_cache.json");
    scan_and_update_cache(funscript_base, &cache_path).await
}
