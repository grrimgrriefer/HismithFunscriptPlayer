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
import {
    refreshVariantsForCurrentVideo,
    updateIntensityDisplay,
    setSBSMode,
    isHardLimitUnlocked
} from './settings_menu.js';
import {
    lerp,
    toFunscriptPath,
    getFunscriptStats,
    showTemporaryOverlayMessage,
    intensityToColor,
    volatilityToColor,
    relativeIntensityToColor,
    updateSbsPlayingState,
    lockLandscape,
    lockPortrait
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
    playedVideos: new Set(),
    funscriptEndCancelled: false,
    videoEndedCancelled: false
};

function computeOscillateValue(intensity, progress) {
    if (intensity === undefined) return 0;
    return lerp(0, intensity / 100, progress);
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

    if (funscriptEnd > 0 && currentTime < funscriptEnd - 500) {
        state.funscriptEndCancelled = false;
    }
    if (!videoElement.ended) {
        state.videoEndedCancelled = false;
    }

    if (!state.isOverlayVisible && !videoElement.loop) {
        if (videoElement.ended && !state.videoEndedCancelled) {
            videoElement.pause();
            showNextVideoOverlay();
        } else if (
            funscriptEnd > 0 &&
            currentTime >= funscriptEnd &&
            !state.funscriptEndCancelled &&
            !videoElement.ended
        ) {
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
    state.funscriptEndCancelled = false;
    state.videoEndedCancelled = false;
    hideNextVideoOverlay();

    const errorOverlay = document.getElementById('video-error-overlay');
    const errorText = document.getElementById('video-error-text');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    cancelCurrentAnimation();
    sendDeviceCommand(0, 0);
    updateSbsPlayingState();

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

    videoElement.onseeking = () => {
        state.funscriptEndCancelled = false;
        state.videoEndedCancelled = false;
    };

    videoElement.onplay = () => {
        if (isHardLimitUnlocked()) {
            videoElement.pause();
            showTemporaryOverlayMessage(
                'Playback refused: Max Intensity Limit is currently unlocked. Please lock it, for your safety, in Settings before playing.'
            );
            return;
        }

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
        setTimeout(lockLandscape, 150);
        updateSbsPlayingState();
    };

    videoElement.onpause = () => {
        state.cancelAnimationTimeout = setTimeout(
            cancelCurrentAnimation,
            TRANSITION_DURATION + 100
        );
        state.transitionStartTime = Date.now();
        state.transitionTargetValue = 1;

        lockPortrait().finally(() => {
            exitFullscreen();
        });
        updateSbsPlayingState();
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

        // autotrigger SBS for 32:9 ratios
        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            const ratio = videoElement.videoWidth / videoElement.videoHeight;
            const is32to9 = Math.abs(ratio - 32 / 9) < 0.1;
            setSBSMode(is32to9);
        }

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

function startNextVideo(videoNode) {
    if (!videoNode) {
        showTemporaryOverlayMessage(
            'No similar video found in the specified intensity range.'
        );
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

async function showNextVideoOverlay() {
    if (state.isOverlayVisible) return;
    state.isOverlayVisible = true;
    if (state.nextVideoTimer) clearTimeout(state.nextVideoTimer);

    const overlay = document.getElementById('next-video-overlay');
    const timerEl = document.getElementById('next-timer');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    exitFullscreen();

    const played = Array.from(state.playedVideos).join(',');
    let candidates = { lower: null, similar: null, higher: null };

    try {
        const resp = await fetch(
            `/api/recommendations/next?video=${encodeURIComponent(state.currentVideoRelativePath)}&exclude=${encodeURIComponent(played)}`
        );
        if (resp.ok) {
            candidates = await resp.json();
        }
    } catch (err) {
        console.error('Failed to fetch next recommendations:', err);
    }

    updateOverlayButtons(
        candidates,
        ['Lower', 'Similar', 'Higher'],
        'relative'
    );

    const replayBtn = document.getElementById('next-replay-btn');
    if (replayBtn) {
        replayBtn.style.display = 'inline-block';
        replayBtn.onclick = () => {
            const video = document.querySelector('#video-player video');
            if (video) {
                video.currentTime = 0;
                video.play();
            }
            hideNextVideoOverlay();
        };
    }

    document.getElementById('next-cancel-btn').onclick = hideNextVideoOverlay;

    const fallbackVideo =
        candidates.similar || candidates.higher || candidates.lower;
    let timeLeft = 6;
    const updateTimer = () => {
        if (!state.isOverlayVisible) return;
        timerEl.innerHTML = `Starting random video in ${timeLeft}s...`;
        if (timeLeft <= 0) {
            if (fallbackVideo) startNextVideo(fallbackVideo);
            else hideNextVideoOverlay();
            return;
        }
        timeLeft--;
        state.nextVideoTimer = setTimeout(updateTimer, 1000);
    };
    updateTimer();
}

function hideNextVideoOverlay() {
    state.isOverlayVisible = false;
    clearTimeout(state.nextVideoTimer);
    document.getElementById('next-video-overlay')?.classList.add('hidden');

    const videoElement = document.querySelector('#video-player video');
    if (videoElement?.ended) {
        state.videoEndedCancelled = true;
    } else {
        state.funscriptEndCancelled = true;
    }

    const settingsBtn = document.getElementById('settings-button');
    if (settingsBtn) settingsBtn.style.display = 'block';
}

// ── Folder Start Selection Helpers ─────────────────────────────────────

export async function showFolderStartOverlay(folderPath) {
    let candidates = { low: null, med: null, high: null };

    try {
        const resp = await fetch(
            `/api/recommendations/folder-start?folder=${encodeURIComponent(folderPath)}`
        );
        if (resp.ok) {
            candidates = await resp.json();
        }
    } catch (err) {
        console.error('Failed to fetch folder start recommendations:', err);
    }

    if (!candidates.low && !candidates.med && !candidates.high) return;

    state.isOverlayVisible = true;
    const overlay = document.getElementById('next-video-overlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    document.getElementById('video-container').classList.remove('hidden');

    exitFullscreen();

    updateOverlayButtons(
        {
            lower: candidates.low,
            similar: candidates.med,
            higher: candidates.high
        },
        ['Low', 'Medium', 'High'],
        'absolute'
    );

    document.getElementById('next-timer').innerHTML =
        'Select a starting intensity to begin...';
    document.getElementById('next-replay-btn').style.display = 'none';
    document.getElementById('next-cancel-btn').onclick = () => {
        hideNextVideoOverlay();
        const activeVideo = document.querySelector('#video-player video');
        if (!activeVideo?.src)
            document.getElementById('video-container').classList.add('hidden');
    };
}

// --- Shared Overlay Helpers ---

function getStats(v) {
    if (!v) return { peak: 0, avg: 0 };
    return getFunscriptStats(state.globalFunscriptMap[toFunscriptPath(v.path)]);
}

function getStatHtml(candidate, mode = 'relative') {
    if (!candidate) return '';

    if (mode === 'absolute') {
        const peakColor = intensityToColor(candidate.peak);
        const avgColor = intensityToColor(candidate.avg);
        const volColor = volatilityToColor(candidate.volatility);

        return (
            `<span style="color:${peakColor}">🔺 ${candidate.peak.toFixed(1)} Peak</span><br>` +
            `<span style="color:${avgColor}">🌡️ ${candidate.avg.toFixed(1)} Avg</span><br>` +
            `<span style="color:${volColor}">⚡️ ${candidate.volatility.toFixed(1)} Vol</span>`
        );
    }

    const dPeak = candidate.delta_peak ?? 0;
    const dAvg = candidate.delta_avg ?? 0;
    const dVol = candidate.delta_volatility ?? 0;

    const peakPrefix = dPeak > 0 ? '+' : '';
    const avgPrefix = dAvg > 0 ? '+' : '';
    const volPrefix = dVol > 0 ? '+' : '';

    const peakColor = relativeIntensityToColor(dPeak);
    const avgColor = relativeIntensityToColor(dAvg);
    const volColor = relativeIntensityToColor(dVol);

    return (
        `<span style="color:${peakColor}">🔺 ${peakPrefix}${dPeak.toFixed(1)} Peak</span><br>` +
        `<span style="color:${avgColor}">🌡️ ${avgPrefix}${dAvg.toFixed(1)} Avg</span><br>` +
        `<span style="color:${volColor}">⚡️ ${volPrefix}${dVol.toFixed(1)} Vol</span>`
    );
}

function updateOverlayButtons(candidates, labels, statMode = 'relative') {
    document.querySelector('#next-lower-btn .next-label').textContent =
        labels[0];
    document.querySelector('#next-similar-btn .next-label').textContent =
        labels[1];
    document.querySelector('#next-higher-btn .next-label').textContent =
        labels[2];

    const formatBtn = (id, candidate) => {
        const btn = document.getElementById(id);
        const thumbImg = btn.querySelector('.next-thumb');
        const statsEl = btn.querySelector('.next-stats');
        if (!candidate) {
            btn.disabled = true;
            statsEl.textContent = 'N/A';
            if (thumbImg) thumbImg.style.display = 'none';
            return;
        }
        btn.disabled = false;
        if (thumbImg) {
            thumbImg.style.display = 'block';
            thumbImg.src = `/site/thumbnails/${candidate.path}.jpg`;
        }
        statsEl.innerHTML = getStatHtml(candidate, statMode);
        btn.onclick = () => startNextVideo(candidate);
    };

    formatBtn('next-lower-btn', candidates.lower);
    formatBtn('next-similar-btn', candidates.similar);
    formatBtn('next-higher-btn', candidates.higher);
}
