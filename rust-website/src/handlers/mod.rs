use actix_web::{web,HttpResponse,Error};
use actix_files::NamedFile;
use std::path::PathBuf;
use log::{info, error};

pub async fn handle_index() -> HttpResponse {
    info!("Loading index page");
    let html = r#"
        <!DOCTYPE html>
        <html>
            <head>
                <title>Video Player</title>
            </head>
            <body>
                <h1>Video Player</h1>
                <video width="640" height="360" controls>
                    <source src="/video/sample.mp4" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
            </body>
        </html>
    "#;

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

pub async fn handle_video(path: web::Path<String>) -> Result<NamedFile, Error> {
    let filename = path.into_inner();
    info!("Attempting to serve video: {}", &filename);
    let path: PathBuf = [".", "videos", &filename].iter().collect();
    info!("Full path: {:?}", &path);
    match NamedFile::open(&path) {
        Ok(file) => {
            info!("Successfully opened file");
            Ok(file)
        },
        Err(e) => {
            error!("Failed to open file: {}", e);
            Err(e.into())
        }
    }
}