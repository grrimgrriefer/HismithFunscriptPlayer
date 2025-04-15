// src/handlers/index.rs

//! Index page handler module
//! 
//! This module handles requests for the main index page of the application.
//! It loads the directory structure and generates the HTML interface for
//! browsing and playing videos.

use log::{info, error};
use actix_web::HttpResponse;
use std::{
    env, 
    path::PathBuf
};
use crate::directory_browser;

/// Handles the main index page request
///
/// Loads the video directory structure and generates the HTML interface.
/// The interface includes:
/// - Directory tree navigation
/// - Video player container
/// - Required CSS and JavaScript resources
///
/// # Returns
/// * `HttpResponse` - HTTP response containing:
///   - 200 OK with HTML content on success
///   - 500 Internal Server Error if:
///     - VIDEO_SHARE_PATH environment variable is not set
///     - Directory cannot be read
pub async fn handle_index() -> HttpResponse {
    info!("Loading index page");

    // Get video directory path from environment
    let base_path = match get_video_base_path() {
        Ok(path) => path,
        Err(response) => return response,
    };

    // Build directory tree structure
    let directory_tree = match build_directory_structure(&base_path) {
        Ok(tree) => tree,
        Err(response) => return response,
    };

    // Generate and return HTML response
    create_html_response(&directory_tree)
}

/// Gets the base video directory path from environment variables
fn get_video_base_path() -> Result<PathBuf, HttpResponse> {
    env::var("VIDEO_SHARE_PATH")
        .map(PathBuf::from)
        .map_err(|e| {
            error!("VIDEO_SHARE_PATH not set: {}", e);
            HttpResponse::InternalServerError()
                .content_type("text/plain")
                .body("Server configuration error")
        })
}

/// Builds the directory tree structure for navigation
fn build_directory_structure(base_path: &PathBuf) -> Result<directory_browser::FileNode, HttpResponse> {
    directory_browser::build_directory_tree(base_path, "").map_err(|e| {
        error!("Failed to read video directory: {}", e);
        HttpResponse::InternalServerError()
            .content_type("text/plain")
            .insert_header(("Cache-Control", "no-store"))
            .body("Failed to load video directory.")
    })
}

/// Creates the HTTP response with generated HTML
fn create_html_response(directory_tree: &directory_browser::FileNode) -> HttpResponse {
    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(generate_index_html(directory_tree))
}

/// Generates the HTML template for the index page
///
/// # Arguments
/// * `directory_tree` - The file system structure to embed in the page
///
/// # Returns
/// * `String` - Complete HTML document with:
///   - Responsive viewport settings
///   - CSS and JavaScript resources
///   - Directory navigation interface
///   - Video player container
fn generate_index_html(directory_tree: &directory_browser::FileNode) -> String {
    format!(
        r#"<!DOCTYPE html>
        <html>
            <head>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <title>Video Player</title>
                <link rel="stylesheet" href="/site/static/styles.css?v={version}">
                <script>
                    window.directoryTree = {tree};
                </script>
                <script src="/site/static/directory_tree.js?v={version}" type="module"></script>
            </head>
            <body>
                <button id="toggle-directory">Toggle Directory</button>
                <div id="directory-container">
                    <h1>Video Player</h1>
                    <div id="directory-tree"></div>
                </div>
                <div id="video-container" class="hidden">
                    <div id="video-wrapper">
                        <div id="video-player"></div>
                    </div>
                </div>
            </body>
        </html>"#,
        tree = serde_json::to_string(directory_tree).unwrap(),
        version = chrono::Utc::now().timestamp()
    )
}