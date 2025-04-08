import { loadFunscript, getCurrentFunscriptAction, getCurrentIntensity } from './funscript_handler.js?v=31';
import { createSettingsMenu, toggleSettingsMenu } from './settings_menu.js?v=31';
import { createFunscriptDisplayBox, updateFunscriptDisplayBox } from './funscript_sliders.js?v=31';
import { initWebSocket, sendOscillateValue } from './socket.js?v=31';

let currentAnimationFrame = null;
let isWebSocketInitialized = false;

export function playVideo(videoUrl, funscriptUrl) {
    if (currentAnimationFrame) {
        cancelAnimationFrame(currentAnimationFrame);
        currentAnimationFrame = null;
    }
    sendOscillateValue(0);

    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = false;
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

    let transitionStartTime = Date.now();
    let transitionTargetValue = 1;
    const TRANSITION_DURATION = 1000;

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000;
        const currentAction = getCurrentFunscriptAction(currentTime);
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentAction, intensity);

        const elapsed = Date.now() - transitionStartTime;
        const progress = Math.abs(transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1));

        if (intensity !== undefined) {
            throttledSendOscillateValue(lerpIntensity(0, intensity, progress) / 100);
        }

        currentAnimationFrame = requestAnimationFrame(updateProgressBars);
    }

    // Create or update the settings menu
    createSettingsMenu(reloadFunscript);

    const throttledSendOscillateValue = throttle(sendOscillateValue, 150);
    if (!isWebSocketInitialized) {
        initWebSocket();
        isWebSocketInitialized = true;
    }

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
        if (cancelAnimationTimeout) {
            clearTimeout(cancelAnimationTimeout);
            cancelAnimationTimeout = null;
        }
        if (currentAnimationFrame) {
            cancelAnimationFrame(currentAnimationFrame);
        }
        transitionStartTime = Date.now();
        transitionTargetValue = 0;
        currentAnimationFrame = requestAnimationFrame(updateProgressBars);
        document.documentElement.requestFullscreen();
    };

    videoElement.onpause = () => {
        cancelAnimationTimeout = setTimeout(() => {
            if (currentAnimationFrame) {
                cancelAnimationFrame(currentAnimationFrame);
                currentAnimationFrame = null;
            }
        }, 1000);
        transitionStartTime = Date.now();
        transitionTargetValue = 1;
        document.exitFullscreen();
    };

    videoElement.onloadeddata = () => {
        updateFunscriptDisplayBox(0, 0);
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