// This file defines the data models used in the application.
// It may export structs that represent the data entities used in the website.

use std::path::PathBuf;
use serde::Serialize;
use std::fs;

#[derive(Serialize)]
pub struct FileNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Option<Vec<FileNode>>,
}

pub fn build_directory_tree(path: &PathBuf, relative_path: &str) -> Result<FileNode, std::io::Error> {
    let mut children = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let file_name = entry.file_name();
        let file_name_str = file_name.to_string_lossy().to_string();
        let file_path = format!("{}/{}", relative_path, file_name_str);

        if file_type.is_dir() {
            let child_node = build_directory_tree(&entry.path(), &file_path)?;
            children.push(child_node);
        } else if file_type.is_file() {
            children.push(FileNode {
                name: file_name_str,
                path: file_path.clone(),
                is_dir: false,
                children: None,
            });
        }
    }

    Ok(FileNode {
        name: path.file_name().unwrap_or_default().to_string_lossy().to_string(),
        path: relative_path.to_string(),
        is_dir: true,
        children: Some(children),
    })
}