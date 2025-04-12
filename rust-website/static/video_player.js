import { loadFunscript, getCurrentIntensity, getAbsoluteMaximum, getCurrentRawMaxIntensity, setIntensityMultiplier } from './funscript_handler.js?v=29';
import { createSettingsMenu, toggleSettingsMenu } from './settings_menu.js?v=29';
import { createFunscriptDisplayBox, updateFunscriptDisplayBox } from './funscript_sliders.js?v=29';
import { initWebSocket, sendOscillateValue } from './socket.js?v=29';

let currentAnimationFrame = null;
let isInitialized = false;
let cancelAnimationTimeout = null;

export async function playVideo(videoUrl, funscriptUrl) {
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

    // Add a spinner element
    let spinner = document.getElementById('loading-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loading-spinner';
        spinner.style.position = 'absolute';
        spinner.style.top = '50%';
        spinner.style.left = '50%';
        spinner.style.transform = 'translate(-50%, -50%)';
        spinner.style.border = '8px solid #f3f3f3';
        spinner.style.borderTop = '8px solid #3498db';
        spinner.style.borderRadius = '50%';
        spinner.style.width = '50px';
        spinner.style.height = '50px';
        spinner.style.animation = 'spin 1s linear infinite';
        spinner.style.zIndex = '20';
        videoPlayer.appendChild(spinner);
    }
    spinner.style.display = 'block'; // Show spinner

    await loadFunscript(funscriptUrl);

    // Create or update the funscript display box
    createFunscriptDisplayBox();

    let transitionStartTime = Date.now();
    let transitionTargetValue = 1;
    const TRANSITION_DURATION = 1000;

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000;
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentTime);

        const elapsed = Date.now() - transitionStartTime;
        const progress = Math.abs(transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1));

        if (intensity !== undefined) {
            throttledSendOscillateValue(lerpIntensity(0, intensity, progress) / 100);
        }

        currentAnimationFrame = requestAnimationFrame(updateProgressBars);
    }

    // Create or update the settings menu
    createSettingsMenu();

    setIntensityMultiplier(1.0);
    if ((getAbsoluteMaximum() * 1.2) < getCurrentRawMaxIntensity()) {
        setIntensityMultiplier(1.2 * getAbsoluteMaximum() / getCurrentRawMaxIntensity());
    }

    const throttledSendOscillateValue = throttle(sendOscillateValue, 150);
    if (!isInitialized) {
        initWebSocket();
        isInitialized = true;
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

        try {
            document.documentElement.requestFullscreen();
        }
        catch (e) {
            console.error('Error requesting fullscreen:', e);
        }
    };

    videoElement.onpause = () => {
        cancelAnimationTimeout = setTimeout(() => {
            if (currentAnimationFrame) {
                cancelAnimationFrame(currentAnimationFrame);
                currentAnimationFrame = null;
            }
        }, 1100);
        transitionStartTime = Date.now();
        transitionTargetValue = 1;
        try {
            document.exitFullscreen();
        }
        catch (e) {
            console.error('Error exiting fullscreen:', e);
        }
    };

    videoElement.onloadeddata = () => {
        updateFunscriptDisplayBox(0);
        updateProgressBars();
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');

    spinner.style.display = 'none';
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