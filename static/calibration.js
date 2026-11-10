// static/calibration.js

import { sendDeviceCommand } from './socket.js';
import { loadFunscript } from './funscript_handler.js';
import { clamp, getCurrentFunscriptUrl, addPressListener } from './utils.js';

// ── Constants ──────────────────────────────────────────────────────────
const PRESETS = [10, 20, 30, 40, 50];
const FLASH_DURATION_MS = 220;

const SEND_INTERVAL_MS = 100;
const KEEPALIVE_MS = 1500;
const ACTIVE_PROFILE_KEY = 'activeCalibrationProfile';

// ── State ──────────────────────────────────────────────────────────────
const calibratedBpms = {};
let bpmMapping = [];
let bpmLut = {};
let calibrationProfiles = {};
let listenersBound = false;

const state = {
    selectedPreset: null,
    running: false,
    sendInterval: null,
    spinnerAnimId: null,
    spinnerAngle: 0,
    spinnerAccum: 0,
    lastTs: null,
    lastSpinCount: 0,
    lastSendTime: 0,

    audioCtx: null,
    tapTimes: [],
    measuredBpmVal: null
};

const els = {};

// ── Utilities (Requirement 2: Whole BPM values) ────────────────────────
const roundBpm = (v) => Math.round(Number(v) || 0);

async function loadBpmMapping() {
    try {
        const resp = await fetch('/api/calibration-mapping');
        if (!resp.ok) return;
        const data = await resp.json();
        if (data && Array.isArray(data.points)) {
            bpmMapping = data.points.map((pt) => [
                roundBpm(pt.bpm),
                Number(pt.intensity)
            ]);
        }
        if (data && data.lut) {
            bpmLut = data.lut;
        }
    } catch (err) {
        console.error('Failed to load BPM mapping', err);
    }
}

function intensityToBpm(intensity) {
    const val = Math.round(clamp(intensity, 0, 100));
    return roundBpm(bpmLut[String(val)] ?? 0.0);
}

// ── Active Profile State Management (Requirement 5) ───────────────────
export function getActiveProfileName() {
    return localStorage.getItem(ACTIVE_PROFILE_KEY) || '';
}

export function setActiveProfileName(name) {
    if (name) {
        localStorage.setItem(ACTIVE_PROFILE_KEY, name);
    } else {
        localStorage.removeItem(ACTIVE_PROFILE_KEY);
    }
    updateSettingsActiveProfileDisplay();
}

export function updateSettingsActiveProfileDisplay() {
    const el = document.getElementById('settings-active-profile');
    if (!el) return;
    const active = getActiveProfileName();
    el.textContent = active ? active : '(none)';
}

export async function initActiveProfile() {
    updateSettingsActiveProfileDisplay();
    try {
        const resp = await fetch('/api/calibration-profiles');
        if (!resp.ok) return;
        calibrationProfiles = (await resp.json()) || {};
        const active = getActiveProfileName();
        if (active && calibrationProfiles[active]) {
            syncActiveProfile(calibrationProfiles[active]);
        }
        updateSettingsActiveProfileDisplay();
    } catch (err) {
        console.error('Failed to initialize active calibration profile:', err);
    }
}

// ── DOM Initialization ─────────────────────────────────────────────────
const ELEMENT_IDS = {
    presetsContainer: 'preset-buttons',
    spinner: 'calibration-spinner',
    spinnerRotor: 'calibration-rotor',

    startBtn: 'start-button',
    stopBtn: 'stop-button',
    syncSpinnerBtn: 'sync-spinner-btn',
    savePointBtn: 'save-point-btn',

    selectedPreset: 'selected-preset',

    sentIntensity: 'sent-intensity',
    theoreticalBpm: 'theoretical-bpm',
    mappingList: 'mapping-list',
    profileSelect: 'profile-select',
    profileName: 'profile-name',
    resetBtn: 'reset-button',
    measuredBpm: 'measured-bpm',

    bpmDec5Btn: 'bpm-dec5-btn',
    bpmDecBtn: 'bpm-dec-btn',
    bpmIncBtn: 'bpm-inc-btn',
    bpmInc5Btn: 'bpm-inc5-btn',

    beatCount: 'beat-count',
    beatAvgInterval: 'beat-avg-interval',
    beatDots: 'beat-dots'
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
    els.theoreticalBpm.textContent = String(
        roundBpm(intensityToBpm(state.selectedPreset))
    );

    const val = state.running ? state.selectedPreset / 100.0 : 0;
    els.sentIntensity.textContent = val.toFixed(2);
}

function renderMappingList() {
    const presetText = PRESETS.map((p) =>
        calibratedBpms[p] === undefined || calibratedBpms[p] === null
            ? `${p}%: (not calibrated)`
            : `${p}%: ${roundBpm(calibratedBpms[p])} BPM`
    ).join(' | ');

    els.mappingList.innerHTML = presetText;
}

function refreshDisplays() {
    updateInfoDisplays();
    renderMappingList();
    renderMappingGraph();
}

function enableManualBpmButtons(enabled) {
    if (els.bpmDec5Btn) els.bpmDec5Btn.disabled = !enabled;
    if (els.bpmDecBtn) els.bpmDecBtn.disabled = !enabled;
    if (els.bpmIncBtn) els.bpmIncBtn.disabled = !enabled;
    if (els.bpmInc5Btn) els.bpmInc5Btn.disabled = !enabled;
}

// ── Manual BPM Adjustment (Requirement 3) ──────────────────────────────
function adjustManualBpm(delta) {
    if (!state.selectedPreset) return;

    let current = state.measuredBpmVal;
    if (current === null || isNaN(current)) {
        if (
            calibratedBpms[state.selectedPreset] &&
            calibratedBpms[state.selectedPreset] > 0
        ) {
            current = roundBpm(calibratedBpms[state.selectedPreset]);
        } else {
            current = roundBpm(intensityToBpm(state.selectedPreset));
        }
    }

    const next = Math.max(1, Math.min(300, current + delta));
    state.measuredBpmVal = next;
    els.measuredBpm.textContent = String(next);
    els.savePointBtn.disabled = false;
}

// ── Beat Tracking & Visualizer (Requirement 4) ─────────────────────────
function clearTaps() {
    state.tapTimes = [];
    state.measuredBpmVal = null;
    els.measuredBpm.textContent = '—';
    els.savePointBtn.disabled = true;
    updateBeatVisualizer();
}

function updateBeatVisualizer(avgIntervalMs = null) {
    if (!els.beatCount || !els.beatDots) return;

    const count = state.tapTimes.length;
    if (count === 0) {
        els.beatCount.textContent = '0 beats';
        if (els.beatAvgInterval) els.beatAvgInterval.textContent = '';
        els.beatDots.innerHTML =
            '<span class="beat-placeholder">Tap spinner or spacebar to measure BPM</span>';
        return;
    }

    els.beatCount.textContent = `${count} beat${count > 1 ? 's' : ''}`;
    if (els.beatAvgInterval) {
        if (count >= 2 && avgIntervalMs) {
            els.beatAvgInterval.textContent = `(avg ${Math.round(avgIntervalMs)}ms / beat)`;
        } else {
            els.beatAvgInterval.textContent = '(need 1 more tap)';
        }
    }

    els.beatDots.innerHTML = '';
    const maxDots = 20;
    const startIndex = Math.max(0, count - maxDots);

    if (startIndex > 0) {
        const moreSpan = document.createElement('span');
        moreSpan.className = 'beat-more';
        moreSpan.textContent = `+${startIndex} `;
        els.beatDots.appendChild(moreSpan);
    }

    for (let i = startIndex; i < count; i++) {
        const dot = document.createElement('span');
        dot.className = 'beat-dot';
        if (i === count - 1) {
            dot.classList.add('active');
        } else {
            dot.classList.add('recorded');
        }
        els.beatDots.appendChild(dot);
    }
}

// ── Preset Logic ───────────────────────────────────────────────────────
function selectPreset(preset, btn) {
    clearTaps();

    state.selectedPreset = preset;

    for (const b of els.presetsContainer.children) b.classList.remove('active');
    btn.classList.add('active');

    els.selectedPreset.textContent = `${preset}`;
    els.theoreticalBpm.textContent = String(roundBpm(intensityToBpm(preset)));

    enableManualBpmButtons(true);
    refreshDisplays();

    if (state.running) {
        sendDeviceCommand(preset / 100.0, 0);
        state.lastSendTime = Date.now();
    }
}

function handleSpinnerTap() {
    resetSpinner(true);

    const now = performance.now();

    // Prevent immediate duplicate taps (< 80ms)
    if (
        state.tapTimes.length > 0 &&
        now - state.tapTimes[state.tapTimes.length - 1] < 80
    ) {
        return;
    }

    // Do NOT discard after 3000ms: maintain all taps until manual reset (Requirement 4)
    state.tapTimes.push(now);

    if (state.tapTimes.length < 2) {
        els.measuredBpm.textContent = '—';
        els.savePointBtn.disabled = true;
        state.measuredBpmVal = null;
        updateBeatVisualizer();
        return;
    }

    const totalDuration =
        state.tapTimes[state.tapTimes.length - 1] - state.tapTimes[0];
    const intervalsCount = state.tapTimes.length - 1;
    const avgIntervalMs = totalDuration / intervalsCount;
    const tappedBpm = roundBpm(60000 / avgIntervalMs);

    state.measuredBpmVal = tappedBpm;
    els.measuredBpm.textContent = String(tappedBpm);

    if (state.selectedPreset) {
        els.savePointBtn.disabled = false;
        enableManualBpmButtons(true);
    }

    updateBeatVisualizer(avgIntervalMs);
}

function savePoint() {
    if (!state.selectedPreset || !state.measuredBpmVal) return;

    calibratedBpms[state.selectedPreset] = roundBpm(state.measuredBpmVal);
    clearTaps();

    buildPresetButtons();
    refreshDisplays();
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
                void els.spinner.offsetWidth;
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

// Spinner reset without touching calibration (Requirement 6)
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

export function stopCalibration() {
    if (!state.running) return;
    state.running = false;

    if (state.sendInterval) clearInterval(state.sendInterval);
    state.sendInterval = null;

    if (state.spinnerAnimId) cancelAnimationFrame(state.spinnerAnimId);
    state.spinnerAnimId = null;
    state.lastTs = null;

    sendDeviceCommand(0, 0);
    state.lastSendTime = 0;

    if (els.startBtn) els.startBtn.disabled = false;
    if (els.stopBtn) els.stopBtn.disabled = true;
}

// ── Profiles ───────────────────────────────────────────────────────────
async function loadProfilesFromServer() {
    try {
        const resp = await fetch('/api/calibration-profiles');
        if (!resp.ok) return;
        const data = await resp.json();
        calibrationProfiles = data || {};

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
            ).map((p) => [String(p), roundBpm(calibratedBpms[p])])
        )
    };

    try {
        const resp = await fetch('/api/calibration-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) return;
        calibrationProfiles[name] = payload.bpms;
        await loadProfilesFromServer();
        if (els.profileSelect) els.profileSelect.value = name;
        applyProfile(name);
    } catch (err) {
        console.error('Failed to save profile', err);
    }
}

function applyProfile(name) {
    const profile = calibrationProfiles[name];
    if (!profile) {
        resetBpms();
        setActiveProfileName('');
        syncActiveProfile({});
        return;
    }

    setActiveProfileName(name);

    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }

    for (const [pStr, bpmVal] of Object.entries(profile)) {
        const p = Number(pStr);
        if (PRESETS.includes(p)) {
            calibratedBpms[p] = roundBpm(Number(bpmVal));
        }
    }
    buildPresetButtons();

    syncActiveProfile(profile);

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
        enableManualBpmButtons(false);
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

        addPressListener(btn, () => selectPreset(p, btn));
        els.presetsContainer.appendChild(btn);
    }
}

function resetBpms() {
    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }
    clearTaps();

    state.selectedPreset = null;
    enableManualBpmButtons(false);
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

    const baselinePoints = bpmMapping.map(([bpm, intensity]) => [
        intensity,
        roundBpm(bpm)
    ]);
    drawPolyline(baselinePoints, 'rgba(0,200,0,0.95)', '#fff');

    const calPoints = getCalibratedPoints();
    const plottedCalPoints = calPoints.map(([bpm, intensity]) => [
        intensity,
        roundBpm(bpm)
    ]);
    if (plottedCalPoints.length > 1) {
        drawPolyline(
            plottedCalPoints,
            'rgba(255,140,0,0.95)',
            'rgba(255,140,0,0.95)'
        );
    }

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
    const points = [[0.0, 0.0]];

    const activePresets = PRESETS.filter(
        (p) =>
            calibratedBpms[p] !== undefined &&
            calibratedBpms[p] !== null &&
            calibratedBpms[p] > 0
    );

    for (const p of activePresets) {
        points.push([roundBpm(calibratedBpms[p]), Number(p)]);
    }

    points.sort((a, b) => a[0] - b[0]);
    return points;
}

async function syncActiveProfile(bpms) {
    try {
        await fetch('/api/calibration-activate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bpms })
        });
        if (getCurrentFunscriptUrl()) {
            await loadFunscript(getCurrentFunscriptUrl());
        }
    } catch (err) {
        console.error('Failed to sync active profile to server', err);
    }
}

function bindEventListeners() {
    if (listenersBound) return;
    listenersBound = true;

    addPressListener(els.startBtn, startCalibration);
    addPressListener(els.stopBtn, stopCalibration);
    addPressListener(els.resetBtn, clearTaps);
    addPressListener(els.syncSpinnerBtn, () => resetSpinner(true));
    addPressListener(els.savePointBtn, savePoint);

    addPressListener(els.bpmDec5Btn, () => adjustManualBpm(-5));
    addPressListener(els.bpmDecBtn, () => adjustManualBpm(-1));
    addPressListener(els.bpmIncBtn, () => adjustManualBpm(1));
    addPressListener(els.bpmInc5Btn, () => adjustManualBpm(5));

    addPressListener(els.spinner, handleSpinnerTap);

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
}

// ── Public API ─────────────────────────────────────────────────────────

export async function saveCalibrationOnClose() {
    const name = getProfileName();
    if (name) {
        await saveProfileToServer(name);
    }
}

export async function setupCalibration() {
    initElements();
    bindEventListeners();

    for (const p of PRESETS) {
        calibratedBpms[p] = null;
    }

    buildPresetButtons();
    renderMappingList();

    await loadBpmMapping();
    await loadProfilesFromServer();

    const activeName = getActiveProfileName();
    if (activeName && calibrationProfiles[activeName]) {
        if (els.profileSelect) els.profileSelect.value = activeName;
        applyProfile(activeName);
    } else if (els.profileSelect && els.profileSelect.value) {
        applyProfile(els.profileSelect.value);
    } else {
        updateSettingsActiveProfileDisplay();
    }

    els.stopBtn.disabled = true;
    els.startBtn.disabled = false;
    els.savePointBtn.disabled = true;
    enableManualBpmButtons(Boolean(state.selectedPreset));

    els.selectedPreset.textContent = state.selectedPreset
        ? `${state.selectedPreset}`
        : '—';
    els.sentIntensity.textContent = '—';
    els.theoreticalBpm.textContent = state.selectedPreset
        ? String(roundBpm(intensityToBpm(state.selectedPreset)))
        : '—';
    els.measuredBpm.textContent = '—';
    clearTaps();
    refreshDisplays();
}
