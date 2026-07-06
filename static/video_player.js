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
import {
    refreshVariantsForCurrentVideo,
    updateIntensityDisplay
} from './settings_menu.js';
import {
    lerp,
    relativeIntensityToColor,
    toFunscriptPath,
    getFunscriptStats
} from './utils.js';

const urlParams = new URLSearchParams(window.location.search);
const DISABLE_FULLSCREEN = ['1', 'true', 'yes'].includes(
    (urlParams.get('no_fullscreen') || '').toLowerCase()
);
const TRANSITION_DURATION = 1000;

const state = {
    currentAnimationFrame: null,
    cancelAnimationTimeout: null,
    transitionStartTime: Date.now(),
    transitionTargetValue: 1,
    globalTree: null,
    globalFunscriptMap: null,
    currentVideoRelativePath: null,
    nextVideoTimer: null,
    isOverlayVisible: false,
    playedVideos: new Set()
};

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

    const elapsed = Date.now() - state.transitionStartTime;
    const progress = Math.abs(
        state.transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1)
    );

    sendDeviceCommand(
        computeOscillateValue(intensity, progress),
        computeVibrateValue(currentTime, intensity, progress)
    );

    const funscriptEnd = getFunscriptDuration();
    if (!state.isOverlayVisible && !videoElement.loop) {
        if (
            videoElement.ended ||
            (funscriptEnd > 0 && currentTime >= funscriptEnd)
        ) {
            if (videoElement.ended) videoElement.pause();
            showNextVideoOverlay();
        }
    }

    state.currentAnimationFrame = requestAnimationFrame(() =>
        updateProgressBars(videoElement)
    );
}

function enterFullscreen() {
    if (!DISABLE_FULLSCREEN)
        document.documentElement.requestFullscreen()?.catch(() => {});
}

function exitFullscreen() {
    if (!DISABLE_FULLSCREEN && document.fullscreenElement)
        document.exitFullscreen()?.catch(() => {});
}

function cancelCurrentAnimation() {
    if (state.currentAnimationFrame) {
        cancelAnimationFrame(state.currentAnimationFrame);
        state.currentAnimationFrame = null;
    }
}

export async function playVideo(
    videoUrl,
    funscriptUrl,
    relativePath,
    autoplay = false
) {
    state.currentVideoRelativePath = relativePath;
    state.playedVideos.add(relativePath);
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
        if (state.cancelAnimationTimeout) {
            clearTimeout(state.cancelAnimationTimeout);
            state.cancelAnimationTimeout = null;
        }
        cancelCurrentAnimation();
        state.transitionStartTime = Date.now();
        state.transitionTargetValue = 0;
        state.currentAnimationFrame = requestAnimationFrame(() =>
            updateProgressBars(videoElement)
        );
        enterFullscreen();
    };

    videoElement.onpause = () => {
        state.cancelAnimationTimeout = setTimeout(
            cancelCurrentAnimation,
            TRANSITION_DURATION + 100
        );
        state.transitionStartTime = Date.now();
        state.transitionTargetValue = 1;
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
        updateIntensityDisplay();
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
    state.globalTree = tree;
    state.globalFunscriptMap = map;
}

function getVideosInSameFolder(path) {
    if (!state.globalTree || !path) return [];
    const parts = path.split('/');
    parts.pop();
    let current = state.globalTree;
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

function findRandomVideo(currentPeak, minDiff, maxDiff) {
    const siblings = getVideosInSameFolder(state.currentVideoRelativePath);
    let candidates = siblings.filter((v) => {
        if (
            v.path === state.currentVideoRelativePath ||
            state.playedVideos.has(v.path)
        ) {
            return false;
        }
        const normPath = toFunscriptPath(v.path);
        const stats = getFunscriptStats(state.globalFunscriptMap[normPath]);
        if (!stats) return false;
        const peak = stats.peak;
        const diff = peak - currentPeak;
        return diff >= minDiff && diff <= maxDiff;
    });

    if (candidates.length === 0) {
        candidates = siblings.filter((v) => {
            if (
                v.path === state.currentVideoRelativePath ||
                state.playedVideos.has(v.path)
            ) {
                return false;
            }
            const normPath = toFunscriptPath(v.path);
            const stats = getFunscriptStats(state.globalFunscriptMap[normPath]);
            if (!stats) return false;
            const peak = stats.peak;
            const diff = peak - currentPeak;
            return diff >= minDiff && diff <= maxDiff;
        });
    }

    return candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)]
        : null;
}

function findClosestVideo(currentPeak) {
    const siblings = getVideosInSameFolder(state.currentVideoRelativePath);

    const candidates = siblings
        .filter(
            (v) =>
                v.path !== state.currentVideoRelativePath &&
                !state.playedVideos.has(v.path)
        )
        .map((v) => {
            const normPath = toFunscriptPath(v.path);
            const stats = getFunscriptStats(state.globalFunscriptMap[normPath]);
            if (!stats) return null;
            return { node: v, diff: Math.abs(stats.peak - currentPeak) };
        })
        .filter(Boolean);

    if (candidates.length === 0) return null;

    candidates.sort((a, b) => a.diff - b.diff);
    return candidates[0].node;
}

function startNextVideo(videoNode) {
    if (!videoNode) {
        alert('No similar video found in the specified intensity range.');
        return;
    }
    hideNextVideoOverlay();
    playVideo(
        `/site/video/${videoNode.path}`,
        `/site/funscripts/${toFunscriptPath(videoNode.path)}`,
        videoNode.path,
        true
    );
}

function showNextVideoOverlay() {
    if (state.isOverlayVisible) return;
    state.isOverlayVisible = true;
    if (state.nextVideoTimer) clearTimeout(state.nextVideoTimer);

    const overlay = document.getElementById('next-video-overlay');
    const timerEl = document.getElementById('next-timer');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    exitFullscreen();

    const getStats = (v) => {
        if (!v) return { peak: 0, avg: 0 };
        return getFunscriptStats(
            state.globalFunscriptMap[toFunscriptPath(v.path)]
        );
    };

    const currentStats = getStats({ path: state.currentVideoRelativePath });
    const currentPeak = currentStats ? currentStats.peak : 0;

    const getStatHtml = (candidate) => {
        if (!candidate) return '';
        const stats = getStats(candidate);
        const dPeak = stats.peak - currentPeak;
        const dAvg = stats.avg - currentStats.avg;
        const peakColor = relativeIntensityToColor(dPeak);

        return (
            `<span style="color:${peakColor}">${dPeak > 0 ? '+' : ''}${dPeak.toFixed(1)}</span> ` +
            `<span style="opacity:0.8; font-size:0.8em;">(${dAvg > 0 ? '+' : ''}${dAvg.toFixed(1)} avg)</span>`
        );
    };

    const formatBtn = (id, candidate, label) => {
        const btn = document.getElementById(id);
        if (!candidate) {
            btn.textContent = `No ${label.toLowerCase()} found`;
            btn.disabled = true;
            return;
        }
        btn.innerHTML = `${label} ${getStatHtml(candidate)}`;
        btn.disabled = false;
        btn.onclick = () => startNextVideo(candidate);
    };

    const candidates = {
        higher: findRandomVideo(currentPeak, 5, 15),
        similar: findRandomVideo(currentPeak, -5, 5),
        lower: findRandomVideo(currentPeak, -15, -5)
    };

    formatBtn('next-higher-btn', candidates.higher, 'Significantly Higher');
    formatBtn('next-lower-btn', candidates.lower, 'Significantly Lower');

    const fallbackVideo = !candidates.similar
        ? findClosestVideo(currentPeak)
        : candidates.similar;
    const similarStatsHtml = fallbackVideo
        ? `<br><small>Next: ${getStatHtml(fallbackVideo)}</small>`
        : '';

    let timeLeft = 6;
    const updateTimer = () => {
        if (!state.isOverlayVisible) return;
        timerEl.innerHTML = `Starting random video in ${timeLeft}s...${similarStatsHtml}`;
        if (timeLeft <= 0) return startNextVideo(fallbackVideo);
        timeLeft--;
        state.nextVideoTimer = setTimeout(updateTimer, 1000);
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
    state.isOverlayVisible = false;
    clearTimeout(state.nextVideoTimer);
    document.getElementById('next-video-overlay')?.classList.add('hidden');
}
