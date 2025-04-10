use actix::{Actor, StreamHandler};
use actix_web_actors::ws;
use actix_web::{web, HttpRequest, HttpResponse, Error};
use actix::ActorContext;
use crate::buttplug::device_manager;

pub struct OscillateSocket;

impl Actor for OscillateSocket {
    type Context = ws::WebsocketContext<Self>;
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for OscillateSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Text(text)) => {
                if let Ok(value) = text.parse::<f64>() {
                    // Clamp value between 0.0 and 1.0
                    let clamped = value.max(0.0).min(1.0);
                    
                    // Spawn oscillate command in background
                    let fut = device_manager::oscillate(clamped);
                    actix::spawn(async move {
                        if let Err(e) = fut.await {
                            println!("Error oscillating: {}", e);
                        }
                    });
                }
            }
            Ok(ws::Message::Ping(msg)) => ctx.pong(&msg),
            Ok(ws::Message::Close(reason)) => {
                ctx.close(reason);
                ctx.stop();
            }
            _ => {}
        }
    }
}

pub async fn handle_ws_start(req: HttpRequest, stream: web::Payload) -> Result<HttpResponse, Error> {
    println!("WebSocket connection attempt");
    match ws::start(OscillateSocket, &req, stream) {
        Ok(response) => {
            println!("WebSocket connection established");
            Ok(response)
        }
        Err(e) => {
            eprintln!("WebSocket error: {}", e);
            Err(e)
        }
    }
}