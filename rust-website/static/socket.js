import { getAbsoluteMaximum } from './funscript_handler.js?v=20';

let ws = null;

export function initWebSocket() {
    // Check if websocket already exists and is connected/connecting
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
        console.error('WebSocket connection already exists');
        return Promise.reject(new Error('WebSocket connection already exists'));
    }

    try {
        console.log('Attempting WebSocket connection...');
        ws = new WebSocket(`ws://192.168.178.8:5441/ws`);

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
        ws.send(Math.max(0, Math.min(value, (getAbsoluteMaximum() / 100))).toString());
    }
}