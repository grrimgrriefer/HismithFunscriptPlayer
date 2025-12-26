// src/intiface_socket.rs

//! WebSocket handler for device control via the Buttplug protocol.
//! 
//! This module implements a WebSocket connection that receives intensity values
//! from the web client and forwards them to the connected device through the
//! Buttplug protocol.

use log::{info, error, debug};
use actix::{
    Actor, 
    StreamHandler,
    ActorContext
};
use actix_web::{
    web, 
    HttpRequest, 
    HttpResponse, 
    Error
};
use actix_web_actors::ws;
use crate::buttplug::device_manager;

/// WebSocket actor that handles device control messages.
/// 
/// Receives floating point values between 0.0 and 1.0 representing
/// device intensity and forwards them to the device manager.
#[derive(Default)]
pub struct OscillateSocket {
    // We could add fields here to track connection state if needed
}

impl Actor for OscillateSocket {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, _ctx: &mut Self::Context) {
        info!("WebSocket connection established");
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        info!("WebSocket connection closed");
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for OscillateSocket {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Text(text)) => {
                if let Ok(cmd) = serde_json::from_str::<serde_json::Value>(&text) {
                    let o = cmd.get("o").and_then(|v| v.as_f64());
                    let v = cmd.get("v").and_then(|v| v.as_f64());
                    if let Some(osc) = o {
                        let clamped = osc.max(0.0).min(1.0);
                        let command = device_manager::oscillate(clamped);
                        actix::spawn(async move {
                            if let Err(e) = command.await {
                                error!("Error sending oscillate command: {}", e);
                            }
                        });
                    }
                    if let Some(vib) = v {
                        let clamped = vib.max(0.0).min(1.0);
                        let command = device_manager::vibrate(clamped);
                        actix::spawn(async move {
                            if let Err(e) = command.await {
                                error!("Error sending vibrate command: {}", e);
                            }
                        });
                    }
                    return;
                } else {
                    error!("Unknown command received: {}", text);
                    ctx.text("Unknown command. Use 'v:<value>' for vibrate or 'o:<value>' for oscillate.");
                }

            }
            Ok(ws::Message::Ping(msg)) => {
                debug!("Received ping");
                ctx.pong(&msg);
            }
            Ok(ws::Message::Close(reason)) => {
                info!("Received close message: {:?}", reason);
                ctx.close(reason);
                ctx.stop();
            }
            Ok(ws::Message::Binary(bin)) => {
                error!("Unexpected binary message of {} bytes", bin.len());
                // Binary messages aren't expected/supported
                ctx.text("Binary messages not supported");
            }
            Err(e) => {
                error!("WebSocket protocol error: {}", e);
                ctx.stop();
            }
            _ => {} // Ignore other message types
        }
    }
}

/// Initializes a new WebSocket connection for device control.
/// 
/// # Arguments
/// * `req` - The HTTP request initiating the WebSocket connection
/// * `stream` - The WebSocket payload stream
/// 
/// # Returns
/// * `Ok(HttpResponse)` - WebSocket connection established successfully
/// * `Err(Error)` - Failed to establish WebSocket connection
pub async fn handle_ws_start(req: HttpRequest, stream: web::Payload) -> Result<HttpResponse, Error> {
    let addr = req.peer_addr()
        .map(|addr| addr.to_string())
        .unwrap_or_else(|| String::from("unknown"));    
    info!("WebSocket connection attempt from {}", addr);
        
    match ws::start(OscillateSocket::default(), &req, stream) {
        Ok(response) => {
            info!("WebSocket handshake successful");
            Ok(response)
        }
        Err(e) => {
            error!("WebSocket handshake failed: {}", e);
            Err(e)
        }
    }
}