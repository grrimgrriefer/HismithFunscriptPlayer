// src/path_utils.rs

//! Utility functions that are used across many different handlers.

use actix_web::error::{ErrorBadRequest, Error};
use std::path::{Component, Path, PathBuf};

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
