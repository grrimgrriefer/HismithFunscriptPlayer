use actix_web::{App, HttpServer};
use actix_web::middleware::DefaultHeaders;
use actix_web::middleware::Logger;
use rust_website::routes;
use rust_website::buttplug;
use env_logger::Env;
use dotenv::dotenv;
use tokio::task;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    // Spawn the `initialize_device` function in the background
    task::spawn(async {
        if let Err(e) = buttplug::initialize_device().await {
            eprintln!("Error running initialize_device: {}", e);
        }
    });

    println!("Starting HTTP server...");
    HttpServer::new(|| {
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
    .bind("192.168.178.8:5441")?
    .run()
    .await
}