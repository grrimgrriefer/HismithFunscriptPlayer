// src/utils.rs

//! Utility functions that are used across many different handlers.

use actix_web::error::{Error, ErrorBadRequest};
use serde::{de::DeserializeOwned, Serialize};
use std::io::ErrorKind;
use std::path::{Component, Path, PathBuf};
use tokio::fs;

/// Builds the path to a `.funscript` file given a base directory, a relative video path,
/// and an optional variant name.
///
/// If `variant` is None, empty, or `"original"`, `.funscript` is used.
/// Otherwise, `.{variant}.funscript` is used.
pub fn build_funscript_path(
    base_path: &Path,
    relative_path: &Path,
    variant: Option<&str>,
) -> PathBuf {
    let extension = match variant.map(str::trim).filter(|v| !v.is_empty() && *v != "original") {
        Some(v) => format!("{v}.funscript"),
        None => "funscript".to_string(),
    };
    base_path.join(relative_path).with_extension(extension)
}

/// Builds the parent fallback path to a `.funscript` file if a parent directory fallback exists.
pub fn build_parent_funscript_path(
    base_path: &Path,
    relative_path: &Path,
    variant: Option<&str>,
) -> Option<PathBuf> {
    let fallback_rel = get_parent_fallback_path(relative_path)?;
    Some(build_funscript_path(base_path, &fallback_rel, variant))
}

/// Returns the fallback relative path by moving one level up to the grandparent directory.
/// E.g. `category/nested/clip.mp4` -> `category/clip.mp4`
pub fn get_parent_fallback_path(rel_path: &Path) -> Option<PathBuf> {
    let parent = rel_path.parent()?;
    let grandparent = parent.parent()?;
    let file_name = rel_path.file_name()?;
    Some(grandparent.join(file_name))
}

/// Checks if a path is a safe relative path (no absolute components, parent directories, etc.).
pub fn is_safe_relative_path(path: &Path) -> bool {
    !path.is_absolute() && path.components().all(|c| matches!(c, Component::Normal(_)))
}

/// Resolves and sanitizes a requested relative path against a base directory,
/// ensuring no path traversal or invalid components are allowed.
pub fn resolve_safe_path(base_dir: &Path, requested: &str) -> Result<PathBuf, Error> {
    let trimmed = requested.trim_start_matches(['/', '\\']);
    if trimmed.is_empty() {
        return Err(ErrorBadRequest("Missing or empty path"));
    }

    let mut relative = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(part) => relative.push(part),
            Component::CurDir => {}
            _ => return Err(ErrorBadRequest("Invalid path components")),
        }
    }

    if relative.as_os_str().is_empty() {
        return Err(ErrorBadRequest("Invalid path"));
    }

    Ok(base_dir.join(relative))
}

/// Asynchronously reads and deserializes a JSON file.
///
/// If the file does not exist, returns `Ok(T::default())`.
/// Returns an error string if reading fails or JSON parsing fails.
pub async fn read_json_file<T>(path: &Path) -> Result<T, String>
where
    T: DeserializeOwned + Default,
{
    match fs::read_to_string(path).await {
        Ok(raw_json) => serde_json::from_str(&raw_json)
            .map_err(|e| format!("Failed to parse JSON file {:?}: {e}", path)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(T::default()),
        Err(e) => Err(format!("Failed to read JSON file {:?}: {e}", path)),
    }
}

/// Asynchronously serializes data to pretty JSON and writes it to a file.
///
/// Ensures any missing parent directories are created first.
pub async fn write_json_file<T>(path: &Path, data: &T) -> Result<(), String>
where
    T: Serialize + ?Sized,
{
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize data for {:?}: {e}", path))?;

    if let Some(parent_dir) = path.parent() {
        fs::create_dir_all(parent_dir)
            .await
            .map_err(|e| format!("Failed to create directory {:?}: {e}", parent_dir))?;
    }

    fs::write(path, json)
        .await
        .map_err(|e| format!("Failed to write file {:?}: {e}", path))
}
