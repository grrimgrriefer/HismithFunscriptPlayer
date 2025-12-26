// static/main.js

import { initDirectoryTree } from './directory_tree.js?v=242';
import { initWebSocket } from './socket.js?v=242';
import { createSettingsMenu, toggleSettingsMenu } from './settings_menu.js?v=242';

function createPlayerButton(id, text, rightPos, onClick) {
    let button = document.createElement('button');
    button.id = id;
    button.textContent = text;
    button.style.position = 'absolute';
    button.style.top = '10px';
    button.style.right = rightPos;
    button.style.backgroundColor = 'rgb(70, 70, 70)';
    button.style.color = 'white';
    button.style.border = 'none';
    button.style.padding = '10px 20px';
    button.style.cursor = 'pointer';
    button.style.borderRadius = '5px';
    button.style.zIndex = '10';
    button.style.display = 'none'; // Buttons are hidden until a video plays
    button.onclick = onClick;
    document.body.appendChild(button);
}

function initializeUI() {
    // Create UI components that are globally available but may be hidden initially
    createSettingsMenu();
    createPlayerButton('settings-button', 'Settings', '10px', toggleSettingsMenu);

    // Event listener for the sidebar toggle
    document.getElementById('toggle-directory').onclick = () => {
        document.getElementById('directory-container').classList.toggle('hidden');
    };
}

async function main() {
    // Initialize core components
    initializeUI();
    initWebSocket();

    // Fetch directory tree and render it
    try {
        const response = await fetch('/api/directory-tree');
        if (!response.ok) {
            throw new Error(`Failed to fetch directory tree: ${response.statusText}`);
        }
        const directoryTreeData = await response.json();
        const directoryTreeContainer = document.getElementById('directory-tree');
        initDirectoryTree(directoryTreeData, directoryTreeContainer);
    } catch (error) {
        console.error(error);
        document.getElementById('directory-tree').innerHTML = `<p style="color: red; padding: 10px;">Error loading directory.</p>`;
    }
}

// Run the main application logic when the DOM is ready
document.addEventListener('DOMContentLoaded', main);