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

export function autoScaleToFit() {
    const card = document.querySelector('.mobile-cal-card');
    if (!card) return;

    card.style.transform = 'none';

    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const cardH = card.scrollHeight;
    const cardW = card.scrollWidth;

    const margin = 10;
    const scaleY = (vh - margin) / cardH;
    const scaleX = (vw - margin) / cardW;
    const scale = Math.min(1.0, scaleY, scaleX);

    if (scale < 0.99) {
        card.style.transform = `scale(${scale.toFixed(4)})`;
    } else {
        card.style.transform = 'none';
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
    window.addEventListener('resize', () => {
        autoScaleToFit();
        refreshDisplays();
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            autoScaleToFit();
            refreshDisplays();
        }, 120);
    });

    const curveDrawer = document.getElementById('curve-details');
    if (curveDrawer) {
        curveDrawer.addEventListener('toggle', () => {
            if (curveDrawer.open) {
                refreshDisplays();
            }
            autoScaleToFit();
        });
    }

    // Initialize calibration components and profiles
    await setupCalibration();

    autoScaleToFit();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initMobileCalibration);
} else {
    initMobileCalibration();
}
