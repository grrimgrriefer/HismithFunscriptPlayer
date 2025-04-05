use actix_web::{
    web, HttpRequest, HttpResponse, Error,
    http::header::{self, ContentDisposition, DispositionType},
};
use actix_files::NamedFile;
use std::{env, path::PathBuf};
use log::{info, error};
use crate::models::build_directory_tree;

pub async fn handle_index() -> HttpResponse {
    info!("Loading index page");

    let smb_base_path = env::var("VIDEO_SHARE_PATH").unwrap();
    let base_path = PathBuf::from(smb_base_path);

    let directory_tree = match build_directory_tree(&base_path, "") {
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
                <title>Video Player</title>
                <link rel="stylesheet" href="/static/styles.css">
                <script>
                    window.directoryTree = {tree};
                </script>
                <script src="/static/directory_tree.js?v={version}" type="module"></script>
            </head>
            <body>
                <button id="toggle-directory">Toggle Directory</button>
                <div id="directory-container">
                    <h1>Video Player</h1>
                    <div id="directory-tree"></div>
                </div>
                <div id="video-container" class="hidden">
                    <div id="video-player"></div>
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

pub async fn handle_funscript(path: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let mut filename = path.into_inner();
    info!("Attempting to serve funscript: {}", &filename);
    if filename.starts_with('/') || filename.starts_with('\\') 
    {
        filename = filename[1..].to_string();
    }
    let smb_base_path = env::var("FUNSCRIPT_SHARE_PATH").unwrap();
    let path = PathBuf::from(smb_base_path).join(&filename);

    match NamedFile::open_async(&path).await {
        Ok(file) => Ok(file.into_response(&req)),
        Err(e) => {
            error!("Failed to open funscript file: {}", e);
            Ok(HttpResponse::NotFound()
                .content_type("text/plain; charset=utf-8")
                .body("Failed to load funscript file."))
        }
    }
}