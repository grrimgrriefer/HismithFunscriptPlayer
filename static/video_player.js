// static/video_player.js

import {
    loadFunscript,
    getCurrentIntensity,
    getCurrentVideoMaxIntensity,
    getVibrateMode,
    getCurrentBeatValue,
    setSelectedFunscriptVariant,
    getFunscriptDuration
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

let globalTree = null;
let globalFunscriptMap = null;
let currentVideoRelativePath = null;
let nextVideoTimer = null;
let isOverlayVisible = false;
const playedVideos = new Set();

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

    const funscriptEnd = getFunscriptDuration();
    const isVideoEnded = videoElement.ended;
    const isFunscriptEnded = funscriptEnd > 0 && currentTime >= funscriptEnd;

    if (!isOverlayVisible && !videoElement.loop) {
        if (isVideoEnded || isFunscriptEnded) {
            if (isVideoEnded) {
                videoElement.pause();
            }
            showNextVideoOverlay();
        }
    }

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

export async function playVideo(
    videoUrl,
    funscriptUrl,
    relativePath,
    autoplay = false
) {
    currentVideoRelativePath = relativePath;
    playedVideos.add(relativePath);
    hideNextVideoOverlay();

    const errorOverlay = document.getElementById('video-error-overlay');
    const errorText = document.getElementById('video-error-text');
    if (errorOverlay) errorOverlay.classList.add('hidden');

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

    videoElement.onerror = () => {
        if (spinner) spinner.style.display = 'none';
        if (errorOverlay && errorText) {
            let msg = 'An unknown error occurred while loading the video.';

            // 4 = MEDIA_ERR_SRC_NOT_SUPPORTED
            if (videoElement.error && videoElement.error.code === 4) {
                msg =
                    'Unsupported video codec. This browser requires H.264/AVC. Please transcode the file on the backend.';
            }
            errorText.textContent = msg;
            errorOverlay.classList.remove('hidden');
        }
    };

    // Reset variant
    setSelectedFunscriptVariant('original');
    const sel = document.getElementById('funscript-variant-select');
    if (sel) sel.value = 'original';

    const funscriptPromise = loadFunscript(funscriptUrl);
    createFunscriptDisplayBox();

    videoElement.onloadeddata = async () => {
        if (spinner) spinner.style.display = 'none';
        console.log(
            `Video metadata loaded. Dimensions: ${videoElement.videoWidth}x${videoElement.videoHeight}`
        );

        // Audio plays but video is unsupported
        if (
            videoElement.videoWidth === 0 &&
            videoUrl.toLowerCase().endsWith('.mp4')
        ) {
            console.error(
                'Video width is 0. Possible codec incompatibility (HEVC/H.265).'
            );
            if (errorOverlay && errorText) {
                errorText.textContent =
                    'Warning: The video track is not visible, it likely uses an unsupported codec like HEVC/H.265.';
                errorOverlay.classList.remove('hidden');
            }
        }

        await funscriptPromise;
        updateFunscriptDisplayBox(0);
        updateProgressBars(videoElement);
        refreshVariantsForCurrentVideo();
        spinner.style.display = 'none';

        if (autoplay) {
            videoElement
                .play()
                .catch((e) => console.warn('Autoplay blocked:', e));
        }
    };

    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
    document.getElementById('settings-button').style.display = 'block';
}

export function setPlaybackData(tree, map) {
    globalTree = tree;
    globalFunscriptMap = map;
}

function getVideosInSameFolder(path) {
    if (!globalTree || !path) return [];
    const parts = path.split('/');
    parts.pop();
    let current = globalTree;
    for (const part of parts) {
        if (!part) continue;
        const found = current.children?.find(
            (c) => c.is_dir && c.name === part
        );
        if (!found) return [];
        current = found;
    }
    return (current.children || []).filter((c) => !c.is_dir);
}

function findRandomVideo(minDiff, maxDiff) {
    const siblings = getVideosInSameFolder(currentVideoRelativePath);
    const currentPeak = getCurrentVideoMaxIntensity();

    let candidates = siblings.filter((v) => {
        if (v.path === currentVideoRelativePath || playedVideos.has(v.path))
            return false;
        const normPath = v.path.replace(/\.[^/.]+$/, '.funscript');
        const stats = globalFunscriptMap[normPath];
        if (!stats) return false;
        const peak =
            stats.peak_intensity || stats.peak || stats.peakIntensity || 0;
        const diff = peak - currentPeak;
        return diff >= minDiff && diff <= maxDiff;
    });

    if (candidates.length === 0) {
        candidates = siblings.filter((v) => {
            if (v.path === currentVideoRelativePath) return false;
            const normPath = v.path.replace(/\.[^/.]+$/, '.funscript');
            const stats = globalFunscriptMap[normPath];
            if (!stats) return false;
            const peak =
                stats.peak_intensity || stats.peak || stats.peakIntensity || 0;
            const diff = peak - currentPeak;
            return diff >= minDiff && diff <= maxDiff;
        });
    }

    return candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : null;
}

function startNextVideo(videoNode) {
    if (!videoNode) {
        alert('No similar video found in the specified intensity range.');
        return;
    }
    hideNextVideoOverlay();
    playVideo(
        `/site/video/${videoNode.path}`,
        `/site/funscripts/${videoNode.path.replace(/\.[^/.]+$/, '.funscript')}`,
        videoNode.path,
        true
    );
}

function showNextVideoOverlay() {
    if (isOverlayVisible) return;
    isOverlayVisible = true;

    if (nextVideoTimer) clearTimeout(nextVideoTimer);

    const overlay = document.getElementById('next-video-overlay');
    const timerEl = document.getElementById('next-timer');
    const higherBtn = document.getElementById('next-higher-btn');
    const lowerBtn = document.getElementById('next-lower-btn');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    exitFullscreen();

    const getStatsDelta = (v) => {
        if (!v) return { peak: 0, avg: 0 };
        const normPath = v.path.replace(/\.[^/.]+$/, '.funscript');
        const stats = globalFunscriptMap[normPath];
        const peak = stats
            ? stats.peak_intensity || stats.peak || stats.peakIntensity || 0
            : 0;
        const avg = stats
            ? stats.average_intensity ||
              stats.avg ||
              stats.average ||
              stats.averageIntensity ||
              0
            : 0;

        const currentNorm = currentVideoRelativePath.replace(
            /\.[^/.]+$/,
            '.funscript'
        );
        const cStats = globalFunscriptMap[currentNorm] || {};
        const cPeak = getCurrentVideoMaxIntensity();
        const cAvg =
            cStats.average_intensity ||
            cStats.avg ||
            cStats.average ||
            cStats.averageIntensity ||
            0;

        return { peak: peak - cPeak, avg: avg - cAvg };
    };

    const getColor = (d) => {
        if (d > 5) return '#ff4444'; // Red
        if (d > 0) return '#ffbb33'; // Orange
        if (d < -5) return '#00C851'; // Green
        if (d < 0) return '#99cc00'; // Light Green
        return '#ffffff';
    };

    const formatBtn = (btn, candidate, label) => {
        if (!candidate) {
            btn.textContent = `No ${label.toLowerCase()} found`;
            btn.disabled = true;
            btn.style.color = '';
            return;
        }
        const delta = getStatsDelta(candidate);
        const pSign = delta.peak > 0 ? '+' : '';
        const aSign = delta.avg > 0 ? '+' : '';

        btn.innerHTML =
            `${label} <span style="color:${getColor(delta.peak)}; font-weight:bold;">` +
            `${pSign}${delta.peak.toFixed(1)}</span> ` +
            `<span style="color:${getColor(delta.avg)}; font-size:0.85em; opacity:0.9;">` +
            `(${aSign}${delta.avg.toFixed(1)} avg)</span>`;

        btn.disabled = false;
        btn.onclick = () => startNextVideo(candidate);
    };

    const candidates = {
        higher: findRandomVideo(5, 15),
        similar: findRandomVideo(-5, 5),
        lower: findRandomVideo(-15, -5)
    };

    formatBtn(higherBtn, candidates.higher, 'Higher Intensity');
    formatBtn(lowerBtn, candidates.lower, 'Lower Intensity');

    let timeLeft = 6;
    const updateTimer = () => {
        if (!isOverlayVisible) return;

        const delta = getStatsDelta(candidates.similar);
        const pSign = delta.peak >= 0 ? '+' : '';
        const aSign = delta.avg >= 0 ? '+' : '';

        const deltaHtml = candidates.similar
            ? ` <span style="color:${getColor(delta.peak)}">${pSign}${delta.peak.toFixed(1)}</span>` +
              ` <small style="color:${getColor(delta.avg)}">(${aSign}${delta.avg.toFixed(1)} avg)</small>`
            : '';

        timerEl.innerHTML = `Starting random video${deltaHtml} in ${timeLeft}s...`;

        if (timeLeft <= 0) {
            startNextVideo(candidates.similar);
            return;
        }
        timeLeft -= 1;
        nextVideoTimer = setTimeout(updateTimer, 1000);
    };
    updateTimer();

    document.getElementById('next-replay-btn').onclick = () => {
        const video = document.querySelector('#video-player video');
        if (video) {
            video.currentTime = 0;
            video.play();
        }
        hideNextVideoOverlay();
    };
    document.getElementById('next-cancel-btn').onclick = hideNextVideoOverlay;
}

function hideNextVideoOverlay() {
    isOverlayVisible = false;
    clearTimeout(nextVideoTimer);
    document.getElementById('next-video-overlay')?.classList.add('hidden');
}
