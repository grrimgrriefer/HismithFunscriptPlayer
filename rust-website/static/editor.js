// static/editor.js

// DOM Elements
const videoElement = document.getElementById('editor-video');
const canvas = document.getElementById('editor-canvas');
const tapButton = document.getElementById('tap-button');
const undoButton = document.getElementById('undo-button');
const deleteButton = document.getElementById('delete-button');
const saveButton = document.getElementById('save-button');
const actionCounter = document.getElementById('action-counter');
const ctx = canvas.getContext('2d');

// State
let tapTimestamps = [];
let selectedTimestamps = new Set();
let videoPath = '';

// Interaction State
let isDragging = false;
let isSelecting = false;
let selectionStartPos = { x: 0 };
let selectionEndPos = { x: 0 };
let dragStartMs = 0;
let dragOffsetMs = 0;

// Config
const VIEW_WINDOW_MS = 10000; // 10 seconds of timeline visible
const CLICK_RADIUS_MS = 100; // Click tolerance in milliseconds

// --- Main Functions ---
async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    videoPath = urlParams.get('video');

    if (!videoPath) {
        document.body.innerHTML = '<h1>Error: No video specified.</h1>';
        return;
    }

    videoElement.src = `/site/video/${videoPath}`;
    await loadExistingFunscript();

    setupEventListeners();
    resizeCanvas();
    updateCounter();
    drawVisualizer();
}

function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    drawVisualizer();
}

function setupEventListeners() {
    tapButton.addEventListener('click', handleTap);
    undoButton.addEventListener('click', handleUndo);
    deleteButton.addEventListener('click', handleDeleteSelected);
    saveButton.addEventListener('click', handleSave);

    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && e.target === document.body) {
            e.preventDefault();
            handleTap();
        }
        if (e.code === 'Delete' || e.code === 'Backspace') {
            e.preventDefault();
            handleDeleteSelected();
        }
    });

    videoElement.addEventListener('timeupdate', drawVisualizer);
    window.addEventListener('resize', resizeCanvas);
    setupCanvasEventListeners();
}

// --- Funscript Logic ---
function updateCounter() {
    actionCounter.textContent = `Taps: ${tapTimestamps.length}`;
}

function generateFunscriptActions() {
    if (tapTimestamps.length === 0) return [{ at: 0, pos: 0 }];

    const sortedTaps = [...tapTimestamps].sort((a, b) => a - b);
    let actions = [];
    let lastTime = 0;

    for (const tapTime of sortedTaps) {
        const downTime = Math.round((lastTime + tapTime) / 2);
        if (actions.length > 0 || downTime > 0) actions.push({ at: downTime, pos: 0 });
        actions.push({ at: tapTime, pos: 100 });
        lastTime = tapTime;
    }

    actions.push({ at: lastTime + 500, pos: 0 });
    if (actions.length > 0 && actions[0].at > 0) actions.unshift({ at: 0, pos: 0 });

    const uniqueActions = [];
    const seen = new Map();
    for (const action of actions) {
        if (!seen.has(action.at) || seen.get(action.at).pos !== action.pos) {
            seen.set(action.at, action);
        }
    }

    return Array.from(seen.values()).sort((a, b) => a.at - b.at);
}

async function loadExistingFunscript() {
    try {
        const funscriptUrl = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, ".funscript")}`;
        const response = await fetch(funscriptUrl);
        if (response.ok) {
            const data = await response.json();
            if (data.original && data.original.actions) {
                tapTimestamps = data.original.actions
                    .filter(action => action.pos === 100)
                    .map(action => action.at)
                    .sort((a, b) => a - b);
                console.log(`Loaded ${tapTimestamps.length} existing points.`);
            }
        }
    } catch (error) {
        console.error('Error loading existing funscript:', error);
    }
}

async function handleSave() {
    const actions = generateFunscriptActions();
    if (actions.length < 2) {
        alert("Not enough actions to create a funscript.");
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
        const response = await fetch('/api/funscripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: videoPath, actions })
        });
        if (response.ok) {
            alert('Funscript saved successfully!');
            window.location.reload();
        } else {
            throw new Error(`Failed to save: ${await response.text()}`);
        }
    } catch (error) {
        console.error(error);
        alert(error.message);
    } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Funscript';
    }
}


// --- User Actions ---
function handleTap() {
    if (videoElement.paused) return;
    const currentTime = Math.round(videoElement.currentTime * 1000);
    tapTimestamps.push(currentTime);
    tapTimestamps.sort((a, b) => a - b);
    updateCounter();
    drawVisualizer();
}

function handleUndo() {
    if (tapTimestamps.length > 0) {
        tapTimestamps.pop();
        updateCounter();
        drawVisualizer();
    }
}

function handleDeleteSelected() {
    if (selectedTimestamps.size === 0) return;
    tapTimestamps = tapTimestamps.filter(t => !selectedTimestamps.has(t));
    selectedTimestamps.clear();
    updateCounter();
    drawVisualizer();
}


// --- Canvas Drawing ---
function drawVisualizer() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentTime = videoElement.currentTime * 1000;
    const viewStartMs = Math.max(0, currentTime - (VIEW_WINDOW_MS / 2));

    const msToPx = (ms) => ((ms - viewStartMs) / VIEW_WINDOW_MS) * canvas.width;
    const pxToMs = (px) => Math.round((px / canvas.width) * VIEW_WINDOW_MS + viewStartMs);

    // Draw waveform
    const actions = generateFunscriptActions();
    ctx.beginPath();
    ctx.strokeStyle = '#4CAF50';
    ctx.lineWidth = 1;
    actions.forEach((action, i) => {
        const x = msToPx(action.at);
        const y = canvas.height - (action.pos / 100) * (canvas.height * 0.8) - (canvas.height * 0.1);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Draw tap points
    tapTimestamps.forEach(at => {
        const x = msToPx(at);
        const y = canvas.height * 0.1; // Top of the wave
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = selectedTimestamps.has(at) ? 'yellow' : '#f44336';
        ctx.fill();
    });

    // Draw playhead
    const playheadX = canvas.width / 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, canvas.height);
    ctx.strokeStyle = 'red';
    ctx.stroke();

    // Draw selection box
    if (isSelecting) {
        const rectX = Math.min(selectionStartPos.x, selectionEndPos.x);
        const rectW = Math.abs(selectionStartPos.x - selectionEndPos.x);
        ctx.fillStyle = 'rgba(0, 150, 255, 0.2)';
        ctx.fillRect(rectX, 0, rectW, canvas.height);
    }
}


// --- Canvas Interactions ---
function setupCanvasEventListeners() {
    const msToPx = (ms) => {
        const viewStartMs = Math.max(0, (videoElement.currentTime * 1000) - (VIEW_WINDOW_MS / 2));
        return ((ms - viewStartMs) / VIEW_WINDOW_MS) * canvas.width;
    }
    const pxToMs = (px) => {
        const viewStartMs = Math.max(0, (videoElement.currentTime * 1000) - (VIEW_WINDOW_MS / 2));
        return Math.round((px / canvas.width) * VIEW_WINDOW_MS + viewStartMs);
    };

    const findPointAt = (px) => {
        const clickMs = pxToMs(px);
        for (const timestamp of tapTimestamps) {
            if (Math.abs(timestamp - clickMs) < CLICK_RADIUS_MS) {
                return timestamp;
            }
        }
        return null;
    };

    canvas.addEventListener('mousedown', (e) => {
        const pointHit = findPointAt(e.offsetX);

        if (pointHit !== null) {
            isDragging = true;
            dragOffsetMs = pxToMs(e.offsetX) - pointHit;
            if (!selectedTimestamps.has(pointHit)) {
                if (!e.ctrlKey && !e.metaKey) selectedTimestamps.clear();
                selectedTimestamps.add(pointHit);
            }
        } else {
            isSelecting = true;
            if (!e.ctrlKey && !e.metaKey) selectedTimestamps.clear();
            selectionStartPos.x = e.offsetX;
            selectionEndPos.x = e.offsetX;
        }
        drawVisualizer();
    });

    canvas.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const currentMouseMs = pxToMs(e.offsetX);
            const newTapTime = currentMouseMs - dragOffsetMs;

            const selectedArray = Array.from(selectedTimestamps);
            const firstSelected = Math.min(...selectedArray);
            const delta = newTapTime - firstSelected;

            tapTimestamps = tapTimestamps.map(t => selectedTimestamps.has(t) ? Math.max(0, t + delta) : t);
            selectedTimestamps = new Set(Array.from(selectedTimestamps).map(t => Math.max(0, t + delta)));

        } else if (isSelecting) {
            selectionEndPos.x = e.offsetX;
        }
        drawVisualizer();
    });

    canvas.addEventListener('mouseup', () => {
        if (isSelecting) {
            const startMs = pxToMs(Math.min(selectionStartPos.x, selectionEndPos.x));
            const endMs = pxToMs(Math.max(selectionStartPos.x, selectionEndPos.x));
            tapTimestamps.forEach(t => {
                if (t >= startMs && t <= endMs) selectedTimestamps.add(t);
            });
        }
        isDragging = false;
        isSelecting = false;
        drawVisualizer();
    });
}

// --- Start Application ---
init();