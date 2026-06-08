// static/main.js

import { initDirectoryTree } from './directory_tree.js';
import { initWebSocket } from './socket.js';
import { createSettingsMenu, toggleSettingsMenu } from './settings_menu.js';
import { setPlaybackData } from './video_player.js';

function initializeUI() {
    createSettingsMenu();

    const settingsBtn = document.getElementById('settings-button');
    settingsBtn.onclick = toggleSettingsMenu;
    settingsBtn.style.right = '10px';
    settingsBtn.style.display = 'block';
    settingsBtn.classList.add('player-button', 'btn');

    document.getElementById('toggle-directory').onclick = () => {
        document
            .getElementById('directory-container')
            .classList.toggle('hidden');
    };
}

function renderCacheError(payload, treeContainer) {
    if (payload?.funscript_cache_error) {
        const container = document.getElementById('directory-container');
        if (!container) return;

        let errEl = document.getElementById('funscript-cache-error');
        if (!errEl) {
            errEl = document.createElement('div');
            errEl.id = 'funscript-cache-error';
            container.insertBefore(errEl, treeContainer);
        }
        errEl.textContent = payload.funscript_cache_error;
    } else {
        document.getElementById('funscript-cache-error')?.remove();
    }
}

async function main() {
    initializeUI();
    initWebSocket();

    const treeContainer = document.getElementById('directory-tree');

    try {
        const response = await fetch('/api/directory-tree');
        if (!response.ok) {
            throw new Error(
                `Failed to fetch directory tree: ${response.statusText}`
            );
        }

        const payload = await response.json();
        const treeData = payload.tree || payload;
        const funscriptMap = payload.funscripts || {};

        setPlaybackData(treeData, funscriptMap);
        renderCacheError(payload, treeContainer);
        initDirectoryTree(treeData, treeContainer, funscriptMap);
    } catch (error) {
        console.error(error);
        treeContainer.innerHTML =
            '<p style="color: red; padding: 10px;">Error loading directory.</p>';
    }
}

document.addEventListener('DOMContentLoaded', main);
