// src/intiface_socket.rs

//! WebSocket handler for device control via the Buttplug protocol.









use crate::buttplug::device_manager;

use actix_web::{Error, HttpRequest, HttpResponse, web};
use actix_ws::Message;
use futures::StreamExt;
use log::{debug, error, info};
use serde::Deserialize;




#[derive(Deserialize)]
struct ControlCommand {
    o: Option<f64>,
    v: Option<f64>,
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

    let (response, mut session, mut msg_stream) = actix_ws::handle(&req, stream)?;
    info!("WebSocket connection established with {}", addr);

    actix_web::rt::spawn(async move {
        while let Some(Ok(msg)) = msg_stream.next().await {
            match msg {
                Message::Text(text) => match serde_json::from_str::<ControlCommand>(&text) {
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
                        let _ = session
                            .text(
                                serde_json::json!({ "error": format!("invalid JSON: {}", e) })
                                    .to_string(),
                            )
                            .await;
                    }
                },
                Message::Ping(bytes) => {
                    debug!("Received ping");
                    if session.pong(&bytes).await.is_err() {
                        break;
                    }
                }
                Message::Close(reason) => {
                    info!("Received close message: {:?}", reason);
                    let _ = session.close(reason).await;
                    break;
                }
                Message::Binary(bin) => {
                    error!("Unexpected binary message of {} bytes", bin.len());
                    let _ = session
                        .text(
                            serde_json::json!({ "error": "binary messages not supported" })
                                .to_string(),
                        )
                        .await;
                }
                _ => {}
            }
        }
        info!("WebSocket connection closed for {}", addr);
    });

    Ok(response)
}
