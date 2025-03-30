use actix_web::{App, HttpServer};
use rust_website::routes;
use env_logger::Env;
use dotenv::dotenv;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenv().ok();
    env_logger::init_from_env(Env::default().default_filter_or("info"));
    HttpServer::new(|| {
        App::new()
            .configure(routes::setup_routes)
    })
    .bind("127.0.0.1:5441")?
    .bind("192.168.178.8:5441")?
    .run()
    .await
}