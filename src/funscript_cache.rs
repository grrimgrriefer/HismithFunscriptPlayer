// src/handlers/funscript_cache.rs

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::fs;
use walkdir::WalkDir;

use crate::buttplug::funscript_utils::{
    calculate_thrust_intensity_by_scaled_speed,
    Action,
    FunscriptData,
};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FunscriptCacheEntry {
    pub sha256: String,
    pub average_intensity: f64,
    pub peak_intensity: f64,
    pub sample_count: usize,
    pub last_updated: u64,
}

pub type FunscriptCache = HashMap<String, FunscriptCacheEntry>;

fn now_unix_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

async fn load_cache_file(path: &Path) -> Result<FunscriptCache, String> {
    match fs::read_to_string(path).await {
        Ok(s) => serde_json::from_str(&s).map_err(|e| format!("Failed parse cache json: {}", e)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("Failed read cache file {:?}: {}", path, e)),
    }
}

async fn save_cache_file(path: &Path, cache: &FunscriptCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }
    let s = serde_json::to_string_pretty(cache).map_err(|e| format!("Ser failed: {}", e))?;
    fs::write(path, s).await.map_err(|e| format!("Failed write cache {:?}: {}", path, e))
}

fn compute_stats_from_intensity(intensity: &[Action]) -> (f64, f64) {
    if intensity.is_empty() {
        return (0.0, 0.0);
    }
    let peak = intensity.iter().map(|a| a.pos).fold(0.0, f64::max);

    // time-weighted average between samples
    if intensity.len() == 1 {
        return (intensity[0].pos, peak);
    }
    let mut num = 0.0;
    let mut den = 0.0;
    for w in intensity.windows(2) {
        let dt = (w[1].at as f64 - w[0].at as f64).max(0.0);
        if dt <= 0.0 { continue; }
        let avg_pos = (w[0].pos + w[1].pos) / 2.0;
        num += avg_pos * dt;
        den += dt;
    }
    if den > 0.0 {
        (num / den, peak)
    } else {
        // fallback to simple mean
        let mean = intensity.iter().map(|a| a.pos).sum::<f64>() / intensity.len() as f64;
        (mean, peak)
    }
}

fn sha256_of_bytes(b: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(b);
    let res = h.finalize();
    hex::encode(res)
}

fn compute_entry_from_content(content: &str) -> Result<FunscriptCacheEntry, String> {
    let sha = sha256_of_bytes(content.as_bytes());
    let fun: FunscriptData = serde_json::from_str(content)
        .map_err(|e| format!("Failed to parse funscript json: {}", e))?;

    if fun.actions.len() < 2 {
        return Ok(FunscriptCacheEntry {
            sha256: sha,
            average_intensity: 0.0,
            peak_intensity: 0.0,
            sample_count: 0,
            last_updated: now_unix_secs(),
        });
    }

    let mut actions_vec: Vec<Action> = fun.actions.clone();
    let intensity = calculate_thrust_intensity_by_scaled_speed(&mut actions_vec, 100, 500);
    let sample_count = intensity.len();
    let (avg, peak) = compute_stats_from_intensity(&intensity);

    Ok(FunscriptCacheEntry {
        sha256: sha,
        average_intensity: avg,
        peak_intensity: peak,
        sample_count,
        last_updated: now_unix_secs(),
    })
}

/// Scan the funscript directory and update the cache file (creates/overwrites cache_path)
pub async fn scan_and_update_cache(funscript_base: &Path, cache_path: &Path) -> Result<FunscriptCache, String> {
    let mut cache = load_cache_file(cache_path).await.unwrap_or_default();
    let mut seen: HashSet<String> = HashSet::new();

    for entry in WalkDir::new(funscript_base).into_iter().filter_map(Result::ok) {
        let p = entry.path();
        if !p.is_file() { continue; }
        if p.extension().and_then(|e| e.to_str()).map(|s| s.eq_ignore_ascii_case("funscript")).unwrap_or(false) {
            let rel = p.strip_prefix(funscript_base)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| p.to_string_lossy().to_string());
            seen.insert(rel.clone());

            match fs::read_to_string(p).await {
                Ok(content) => {
                    let sha = sha256_of_bytes(content.as_bytes());
                    let needs = match cache.get(&rel) {
                        Some(e) => e.sha256 != sha,
                        None => true,
                    };
                    if needs {
                        match compute_entry_from_content(&content) {
                            Ok(entry) => { cache.insert(rel, entry); }
                            Err(e) => log::error!("Failed compute stats for {:?}: {}", p, e),
                        }
                    }
                }
                Err(e) => log::error!("Failed read funscript {:?}: {}", p, e),
            }
        }
    }

    // remove stale entries
    let stale: Vec<String> = cache.keys()
        .filter(|k| !seen.contains(*k))
        .cloned()
        .collect();
    for k in stale { cache.remove(&k); }

    save_cache_file(cache_path, &cache).await?;
    Ok(cache)
}

pub async fn get_cache_for_base(funscript_base: &Path) -> Result<FunscriptCache, String> {
    let cache_path = funscript_base.join(".funscript_cache.json");
    scan_and_update_cache(funscript_base, &cache_path).await
}