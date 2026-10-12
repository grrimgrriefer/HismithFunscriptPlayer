// src/main.rs

//! Main entry point for the Video Player web server.
//!
//! Loads .env and initializes logging. Spawns background tasks for:
//! - funscript cache initialization when FUNSCRIPT_SHARE_PATH is set
//! - Intiface initialization via device::device_manager::initialize()
//!
//! Configures Actix HTTP server with logging and permissive CORS. Bind address is
//! controlled by HOST_IP and SERVER_PORT environment variables

use actix_cors::Cors;
use actix_web::{App, HttpServer, middleware::Logger, web};
use env_logger::Env;
use hismith_player_site::{AppConfig, device::device_manager, routes};
use log::{error, info};
use std::env;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    let config = AppConfig::from_env().expect("Failed to load application configuration");

    info!("Starting background cache");
    let cache_base = config.funscript_share_path.clone();
    tokio::spawn(async move {
        match hismith_player_site::funscripts_cache::get_cache_for_base(&cache_base).await {
            Ok(_) => info!("Funscript cache ready"),
            Err(e) => error!("Funscript cache error: {}", e),
        }
    });

    info!("Starting intiface initialization...");
    tokio::spawn(async {
        if let Err(e) = device_manager::initialize().await {
            error!("Intiface initialization error: {}", e);
        } else {
            info!("Intiface initialization completed");
        }
    });

    // LAN configuration
    let host_ip = env::var("HOST_IP").expect("HOST_IP environment variable must be set");
    let port = env::var("SERVER_PORT")
        .expect("SERVER_PORT environment variable must be set")
        .parse::<u16>()
        .expect("SERVER_PORT must be a valid port number (0-65535)");

    let config_data = web::Data::new(config);

    info!("Starting HTTP server on {}:{}...", host_ip, port);
    HttpServer::new(move || {
        App::new()
            .app_data(config_data.clone())
            .wrap(Logger::default())
            .wrap(
                Cors::default()
                    .allow_any_origin()
                    .allowed_methods(vec!["GET", "POST", "OPTIONS"])
                    .allow_any_header()
                    .max_age(3600),
            )
            .configure(routes::setup_routes)
    })
    .bind(format!("{}:{}", host_ip, port))?
    .run()
    .await
}
