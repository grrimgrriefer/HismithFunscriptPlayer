let ws = null;

export function initWebSocket() {
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
            // Try to reconnect after 1 second
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
        ws.send(value.toString());
    }
}