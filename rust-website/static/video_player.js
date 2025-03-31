import { loadFunscript, getCurrentFunscriptAction } from './funscript_handler.js';

export function playVideo(videoUrl, funscriptUrl) {
    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.style.width = '100%';

    videoPlayer.innerHTML = ''; // Clear any existing video
    videoPlayer.appendChild(videoElement);

    // Load the funscript
    loadFunscript(funscriptUrl);

    // Create or update the funscript display box
    let funscriptBox = document.getElementById('funscript-box');
    if (!funscriptBox) {
        funscriptBox = document.createElement('div');
        funscriptBox.id = 'funscript-box';
        funscriptBox.style.position = 'absolute';
        funscriptBox.style.bottom = '10px';
        funscriptBox.style.right = '10px';
        funscriptBox.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        funscriptBox.style.color = 'white';
        funscriptBox.style.padding = '10px';
        funscriptBox.style.borderRadius = '5px';
        funscriptBox.style.fontSize = '16px';
        document.body.appendChild(funscriptBox);
    }

    // Update the funscript display as the video plays
    videoElement.ontimeupdate = () => {
        const currentTime = videoElement.currentTime * 1000; // Convert to milliseconds
        const currentAction = getCurrentFunscriptAction(currentTime);
        if (currentAction) {
            funscriptBox.textContent = `Position: ${currentAction.pos}`;
        }
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
}