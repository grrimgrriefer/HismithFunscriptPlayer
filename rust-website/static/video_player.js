// static/video_player.js

import { loadFunscript, getCurrentIntensity, getAbsoluteMaximum, getCurrentVideoMaxIntensity, setIntensityMultiplier, getCurrentVideoRawMaxIntensity, getCurrentVideoRawAverageIntensity, funscriptActions } from './funscript_handler.js?v=218';
import { createFunscriptDisplayBox, updateFunscriptDisplayBox } from './funscript_sliders.js?v=218';
import { sendOscillateValue } from './socket.js?v=218';
import { createDuplicateVideoModal, clearMetadataPanel } from './metadata_panel.js?v=218';

let currentAnimationFrame = null;
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

        if (intensity !== undefined) {
            throttledSendOscillateValue(lerpIntensity(0, intensity, progress) / 100);
        }

        currentAnimationFrame = requestAnimationFrame(updateProgressBars);
    }

    // Create or update the settings menu
    // UI components are now created globally by main.js
    const throttledSendOscillateValue = throttle(sendOscillateValue, 150);
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
        clearMetadataPanel();

        // Now, wait for the funscript to finish loading.
        await funscriptPromise;

        // Now that both video and funscript data are ready, we can initialize things that depend on them.
        setIntensityMultiplier(1.0);
        if ((getAbsoluteMaximum() * 1.2) < getCurrentVideoMaxIntensity()) {
            setIntensityMultiplier(1.2 * getAbsoluteMaximum() / getCurrentVideoMaxIntensity());
        }

        updateFunscriptDisplayBox(0);
        updateProgressBars();
        const videoPath = videoUrl.substring('/site/video/'.length);
        const filename = videoPath.split('/').pop();
        let dbMetadata = {};

        try {
            const response = await fetch('/api/video/ensure', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path: videoPath, filename: filename })
            });

            if (response.ok) {
                dbMetadata = await response.json();
            } else if (response.status === 409) {
                const conflictData = await response.json();
                createDuplicateVideoModal(conflictData);
                spinner.style.display = 'none';
                return;
            } else {
                const errorData = await response.json();
                console.error('Failed to ensure video metadata:', errorData);
                alert(`Failed to load video metadata: ${errorData.error}`);
                spinner.style.display = 'none';
                return;
            }
        } catch (error) {
            console.error('Failed to fetch video metadata:', error);
            alert('An error occurred while fetching video metadata.');
            spinner.style.display = 'none';
            return;
        }

        const metadata = {
            ...dbMetadata,
            filename: filename,
            avgIntensity: getCurrentVideoRawAverageIntensity(),
            maxIntensity: getCurrentVideoRawMaxIntensity(),
            duration: videoElement.duration,
            hasFunscript: funscriptActions.length > 0,
        };

        window.updateMetadataPanel(metadata);

        // Hide the spinner only when all data is loaded and UI is ready.
        spinner.style.display = 'none';
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');

    // Show player-specific buttons
    document.getElementById('settings-button').style.display = 'block';
    document.getElementById('metadata-button').style.display = 'block';
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