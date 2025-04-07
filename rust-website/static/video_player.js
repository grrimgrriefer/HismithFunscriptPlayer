import { loadFunscript, getCurrentFunscriptAction, getCurrentIntensity } from './funscript_handler.js';
import { createSettingsMenu, toggleSettingsMenu } from './settings_menu.js';
import { createFunscriptDisplayBox, updateFunscriptDisplayBox } from './funscript_sliders.js';
import { initWebSocket, sendOscillateValue } from './socket.js';

export function playVideo(videoUrl, funscriptUrl) {
    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.style.width = '100%';

    videoPlayer.innerHTML = ''; // Clear any existing video
    videoPlayer.appendChild(videoElement);

    // Function to reload the funscript and regenerate values
    const reloadFunscript = () => {
        loadFunscript(funscriptUrl);
    };

    // Load the funscript initially
    reloadFunscript();

    // Create or update the funscript display box
    createFunscriptDisplayBox();

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000; // Convert to milliseconds
        const currentAction = getCurrentFunscriptAction(currentTime);
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentAction, intensity);
        if (intensity !== undefined) {
            sendOscillateValue(intensity / 100);
        }
        requestAnimationFrame(updateProgressBars); // Schedule the next update
    }

    // Create or update the settings menu
    createSettingsMenu(reloadFunscript);

    initWebSocket();

    // Add a button to toggle the settings menu
    let settingsButton = document.getElementById('settings-button');
    if (!settingsButton) {
        settingsButton = document.createElement('button');
        settingsButton.id = 'settings-button';
        settingsButton.textContent = 'Settings';
        settingsButton.style.position = 'absolute';
        settingsButton.style.top = '10px';
        settingsButton.style.right = '10px';
        settingsButton.style.backgroundColor = 'rgb(70, 70, 70)';
        settingsButton.style.color = 'white';
        settingsButton.style.border = 'none';
        settingsButton.style.padding = '10px 20px';
        settingsButton.style.cursor = 'pointer';
        settingsButton.style.borderRadius = '5px';
        settingsButton.style.zIndex = '10';
        settingsButton.onclick = toggleSettingsMenu;

        document.body.appendChild(settingsButton);
    }

    videoElement.onplay = () => {
        requestAnimationFrame(updateProgressBars); // Start updating when the video plays
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
}