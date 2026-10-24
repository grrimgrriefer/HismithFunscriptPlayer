// static/editor.js

import {
    toVideoUrl,
    toFunscriptUrl,
    intensityToColor,
    volatilityToColor,
    formatDuration,
    isTextInput
} from './utils.js';
import { showTemporaryOverlayMessage } from './utils_ui.js';

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
    baseTapsMs: [],
    variant: [],
    currentVariant: '',
    selected: new Set(),
    videoPath: '',
    raf: null,
    dragging: false,
    selecting: false,
    selectionStartX: 0,
    selectionEndX: 0,
    dragOffsetMs: 0,
    calcDebounceTimer: null,
    baseActions: [],
    editingActions: [],
    pendingVolatilityData: null
};

// ── Utilities ──────────────────────────────────────────────────────────

const isEditingVariant = () =>
    state.currentVariant &&
    state.currentVariant !== '' &&
    state.currentVariant !== 'original';

const getEditingArray = () =>
    isEditingVariant() ? state.variant : state.baseTapsMs;

const setEditingArray = (arr) => {
    if (isEditingVariant()) state.variant = arr;
    else state.baseTapsMs = arr;
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

// ── Data Loading ───────────────────────────────────────────────────────

async function loadFunscript() {
    state.currentVariant = variantInput?.value.trim() ?? '';
    const baseUrl = toFunscriptUrl(state.videoPath);

    const listData = await fetchJson(`${baseUrl}?list=1`);
    if (listData?.variants && variantList) {
        variantList.innerHTML = '';
        for (const v of listData.variants) {
            const opt = document.createElement('option');
            opt.value = v;
            variantList.appendChild(opt);
        }
    }

    const baseData = await fetchJson(baseUrl);
    state.baseTapsMs = (extractActionsFromResponse(baseData, 'original') || [])
        .filter((a) => a.pos === 100)
        .map((a) => a.at)
        .sort((a, b) => a - b);

    const baseStats = await fetchDraftIntensity(state.baseTapsMs);
    state.baseActions = baseStats?.actions || [];

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

        const variantStats = await fetchDraftIntensity(state.variant);
        applyIntensityStats(variantStats);
    } else {
        applyIntensityStats(baseStats);
    }

    state.selected.clear();
    updateCounter(false);
    draw();
}

// ── Unified Intensity Draft API Helper ─────────────────────────────────

async function fetchDraftIntensity(taps) {
    try {
        const res = await fetch('/api/funscripts/calculate-draft-intensity', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ taps })
        });
        if (!res.ok) return null;
        return await res.json();
    } catch (e) {
        console.error('Failed to calculate draft intensity:', e);
        return null;
    }
}

function applyIntensityStats(stats) {
    const s = stats || {
        peak: 0,
        average: 0,
        volatility: 0,
        actions: [],
        sections: []
    };
    state.editingActions = s.actions || [];

    const peakEl = document.getElementById('editor-peak-val');
    const avgEl = document.getElementById('editor-avg-val');

    if (peakEl) {
        peakEl.textContent = Math.round(s.peak || 0);
        peakEl.style.color = intensityToColor(s.peak || 0);
    }
    if (avgEl) {
        avgEl.textContent = Math.round(s.average || 0);
        avgEl.style.color = intensityToColor(s.average || 0);
    }

    state.pendingVolatilityData = {
        volatility: s.volatility || 0,
        sections: s.sections || []
    };

    if (video.paused) {
        applyVolatilityUI();
    }

    draw();
}

// ── UI Updates ─────────────────────────────────────────────────────────

function updateCounter(triggerFetch = true) {
    const editing = getEditingArray();
    counter.textContent = isEditingVariant()
        ? `Taps: ${editing.length} (variant: ${state.currentVariant}) — Original: ${state.baseTapsMs.length}`
        : `Taps: ${editing.length}`;

    if (triggerFetch) {
        clearTimeout(state.calcDebounceTimer);
        state.calcDebounceTimer = setTimeout(async () => {
            applyIntensityStats(await fetchDraftIntensity(editing));
        }, 150);
    }
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
    const taps = getEditingArray();
    if (taps.length < 1) {
        showTemporaryOverlayMessage('Not enough taps to create a funscript.');
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
                taps,
                variant: variantVal || null
            })
        });
        if (!res.ok) throw new Error(`Failed to save: ${await res.text()}`);
        showTemporaryOverlayMessage('Funscript saved successfully!');
        window.location.reload();
    } catch (err) {
        console.error(err);
        alert(err.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Funscript';
    }
}

// ── Volatility heatmap──────────────────────────────────────────────────

function updateActiveSectionHighlight(currentTimeSec) {
    if (!state.pendingVolatilityData?.sections) return;
    const sections = state.pendingVolatilityData.sections;

    let activeIdx = -1;
    sections.forEach((sec, idx) => {
        if (currentTimeSec >= sec.start && currentTimeSec < sec.end) {
            activeIdx = idx;
        }
    });

    const heatmap = document.getElementById('volatility-heatmap');
    if (heatmap) {
        Array.from(heatmap.children).forEach((child, idx) => {
            child.classList.toggle('active', idx === activeIdx);
        });
    }

    const listEl = document.getElementById('volatility-sections-list');
    if (listEl) {
        Array.from(listEl.children).forEach((child, idx) => {
            const isActive = idx === activeIdx;
            child.classList.toggle('active', isActive);
        });
    }

    const activeTextEl = document.getElementById('active-sec-text');
    if (activeTextEl) {
        if (activeIdx >= 0) {
            const sec = sections[activeIdx];
            activeTextEl.innerHTML =
                `<strong style="color:var(--accent-yellow)">#${activeIdx + 1}</strong> ` +
                `(${formatDuration(sec.start)}–${formatDuration(sec.end)}, ` +
                `Duration: <strong>${sec.duration.toFixed(1)}s</strong>, ` +
                `🌡️ Avg: <strong>${Math.round(sec.mean_intensity)}</strong>, ` +
                `🔺 Peak: <strong>${Math.round(sec.peak_intensity)}</strong>)`;
        } else {
            activeTextEl.textContent = '—';
        }
    }
}

function applyVolatilityUI() {
    if (!state.pendingVolatilityData) return;
    const { volatility, sections } = state.pendingVolatilityData;

    const volEl = document.getElementById('editor-vol-val');
    const heatmapEl = document.getElementById('volatility-heatmap');
    const statusEl = document.getElementById('volatility-status');
    const sectionsCountEl = document.getElementById('editor-sections-count');
    const sectionsListEl = document.getElementById('volatility-sections-list');

    if (volEl) {
        volEl.textContent = Number(volatility || 0).toFixed(1);
        volEl.style.color = volatilityToColor(volatility || 0);
    }

    if (statusEl) {
        statusEl.textContent = video.paused
            ? '(updated)'
            : '(updates when paused)';
    }

    if (sectionsCountEl) {
        sectionsCountEl.textContent = sections ? sections.length : 0;
    }

    if (heatmapEl) heatmapEl.innerHTML = '';
    if (sectionsListEl) sectionsListEl.innerHTML = '';

    if (!sections || sections.length === 0) return;

    const totalDuration = sections.reduce((acc, s) => acc + s.duration, 0);
    if (totalDuration <= 0) return;

    sections.forEach((sec, idx) => {
        const div = document.createElement('div');
        div.className = 'heatmap-section';
        const pct = (sec.duration / totalDuration) * 100;
        div.style.width = `${pct.toFixed(2)}%`;
        div.style.backgroundColor = intensityToColor(sec.mean_intensity);

        const titleText = `Section #${idx + 1}: ${formatDuration(sec.start)} – ${formatDuration(sec.end)}\nDuration: ${sec.duration.toFixed(1)}s\n🌡️ Avg: ${Math.round(sec.mean_intensity)} | 🔺 Peak: ${Math.round(sec.peak_intensity)}`;
        div.setAttribute('title', titleText);
        div.onclick = () => {
            video.currentTime = sec.start;
            draw();
        };

        if (heatmapEl) heatmapEl.appendChild(div);

        if (sectionsListEl) {
            const item = document.createElement('div');
            item.className = 'section-item';
            const avgColor = intensityToColor(sec.mean_intensity);
            const peakColor = intensityToColor(sec.peak_intensity);

            item.innerHTML = `
                <div>
                    <span class="section-badge" style="background-color: ${avgColor}"></span>
                    <strong>#${idx + 1}</strong> (${formatDuration(sec.start)} - ${formatDuration(sec.end)})
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <span style="color: #bbb;">⏱ ${sec.duration.toFixed(1)}s</span>
                    <span style="color: ${avgColor}; font-weight: bold;">🌡️ Avg ${Math.round(sec.mean_intensity)}</span>
                    <span style="color: ${peakColor}; font-weight: bold;">🔺 Peak ${Math.round(sec.peak_intensity)}</span>
                </div>
            `;
            item.onclick = () => {
                video.currentTime = sec.start;
                draw();
            };
            sectionsListEl.appendChild(item);
        }
    });

    updateActiveSectionHighlight(video.currentTime);
}

// ── Section Peak Detection ─────────────────────────────────────────────

/**
 * Finds the two consecutive taps with the shortest interval (highest BPM/intensity)
 * belonging to the given section.
 */
function getSectionPeakTaps(section, taps) {
    if (!taps || taps.length < 2) return null;

    const secStartMs = section.start * 1000;
    const secEndMs = section.end * 1000;

    let bestPair = null;
    let minInterval = Infinity;

    for (let i = 0; i < taps.length - 1; i++) {
        const t1 = taps[i];
        const t2 = taps[i + 1];
        const interval = t2 - t1;
        if (interval <= 0) continue;

        // Pair belongs to this section if its midpoint is within bounds
        // or both taps fall inside the section range
        const mid = (t1 + t2) / 2;
        const inside =
            (mid >= secStartMs && mid <= secEndMs) ||
            (t1 >= secStartMs - 50 && t2 <= secEndMs + 50);

        if (inside && interval < minInterval) {
            minInterval = interval;
            bestPair = {
                t1,
                t2,
                interval,
                bpm: Math.round(60000 / interval)
            };
        }
    }

    // Fallback if no pair midpoint fell strictly inside
    if (!bestPair) {
        for (let i = 0; i < taps.length; i++) {
            if (taps[i] >= secStartMs && taps[i] <= secEndMs) {
                if (i > 0 && taps[i] - taps[i - 1] < minInterval) {
                    const intv = taps[i] - taps[i - 1];
                    minInterval = intv;
                    bestPair = {
                        t1: taps[i - 1],
                        t2: taps[i],
                        interval: intv,
                        bpm: Math.round(60000 / intv)
                    };
                }
                if (
                    i < taps.length - 1 &&
                    taps[i + 1] - taps[i] < minInterval
                ) {
                    const intv = taps[i + 1] - taps[i];
                    minInterval = intv;
                    bestPair = {
                        t1: taps[i],
                        t2: taps[i + 1],
                        interval: intv,
                        bpm: Math.round(60000 / intv)
                    };
                }
            }
        }
    }

    return bestPair;
}

/**
 * Renders the peak caliper bracket, badge, and glowing rings for each visible section.
 */
function drawSectionPeakIndicators() {
    if (!state.pendingVolatilityData?.sections) return;
    const sections = state.pendingVolatilityData.sections;
    const taps = getEditingArray();
    if (!taps || taps.length < 2) return;

    const viewStartMs = getViewStartMs();
    const viewEndMs = viewStartMs + VIEW_WINDOW_MS;
    const yDot = canvas.height * 0.1;

    sections.forEach((sec) => {
        const secStartMs = sec.start * 1000;
        const secEndMs = sec.end * 1000;
        if (secEndMs < viewStartMs || secStartMs > viewEndMs) return;

        const peak = getSectionPeakTaps(sec, taps);
        if (!peak) return;

        const x1 = msToPx(peak.t1);
        const x2 = msToPx(peak.t2);

        // Skip if outside canvas viewport
        if (Math.max(x1, x2) < -80 || Math.min(x1, x2) > canvas.width + 80)
            return;

        const xMid = (x1 + x2) / 2;

        ctx.save();

        // 1. Faint vertical column over the peak stroke
        ctx.fillStyle = 'rgba(0, 229, 255, 0.07)';
        ctx.fillRect(
            x1,
            yDot - 14,
            Math.max(2, x2 - x1),
            canvas.height - yDot + 14
        );

        // 2. Caliper bracket line connecting the two dots
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(x1, yDot - 3);
        ctx.lineTo(x1, yDot - 11);
        ctx.lineTo(x2, yDot - 11);
        ctx.lineTo(x2, yDot - 3);
        ctx.stroke();

        // 3. Peak Pill Badge
        const peakVal = Math.round(sec.peak_intensity || 0);
        const label = peakVal > 0 ? `▲ PEAK ${peakVal}` : '▲ PEAK';
        ctx.font = 'bold 9px sans-serif';
        const metrics = ctx.measureText(label);
        const badgeW = metrics.width + 8;
        const badgeH = 13;
        const badgeX = xMid - badgeW / 2;
        const badgeY = Math.max(1, yDot - 25);

        ctx.fillStyle = 'rgba(20, 25, 30, 0.9)';
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 3);
        } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#00e5ff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, xMid, badgeY + badgeH / 2);

        // 4. Outer glowing halo rings around each dot
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.arc(x1, yDot, 8.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(x2, yDot, 8.5, 0, Math.PI * 2);
        ctx.stroke();

        ctx.restore();
    });
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

function drawSectionsOnCanvas() {
    if (!state.pendingVolatilityData?.sections) return;
    const sections = state.pendingVolatilityData.sections;
    const viewStartMs = getViewStartMs();
    const viewEndMs = viewStartMs + VIEW_WINDOW_MS;

    sections.forEach((sec, idx) => {
        const secStartMs = sec.start * 1000;
        const secEndMs = sec.end * 1000;

        if (secEndMs < viewStartMs || secStartMs > viewEndMs) return;

        const xStart = Math.max(0, msToPx(secStartMs));
        const xEnd = Math.min(canvas.width, msToPx(secEndMs));
        const width = xEnd - xStart;

        if (width <= 0) return;

        // Section background tint
        ctx.save();
        ctx.fillStyle = intensityToColor(sec.mean_intensity);
        ctx.globalAlpha = 0.12;
        ctx.fillRect(xStart, 0, width, canvas.height);
        ctx.restore();

        // Section start line
        const lineX = msToPx(secStartMs);
        if (lineX >= 0 && lineX <= canvas.width) {
            ctx.save();
            ctx.setLineDash([4, 4]);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(lineX, 0);
            ctx.lineTo(lineX, canvas.height);
            ctx.stroke();
            ctx.restore();
        }

        // Section label tag at the top of the canvas
        const labelX = Math.max(lineX + 4, xStart + 4);
        if (labelX < xEnd - 20) {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.font = '10px sans-serif';
            ctx.fillText(
                `Sec #${idx + 1} (🌡️ Avg ${Math.round(sec.mean_intensity)}, 🔺 Peak ${Math.round(sec.peak_intensity)})`,
                labelX,
                14
            );
            ctx.restore();
        }
    });
}

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const currentTimeMs = video.currentTime * 1000;

    // Draw Section Background Tints & Boundaries on the Canvas
    drawSectionsOnCanvas();

    if (isEditingVariant() && state.baseActions && state.baseActions.length > 0)
        drawWave(state.baseActions, '#666');
    if (state.editingActions && state.editingActions.length > 0)
        drawWave(state.editingActions, '#4CAF50');

    // Draw the peak caliper brackets and halo indicators
    drawSectionPeakIndicators();

    if (isEditingVariant()) {
        drawTaps(state.baseTapsMs, false);
        drawTaps(state.variant, true);
    } else {
        drawTaps(state.baseTapsMs, true);
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
        ctx.fillStyle = 'rgba(255, 255, 0, 0.2)';
        ctx.fillRect(
            Math.min(state.selectionStartX, state.selectionEndX),
            0,
            Math.abs(state.selectionEndX - state.selectionStartX),
            canvas.height
        );
    }

    // Synchronize active section highlights on minimap & UI
    updateActiveSectionHighlight(video.currentTime);
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
            updateCounter();
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
        updateCounter();
        draw();
    });
}

// ── Event Binding ──────────────────────────────────────────────────────

function resizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    draw();
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
    video.addEventListener('pause', () => {
        stopRaf();
        applyVolatilityUI();
    });
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

    // Decode all URL percent-encoding to get the raw path
    const decodedPath = decodeURIComponent(state.videoPath);

    if (decodedPath.includes(' ') || state.videoPath.includes('%20')) {
        showTemporaryOverlayMessage(
            `WARNING: Video files with spaces in the path are not supported.\n\n` +
                `[${decodedPath}]`,
            8000
        );
    }

    if (params.get('variant') && variantInput) {
        variantInput.value = params.get('variant');
    }

    video.src = toVideoUrl(state.videoPath);
    await loadFunscript();
    bind();
    resizeCanvas();
    draw();
}

document.addEventListener('DOMContentLoaded', init);
