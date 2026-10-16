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
    initIntensityGraphHUD,
    renderIntensityGraphHUD
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
    toVideoUrl,
    toFunscriptUrl,
    updateSbsPlayingState,
    lockLandscape,
    lockPortrait
} from './utils.js';
import { showTemporaryOverlayMessage } from './utils_ui.js';
import {
    initVideoStats,
    recordView,
    trackPlayTick,
    resetPlayTick,
    getPlayedVideos,
    checkAndTriggerAutoLike
} from './video_stats_tracker.js';
import {
    showNextVideoOverlay,
    showFolderStartOverlay as openFolderStartOverlay,
    hideNextVideoOverlay,
    isOverlayVisible
} from './recommendation_overlay.js';

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
    funscriptEndCancelled: false,
    videoEndedCancelled: false
};

function computeThrustIntensity(intensity, progress) {
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
    trackPlayTick(videoElement);

    const currentTime = videoElement.currentTime * 1000;
    const intensity = getCurrentIntensity(currentTime);
    renderIntensityGraphHUD(currentTime);

    const elapsed = Date.now() - state.transitionStartTime;
    const progress = Math.abs(
        state.transitionTargetValue - Math.min(elapsed / TRANSITION_DURATION, 1)
    );

    sendDeviceCommand(
        computeThrustIntensity(intensity, progress),
        computeVibrateValue(currentTime, intensity, progress)
    );

    const funscriptEnd = getFunscriptDuration();

    if (funscriptEnd > 0 && currentTime < funscriptEnd - 500) {
        state.funscriptEndCancelled = false;
    }
    if (!videoElement.ended) {
        state.videoEndedCancelled = false;
    }

    if (!isOverlayVisible() && !videoElement.loop) {
        if (videoElement.ended && !state.videoEndedCancelled) {
            videoElement.pause();
            triggerNextVideoOverlay(videoElement);
        } else if (
            funscriptEnd > 0 &&
            currentTime >= funscriptEnd &&
            !state.funscriptEndCancelled &&
            !videoElement.ended
        ) {
            triggerNextVideoOverlay(videoElement);
        }
    }

    state.currentAnimationFrame = requestAnimationFrame(() =>
        updateProgressBars(videoElement)
    );
}

function enterFullscreen() {
    if (!DISABLE_FULLSCREEN) {
        document.documentElement.requestFullscreen()?.catch(() => {});
    }
}

function exitFullscreen() {
    if (!DISABLE_FULLSCREEN && document.fullscreenElement) {
        document.exitFullscreen()?.catch(() => {});
    }
}

function cancelCurrentAnimation() {
    if (state.currentAnimationFrame) {
        cancelAnimationFrame(state.currentAnimationFrame);
        state.currentAnimationFrame = null;
    }
}

function startNextVideo(videoNode) {
    if (!videoNode) {
        showTemporaryOverlayMessage(
            'No similar video found in the specified intensity range.'
        );
        return;
    }

    const currentVideoEl = document.querySelector('#video-player video');
    checkAndTriggerAutoLike(
        currentVideoEl,
        state.currentVideoRelativePath,
        state.globalTree
    );

    hideNextVideoOverlay();
    playVideo(
        toVideoUrl(videoNode.path),
        toFunscriptUrl(videoNode.path),
        videoNode.path,
        true
    );
}

function triggerNextVideoOverlay(videoElement) {
    exitFullscreen();
    showNextVideoOverlay({
        currentVideoRelativePath: state.currentVideoRelativePath,
        playedVideos: getPlayedVideos(),
        globalTree: state.globalTree,
        onSelectVideo: (candidate) => startNextVideo(candidate),
        onReplay: () => {
            if (videoElement) {
                videoElement.currentTime = 0;
                videoElement.play();
            }
        },
        onCancel: () => {
            if (videoElement?.ended) {
                state.videoEndedCancelled = true;
            } else {
                state.funscriptEndCancelled = true;
            }
        }
    });
}

export function showFolderStartOverlay(folderPath) {
    openFolderStartOverlay(folderPath, {
        globalTree: state.globalTree,
        onSelectVideo: (candidate) => startNextVideo(candidate),
        onCancel: () => {}
    });
}

export function setPlaybackData(tree, map) {
    state.globalTree = tree;
    state.globalFunscriptMap = map;
}

export async function playVideo(
    videoUrl,
    funscriptUrl,
    relativePath,
    autoplay = false
) {
    state.currentVideoRelativePath = relativePath;
    state.funscriptEndCancelled = false;
    state.videoEndedCancelled = false;

    hideNextVideoOverlay();

    const errorOverlay = document.getElementById('video-error-overlay');
    if (errorOverlay) errorOverlay.classList.add('hidden');

    cancelCurrentAnimation();
    sendDeviceCommand(0, 0);
    updateSbsPlayingState();

    initVideoStats(relativePath, state.globalTree);

    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.playsInline = true;
    videoElement.autoplay = false;

    videoPlayer.innerHTML = '';
    videoPlayer.appendChild(videoElement);

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

        recordView(relativePath, state.globalTree);

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
        resetPlayTick();
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
        const errorText = document.getElementById('video-error-text');
        if (errorOverlay && errorText) {
            let msg = 'An unknown error occurred while loading the video.';
            if (videoElement.error && videoElement.error.code === 4) {
                msg =
                    'Unsupported video codec. This browser requires H.264/AVC. Please transcode the file on the backend.';
            }
            errorText.textContent = msg;
            errorOverlay.classList.remove('hidden');
        }
    };

    setSelectedFunscriptVariant('original');
    const variantSelect = document.getElementById('funscript-variant-select');
    if (variantSelect) variantSelect.value = 'original';

    const funscriptPromise = loadFunscript(funscriptUrl);
    initIntensityGraphHUD();

    videoElement.onloadeddata = async () => {
        if (spinner) spinner.style.display = 'none';

        if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
            const ratio = videoElement.videoWidth / videoElement.videoHeight;
            const is32to9 = Math.abs(ratio - 32 / 9) < 0.1;
            setSBSMode(is32to9);
        }

        if (
            videoElement.videoWidth === 0 &&
            videoUrl.toLowerCase().endsWith('.mp4')
        ) {
            const errorText = document.getElementById('video-error-text');
            if (errorOverlay && errorText) {
                errorText.textContent =
                    'Warning: The video track is not visible, it likely uses an unsupported codec like HEVC/H.265.';
                errorOverlay.classList.remove('hidden');
            }
        }

        await funscriptPromise;
        updateIntensityDisplay();
        renderIntensityGraphHUD(0);
        updateProgressBars(videoElement);
        refreshVariantsForCurrentVideo();

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
