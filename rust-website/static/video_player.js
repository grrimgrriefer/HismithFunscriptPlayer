// static/video_player.js

import { loadFunscript, getCurrentIntensity, getAbsoluteMaximum, getCurrentVideoMaxIntensity, setIntensityMultiplier, getCurrentVideoRawMaxIntensity, getCurrentVideoRawAverageIntensity, getVibrateMode, getCurrentBeatValue, funscriptActions } from './funscript_handler.js?v=242';
import { createFunscriptDisplayBox, updateFunscriptDisplayBox } from './funscript_sliders.js?v=242';
import { sendDeviceCommand } from './socket.js?v=242';

let currentAnimationFrame = null;
let cancelAnimationTimeout = null;

export async function playVideo(videoUrl, funscriptUrl) {
    if (currentAnimationFrame) {
        cancelAnimationFrame(currentAnimationFrame);
        currentAnimationFrame = null;
    }
    sendDeviceCommand(0, 0);

    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.playsInline = true;
    videoElement.autoplay = false;

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

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000;
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentTime);

        const elapsed = Date.now() - transitionStartTime;
        const progress = Math.abs(transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1));

        let oscillateValue = 0;
        if (intensity !== undefined) {
            oscillateValue = lerpIntensity(0, intensity, progress) / 100, 150;
        }

        let vibrateValue = 0;
        if (getVibrateMode() === 'Rate') {
            // Default: rate-based            
            if (intensity !== undefined) {
                vibrateValue = lerpIntensity(0, intensity, progress) / 100;
            }
        } else {
            const beatValue = getCurrentBeatValue(currentTime);
            if (beatValue !== undefined) {
                vibrateValue = lerpIntensity(0, beatValue, progress), 150;
            }
        }

        sendDeviceCommand(oscillateValue, vibrateValue);

        currentAnimationFrame = requestAnimationFrame(updateProgressBars);
    }

    // Create or update the settings menu
    // UI components are now created globally by main.js
    let transitionStartTime = Date.now();
    let transitionTargetValue = 1;
    const TRANSITION_DURATION = 1000;

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

    // Start loading funscript, but don't await it here.
    const funscriptPromise = loadFunscript(funscriptUrl);

    // Create or update the funscript display box while things are loading
    createFunscriptDisplayBox();

    videoElement.onloadeddata = async () => {
        // Now, wait for the funscript to finish loading.
        await funscriptPromise;

        // Now that both video and funscript data are ready, we can initialize things that depend on them.
        setIntensityMultiplier(1.0);
        if ((getAbsoluteMaximum() * 1.2) < getCurrentVideoMaxIntensity()) {
            setIntensityMultiplier(1.2 * getAbsoluteMaximum() / getCurrentVideoMaxIntensity());
        }

        updateFunscriptDisplayBox(0);
        updateProgressBars();

        // Hide the spinner only when all data is loaded and UI is ready.
        spinner.style.display = 'none';
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');

    // Show player-specific buttons
    document.getElementById('settings-button').style.display = 'block';
}

function lerpIntensity(start, end, progress) {
    return start + (end - start) * progress;
}