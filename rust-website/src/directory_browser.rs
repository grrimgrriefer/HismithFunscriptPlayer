// src/directory_browser.rs

//! File system directory browser module
//! 
//! This module provides functionality to recursively scan directories and build
//! a tree structure representing the file system hierarchy. It's primarily used
//! to display video files in the web interface.

use std::{
    path::PathBuf,
    fs
};
use serde::Serialize;

/// Represents a node in the file system tree structure
///
/// This structure is serialized to JSON and sent to the frontend where it's used
/// to build the directory navigation interface.
#[derive(Serialize)]
pub struct FileNode {
    /// Name of the file or directory
    pub name: String,
    /// Relative path from the root directory
    pub path: String,
    /// Whether this node represents a directory
    pub is_dir: bool,
    /// Child nodes if this is a directory, None otherwise
    pub children: Option<Vec<FileNode>>,
}

/// Recursively builds a tree structure representing the directory hierarchy
///
/// # Arguments
/// * `path` - The absolute path to scan
/// * `relative_path` - The relative path from the root directory (used for URLs)
///
/// # Returns
/// * `Ok(FileNode)` - Root node of the directory tree
/// * `Err(std::io::Error)` - If directory reading fails
///
/// # Example
/// ```
/// use std::path::PathBuf;
/// let path = PathBuf::from("/path/to/videos");
/// let tree = build_directory_tree(&path, "")?;
/// ```
pub fn build_directory_tree(path: &PathBuf, relative_path: &str) -> Result<FileNode, std::io::Error> {
    // Vector to store child nodes
    let mut children = Vec::new();

    // Read directory entries
    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy().to_string();
        
        // Build relative path for URLs
        let file_path = if relative_path.is_empty() {
            file_name_str.clone()
        } else {
            format!("{}/{}", relative_path, file_name_str)
        };

        // Create node based on entry type
        let node = if file_type.is_dir() {
            // Recursively scan subdirectories
            build_directory_tree(&entry.path(), &file_path)?
        } else if file_type.is_file() {
            // Create leaf node for files
            FileNode {
                name: file_name_str,
                path: file_path,
                is_dir: false,
                children: None,
            }
        } else {
            // Skip other file types (symlinks, etc.)
            continue;
        };

        children.push(node);
    }

    // Sort nodes: directories first, then alphabetically
    children.sort_by(|a, b| {
        match (a.is_dir, b.is_dir) {
            (true, false) => std::cmp::Ordering::Less,    // Directories before files
            (false, true) => std::cmp::Ordering::Greater, // Files after directories
            _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()), // Alphabetical within each group
        }
    });

    // Create and return root node
    Ok(FileNode {
        name: path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string(),
        path: relative_path.to_string(),
        is_dir: true,
        children: Some(children),
    })
}