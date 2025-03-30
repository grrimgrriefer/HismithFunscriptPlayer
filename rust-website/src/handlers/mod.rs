use actix_web::{
    web, HttpRequest, HttpResponse, Error,
    http::header::{self, ContentDisposition, DispositionType},
};
use actix_files::NamedFile;
use std::{env, path::PathBuf};
use log::{info, error};

pub async fn handle_index() -> HttpResponse {
    info!("Loading index page");
    let html = r#"
        <!DOCTYPE html>
        <html>
            <head>
                <title>Video Player</title>
                <style>
                    body {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        background-color:rgb(37, 37, 37);
                        font-family: Arial, sans-serif;
                    }
                    video {
                        max-width: 100%;
                        box-shadow: 0 0 10px rgba(0,0,0,0.2);
                        margin: 20px;
                    }
                </style>
            </head>
            <body>
                <h1>Video Player</h1>
                <video width="640" height="360" controls preload="metadata">
                    <source src="/video/sample3.mp4" type="video/mp4">
                    Your browser does not support the video tag.
                </video>
            </body>
        </html>
    "#;

    HttpResponse::Ok()
        .content_type("text/html; charset=utf-8")
        .body(html)
}

pub async fn handle_video(req: HttpRequest, path: web::Path<String>) -> Result<HttpResponse, Error> {
    let filename = path.into_inner();
    info!("Attempting to serve video: {}", &filename);

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