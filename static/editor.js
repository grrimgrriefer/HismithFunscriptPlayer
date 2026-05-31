// static/editor.js

// ── Constants ──────────────────────────────────────────────────────────

const VIEW_WINDOW_MS = 10000;
const CLICK_RADIUS_MS = 100;

// ── DOM Elements ───────────────────────────────────────────────────────

const video = document.getElementById('editor-video');
const canvas = document.getElementById('editor-canvas');
const ctx = canvas.getContext('2d');
const tapBtn = document.getElementById('tap-button');
const undoBtn = document.getElementById('undo-button');
const deleteBtn = document.getElementById('delete-button');
const saveBtn = document.getElementById('save-button');
const counter = document.getElementById('action-counter');
const variantInput = document.getElementById('variant-input');
const variantList = document.getElementById('variant-list');

// ── State ──────────────────────────────────────────────────────────────

const state = {
    base: [],
    variant: [],
    currentVariant: '',
    selected: new Set(),
    videoPath: '',
    raf: null,
    dragging: false,
    selecting: false,
    selectionStartX: 0,
    selectionEndX: 0,
    dragOffsetMs: 0
};

// ── Utilities ──────────────────────────────────────────────────────────

const isEditingVariant = () =>
    state.currentVariant &&
    state.currentVariant !== '' &&
    state.currentVariant !== 'original';

const getEditingArray = () => (isEditingVariant() ? state.variant : state.base);

const setEditingArray = (arr) => {
    if (isEditingVariant()) state.variant = arr;
    else state.base = arr;
};

const dedupeAndSort = (arr) => Array.from(new Set(arr)).sort((a, b) => a - b);

async function fetchJson(url) {
    try {
        const resp = await fetch(url);
        if (!resp.ok) return undefined;
        return await resp.json();
    } catch (e) {
        console.error(e);
        return undefined;
    }
}

function extractActionsFromResponse(data, variantName) {
    if (!data) return [];
    if (variantName && data[variantName]?.actions)
        return data[variantName].actions;
    if (data.original?.actions) return data.original.actions;
    if (Array.isArray(data.actions)) return data.actions;
    return [];
}

function getViewStartMs() {
    return Math.max(0, video.currentTime * 1000 - VIEW_WINDOW_MS / 2);
}

function msToPx(ms) {
    return ((ms - getViewStartMs()) / VIEW_WINDOW_MS) * canvas.width;
}

function pxToMs(px) {
    return Math.round((px / canvas.width) * VIEW_WINDOW_MS + getViewStartMs());
}

// ── Funscript Generation ───────────────────────────────────────────────

function generateFunscriptActions(timestamps) {
    if (!timestamps || timestamps.length === 0) return [{ at: 0, pos: 0 }];

    const sorted = [...timestamps].sort((a, b) => a - b);
    const actions = [];
    let last = 0;

    for (const t of sorted) {
        const down = Math.round((last + t) / 2);
        if (actions.length > 0 || down > 0) actions.push({ at: down, pos: 0 });
        actions.push({ at: t, pos: 100 });
        last = t;
    }

    actions.push({ at: last + 500, pos: 0 });
    if (actions[0]?.at > 0) actions.unshift({ at: 0, pos: 0 });

    // Dedupe by timestamp
    const seen = new Map();
    for (const a of actions) seen.set(a.at, a);
    return Array.from(seen.values()).sort((a, b) => a.at - b.at);
}

// ── Data Loading ───────────────────────────────────────────────────────

async function loadFunscript() {
    state.currentVariant = variantInput?.value.trim() ?? '';
    const baseUrl = `/site/funscripts/${state.videoPath.replace(/\.[^/.]+$/, '.funscript')}`;

    // Variant list
    const listData = await fetchJson(`${baseUrl}?list=1`);
    if (listData?.variants && variantList) {
        variantList.innerHTML = '';
        for (const v of listData.variants) {
            const opt = document.createElement('option');
            opt.value = v;
            variantList.appendChild(opt);
        }
    }

    // Base actions
    const baseData = await fetchJson(baseUrl);
    state.base = (extractActionsFromResponse(baseData, 'original') || [])
        .filter((a) => a.pos === 100)
        .map((a) => a.at)
        .sort((a, b) => a - b);

    // Variant actions
    state.variant = [];
    if (isEditingVariant()) {
        const vdata = await fetchJson(
            `${baseUrl}?variant=${encodeURIComponent(state.currentVariant)}`
        );
        state.variant = (
            extractActionsFromResponse(vdata, state.currentVariant) || []
        )
            .filter((a) => a.pos === 100)
            .map((a) => a.at)
            .sort((a, b) => a - b);
    }

    state.selected.clear();
    updateCounter();
    draw();
}

// ── UI Updates ─────────────────────────────────────────────────────────

function updateCounter() {
    const editing = getEditingArray();
    counter.textContent = isEditingVariant()
        ? `Taps: ${editing.length} (variant: ${state.currentVariant}) — Original: ${state.base.length}`
        : `Taps: ${editing.length}`;
}

// ── Actions ────────────────────────────────────────────────────────────

function handleTap() {
    const now = Math.round(video.currentTime * 1000);
    const editing = getEditingArray();
    editing.push(now);
    setEditingArray(dedupeAndSort(editing));
    updateCounter();
    draw();
}

function handleUndo() {
    const editing = getEditingArray();
    if (editing.length === 0) return;
    editing.pop();
    setEditingArray(dedupeAndSort(editing));
    updateCounter();
    draw();
}

function handleDeleteSelected() {
    if (state.selected.size === 0) return;
    const editing = getEditingArray();
    setEditingArray(
        dedupeAndSort(editing.filter((t) => !state.selected.has(t)))
    );
    state.selected.clear();
    updateCounter();
    draw();
}

async function handleSave() {
    const actions = generateFunscriptActions(getEditingArray());
    if (actions.length < 2) {
        alert('Not enough actions to create a funscript.');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
        const variantVal = variantInput?.value.trim() ?? '';
        const res = await fetch('/api/funscripts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                video_path: state.videoPath,
                actions,
                variant: variantVal || null
            })
        });
        if (!res.ok) throw new Error(`Failed to save: ${await res.text()}`);
        alert('Funscript saved successfully!');
        window.location.reload();
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Funscript';
    }
}

// ── Drawing ────────────────────────────────────────────────────────────

function drawWave(actions, color = '#4CAF50') {
    if (!actions || actions.length === 0) return;

    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;

    for (let i = 0; i < actions.length; i++) {
        const x = msToPx(actions[i].at);
        const y =
            canvas.height -
            (actions[i].pos / 100) * (canvas.height * 0.8) -
            canvas.height * 0.1;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }

    ctx.stroke();
}

function drawTaps(list, interactive) {
    const y = canvas.height * 0.1;

    for (const at of list) {
        ctx.beginPath();
        ctx.arc(msToPx(at), y, 5, 0, Math.PI * 2);
        ctx.fillStyle = state.selected.has(at)
            ? 'yellow'
            : interactive
              ? '#f44336'
              : '#999';
        ctx.fill();
    }
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentTimeMs = video.currentTime * 1000;

    const baseActions = generateFunscriptActions(state.base);
    const editingActions = generateFunscriptActions(getEditingArray());

    if (isEditingVariant() && baseActions.length > 0)
        drawWave(baseActions, '#777');
    if (editingActions.length > 0) drawWave(editingActions, '#4CAF50');

    if (isEditingVariant()) {
        drawTaps(state.base, false);
        drawTaps(state.variant, true);
    } else {
        drawTaps(state.base, true);
    }

    // Playhead
    const playX = msToPx(currentTimeMs);
    ctx.beginPath();
    ctx.moveTo(playX, 0);
    ctx.lineTo(playX, canvas.height);
    ctx.strokeStyle = 'red';
    ctx.stroke();

    // Selection box
    if (state.selecting) {
        const rx = Math.min(state.selectionStartX, state.selectionEndX);
        const rw = Math.abs(state.selectionStartX - state.selectionEndX);
        ctx.fillStyle = 'rgba(0, 150, 255, 0.2)';
        ctx.fillRect(rx, 0, rw, canvas.height);
    }
}

// ── Animation Frame ────────────────────────────────────────────────────

function startRaf() {
    if (state.raf) cancelAnimationFrame(state.raf);
    const loop = () => {
        draw();
        state.raf = requestAnimationFrame(loop);
    };
    state.raf = requestAnimationFrame(loop);
}

function stopRaf() {
    if (state.raf) cancelAnimationFrame(state.raf);
    state.raf = null;
}

// ── Canvas Interaction ─────────────────────────────────────────────────

function findPointAt(px) {
    const clickMs = pxToMs(px);
    for (const t of getEditingArray()) {
        if (Math.abs(t - clickMs) < CLICK_RADIUS_MS) return t;
    }
    return null;
}

function setupCanvasEvents() {
    canvas.addEventListener('mousedown', (e) => {
        const hit = findPointAt(e.offsetX);

        if (hit !== null) {
            state.dragging = true;
            state.dragOffsetMs = pxToMs(e.offsetX) - hit;
            if (!state.selected.has(hit)) {
                if (!e.ctrlKey && !e.metaKey) state.selected.clear();
                state.selected.add(hit);
            }
        } else {
            state.selecting = true;
            if (!e.ctrlKey && !e.metaKey) state.selected.clear();
            state.selectionStartX = e.offsetX;
            state.selectionEndX = e.offsetX;
        }

        draw();
    });

    canvas.addEventListener('mousemove', (e) => {
        if (state.dragging) {
            const newTapTime = pxToMs(e.offsetX) - state.dragOffsetMs;
            const selectedArray = Array.from(state.selected);

            if (selectedArray.length > 0) {
                const first = Math.min(...selectedArray);
                const delta = newTapTime - first;
                const editing = getEditingArray();
                const moved = editing.map((t) =>
                    state.selected.has(t)
                        ? Math.max(0, Math.round(t + delta))
                        : t
                );
                setEditingArray(dedupeAndSort(moved));
                state.selected = new Set(
                    selectedArray.map((t) => Math.max(0, Math.round(t + delta)))
                );
            }
        } else if (state.selecting) {
            state.selectionEndX = e.offsetX;
        }

        draw();
    });

    canvas.addEventListener('mouseup', () => {
        if (state.selecting) {
            const startMs = pxToMs(
                Math.min(state.selectionStartX, state.selectionEndX)
            );
            const endMs = pxToMs(
                Math.max(state.selectionStartX, state.selectionEndX)
            );

            for (const t of getEditingArray()) {
                if (t >= startMs && t <= endMs) state.selected.add(t);
            }
        }

        state.dragging = false;
        state.selecting = false;
        draw();
    });
}

// ── Event Binding ──────────────────────────────────────────────────────

function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    draw();
}

function isTextInput(target) {
    const tag = target?.tagName?.toUpperCase() ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
}

function bind() {
    tapBtn.addEventListener('click', handleTap);
    undoBtn.addEventListener('click', handleUndo);
    deleteBtn.addEventListener('click', handleDeleteSelected);
    saveBtn.addEventListener('click', handleSave);

    document.addEventListener('keydown', (e) => {
        if (isTextInput(e.target)) return;

        if (e.code === 'Space') {
            e.preventDefault();
            handleTap();
        } else if (e.code === 'Delete' || e.code === 'Backspace') {
            e.preventDefault();
            handleDeleteSelected();
        }
    });

    video.addEventListener('play', startRaf);
    video.addEventListener('pause', stopRaf);
    video.addEventListener('seeked', draw);
    window.addEventListener('resize', resizeCanvas);

    if (variantInput) {
        variantInput.addEventListener('change', loadFunscript);
        variantInput.addEventListener('keyup', (e) => {
            if (e.key === 'Enter') loadFunscript();
        });
    }

    setupCanvasEvents();
}

// ── Init ───────────────────────────────────────────────────────────────

async function init() {
    const params = new URLSearchParams(window.location.search);
    state.videoPath = params.get('video');

    if (!state.videoPath) {
        document.body.innerHTML = '<h1>Error: No video specified.</h1>';
        return;
    }

    if (params.get('variant') && variantInput) {
        variantInput.value = params.get('variant');
    }

    video.src = `/site/video/${state.videoPath}`;
    await loadFunscript();
    bind();
    resizeCanvas();
    draw();
}

document.addEventListener('DOMContentLoaded', init);
