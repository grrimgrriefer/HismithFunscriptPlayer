use actix_web::{
    web, HttpRequest, HttpResponse, Error,
    http::header::{self, ContentDisposition, DispositionType},
};
use actix_files::NamedFile;
use std::{env, path::PathBuf, path::Path};
use log::{info, error, warn};
use serde::Serialize; 
use tokio::fs;
use crate::directory_browser;
use crate::buttplug::funscript_utils::FunscriptData;
use crate::buttplug::funscript_utils;

#[derive(Serialize, Debug)] // Add Debug for logging
struct FunscriptResponse {
    original: Option<FunscriptData>,
    intensity: Option<FunscriptData>,
}

pub async fn handle_index() -> HttpResponse {
    info!("Loading index page");

    let smb_base_path = env::var("VIDEO_SHARE_PATH").unwrap();
    let base_path = PathBuf::from(smb_base_path);

    let directory_tree = match directory_browser::build_directory_tree(&base_path, "") {
        Ok(tree) => tree,
        Err(e) => {
            error!("Failed to read video directory: {}", e);
            return HttpResponse::InternalServerError()
                .content_type("text/plain; charset=utf-8")
                .insert_header(("Cache-Control", "no-store"))
                .body("Failed to load video directory.");
        }
    };

    let html = format!(
        r#"
        <!DOCTYPE html>
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
        </html>
        "#,
        tree = serde_json::to_string(&directory_tree).unwrap(),
        version = chrono::Utc::now().timestamp()
    );


    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

pub async fn handle_video(req: HttpRequest, path: web::Path<String>) -> Result<HttpResponse, Error> {
    let mut filename = path.into_inner();
    info!("Attempting to serve video: {}", &filename);
    if filename.starts_with('/') || filename.starts_with('\\') 
    {
        filename = filename[1..].to_string();
    }
    let smb_base_path = env::var("VIDEO_SHARE_PATH").unwrap();
    let path = PathBuf::from(smb_base_path).join(&filename);

    let named_file = match NamedFile::open_async(&path).await {
        Ok(file) => file,
        Err(e) => {
            error!("Failed to open file: {}", e);
            return Ok(HttpResponse::NotFound()
                .content_type("text/plain; charset=utf-8")
                .body("Video file not found or inaccessible."));
        }
    };

    let mut response = named_file
        .use_last_modified(true)
        .prefer_utf8(true)
        .set_content_disposition(ContentDisposition {
            disposition: DispositionType::Inline,
            parameters: vec![],
        })
        .into_response(&req);

    response.headers_mut().insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("public, max-age=31536000"),
    );

    Ok(response)
}

fn get_original_funscript_path(
    requested_path_str: &str,
    base_path_str: &str,
) -> Result<(PathBuf, String), String> { // Removed intensity_filepath from return
    let base_path = PathBuf::from(base_path_str);

    // Get just the filename part safely
    let filename_only = Path::new(requested_path_str)
        .file_name()
        .ok_or_else(|| format!("Invalid requested path: {}", requested_path_str))?
        .to_string_lossy()
        .to_string();

    let original_filepath = base_path.join(&filename_only);

    Ok((original_filepath, filename_only)) // Return only original path and filename
}

async fn read_and_deserialize_funscript(filepath: &Path) -> Result<FunscriptData, String> {
    let content = fs::read_to_string(filepath)
        .await
        .map_err(|e| format!("Failed to read file {:?}: {}", filepath, e))?;

    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to deserialize file {:?}: {}", filepath, e))
}

fn generate_intensity_funscript(
    original_data: &FunscriptData,
) -> Result<FunscriptData, String> { // Removed async as fs::write is gone

    // Clone original actions because calculate_thrust... needs mutable slice for sorting
    let mut actions_to_process = original_data.actions.clone();

    if actions_to_process.len() < 2 {
         // Cannot generate intensity from less than 2 points
         return Err("Cannot generate intensity: requires at least 2 actions.".to_string());
    }

    // Define generation parameters (consider making these configurable)
    let sample_rate_ms = 50;
    let window_radius_ms = 200;

    let intensity_actions = funscript_utils::calculate_thrust_intensity_by_scaled_speed(
        &mut actions_to_process, // Pass the mutable clone
        sample_rate_ms,
        window_radius_ms,
    );

    // Create new FunscriptData with intensity actions
    let intensity_data = FunscriptData {
        actions: intensity_actions,
        // Copy metadata if it exists and you need it
        // metadata: original_data.metadata.clone(),
    };

    // No serialization needed here, just return the data structure
    // No file writing

    Ok(intensity_data) // Return the generated data structure
}

// --- Updated handle_funscript function ---
pub async fn handle_funscript(path: web::Path<String>) -> HttpResponse {
    let original_filename_req = path.into_inner();
    info!("Handling funscript request for: {}", &original_filename_req);

    let funscript_base_path_str = match env::var("FUNSCRIPT_SHARE_PATH") {
        Ok(p) => p,
        Err(e) => {
            error!("FUNSCRIPT_SHARE_PATH environment variable not set: {}", e);
            // Still return JSON structure for consistency
            return HttpResponse::InternalServerError().json(FunscriptResponse {
                original: None,
                intensity: None,
            });
        }
    };

    // 1. Determine Original Path
    let (original_filepath, filename_only) =
        match get_original_funscript_path(&original_filename_req, &funscript_base_path_str) {
            Ok(paths) => paths,
            Err(e) => {
                error!("Path determination error: {}", e);
                return HttpResponse::BadRequest().json(FunscriptResponse {
                    original: None,
                    intensity: None,
                });
            }
        };

    // 2. Attempt to load original funscript
    let original_result = read_and_deserialize_funscript(&original_filepath).await;

    // --- Store potential intensity error message BEFORE moving result ---
    let mut intensity_error_message: Option<String> = None;
    // ---

    // 3. Always attempt to generate intensity data *if* original loaded
    let intensity_result = match &original_result {
         Ok(orig_data) => {
              info!("Original loaded, generating intensity for: {}", &filename_only);
              // Call the generation function (no longer async, no longer saves)
              match generate_intensity_funscript(orig_data) {
                   Ok(generated_data) => {
                        info!("Successfully generated intensity for: {}", &filename_only);
                        Ok(generated_data)
                   },
                   Err(e) => {
                        error!("Failed to generate intensity for {}: {}", &filename_only, e.clone()); // Clone error for storage
                        intensity_error_message = Some(e); // Store error message
                        Err("Intensity generation failed.".to_string()) // Return a generic error or the specific one
                   }
              }
         }
         Err(e) => {
              // Original failed to load, cannot generate
              let err_msg = format!("Original funscript failed to load: {}", e);
              info!("Original script {} failed to load, cannot generate intensity: {}", &filename_only, e);
              intensity_error_message = Some(err_msg.clone()); // Store error message
              Err(err_msg)
         }
    };

    // 4. Construct the final response payload
    //    We use .ok() to convert Result<FunscriptData, String> into Option<FunscriptData>
    //    This MOVES original_result and intensity_result
    let response_payload = FunscriptResponse {
        original: original_result.ok(),
        intensity: intensity_result.ok(), // This is okay now, error message was stored if needed
    };

    // 5. Determine status code: OK only if original was loaded successfully
    let status_code = if response_payload.original.is_some() {
        actix_web::http::StatusCode::OK
    } else {
        // If original load failed, treat as NotFound
        actix_web::http::StatusCode::NOT_FOUND
    };

     if status_code == actix_web::http::StatusCode::NOT_FOUND {
        info!("Responding with 404 Not Found for: {}", original_filename_req);
    } else {
         info!("Responding with 200 OK for: {}", original_filename_req);
         // Log if intensity generation failed for an existing original
         // Use the stored error message
         if response_payload.intensity.is_none() {
              if let Some(e) = intensity_error_message {
                 warn!("Intensity data is missing for {}: {}", &filename_only, e);
              }
         }
    }

    // 6. Return JSON response
    HttpResponse::build(status_code)
        .content_type("application/json")
        .json(response_payload)
}
