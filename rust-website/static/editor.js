// static/editor.js

const videoElement = document.getElementById('editor-video');
const tapButton = document.getElementById('tap-button');
const undoButton = document.getElementById('undo-button');
const saveButton = document.getElementById('save-button');
const actionCounter = document.getElementById('action-counter');

let tapTimestamps = [];
let videoPath = '';

function updateCounter() {
    actionCounter.textContent = `Taps: ${tapTimestamps.length}`;
}

function handleTap() {
    if (videoElement.paused) {
        alert("Please play the video first!");
        return;
    }
    const currentTime = Math.round(videoElement.currentTime * 1000);
    tapTimestamps.push(currentTime);
    tapTimestamps.sort((a, b) => a - b); // Keep it sorted
    updateCounter();
}

function handleUndo() {
    if (tapTimestamps.length > 0) {
        tapTimestamps.pop(); // Removes the last one, which is the latest time
        updateCounter();
    }
}

function generateFunscriptActions() {
    if (tapTimestamps.length === 0) {
        return [];
    }

    const sortedTaps = [...tapTimestamps].sort((a, b) => a - b);

    let actions = [];
    let lastTime = 0;

    for (const tapTime of sortedTaps) {
        // Midpoint between last action and this tap for the 'down' motion
        const downTime = Math.round((lastTime + tapTime) / 2);

        if (actions.length > 0 || downTime > 0) {
            actions.push({ at: downTime, pos: 0 });
        }

        // The 'up' motion (the tap itself)
        actions.push({ at: tapTime, pos: 100 });
        lastTime = tapTime;
    }

    // Add a final 'down' motion after the last tap
    const finalDownTime = lastTime + 500; // 500ms after last tap
    actions.push({ at: finalDownTime, pos: 0 });

    // The spec often starts with {at: 0, pos: 0}
    if (actions.length > 0 && actions[0].at > 0) {
        actions.unshift({ at: 0, pos: 0 });
    } else if (actions.length === 0) {
        actions.push({ at: 0, pos: 0 });
    }

    // De-duplicate actions at the same timestamp, keeping the last one
    const uniqueActions = [];
    const seenTimestamps = new Map();
    for (let i = actions.length - 1; i >= 0; i--) {
        const action = actions[i];
        if (!seenTimestamps.has(action.at)) {
            seenTimestamps.set(action.at, true);
            uniqueActions.unshift(action);
        }
    }

    return uniqueActions;
}

async function handleSave() {
    const actions = generateFunscriptActions();
    if (actions.length < 2) {
        alert("Not enough actions to create a funscript.");
        return;
    }

    const payload = {
        video_path: videoPath,
        actions: actions
    };

    try {
        saveButton.disabled = true;
        saveButton.textContent = 'Saving...';
        const response = await fetch('/api/funscripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('Funscript saved successfully!');
            window.close(); // Close the editor window
        } else {
            const errorText = await response.text();
            throw new Error(`Failed to save funscript: ${errorText}`);
        }
    } catch (error) {
        console.error(error);
        alert(error.message);
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Funscript';
    }
}

function init() {
    const urlParams = new URLSearchParams(window.location.search);
    videoPath = urlParams.get('video');

    if (!videoPath) {
        document.body.innerHTML = '<h1>Error: No video specified. Please use a link like /site/editor?video=path/to/video.mp4</h1>';
        return;
    }

    videoElement.src = `/site/video/${videoPath}`;

    tapButton.addEventListener('click', handleTap);
    undoButton.addEventListener('click', handleUndo);
    saveButton.addEventListener('click', handleSave);

    // Allow using spacebar to tap
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            handleTap();
        }
    });

    document.body.onfocus = () => {
        // to catch spacebar when nothing is focused
    }

    updateCounter();
}

init();