// static/video_player.js

import {
    loadFunscript,
    getCurrentIntensity,
    getCurrentVideoMaxIntensity,
    getVibrateMode,
    getCurrentBeatValue,
    setSelectedFunscriptVariant
} from './funscript_handler.js';
import {
    createFunscriptDisplayBox,
    updateFunscriptDisplayBox
} from './funscript_display_graphs.js';
import { sendDeviceCommand } from './socket.js';
import { getCalibrationMultiplier } from './calibration.js';
import { refreshVariantsForCurrentVideo } from './settings_menu.js';

const urlParams = new URLSearchParams(window.location.search);
const DISABLE_FULLSCREEN = ['1', 'true', 'yes'].includes(
    (urlParams.get('no_fullscreen') || '').toLowerCase()
);

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

    // Loading spinner while video is loading
    let spinner = document.getElementById('loading-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loading-spinner';
        spinner.className = 'loading-spinner';
        videoPlayer.appendChild(spinner);
    }
    spinner.style.display = 'block'; // Show spinner

    // Update the funscript graphs for the next repaint of the page (i.e. the next frame frame)
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000;
        const intensity = getCurrentIntensity(currentTime);
        updateFunscriptDisplayBox(currentTime);

        const elapsed = Date.now() - transitionStartTime;
        const progress = Math.abs(
            transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1)
        );

        let oscillateValue = 0;
        if (intensity !== undefined) {
            ((oscillateValue =
                lerpIntensity(
                    0,
                    intensity * getCalibrationMultiplier(intensity),
                    progress
                ) / 100),
                150);
        }

        let vibrateValue = 0;
        if (getVibrateMode() === 'Rate') {
            if (intensity !== undefined) {
                vibrateValue =
                    lerpIntensity(
                        0,
                        (intensity / 100) * getCurrentVideoMaxIntensity(),
                        progress
                    ) / 100;
            }
        } else {
            const beatValue = getCurrentBeatValue(currentTime);
            if (beatValue !== undefined) {
                ((vibrateValue = lerpIntensity(0, beatValue, progress)), 150);
            }
        }

        sendDeviceCommand(oscillateValue, vibrateValue);

        // schedule update for the next repaint (so it keeps updating every frame)
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

        if (!DISABLE_FULLSCREEN) {
            try {
                document.documentElement.requestFullscreen();
            } catch (e) {
                console.error('Error requesting fullscreen:', e);
            }
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

        if (!DISABLE_FULLSCREEN) {
            try {
                if (document.fullscreenElement) {
                    document.exitFullscreen();
                }
            } catch (e) {
                console.error('Error exiting fullscreen:', e);
            }
        }
    };

    // Force default variant to 'original' for each new video and sync the dropdown UI
    setSelectedFunscriptVariant('original');
    const sel = document.getElementById('funscript-variant-select');
    if (sel) sel.value = 'original';

    // Start loading funscript, but don't await it here.
    const funscriptPromise = loadFunscript(funscriptUrl);

    // Create or update the funscript display box while things are loading
    createFunscriptDisplayBox();

    videoElement.onloadeddata = async () => {
        // Now, wait for the funscript to finish loading.
        await funscriptPromise;

        updateFunscriptDisplayBox(0);
        updateProgressBars();
        refreshVariantsForCurrentVideo();

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
