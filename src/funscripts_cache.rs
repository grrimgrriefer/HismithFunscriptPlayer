// src/funscripts_cache.rs

//! Funscript cache utilities
//!
//! This module provides a lightweight cache for precomputing intensity statistics
//! for funscript files under a base directory. The cache is stored as a JSON file
//! (.funscripts_cache.json) beside the funscript base and maps relative file paths
//! to computed entries (sha256, average/peak intensity, sample counts, timestamp).

use crate::funscript::{self, structs::{FunscriptData, FunscriptStats}};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::fs;
use walkdir::WalkDir;

const CURRENT_CACHE_VERSION: u32 = 4;
pub const CACHE_FILE_NAME: &str = ".funscripts_cache.json";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FunscriptCacheFile {
    pub version: u32,
    pub entries: HashMap<String, FunscriptCacheEntry>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FunscriptCacheEntry {
    pub sha256: String,
    #[serde(flatten)]
    pub stats: FunscriptStats,
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

pub fn cache_key(base: &Path, file: &Path) -> String {
    file.strip_prefix(base)
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| file.to_string_lossy().to_string())
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn build_entry(content: &str, sha256: String) -> Result<FunscriptCacheEntry, String> {
    let data: FunscriptData = serde_json::from_str(content)
        .map_err(|e| format!("Failed to parse funscript json: {}", e))?;
    let duration = data.actions.last().map(|a| a.at / 1000).unwrap_or(0);

    if data.actions.len() < 2 {
        return Ok(FunscriptCacheEntry {
            sha256,
            stats: FunscriptStats {
                peak: 0.0,
                avg: 0.0,
                volatility: 0.0,
                duration,
            },
            sample_count: 0,
            last_updated: unix_now_secs(),
        });
    }

    let actions = data.actions.clone();
    let intensity = funscript::curves::actions_to_intensity_curve(&actions, &[]);
    let (avg, peak) = funscript::curves::calculate_intensity_stats(&intensity);
    let volatility = funscript::volatility::calculate_volatility(&actions);

    Ok(FunscriptCacheEntry {
        sha256,
        stats: FunscriptStats {
            peak,
            avg,
            volatility,
            duration,
        },
        sample_count: intensity.len(),
        last_updated: unix_now_secs(),
    })
}

async fn read_cache(path: &Path) -> Result<FunscriptCache, String> {
    match fs::read_to_string(path).await {
        Ok(raw) => {
            if let Ok(wrapper) = serde_json::from_str::<FunscriptCacheFile>(&raw) {
                if wrapper.version == CURRENT_CACHE_VERSION {
                    return Ok(wrapper.entries);
                }
                log::info!("Cache schema version changed (v{} -> v{}). Rebuilding cache...", wrapper.version, CURRENT_CACHE_VERSION);
                return Ok(HashMap::new());
            }
            Ok(HashMap::new())
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
        Err(e) => Err(format!("Failed read cache file {:?}: {}", path, e)),
    }
}

async fn write_cache(path: &Path, cache: &FunscriptCache) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent).await;
    }

    let wrapper = FunscriptCacheFile {
        version: CURRENT_CACHE_VERSION,
        entries: cache.clone(),
    };

    let json = serde_json::to_string_pretty(&wrapper).map_err(|e| format!("Ser failed: {}", e))?;
    fs::write(path, json)
        .await
        .map_err(|e| format!("Failed write cache {:?}: {}", path, e))
}

pub async fn update_single_entry(
    cache_path: &Path,
    rel_key: &str,
    content: &str,
) -> Result<(), String> {
    let sha = sha256_hex(content.as_bytes());
    let entry = build_entry(content, sha)?;

    let mut cache = read_cache(cache_path).await?;
    cache.insert(rel_key.to_string(), entry);
    write_cache(cache_path, &cache).await?;
    Ok(())
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
    let cache_path = funscript_base.join(CACHE_FILE_NAME);
    scan_and_update_cache(funscript_base, &cache_path).await
}

/// Returns the exact match key and variant prefix for a given file path.
pub fn get_cache_match_keys(file_path: &str) -> (String, String) {
    let stem_path = Path::new(file_path).with_extension("");
    let stem_str = stem_path.to_string_lossy();
    let exact_match = format!("{stem_str}.funscript");
    let variant_prefix = format!("{stem_str}.");
    (exact_match, variant_prefix)
}

/// Helper to check if a cache key matches a file path.
pub fn is_matching_key(key: &str, exact_match: &str, variant_prefix: &str) -> bool {
    key == exact_match || (key.starts_with(variant_prefix) && key.ends_with(".funscript"))
}

/// Queries the cache for all entries matching the given file path (exact match and variants).
///
/// If an exact match (`<stem>.funscript`) is present, it is positioned first in the returned vector.
pub fn query_cache<'a, K, V>(
    cache: impl IntoIterator<Item = (&'a K, &'a V)>,
    file_path: &str,
) -> Vec<(&'a K, &'a V)>
where
    K: AsRef<str> + 'a,
    V: 'a,
{
    let (exact_match, variant_prefix) = get_cache_match_keys(file_path);
    let mut matches: Vec<(&'a K, &'a V)> = cache
        .into_iter()
        .filter(|(key, _)| is_matching_key(key.as_ref(), &exact_match, &variant_prefix))
        .collect();

    // Ensure the exact match is first if present
    if let Some(pos) = matches.iter().position(|(k, _)| k.as_ref() == exact_match) {
        if pos != 0 {
            matches.swap(0, pos);
        }
    }

    matches
}
