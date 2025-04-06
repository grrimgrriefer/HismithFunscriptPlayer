use actix_web::{App, HttpServer};
use rust_website::routes;
use rust_website::buttplug;
use env_logger::Env;
use dotenv::dotenv;
use tokio::task;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init_from_env(Env::default().default_filter_or("info"));

    // Spawn the `do_the_thing` function in the background
    task::spawn(async {
        if let Err(e) = buttplug::do_the_thing().await {
            eprintln!("Error running do_the_thing: {}", e);
        }
    });

    HttpServer::new(|| {
        App::new()
            .configure(routes::setup_routes)
    })
    .bind("127.0.0.1:5441")?
    .bind("192.168.178.8:5441")?
    .run()
    .await
}