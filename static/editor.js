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
const variantInput = document.getElementById('variant-input');

// State
let baseTimestamps = [];
let variantTimestamps = [];
let currentVariant = '';
let selectedTimestamps = new Set();
let videoPath = '';
let editorAnimationFrame = null;

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

async function init() {
    const urlParams = new URLSearchParams(window.location.search);
    videoPath = urlParams.get('video');

    const qvariant = urlParams.get('variant');
    if (qvariant && variantInput) variantInput.value = qvariant;

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

function isEditingVariant() {
    return (
        currentVariant && currentVariant !== '' && currentVariant !== 'original'
    );
}

function getEditingArray() {
    return isEditingVariant() ? variantTimestamps : baseTimestamps;
}

function setEditingArray(arr) {
    if (isEditingVariant()) {
        variantTimestamps = arr;
    } else {
        baseTimestamps = arr;
    }
}

function dedupeAndSort(arr) {
    const s = Array.from(new Set(arr));
    s.sort((a, b) => a - b);
    return s;
}

function extractActionsFromResponse(data, variantName) {
    if (!data) return [];
    if (
        variantName &&
        data[variantName] &&
        Array.isArray(data[variantName].actions)
    )
        return data[variantName].actions;
    if (data.original && Array.isArray(data.original.actions))
        return data.original.actions;
    if (Array.isArray(data.actions)) return data.actions;
    return [];
}

async function loadExistingFunscript() {
    currentVariant = variantInput ? variantInput.value.trim() : '';
    const baseFunscriptUrl = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, '.funscript')}`;

    // Populate variant datalist for easy selection
    try {
        const listResp = await fetch(baseFunscriptUrl + '?list=1');
        if (listResp.ok) {
            const listData = await listResp.json();
            const variants = Array.isArray(listData.variants)
                ? listData.variants
                : [];
            const datalist = document.getElementById('variant-list');
            if (datalist) {
                datalist.innerHTML = '';
                variants.forEach((v) => {
                    const opt = document.createElement('option');
                    opt.value = v;
                    datalist.appendChild(opt);
                });
            }
        }
    } catch (err) {
        console.error('Error loading variant list:', err);
    }

    // Load base (original) taps
    try {
        const response = await fetch(baseFunscriptUrl);
        if (response.ok) {
            const data = await response.json();
            const actions = extractActionsFromResponse(data, 'original');
            baseTimestamps = (actions || [])
                .filter((a) => a.pos === 100)
                .map((a) => a.at)
                .sort((a, b) => a - b);
            console.log(`Loaded ${baseTimestamps.length} base points.`);
        } else {
            baseTimestamps = [];
        }
    } catch (error) {
        console.error('Error loading base funscript:', error);
        baseTimestamps = [];
    }

    // Load variant taps (if editing a non-original variant)
    variantTimestamps = [];
    if (isEditingVariant()) {
        try {
            const vurl = `${baseFunscriptUrl}?variant=${encodeURIComponent(currentVariant)}`;
            const vresp = await fetch(vurl);
            if (vresp.ok) {
                const vdata = await vresp.json();
                let vactions = extractActionsFromResponse(
                    vdata,
                    currentVariant
                );
                variantTimestamps = (vactions || [])
                    .filter((a) => a.pos === 100)
                    .map((a) => a.at)
                    .sort((a, b) => a - b);
                console.log(
                    `Loaded ${variantTimestamps.length} variant points (${currentVariant}).`
                );
            } else {
                variantTimestamps = [];
            }
        } catch (error) {
            console.error('Error loading variant funscript:', error);
            variantTimestamps = [];
        }
    }

    selectedTimestamps.clear();
    updateCounter();
    drawVisualizer();
}

function setupEventListeners() {
    tapButton.addEventListener('click', handleTap);
    undoButton.addEventListener('click', handleUndo);
    deleteButton.addEventListener('click', handleDeleteSelected);
    saveButton.addEventListener('click', handleSave);

    document.addEventListener('keydown', (e) => {
        const target = e.target;
        const tag =
            target && target.tagName ? target.tagName.toUpperCase() : '';
        const isTextEntry =
            tag === 'INPUT' ||
            tag === 'TEXTAREA' ||
            (target && target.isContentEditable);
        if (e.code === 'Space' && !isTextEntry) {
            e.preventDefault();
            handleTap();
        }
        if ((e.code === 'Delete' || e.code === 'Backspace') && !isTextEntry) {
            e.preventDefault();
            handleDeleteSelected();
        }
    });

    videoElement.addEventListener('play', startEditorRaf);
    videoElement.addEventListener('pause', stopEditorRaf);
    videoElement.addEventListener('seeked', drawVisualizer);
    window.addEventListener('resize', resizeCanvas);

    if (variantInput) {
        variantInput.addEventListener('change', async () => {
            await loadExistingFunscript();
        });
        variantInput.addEventListener('keyup', async (e) => {
            if (e.key === 'Enter') await loadExistingFunscript();
        });
    }

    setupCanvasEventListeners();
}

// Funscript Logic
function updateCounter() {
    const editing = getEditingArray();
    if (isEditingVariant()) {
        actionCounter.textContent = `Taps: ${editing.length} (variant: ${currentVariant}) — Original: ${baseTimestamps.length}`;
    } else {
        actionCounter.textContent = `Taps: ${editing.length}`;
    }
}

function generateFunscriptActionsFromTimestamps(timestamps) {
    if (!timestamps || timestamps.length === 0) return [{ at: 0, pos: 0 }];

    const sortedTaps = [...timestamps].sort((a, b) => a - b);
    let actions = [];
    let lastTime = 0;

    for (const tapTime of sortedTaps) {
        const downTime = Math.round((lastTime + tapTime) / 2);
        if (actions.length > 0 || downTime > 0)
            actions.push({ at: downTime, pos: 0 });
        actions.push({ at: tapTime, pos: 100 });
        lastTime = tapTime;
    }

    actions.push({ at: lastTime + 500, pos: 0 });
    if (actions.length > 0 && actions[0].at > 0)
        actions.unshift({ at: 0, pos: 0 });

    const seen = new Map();
    for (const action of actions) {
        // keep last action for a timestamp (preserves pos changes)
        seen.set(action.at, action);
    }

    return Array.from(seen.values()).sort((a, b) => a.at - b.at);
}

async function handleSave() {
    const editing = getEditingArray();
    const actions = generateFunscriptActionsFromTimestamps(editing);
    if (actions.length < 2) {
        alert('Not enough actions to create a funscript.');
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';
    try {
        const variantVal = variantInput ? variantInput.value.trim() : '';
        const response = await fetch('/api/funscripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_path: videoPath,
                actions,
                variant: variantVal || null
            })
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

// User Actions
function handleTap() {
    const currentTime = Math.round(videoElement.currentTime * 1000);
    const editing = getEditingArray();
    editing.push(currentTime);
    setEditingArray(dedupeAndSort(editing));
    updateCounter();
    drawVisualizer();
}

function handleUndo() {
    const editing = getEditingArray();
    if (editing.length > 0) {
        editing.pop();
        setEditingArray(dedupeAndSort(editing));
        updateCounter();
        drawVisualizer();
    }
}

function handleDeleteSelected() {
    if (selectedTimestamps.size === 0) return;
    const editing = getEditingArray();
    const newEditing = editing.filter((t) => !selectedTimestamps.has(t));
    setEditingArray(dedupeAndSort(newEditing));
    selectedTimestamps.clear();
    updateCounter();
    drawVisualizer();
}

// Canvas Drawing
function startEditorRaf() {
    if (editorAnimationFrame) cancelAnimationFrame(editorAnimationFrame);
    const loop = () => {
        drawVisualizer();
        editorAnimationFrame = requestAnimationFrame(loop);
    };
    editorAnimationFrame = requestAnimationFrame(loop);
}

function stopEditorRaf() {
    if (editorAnimationFrame) {
        cancelAnimationFrame(editorAnimationFrame);
        editorAnimationFrame = null;
    }
}

function drawVisualizer() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const currentTime = videoElement.currentTime * 1000;
    const viewStartMs = Math.max(0, currentTime - VIEW_WINDOW_MS / 2);

    const msToPx = (ms) => ((ms - viewStartMs) / VIEW_WINDOW_MS) * canvas.width;

    // Draw base and editing waveforms
    const baseActions = generateFunscriptActionsFromTimestamps(baseTimestamps);
    const editingActions =
        generateFunscriptActionsFromTimestamps(getEditingArray());

    if (isEditingVariant() && baseActions.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 1;
        baseActions.forEach((action, i) => {
            const x = msToPx(action.at);
            const y =
                canvas.height -
                (action.pos / 100) * (canvas.height * 0.8) -
                canvas.height * 0.1;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    if (editingActions.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#4CAF50';
        ctx.lineWidth = 1;
        editingActions.forEach((action, i) => {
            const x = msToPx(action.at);
            const y =
                canvas.height -
                (action.pos / 100) * (canvas.height * 0.8) -
                canvas.height * 0.1;
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
    }

    // Draw tap points
    if (isEditingVariant()) {
        // base taps - grey, not interactive
        baseTimestamps.forEach((at) => {
            const x = msToPx(at);
            const y = canvas.height * 0.1;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#999';
            ctx.fill();
        });
        // variant taps - interactive
        variantTimestamps.forEach((at) => {
            const x = msToPx(at);
            const y = canvas.height * 0.1;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = selectedTimestamps.has(at) ? 'yellow' : '#f44336';
            ctx.fill();
        });
    } else {
        // editing original - taps are interactive
        baseTimestamps.forEach((at) => {
            const x = msToPx(at);
            const y = canvas.height * 0.1;
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fillStyle = selectedTimestamps.has(at) ? 'yellow' : '#f44336';
            ctx.fill();
        });
    }

    // Draw playhead
    const playheadX = msToPx(currentTime);
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

// Canvas Interactions
function setupCanvasEventListeners() {
    const msToPx = (ms) => {
        const viewStartMs = Math.max(
            0,
            videoElement.currentTime * 1000 - VIEW_WINDOW_MS / 2
        );
        return ((ms - viewStartMs) / VIEW_WINDOW_MS) * canvas.width;
    };
    const pxToMs = (px) => {
        const viewStartMs = Math.max(
            0,
            videoElement.currentTime * 1000 - VIEW_WINDOW_MS / 2
        );
        return Math.round((px / canvas.width) * VIEW_WINDOW_MS + viewStartMs);
    };

    const findPointAt = (px) => {
        const clickMs = pxToMs(px);
        const items = getEditingArray();
        for (const timestamp of items) {
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
            if (selectedArray.length === 0) {
                // nothing selected, ignore
            } else {
                const firstSelected = Math.min(...selectedArray);
                const delta = newTapTime - firstSelected;
                const editing = getEditingArray();
                const newEditing = editing.map((t) =>
                    selectedTimestamps.has(t)
                        ? Math.max(0, Math.round(t + delta))
                        : t
                );
                setEditingArray(dedupeAndSort(newEditing));
                // update selected timestamps to moved positions
                selectedTimestamps = new Set(
                    Array.from(selectedArray).map((t) =>
                        Math.max(0, Math.round(t + delta))
                    )
                );
            }
        } else if (isSelecting) {
            selectionEndPos.x = e.offsetX;
        }
        drawVisualizer();
    });

    canvas.addEventListener('mouseup', () => {
        if (isSelecting) {
            const startMs = pxToMs(
                Math.min(selectionStartPos.x, selectionEndPos.x)
            );
            const endMs = pxToMs(
                Math.max(selectionStartPos.x, selectionEndPos.x)
            );
            const editing = getEditingArray();
            editing.forEach((t) => {
                if (t >= startMs && t <= endMs) selectedTimestamps.add(t);
            });
        }
        isDragging = false;
        isSelecting = false;
        drawVisualizer();
    });
}

function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    drawVisualizer();
}

document.addEventListener('DOMContentLoaded', init);
