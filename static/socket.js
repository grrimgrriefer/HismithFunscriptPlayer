// static/socket.js

import { getAbsoluteMaximum, getVibrateMode } from './funscript_handler.js';

const WS_PORT = 5441;
const RECONNECT_DELAY_MS = 1000;
const VIBRATE_DEADZONE = 0.03;
const VIBRATE_SCALE = 1.5;

let ws = null;

export function initWebSocket() {
    if (
        ws &&
        (ws.readyState === WebSocket.OPEN ||
            ws.readyState === WebSocket.CONNECTING)
    ) {
        console.error('WebSocket connection already exists');
        return Promise.reject(new Error('WebSocket connection already exists'));
    }

    try {
        ws = new WebSocket(`ws://${window.location.hostname}:${WS_PORT}/ws`);
        ws.onopen = () => console.log('WebSocket connected');
        ws.onerror = (error) => console.error('WebSocket error:', error);
        ws.onclose = (event) => {
            console.log(`WebSocket closed: ${event.code} ${event.reason}`);
            setTimeout(initWebSocket, RECONNECT_DELAY_MS);
        };
        ws.onmessage = (event) => console.log('WebSocket message:', event.data);
    } catch (e) {
        console.error('WebSocket initialization error:', e);
    }
}

export function sendDeviceCommand(oscillate, vibrate) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;

    const maxOscillate = getAbsoluteMaximum() / 100;
    let vibrateValue = vibrate;

    if (getVibrateMode() === 'Rate') {
        vibrateValue =
            vibrateValue < VIBRATE_DEADZONE
                ? 0.0
                : (vibrateValue - VIBRATE_DEADZONE) * VIBRATE_SCALE;
    }

    ws.send(
        JSON.stringify({
            o: Math.max(0, Math.min(oscillate, maxOscillate)),
            v: Math.max(0, Math.min(vibrateValue, 1.0))
        })
    );
}
