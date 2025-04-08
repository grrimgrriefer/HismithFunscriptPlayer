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

    let isTransitioning = false;
    let transitionStartTime = 0;
    let transitionTargetValue = 0;
    const TRANSITION_DURATION = 1000; // 1 second in milliseconds

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000;
        const currentAction = getCurrentFunscriptAction(currentTime);
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentAction, intensity);

        let finalIntensity = intensity;
        if (isTransitioning) {
            const elapsed = Date.now() - transitionStartTime;
            const progress = Math.min(elapsed / TRANSITION_DURATION, 1);
            finalIntensity = lerpIntensity(transitionStartValue, transitionTargetValue, progress);
            if (progress === 1) {
                isTransitioning = false;
            }
        }
        if (finalIntensity !== undefined) {
            throttledSendOscillateValue(finalIntensity / 100);
        }

        requestAnimationFrame(updateProgressBars); // Schedule the next update
    }

    // Create or update the settings menu
    createSettingsMenu(reloadFunscript);

    const throttledSendOscillateValue = throttle(sendOscillateValue, 150);
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
        isTransitioning = true;
        transitionStartTime = Date.now();
        transitionTargetValue = 1;
        requestAnimationFrame(updateProgressBars); // Start updating when the video plays
    };

    videoElement.onpause = () => {
        isTransitioning = true;
        transitionStartTime = Date.now();
        transitionTargetValue = 0;
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
}

function throttle(func, limit) {
    let inThrottle;
    return function (...args) {
        if (!inThrottle) {
            func.apply(this, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

function lerpIntensity(start, end, progress) {
    return start + (end - start) * progress;
}