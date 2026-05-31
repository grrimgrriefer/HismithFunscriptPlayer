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
const TRANSITION_DURATION = 1000;

let currentAnimationFrame = null;
let cancelAnimationTimeout = null;
let transitionStartTime = Date.now();
let transitionTargetValue = 1;

function lerp(start, end, progress) {
    return start + (end - start) * progress;
}

function computeOscillateValue(intensity, progress) {
    if (intensity === undefined) return 0;
    return (
        lerp(0, intensity * getCalibrationMultiplier(intensity), progress) / 100
    );
}

function computeVibrateValue(currentTime, intensity, progress) {
    if (getVibrateMode() === 'Rate') {
        if (intensity === undefined) return 0;
        return (
            lerp(
                0,
                (intensity / 100) * getCurrentVideoMaxIntensity(),
                progress
            ) / 100
        );
    }
    const beatValue = getCurrentBeatValue(currentTime);
    return beatValue !== undefined ? lerp(0, beatValue, progress) : 0;
}

function updateProgressBars(videoElement) {
    const currentTime = videoElement.currentTime * 1000;
    const intensity = getCurrentIntensity(currentTime);
    updateFunscriptDisplayBox(currentTime);

    const elapsed = Date.now() - transitionStartTime;
    const progress = Math.abs(
        transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1)
    );

    sendDeviceCommand(
        computeOscillateValue(intensity, progress),
        computeVibrateValue(currentTime, intensity, progress)
    );

    currentAnimationFrame = requestAnimationFrame(() =>
        updateProgressBars(videoElement)
    );
}

function enterFullscreen() {
    if (DISABLE_FULLSCREEN) return;
    try {
        document.documentElement.requestFullscreen();
    } catch (e) {
        console.error('Error requesting fullscreen:', e);
    }
}

function exitFullscreen() {
    if (DISABLE_FULLSCREEN || !document.fullscreenElement) return;
    try {
        document.exitFullscreen();
    } catch (e) {
        console.error('Error exiting fullscreen:', e);
    }
}

function cancelCurrentAnimation() {
    if (currentAnimationFrame) {
        cancelAnimationFrame(currentAnimationFrame);
        currentAnimationFrame = null;
    }
}

export async function playVideo(videoUrl, funscriptUrl) {
    cancelCurrentAnimation();
    sendDeviceCommand(0, 0);

    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.playsInline = true;
    videoElement.autoplay = false;

    videoPlayer.innerHTML = '';
    videoPlayer.appendChild(videoElement);

    // Loading spinner
    let spinner = document.getElementById('loading-spinner');
    if (!spinner) {
        spinner = document.createElement('div');
        spinner.id = 'loading-spinner';
        spinner.className = 'loading-spinner';
        videoPlayer.appendChild(spinner);
    }
    spinner.style.display = 'block';

    videoElement.onplay = () => {
        if (cancelAnimationTimeout) {
            clearTimeout(cancelAnimationTimeout);
            cancelAnimationTimeout = null;
        }
        cancelCurrentAnimation();
        transitionStartTime = Date.now();
        transitionTargetValue = 0;
        currentAnimationFrame = requestAnimationFrame(() =>
            updateProgressBars(videoElement)
        );
        enterFullscreen();
    };

    videoElement.onpause = () => {
        cancelAnimationTimeout = setTimeout(
            cancelCurrentAnimation,
            TRANSITION_DURATION + 100
        );
        transitionStartTime = Date.now();
        transitionTargetValue = 1;
        exitFullscreen();
    };

    // Reset variant
    setSelectedFunscriptVariant('original');
    const sel = document.getElementById('funscript-variant-select');
    if (sel) sel.value = 'original';

    const funscriptPromise = loadFunscript(funscriptUrl);
    createFunscriptDisplayBox();

    videoElement.onloadeddata = async () => {
        await funscriptPromise;
        updateFunscriptDisplayBox(0);
        updateProgressBars(videoElement);
        refreshVariantsForCurrentVideo();
        spinner.style.display = 'none';
    };

    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
    document.getElementById('settings-button').style.display = 'block';
}
