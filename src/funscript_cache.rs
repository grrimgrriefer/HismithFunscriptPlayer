// src/funscript_cache.rs

//! Funscript cache utilities
//!
//! This module provides a lightweight cache for precomputing intensity statistics
//! for funscript files under a base directory. The cache is stored as a JSON file
//! (.funscript_cache.json) beside the funscript base and maps relative file paths
//! to computed entries (sha256, average/peak intensity, sample counts, timestamp).

use crate::buttplug::funscript_utils::{Action, FunscriptData, actions_to_intensity_curve};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
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
        Ok(raw) => {
            serde_json::from_str(&raw).map_err(|e| format!("Failed parse cache json: {}", e))
        }
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
    base: &Path,
    cache_path: &Path,
) -> Result<FunscriptCache, String> {
    let mut cache = read_cache(cache_path).await?;
    let base_owned = base.to_path_buf();
    let discovered: Vec<(String, std::path::PathBuf)> = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        for entry in WalkDir::new(&base_owned).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path().to_path_buf();
            if is_funscript_file(&path) {
                let key = cache_key(&base_owned, &path);
                files.push((key, path));
            }
        }
        files
    })
    .await
    .map_err(|e| format!("spawn_blocking join error: {}", e))?;

    let mut seen_keys = HashSet::new();

    for (key, path) in &discovered {
        seen_keys.insert(key.clone());

        let content = fs::read_to_string(&path)
            .await
            .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

        let sha = sha256_hex(content.as_bytes());

        // Skip if already cached with the same hash
        if let Some(existing) = cache.get(key) {
            if existing.sha256 == sha {
                continue;
            }
        }

        match build_entry(&content, sha) {
            Ok(entry) => {
                cache.insert(key.clone(), entry);
            }
            Err(e) => {
                log::warn!("Skipping {}: {}", key, e);
            }
        }
    }

    // Remove entries for files that no longer exist
    cache.retain(|k, _| seen_keys.contains(k));

    write_cache(cache_path, &cache).await?;
    Ok(cache)
}

pub async fn get_cache_for_base(funscript_base: &Path) -> Result<FunscriptCache, String> {
    let cache_path = funscript_base.join(".funscript_cache.json");
    scan_and_update_cache(funscript_base, &cache_path).await
}
