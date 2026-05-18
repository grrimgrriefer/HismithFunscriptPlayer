// src/main.rs

//! Main entry point for the Video Player web server.
//! This server provides a REST API for video playback control and device management.

use log::{info, error};
use actix_web::{
    App, 
    HttpServer,
    middleware::{DefaultHeaders, Logger}
};
use hismith_player_site::{
    routes, 
    buttplug::device_manager,
};
use env_logger::Env;
use std::env;
use tokio::task;

/// Default server port
const SERVER_PORT: u16 = 5441;

/// Starts the web server and initializes Intiface management.
/// 
/// # Error
/// Returns an error if:
/// - The server fails to bind to the specified address
/// - Environment variables are not properly configured
/// - Intiface initialization fails
#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // Load environment variables from .env file
    dotenv::from_filename(".env").expect("Failed to load .env");

    // Initialize logging with default level of 'info'
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    // spawn a background cache build (best-effort)
    info!("Starting background cache");
    if let Ok(f) = std::env::var("FUNSCRIPT_SHARE_PATH") {
        let base = std::path::PathBuf::from(f);
        tokio::spawn(async move {
            let _ = hismith_player_site::funscript_cache::get_cache_for_base(&base).await;
        });
    }

    // Initialize intiface management in background task
    info!("Starting intiface initialization...");
    task::spawn(async {
        if let Err(e) = device_manager::initialize_intiface().await {
            error!("Intiface initialization error: {}", e);
        } else {
            info!("Intiface initialization completed");
        }
    });

    // Get server configuration from environment
    let host_ip = env::var("HOST_IP")
        .expect("HOST_IP must be set in .env file");

    info!("Starting HTTP server on {}:{}...", host_ip, SERVER_PORT);

    // Configure and start the HTTP server
    HttpServer::new(move || {
        App::new()
            .wrap(Logger::default())
            .wrap(
                DefaultHeaders::new()
                    .add(("Access-Control-Allow-Origin", "*"))
                    .add(("Access-Control-Allow-Methods", "GET, POST"))
                    .add(("Access-Control-Allow-Headers", "content-type"))
            )
            .configure(routes::setup_routes)
    })
    .bind(format!("{}:{}", host_ip, SERVER_PORT))?
    .run()
    .await
}