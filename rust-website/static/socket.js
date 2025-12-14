// static/socket.js

import { getAbsoluteMaximum, getVibrateMode } from './funscript_handler.js?v=230';

let ws = null;

export function initWebSocket() {
    // Check if websocket already exists and is connected/connecting
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.error('WebSocket connection already exists');
        return Promise.reject(new Error('WebSocket connection already exists'));
    }

    try {
        console.log('Attempting WebSocket connection...');
        ws = new WebSocket(`ws://${window.location.hostname}:5441/ws`);

        ws.onopen = () => {
            console.log('WebSocket connected successfully');
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            console.log('WebSocket readyState:', ws.readyState);
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed with code:', event.code);
            console.log('WebSocket close reason:', event.reason);
            setTimeout(initWebSocket, 1000);
        };

        ws.onmessage = (event) => {
            console.log('WebSocket message received:', event.data);
        };
    } catch (e) {
        console.error('WebSocket initialization error:', e);
    }
}

export function sendOscillateValue(value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send('o:' + Math.max(0, Math.min(value, (getAbsoluteMaximum() / 100))).toString());
    }
}

export function sendVibrateValue(value) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        if (getVibrateMode() === 'Rate') {
            value = value < 0.03 ? 0.0 : (value - 0.03) * 1.5;
        }
        ws.send('v:' + Math.max(0, Math.min(value, 1.0)).toString());
    }
}