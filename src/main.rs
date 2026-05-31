// src/main.rs

//! Main entry point for the Video Player web server.
//!
//! Loads .env and initializes logging. Spawns background tasks for:
//! - funscript cache initialization when FUNSCRIPT_SHARE_PATH is set
//! - Intiface initialization via buttplug::device_manager::initialize()
//!
//! Configures Actix HTTP server with logging and permissive CORS. Bind address is
//! controlled by HOST_IP and SERVER_PORT environment variables (defaults to 0.0.0.0:5441).

use actix_cors::Cors;
use actix_web::{App, HttpServer, middleware::Logger};
use env_logger::Env;
use hismith_player_site::{buttplug::device_manager, routes};
use log::{error, info};
use std::env;

const SERVER_PORT: u16 = 5441;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv::dotenv().ok();
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    info!("Starting background cache");
    if let Ok(f) = env::var("FUNSCRIPT_SHARE_PATH") {
        let base = std::path::PathBuf::from(f);
        tokio::spawn(async move {
            match hismith_player_site::funscript_cache::get_cache_for_base(&base).await {
                Ok(_) => info!("Funscript cache ready"),
                Err(e) => error!("Funscript cache error: {}", e),
            }
        });
    }

    info!("Starting intiface initialization...");
    tokio::spawn(async {
        if let Err(e) = device_manager::initialize().await {
            error!("Intiface initialization error: {}", e);
        } else {
            info!("Intiface initialization completed");
        }
    });

    // LAN configuration
    let host_ip = env::var("HOST_IP").unwrap_or_else(|_| "0.0.0.0".to_string());
    let port = env::var("SERVER_PORT")
        .ok()
        .and_then(|s| s.parse::<u16>().ok())
        .unwrap_or(SERVER_PORT);

    info!("Starting HTTP server on {}:{}...", host_ip, port);
    HttpServer::new(move || {
        App::new()
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
