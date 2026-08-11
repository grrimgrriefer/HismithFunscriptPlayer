// static/calibration.js

import { sendDeviceCommand } from './socket.js';
import { loadFunscript } from './funscript_handler.js';
import { clamp, toFunscriptPath } from './utils.js';

// ── Constants ──────────────────────────────────────────────────────────
const PRESETS = [10, 20, 30, 40, 50];
const FLASH_DURATION_MS = 220;

const SEND_INTERVAL_MS = 100;
const KEEPALIVE_MS = 1500;

// ── State ──────────────────────────────────────────────────────────────
const calibratedBpms = {};
let bpmMapping = [];

const state = {
    selectedPreset: null,
    running: false,
    sendInterval: null,
    spinnerAnimId: null,
    spinnerAngle: 0,
    spinnerAccum: 0,
    lastTs: null,
    lastSpinCount: 0,
    lastSentIntensity: null,
    lastSendTime: 0,

    audioCtx: null,
    tapTimes: [],
    measuredBpmVal: null
};

const els = {};

// ── Utilities ──────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;

async function loadBpmMapping() {
    try {
        const resp = await fetch('/api/calibration-mapping');
        if (!resp.ok) return;
        const data = await resp.json();
        if (Array.isArray(data)) {
            bpmMapping = data.map((pt) => [
                Number(pt.bpm),
                Number(pt.intensity)
            ]);
        }
    } catch (err) {
        console.error('Failed to load BPM mapping', err);
    }
}

export function intensityToBpm(intensity) {
    const val = clamp(intensity, 0, 100);
    if (bpmMapping.length === 0) return 0.0;
    if (val <= 0) return bpmMapping[0][0];
    if (val >= 100) return bpmMapping[bpmMapping.length - 1][0];

    for (let i = 0; i < bpmMapping.length - 1; i++) {
        const [b0, i0] = bpmMapping[i];
        const [b1, i1] = bpmMapping[i + 1];
        if (val >= i0 && val <= i1) {
            if (i1 === i0) return b0;
            const t = (val - i0) / (i1 - i0);
            return b0 + t * (b1 - b0);
        }
    }
    return 0.0;
}

// ── DOM Initialization ─────────────────────────────────────────────────
const ELEMENT_IDS = {
    presetsContainer: 'preset-buttons',
    spinner: 'calibration-spinner',
    spinnerRotor: 'calibration-rotor',

    startBtn: 'start-button',
    stopBtn: 'stop-button',
    savePointBtn: 'save-point-btn',

    selectedPreset: 'selected-preset',

    sentIntensity: 'sent-intensity',
    theoreticalBpm: 'theoretical-bpm',
    mappingList: 'mapping-list',
    profileSelect: 'profile-select',
    profileName: 'profile-name',
    resetBtn: 'reset-button',
    measuredBpm: 'measured-bpm'
};

function initElements() {
    for (const [key, id] of Object.entries(ELEMENT_IDS)) {
        els[key] = document.getElementById(id);
    }
}

// ── UI Updates ─────────────────────────────────────────────────────────

function updateInfoDisplays() {
    if (!state.selectedPreset) {
        els.selectedPreset.textContent = '—';
        els.sentIntensity.textContent = '—';
        els.theoreticalBpm.textContent = '—';
        return;
    }

    els.selectedPreset.textContent = `${state.selectedPreset}`;
    els.theoreticalBpm.textContent = intensityToBpm(
        state.selectedPreset
    ).toFixed(1);

    const val = state.running ? state.selectedPreset / 100.0 : 0;
    els.sentIntensity.textContent = val.toFixed(2);
}

function renderMappingList() {
    const presetText = PRESETS.map((p) =>
        calibratedBpms[p] === undefined || calibratedBpms[p] === null
            ? `${p}%: (not calibrated)`
            : `${p}%: ${calibratedBpms[p].toFixed(1)} BPM`
    ).join(' | ');

    els.mappingList.innerHTML = presetText;
}

function refreshDisplays() {
    updateInfoDisplays();
    renderMappingList();
    renderMappingGraph();
}

// ── Preset Logic ───────────────────────────────────────────────────────
function selectPreset(preset, btn) {
    state.tapTimes = [];
    state.measuredBpmVal = null;
    els.measuredBpm.textContent = '—';
    els.savePointBtn.disabled = true;

    state.selectedPreset = preset;

    for (const b of els.presetsContainer.children) b.classList.remove('active');
    btn.classList.add('active');

    els.selectedPreset.textContent = `${preset}`;
    els.theoreticalBpm.textContent = intensityToBpm(preset).toFixed(1);

    refreshDisplays();

    if (state.running) {
        sendDeviceCommand(preset / 100.0, 0);
        state.lastSendTime = Date.now();
    }
}

function handleSpinnerTap() {
    resetSpinner(true);

    const now = performance.now();

    state.tapTimes = state.tapTimes.filter((t) => now - t < 3000);
    state.tapTimes.push(now);

    if (state.tapTimes.length < 2) {
        els.measuredBpm.textContent = '—';
        els.savePointBtn.disabled = true;
        state.measuredBpmVal = null;
        return;
    }

    const intervals = [];
    for (let i = 1; i < state.tapTimes.length; i++) {
        intervals.push(state.tapTimes[i] - state.tapTimes[i - 1]);
    }
    const avgIntervalMs =
        intervals.reduce((sum, val) => sum + val, 0) / intervals.length;
    const tappedBpm = 60000 / avgIntervalMs;

    state.measuredBpmVal = tappedBpm;
    els.measuredBpm.textContent = tappedBpm.toFixed(1);

    if (state.selectedPreset) {
        els.savePointBtn.disabled = false;
    }
}

function savePoint() {
    if (!state.selectedPreset || !state.measuredBpmVal) return;

    calibratedBpms[state.selectedPreset] = round2(state.measuredBpmVal);

    state.tapTimes = [];
    state.measuredBpmVal = null;
    els.measuredBpm.textContent = '—';
    els.savePointBtn.disabled = true;

    buildPresetButtons();
    refreshDisplays();

    const activeBpms = {};
    for (const p of PRESETS) {
        if (calibratedBpms[p] !== null && calibratedBpms[p] !== undefined) {
            activeBpms[String(p)] = calibratedBpms[p];
        }
    }
    syncActiveProfileToRust(activeBpms);
}

// ── Audio ──────────────────────────────────────────────────────────────
function ensureAudioContext() {
    if (state.audioCtx) return;
    try {
        state.audioCtx = new (
            window.AudioContext || window.webkitAudioContext
        )();
    } catch (e) {
        console.warn('Web Audio API not available', e);
    }
}

function playClick() {
    if (!state.audioCtx) return;
    const now = state.audioCtx.currentTime;
    const osc = state.audioCtx.createOscillator();
    const gain = state.audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(state.audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
}

function handleFullRotations(count) {
    if (!els.spinner || !els.spinnerRotor) return;
    if (state.audioCtx?.state === 'suspended') state.audioCtx.resume();

    for (let i = 0; i < count; i++) {
        setTimeout(() => {
            playClick();
            if (els.spinner) {
                els.spinner.classList.remove('spinner-flash');
                void els.spinner.offsetWidth; // Trigger reflow
                els.spinner.classList.add('spinner-flash');
            }
        }, i * FLASH_DURATION_MS);
    }
}

// ── Spinner Animation ──────────────────────────────────────────────────

function spinnerFrame(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = (ts - state.lastTs) / 1000.0;
    state.lastTs = ts;

    const targetBpm =
        state.measuredBpmVal && state.measuredBpmVal > 0
            ? state.measuredBpmVal
            : calibratedBpms[state.selectedPreset] &&
                calibratedBpms[state.selectedPreset] > 0
              ? calibratedBpms[state.selectedPreset]
              : state.selectedPreset
                ? intensityToBpm(state.selectedPreset)
                : 0;

    const degDelta = dt * (targetBpm / 60.0) * 360;
    state.spinnerAccum += degDelta;
    state.spinnerAngle = state.spinnerAccum % 360;

    if (els.spinnerRotor) {
        els.spinnerRotor.style.transform = `rotate(${state.spinnerAngle}deg)`;
    }

    const spinCount = Math.floor(state.spinnerAccum / 360);
    if (spinCount > state.lastSpinCount) {
        handleFullRotations(spinCount - state.lastSpinCount);
        state.lastSpinCount = spinCount;
    }

    state.spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

function startSpinner() {
    if (!state.selectedPreset) return;
    if (state.spinnerAnimId) cancelAnimationFrame(state.spinnerAnimId);
    state.lastTs = null;
    state.spinnerAccum = state.spinnerAngle;
    state.lastSpinCount = Math.floor(state.spinnerAccum / 360);
    state.spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

function resetSpinner(flash = true) {
    state.spinnerAccum = 0;
    state.spinnerAngle = 0;
    state.lastSpinCount = 0;
    if (els.spinnerRotor) els.spinnerRotor.style.transform = 'rotate(0deg)';
    state.lastTs = performance.now();
    if (state.running && flash) handleFullRotations(1);
}

// ── Calibration Start/Stop ─────────────────────────────────────────────
function startCalibration() {
    if (!state.selectedPreset || state.running) return;

    ensureAudioContext();
    if (state.audioCtx?.state === 'suspended') state.audioCtx.resume();

    state.running = true;
    state.lastSentIntensity = 0;
    state.lastSendTime = Date.now();

    const intensity = state.selectedPreset / 100.0;
    sendDeviceCommand(intensity, 0);

    updateInfoDisplays();

    if (state.sendInterval) clearInterval(state.sendInterval);
    state.sendInterval = setInterval(sendLoop, SEND_INTERVAL_MS);

    startSpinner();
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
}

function sendLoop() {
    if (!state.running || !state.selectedPreset) return;

    const intensity = state.selectedPreset / 100.0;

    const stale = Date.now() - state.lastSendTime >= KEEPALIVE_MS;

    if (stale) {
        sendDeviceCommand(intensity, 0);

        state.lastSendTime = Date.now();
        updateInfoDisplays();
    }
}

function stopCalibration() {
    if (!state.running) return;
    state.running = false;

    if (state.sendInterval) clearInterval(state.sendInterval);
    state.sendInterval = null;

    if (state.spinnerAnimId) cancelAnimationFrame(state.spinnerAnimId);
    state.spinnerAnimId = null;
    state.lastTs = null;

    sendDeviceCommand(0, 0);
    state.lastSentIntensity = null;
    state.lastSendTime = 0;

    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
}

// ── Profiles ───────────────────────────────────────────────────────────
async function loadProfilesFromServer() {
    try {
        const resp = await fetch('/api/calibration-profiles');
        if (!resp.ok) return;
        const data = await resp.json();
        window.__calibrationProfiles = data || {};

        if (!els.profileSelect) return;
        els.profileSelect.innerHTML = '';

        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '(none)';
        els.profileSelect.appendChild(noneOpt);

        for (const name of Object.keys(data)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            els.profileSelect.appendChild(opt);
        }
    } catch (err) {
        console.error('Failed to load profiles', err);
    }
}

async function saveProfileToServer(name) {
    if (!name) return;
    const payload = {
        name,
        bpms: Object.fromEntries(
            PRESETS.filter(
                (p) =>
                    calibratedBpms[p] !== undefined &&
                    calibratedBpms[p] !== null
            ).map((p) => [String(p), calibratedBpms[p]])
        )
    };

    try {
        const resp = await fetch('/api/calibration-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) return;
        window.__calibrationProfiles = window.__calibrationProfiles || {};
        window.__calibrationProfiles[name] = payload.bpms;
        await loadProfilesFromServer();
        if (els.profileSelect) els.profileSelect.value = name;
    } catch (err) {
        console.error('Failed to save profile', err);
    }
}

function applyProfile(name) {
    const profile = window.__calibrationProfiles?.[name];
    if (!profile) {
        resetBpms();
        syncActiveProfileToRust({});
        return;
    }

    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }

    for (const [pStr, bpmVal] of Object.entries(profile)) {
        const p = Number(pStr);
        if (PRESETS.includes(p)) {
            calibratedBpms[p] = Number(bpmVal);
        }
    }
    buildPresetButtons();

    const activeBpms = {};
    for (const p of PRESETS) {
        if (calibratedBpms[p] !== null && calibratedBpms[p] !== undefined) {
            activeBpms[String(p)] = calibratedBpms[p];
        }
    }
    syncActiveProfileToRust(activeBpms);

    const first = PRESETS.find(
        (p) => calibratedBpms[p] !== undefined && calibratedBpms[p] !== null
    );
    if (first) {
        const btn = els.presetsContainer.querySelector(
            `button[data-preset="${first}"]`
        );
        if (btn) selectPreset(first, btn);
    } else {
        state.selectedPreset = null;
        updateInfoDisplays();
    }
    refreshDisplays();
}

function getProfileName() {
    return els.profileName?.value.trim() || els.profileSelect?.value || '';
}

// ── Preset Buttons ─────────────────────────────────────────────────────
function buildPresetButtons() {
    els.presetsContainer.innerHTML = '';
    for (const p of PRESETS) {
        const btn = document.createElement('button');
        btn.textContent = `${p}%`;
        btn.className = 'preset-btn';
        btn.setAttribute('data-preset', p);

        if (calibratedBpms[p] !== undefined && calibratedBpms[p] !== null) {
            btn.style.border = '2px solid #4CAF50';
        } else {
            btn.style.border = '2px dashed #777';
        }

        if (state.selectedPreset === p) {
            btn.classList.add('active');
        }

        btn.addEventListener('click', () => selectPreset(p, btn));
        els.presetsContainer.appendChild(btn);
    }
}

function resetBpms() {
    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }
    state.tapTimes = [];
    state.measuredBpmVal = null;

    state.selectedPreset = null;
    buildPresetButtons();

    els.selectedPreset.textContent = '—';

    els.sentIntensity.textContent = '—';
    els.theoreticalBpm.textContent = '—';
    els.measuredBpm.textContent = '—';
    els.savePointBtn.disabled = true;
    refreshDisplays();
}

// ── Mapping Graph ──────────────────────────────────────────────────────
function renderMappingGraph() {
    const canvas = document.getElementById('mapping-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = 120;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = `${cssHeight}px`;

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const pad = 12;
    const iRange = 100;
    const bRange = 270;

    const xFor = (i) => pad + (i / iRange) * (cssWidth - pad * 2);
    const yFor = (b) => cssHeight - pad - (b / bRange) * (cssHeight - pad * 2);

    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j <= 4; j++) {
        const x = xFor(j * 25);
        ctx.moveTo(x, pad);
        ctx.lineTo(x, cssHeight - pad);

        const y = yFor(j * 60);
        ctx.moveTo(pad, y);
        ctx.lineTo(cssWidth - pad, y);
    }
    ctx.stroke();

    function drawPolyline(points, lineColor, dotColor) {
        if (points.length === 0) return;

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(xFor(points[0][0]), yFor(points[0][1]));
        for (let i = 1; i < points.length; i++) {
            ctx.lineTo(xFor(points[i][0]), yFor(points[i][1]));
        }
        ctx.stroke();

        for (const pt of points) {
            ctx.beginPath();
            ctx.arc(xFor(pt[0]), yFor(pt[1]), 3, 0, Math.PI * 2);
            ctx.fillStyle = dotColor;
            ctx.fill();
        }
    }

    // 1. Draw Baseline
    const baselinePoints = bpmMapping.map(([bpm, intensity]) => [
        intensity,
        bpm
    ]);
    drawPolyline(baselinePoints, 'rgba(0,200,0,0.95)', '#fff');

    // 2. Draw Calibrated
    const calPoints = getCalibratedPoints(); // [[bpm, intensity], ...]
    const plottedCalPoints = calPoints.map(([bpm, intensity]) => [
        intensity,
        bpm
    ]);
    if (plottedCalPoints.length > 1) {
        drawPolyline(
            plottedCalPoints,
            'rgba(255,140,0,0.95)',
            'rgba(255,140,0,0.95)'
        );
    }

    // Labels
    ctx.fillStyle = '#ddd';
    ctx.font = '10px sans-serif';
    ctx.fillText('0%', pad, cssHeight - 2);
    ctx.fillText('100%', cssWidth - pad - 24, cssHeight - 2);
    ctx.fillText('Intensity →', cssWidth / 2 - 30, cssHeight - 2);

    ctx.save();
    ctx.translate(6, cssHeight / 2 + 15);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BPM', 0, 0);
    ctx.restore();

    // Legend
    const legendLeft = cssWidth - pad - 120;
    const legendTop = 12;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,200,0,0.95)';
    ctx.fillRect(legendLeft, legendTop, 8, 8);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Baseline', legendLeft + 12, legendTop + 4);
    ctx.fillStyle = 'rgba(255,140,0,0.95)';
    ctx.fillRect(legendLeft + 60, legendTop, 8, 8);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Calibrated', legendLeft + 72, legendTop + 4);
    ctx.textBaseline = 'alphabetic';
}

function getCalibratedPoints() {
    const points = [[0.0, 0.0]]; // 0 BPM maps to 0% intensity

    const activePresets = PRESETS.filter(
        (p) =>
            calibratedBpms[p] !== undefined &&
            calibratedBpms[p] !== null &&
            calibratedBpms[p] > 0
    );

    for (const p of activePresets) {
        points.push([calibratedBpms[p], Number(p)]);
    }

    points.sort((a, b) => a[0] - b[0]);
    return points;
}

// ── Public API ─────────────────────────────────────────────────────────

function getCurrentVideoBaseUrl() {
    const videoEl = document.querySelector('#video-player video');
    if (!videoEl?.src) return null;
    const url = new URL(videoEl.src, window.location.origin);
    const match = url.pathname.match(/\/site\/video\/(.+)/);
    return match ? `/site/funscripts/${toFunscriptPath(match[1])}` : null;
}

async function reloadActiveFunscript() {
    const baseUrl = getCurrentVideoBaseUrl();
    if (baseUrl) {
        await loadFunscript(baseUrl);
    }
}

export async function syncActiveProfileToRust(bpms) {
    try {
        await fetch('/api/calibration-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bpms })
        });
        await reloadActiveFunscript();
    } catch (err) {
        console.error('Failed to sync active profile to server', err);
    }
}

export async function saveOnClose() {
    const name = getProfileName();
    if (name) {
        await saveProfileToServer(name);
    }
}

export async function setup() {
    initElements();

    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }

    buildPresetButtons();
    renderMappingList();

    await loadBpmMapping();

    loadProfilesFromServer().then(() => {
        if (els.profileSelect && els.profileSelect.value) {
            applyProfile(els.profileSelect.value);
        }
    });

    els.startBtn.addEventListener('click', startCalibration);
    els.stopBtn.addEventListener('click', stopCalibration);
    els.resetBtn.addEventListener('click', () => {
        state.tapTimes = [];
        state.measuredBpmVal = null;
        els.measuredBpm.textContent = '—';
        els.savePointBtn.disabled = true;
    });

    els.savePointBtn.addEventListener('click', savePoint);

    els.spinner.addEventListener('click', handleSpinnerTap);
    els.spinner.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Spacebar') {
            e.preventDefault();
            handleSpinnerTap();
        }
    });

    els.profileSelect.addEventListener('change', () => {
        applyProfile(els.profileSelect.value);
    });

    els.profileName.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
            const name = els.profileName.value.trim();
            if (name) {
                saveProfileToServer(name).then(() => {
                    els.profileName.value = '';
                });
            }
        }
    });

    els.stopBtn.disabled = true;
    els.startBtn.disabled = false;
    els.savePointBtn.disabled = true;
    els.selectedPreset.textContent = '—';

    els.sentIntensity.textContent = '—';
    els.theoreticalBpm.textContent = '—';
    els.measuredBpm.textContent = '—';
    refreshDisplays();
}
