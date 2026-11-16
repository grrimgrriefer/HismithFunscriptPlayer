// static/calibration_mobile.js

import { initWebSocket, isWebSocketConnected } from './socket.js';
import {
    setupCalibration,
    refreshDisplays,
    stopCalibration
} from './calibration.js';

function updateWsBadge(status) {
    const badge = document.getElementById('ws-status-badge');
    if (!badge) return;

    if (status === 'connected') {
        badge.textContent = 'WS Online';
        badge.className = 'mobile-ws-badge connected';
    } else if (status === 'connecting') {
        badge.textContent = 'Connecting...';
        badge.className = 'mobile-ws-badge';
    } else {
        badge.textContent = 'WS Offline';
        badge.className = 'mobile-ws-badge disconnected';
    }
}

async function initMobileCalibration() {
    updateWsBadge('connecting');

    try {
        initWebSocket();
    } catch (e) {
        console.warn('WebSocket init error:', e);
    }

    if (isWebSocketConnected?.()) {
        updateWsBadge('connected');
    }

    window.addEventListener('ws-status', (e) => {
        updateWsBadge(e.detail?.status || 'disconnected');
    });

    // Safety: stop hardware if the user closes the tab or switches apps
    window.addEventListener('beforeunload', () => stopCalibration());
    window.addEventListener('pagehide', () => stopCalibration());

    // Redraw graph crispness on orientation change or window resize
    window.addEventListener('resize', () => refreshDisplays());
    window.addEventListener('orientationchange', () => {
        setTimeout(refreshDisplays, 120);
    });

    // Initialize calibration components and profiles
    await setupCalibration();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileCalibration);
} else {
    initMobileCalibration();
}
