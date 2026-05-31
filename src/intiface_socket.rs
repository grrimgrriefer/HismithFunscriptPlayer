// src/intiface_socket.rs

//! WebSocket handler for device control via the Buttplug protocol.
//!
//! Receives JSON messages from browser clients and forwards normalized intensity
//! values to the Buttplug device manager. Expected JSON payload:
//! { "o": <f64>, "v": <f64> } where `o` (oscillate) and `v` (vibrate) are optional.
//! Values are interpreted in the 0.0..1.0 range and are clamped before being
//! passed to device_manager::set_oscillate and device_manager::set_vibrate.
//! Non-JSON or binary messages result in a structured JSON error reply. Implemented
//! as an Actix WebSocket actor.

use crate::buttplug::device_manager;
use actix::prelude::*;
use actix_web::{Error, HttpRequest, HttpResponse, web};
use actix_web_actors::ws;
use log::{debug, error, info};
use serde::Deserialize;

#[derive(Default)]
pub struct DeviceControlWs;

#[derive(Deserialize)]
struct ControlCommand {
    o: Option<f64>,
    v: Option<f64>,
}

impl Actor for DeviceControlWs {
    type Context = ws::WebsocketContext<Self>;

    fn started(&mut self, _ctx: &mut Self::Context) {
        info!("WebSocket connection established");
    }

    fn stopped(&mut self, _ctx: &mut Self::Context) {
        info!("WebSocket connection closed");
    }
}

impl StreamHandler<Result<ws::Message, ws::ProtocolError>> for DeviceControlWs {
    fn handle(&mut self, msg: Result<ws::Message, ws::ProtocolError>, ctx: &mut Self::Context) {
        match msg {
            Ok(ws::Message::Text(text)) => match serde_json::from_str::<ControlCommand>(&text) {
                Ok(cmd) => {
                    if let Some(o) = cmd.o {
                        let clamped = o.max(0.0).min(1.0);
                        device_manager::set_oscillate(clamped);
                    }
                    if let Some(v) = cmd.v {
                        let clamped = v.max(0.0).min(1.0);
                        device_manager::set_vibrate(clamped);
                    }
                }
                Err(e) => {
                    error!("Invalid JSON command: {}", e);
                    ctx.text(
                        serde_json::json!({ "error": format!("invalid JSON: {}", e) }).to_string(),
                    );
                }
            },

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
                ctx.text(
                    serde_json::json!({ "error": "binary messages not supported" }).to_string(),
                );
            }

            Err(e) => {
                error!("WebSocket protocol error: {}", e);
                ctx.stop();
            }

            _ => {}
        }
    }
}

pub async fn handle_ws_start(
    req: HttpRequest,
    stream: web::Payload,
) -> Result<HttpResponse, Error> {
    let addr = req
        .peer_addr()
        .map(|addr| addr.to_string())
        .unwrap_or_else(|| String::from("unknown"));
    info!("WebSocket connection attempt from {}", addr);

    match ws::start(DeviceControlWs::default(), &req, stream) {
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
