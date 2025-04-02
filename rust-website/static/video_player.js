import { loadFunscript, getCurrentFunscriptAction, getCurrentIntensity } from './funscript_handler.js';

export function playVideo(videoUrl, funscriptUrl) {
    const videoPlayer = document.getElementById('video-player');
    const videoElement = document.createElement('video');
    videoElement.src = videoUrl;
    videoElement.controls = true;
    videoElement.autoplay = true;
    videoElement.style.width = '100%';

    videoPlayer.innerHTML = ''; // Clear any existing video
    videoPlayer.appendChild(videoElement);

    // Function to reload the funscript and regenerate values
    const reloadFunscript = () => {
        loadFunscript(funscriptUrl);
    };

    // Load the funscript initially
    reloadFunscript();

    // Add a loop toggle button
    let loopToggle = document.getElementById('loop-toggle');
    if (!loopToggle) {
        loopToggle = document.createElement('button');
        loopToggle.id = 'loop-toggle';
        loopToggle.textContent = 'Loop: Off';
        loopToggle.style.position = 'absolute';
        loopToggle.style.top = '50px';
        loopToggle.style.left = '10px';
        loopToggle.style.zIndex = '3';
        loopToggle.style.backgroundColor = 'rgb(70, 70, 70)';
        loopToggle.style.color = 'white';
        loopToggle.style.border = 'none';
        loopToggle.style.padding = '10px 20px';
        loopToggle.style.cursor = 'pointer';
        loopToggle.style.borderRadius = '5px';

        loopToggle.onclick = () => {
            videoElement.loop = !videoElement.loop;
            loopToggle.textContent = `Loop: ${videoElement.loop ? 'On' : 'Off'}`;
            window.isLoopEnabled = videoElement.loop; // Update global loop state

            // Regenerate the funscript values when toggling loop
            reloadFunscript();
        };

        document.body.appendChild(loopToggle);
    }

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
        funscriptBox.style.width = '200px';
        funscriptBox.style.height = '50px'; // Increased height to fit two bars
        funscriptBox.style.display = 'flex';
        funscriptBox.style.flexDirection = 'column';
        funscriptBox.style.alignItems = 'center';
        funscriptBox.style.overflow = 'hidden';
        funscriptBox.style.border = '1px solid white';

        // Create the position progress bar
        const positionBar = document.createElement('div');
        positionBar.id = 'position-bar';
        positionBar.style.height = '50%';
        positionBar.style.width = '0%';
        positionBar.style.backgroundColor = 'lime';
        positionBar.style.transition = 'width 0.1s ease-out';
        positionBar.style.position = 'relative';

        const positionText = document.createElement('span');
        positionText.id = 'position-text';
        positionText.style.position = 'absolute';
        positionText.style.width = '100%';
        positionText.style.textAlign = 'center';
        positionText.style.color = 'black';
        positionText.style.fontWeight = 'bold';
        positionBar.appendChild(positionText);

        // Create the intensity progress bar
        const intensityBar = document.createElement('div');
        intensityBar.id = 'intensity-bar';
        intensityBar.style.height = '50%';
        intensityBar.style.width = '0%';
        intensityBar.style.backgroundColor = 'orange';
        intensityBar.style.transition = 'width 0.1s ease-out';
        intensityBar.style.position = 'relative';

        const intensityText = document.createElement('span');
        intensityText.id = 'intensity-text';
        intensityText.style.position = 'absolute';
        intensityText.style.width = '100%';
        intensityText.style.textAlign = 'center';
        intensityText.style.color = 'black';
        intensityText.style.fontWeight = 'bold';
        intensityBar.appendChild(intensityText);

        funscriptBox.appendChild(positionBar);
        funscriptBox.appendChild(intensityBar);
        document.body.appendChild(funscriptBox);
    }

    // Update the funscript display as the video plays
    function updateProgressBars() {
        const currentTime = videoElement.currentTime * 1000; // Convert to milliseconds
        const currentAction = getCurrentFunscriptAction(currentTime);
        if (currentAction) {
            // Update position bar
            const positionBar = document.getElementById('position-bar');
            const positionText = document.getElementById('position-text');
            positionBar.style.width = `${Math.round(currentAction.pos)}%`;
            positionText.textContent = `${Math.round(currentAction.pos)}%`;

            // Update intensity bar
            const intensityBar = document.getElementById('intensity-bar');
            const intensityText = document.getElementById('intensity-text');
            const intensity = getCurrentIntensity(currentTime);
            intensityBar.style.width = `${intensity}%`;
            intensityText.textContent = `${Math.round(intensity)}`;
        }
        requestAnimationFrame(updateProgressBars); // Schedule the next update
    }

    videoElement.onplay = () => {
        requestAnimationFrame(updateProgressBars); // Start updating when the video plays
    };

    // Hide the directory tree and show the video player
    document.getElementById('directory-container').classList.add('hidden');
    document.getElementById('video-container').classList.remove('hidden');
}