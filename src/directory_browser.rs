// src/directory_browser.rs

//! File system directory browser module
//!
//! This module provides functionality to recursively scan directories and build
//! a tree structure representing the file system hierarchy. It's primarily used
//! to display video files in the web interface.

use serde::Serialize;
use std::collections::HashMap;
use std::{
    fs, io,
    path::{Path, PathBuf},
};
use walkdir::{DirEntry, WalkDir};

#[derive(Serialize)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileNode>>,
}

fn is_funscripts_dir(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("funscripts"))
        .unwrap_or(false)
}

fn join_relative_path(parent: &str, name: &str) -> String {
    if parent.is_empty() {
        name.to_string()
    } else {
        format!("{parent}/{name}")
    }
}

pub fn build_directory_tree(path: &Path, relative_path: &str) -> io::Result<FileNode> {
    let mut children = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let name = entry.file_name().to_string_lossy().to_string();

        if file_type.is_dir() && name.eq_ignore_ascii_case("funscripts") {
            continue;
        }

        let child_relative_path = join_relative_path(relative_path, &name);

        let node = if file_type.is_dir() {
            build_directory_tree(&entry.path(), &child_relative_path)?
        } else if file_type.is_file() {
            FileNode {
                name,
                path: child_relative_path,
                is_dir: false,
                children: None,
            }
        } else {
            continue;
        };

        children.push(node);
    }

    children.sort_by_cached_key(|n| (!n.is_dir, n.name.to_lowercase()));

    Ok(FileNode {
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: relative_path.to_string(),
        is_dir: true,
        children: Some(children),
    })
}

fn is_video_file(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase()),
        Some(ext) if matches!(ext.as_str(), "mp4" | "mkv" | "webm" | "mov")
    )
}

pub fn get_all_files_with_size(base_path: &Path) -> io::Result<HashMap<PathBuf, u64>> {
    let mut file_map = HashMap::new();

    let walker = WalkDir::new(base_path)
        .into_iter()
        .filter_entry(|e: &DirEntry| !is_funscripts_dir(e.path()));

    for entry in walker {
        let entry = entry.map_err(|e| io::Error::new(io::ErrorKind::Other, e))?;
        let path = entry.path();

        if !entry.file_type().is_file() || !is_video_file(path) {
            continue;
        }

        let relative = match path.strip_prefix(base_path) {
            Ok(p) => p.to_path_buf(),
            Err(_) => continue,
        };

        let size = entry.metadata()?.len();
        file_map.insert(relative, size);
    }

    Ok(file_map)
}
