// static/calibration.js

import { initWebSocket, sendDeviceCommand } from './socket.js';
import { clamp, smoothstep } from './utils.js';

// ── Constants ──────────────────────────────────────────────────────────
const PRESETS = [10, 20, 30, 40, 50];
const FLASH_DURATION_MS = 220;
const RAMP_MS = 700;
const SEND_INTERVAL_MS = 100;
const KEEPALIVE_MS = 1500;
const MULTIPLIER_MIN = 0.5;
const MULTIPLIER_MAX = 3.0;
const FALLBACK_BPM_SCALE = 60.0 / 25.0; // intensity-to-BPM when no mapping

// ── State ──────────────────────────────────────────────────────────────
const multipliers = { [PRESETS[0]]: 1.0 };

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
    bpmIntensityMapping: [],
    audioCtx: null
};

const ramp = {
    active: false,
    startIntensity: 0,
    targetIntensity: 0,
    startTime: 0,
    spinnerStartBpm: 0,
    spinnerTargetBpm: 0,
    spinnerCurrentBpm: 0
};

const els = {};

// ── Utilities ──────────────────────────────────────────────────────────
const round2 = (v) => Math.round(v * 100) / 100;
const getMultiplier = (preset) => multipliers[preset] ?? 1.0;

function intensityToNormalized(preset, multiplier) {
    return Math.min(1.0, (preset / 100.0) * multiplier);
}

// ── DOM Initialization ─────────────────────────────────────────────────
const ELEMENT_IDS = {
    presetsContainer: 'preset-buttons',
    spinner: 'calibration-spinner',
    spinnerRotor: 'calibration-rotor',
    multiplierValue: 'multiplier-value',
    startBtn: 'start-button',
    stopBtn: 'stop-button',
    multDecLarge: 'mult-dec-large',
    multDecSmall: 'mult-dec-small',
    multIncSmall: 'mult-inc-small',
    multIncLarge: 'mult-inc-large',
    multiplierInput: 'multiplier-input',
    selectedPreset: 'selected-preset',
    targetSpin: 'target-spin',
    sentIntensity: 'sent-intensity',
    mappingList: 'mapping-list',
    profileSelect: 'profile-select',
    profileName: 'profile-name',
    resetBtn: 'reset-button'
};

function initElements() {
    for (const [key, id] of Object.entries(ELEMENT_IDS)) {
        els[key] = document.getElementById(id);
    }
}

// ── BPM / Mapping ──────────────────────────────────────────────────────
function getBpmForIntensity(intensity) {
    const i = Number(intensity);
    if (!isFinite(i)) return 0;

    const mapping = state.bpmIntensityMapping;
    if (!Array.isArray(mapping) || mapping.length === 0) {
        return i * FALLBACK_BPM_SCALE;
    }

    const sorted = mapping.slice().sort((a, b) => a.intensity - b.intensity);
    if (i <= sorted[0].intensity) return sorted[0].bpm;
    if (i >= sorted.at(-1).intensity) return sorted.at(-1).bpm;

    for (let k = 0; k < sorted.length - 1; k++) {
        const { intensity: i0, bpm: b0 } = sorted[k];
        const { intensity: i1, bpm: b1 } = sorted[k + 1];
        if (i >= i0 && i <= i1) {
            const t = (i - i0) / (i1 - i0);
            return b0 + (b1 - b0) * t;
        }
    }
    return i * FALLBACK_BPM_SCALE;
}

// ── Ramp ───────────────────────────────────────────────────────────────
function getRampProgress() {
    if (!ramp.active) return 1;
    return clamp((performance.now() - ramp.startTime) / RAMP_MS, 0, 1);
}

function getCurrentRampedIntensity() {
    if (!ramp.active) return state.lastSentIntensity ?? 0;
    const t = getRampProgress();
    return (
        ramp.startIntensity +
        (ramp.targetIntensity - ramp.startIntensity) * smoothstep(t)
    );
}

function startRamp(fromIntensity, toIntensity, fromBpm, toBpm) {
    Object.assign(ramp, {
        active: true,
        startIntensity: fromIntensity,
        targetIntensity: toIntensity,
        startTime: performance.now(),
        spinnerStartBpm: fromBpm,
        spinnerTargetBpm: toBpm
    });
}

function resetRamp() {
    Object.assign(ramp, {
        active: false,
        startIntensity: 0,
        targetIntensity: 0,
        startTime: 0,
        spinnerStartBpm: 0,
        spinnerTargetBpm: 0,
        spinnerCurrentBpm: 0
    });
}

// ── UI Updates ─────────────────────────────────────────────────────────
function updateMultiplierDisplay(value) {
    const text = value.toFixed(2);
    els.multiplierInput.value = text;
    els.multiplierValue.textContent = text;
}

function setMultiplierControlsEnabled(enabled) {
    const controls = [
        els.multDecLarge,
        els.multDecSmall,
        els.multIncSmall,
        els.multIncLarge,
        els.multiplierInput
    ];
    for (const el of controls) {
        if (el) el.disabled = !enabled;
    }
}

function updateInfoDisplays() {
    if (!state.selectedPreset) {
        els.targetSpin.textContent = '—';
        els.sentIntensity.textContent = '—';
        return;
    }

    const nominalSpinsPerSec = getBpmForIntensity(state.selectedPreset) / 60.0;
    els.targetSpin.textContent = nominalSpinsPerSec.toFixed(2);

    const val =
        state.running && state.lastSentIntensity !== null
            ? state.lastSentIntensity
            : intensityToNormalized(
                  state.selectedPreset,
                  getMultiplier(state.selectedPreset)
              );
    els.sentIntensity.textContent = val.toFixed(3);
}

function renderMappingList() {
    const presetText = PRESETS.map((p) =>
        multipliers[p] === undefined
            ? `${p}: (inactive)`
            : `${p}: ${multipliers[p].toFixed(3)}x`
    ).join(' | ');

    let html = presetText;
    if (state.bpmIntensityMapping.length > 0) {
        const mapText = state.bpmIntensityMapping
            .map((pt) => `${pt.intensity.toFixed(0)}:${pt.bpm.toFixed(0)}`)
            .join(' | ');
        html += `<br/><small style="opacity:0.85; margin-top:6px; display:block;">Mapping (intensity:bpm): ${mapText}</small>`;
    }
    els.mappingList.innerHTML = html;
}

function refreshDisplays() {
    updateInfoDisplays();
    renderMappingList();
    renderMappingGraph();
}

// ── Preset / Multiplier Logic ──────────────────────────────────────────
function selectPreset(preset, btn) {
    const previousPreset = state.selectedPreset;
    state.selectedPreset = preset;

    for (const b of els.presetsContainer.children) b.classList.remove('active');
    btn.classList.add('active');
    btn.classList.remove('inactive');

    els.selectedPreset.textContent = `${preset}`;
    updateMultiplierDisplay(getMultiplier(preset));
    setMultiplierControlsEnabled(true);
    refreshDisplays();

    if (state.running) {
        const targetIntensity = intensityToNormalized(
            preset,
            getMultiplier(preset)
        );
        const fromBpm =
            ramp.spinnerCurrentBpm ||
            (previousPreset ? getBpmForIntensity(previousPreset) : 0);
        startRamp(
            getCurrentRampedIntensity(),
            targetIntensity,
            fromBpm,
            getBpmForIntensity(preset)
        );
    }
}

function setMultiplier(value, doRamp = true) {
    if (!state.selectedPreset) return;
    const clamped = round2(clamp(value, MULTIPLIER_MIN, MULTIPLIER_MAX));
    multipliers[state.selectedPreset] = clamped;
    updateMultiplierDisplay(clamped);
    refreshDisplays();

    if (state.running && doRamp) {
        const targetIntensity = intensityToNormalized(
            state.selectedPreset,
            clamped
        );
        const currentBpm =
            ramp.spinnerCurrentBpm || getBpmForIntensity(state.selectedPreset);
        startRamp(
            getCurrentRampedIntensity(),
            targetIntensity,
            currentBpm,
            currentBpm
        );
    }
}

function adjustMultiplier(delta) {
    if (!state.selectedPreset) return;
    setMultiplier(getMultiplier(state.selectedPreset) + delta);
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
            els.spinner.classList.remove('spinner-flash');
            void els.spinner.offsetWidth;
            els.spinner.classList.add('spinner-flash');
            playClick();
        }, i * FLASH_DURATION_MS);
    }
}

// ── Spinner Animation ──────────────────────────────────────────────────
function updateRampState(timestamp) {
    if (ramp.active) {
        const t = clamp((timestamp - ramp.startTime) / RAMP_MS, 0, 1);
        const s = smoothstep(t);
        ramp.spinnerCurrentBpm =
            ramp.spinnerStartBpm +
            (ramp.spinnerTargetBpm - ramp.spinnerStartBpm) * s;
        if (t >= 1) {
            ramp.active = false;
            ramp.spinnerCurrentBpm = ramp.spinnerTargetBpm;
        }
    } else {
        ramp.spinnerCurrentBpm = getBpmForIntensity(state.selectedPreset);
    }
}

function spinnerFrame(ts) {
    if (!state.lastTs) state.lastTs = ts;
    const dt = (ts - state.lastTs) / 1000.0;
    state.lastTs = ts;

    updateRampState(ts);

    const degDelta = dt * (ramp.spinnerCurrentBpm / 60.0) * 360;
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

    const initial = intensityToNormalized(
        state.selectedPreset,
        getMultiplier(state.selectedPreset)
    );
    startRamp(0, initial, 0, getBpmForIntensity(state.selectedPreset));

    sendDeviceCommand(0, 0);
    updateInfoDisplays();

    if (state.sendInterval) clearInterval(state.sendInterval);
    state.sendInterval = setInterval(sendLoop, SEND_INTERVAL_MS);

    startSpinner();
    els.startBtn.disabled = true;
    els.stopBtn.disabled = false;
}

function sendLoop() {
    if (!state.running) return;

    const nowPerf = performance.now();
    let intensity = intensityToNormalized(
        state.selectedPreset,
        getMultiplier(state.selectedPreset)
    );

    if (ramp.active) {
        const t = clamp((nowPerf - ramp.startTime) / RAMP_MS, 0, 1);
        const s = smoothstep(t);
        intensity =
            ramp.startIntensity +
            (ramp.targetIntensity - ramp.startIntensity) * s;
        ramp.spinnerCurrentBpm =
            ramp.spinnerStartBpm +
            (ramp.spinnerTargetBpm - ramp.spinnerStartBpm) * s;

        if (t >= 1) {
            ramp.active = false;
            ramp.spinnerCurrentBpm = ramp.spinnerTargetBpm;
        }
    } else {
        ramp.spinnerCurrentBpm = getBpmForIntensity(state.selectedPreset);
    }

    const changed =
        state.lastSentIntensity === null ||
        Math.abs(intensity - state.lastSentIntensity) > 1e-6;
    const stale = Date.now() - state.lastSendTime >= KEEPALIVE_MS;

    if (changed || stale) {
        sendDeviceCommand(intensity, 0);
        state.lastSentIntensity = intensity;
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
    resetRamp();

    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
}

// ── Profiles ───────────────────────────────────────────────────────────
async function loadProfilesFromServer() {
    try {
        const resp = await fetch('/api/calibration-profiles');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
        multipliers: Object.fromEntries(
            PRESETS.filter((p) => multipliers[p] !== undefined).map((p) => [
                String(p),
                multipliers[p]
            ])
        )
    };

    try {
        const resp = await fetch('/api/calibration-profiles', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        window.__calibrationProfiles = window.__calibrationProfiles || {};
        window.__calibrationProfiles[name] = payload.multipliers;
        await loadProfilesFromServer();
        if (els.profileSelect) els.profileSelect.value = name;
    } catch (err) {
        console.error('Failed to save profile', err);
        alert('Failed to save calibration profile');
    }
}

function applyProfile(profile) {
    for (const p of PRESETS) {
        const key = String(p);
        if (profile && Object.prototype.hasOwnProperty.call(profile, key)) {
            multipliers[p] = parseFloat(profile[key]);
        } else {
            delete multipliers[p];
        }
    }
    buildPresetButtons();

    const first = PRESETS.find((p) => multipliers[p] !== undefined);
    if (first) {
        const btn = [...els.presetsContainer.children].find(
            (b) => b.textContent === String(first)
        );
        if (btn) selectPreset(first, btn);
    } else {
        updateMultiplierDisplay(1.0);
        els.selectedPreset.textContent = '—';
        setMultiplierControlsEnabled(false);
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
        btn.className = 'preset-btn';
        btn.textContent = p.toString();
        if (multipliers[p] === undefined) btn.classList.add('inactive');
        btn.onclick = () => {
            if (multipliers[p] === undefined) {
                multipliers[p] = 1.0;
                btn.classList.remove('inactive');
            }
            selectPreset(p, btn);
        };
        els.presetsContainer.appendChild(btn);
    }
}

function resetMultipliers() {
    for (const [i, p] of PRESETS.entries()) {
        if (i === 0) multipliers[p] = 1.0;
        else delete multipliers[p];
    }
    state.selectedPreset = null;
    buildPresetButtons();
    updateMultiplierDisplay(1.0);
    els.selectedPreset.textContent = '—';
    els.targetSpin.textContent = '—';
    els.sentIntensity.textContent = '—';
    setMultiplierControlsEnabled(false);
    refreshDisplays();
}

// ── Mapping Graph ──────────────────────────────────────────────────────
function renderMappingGraph() {
    const canvas = document.getElementById('mapping-canvas');
    const mapping = state.bpmIntensityMapping;
    if (!canvas || !Array.isArray(mapping) || mapping.length === 0) return;

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
    const intensities = mapping.map((pt) => pt.intensity);
    const bpms = mapping.map((pt) => pt.bpm);
    const minI = Math.min(...intensities),
        maxI = Math.max(...intensities);
    const minB = Math.min(...bpms),
        maxB = Math.max(...bpms);
    const iRange = maxI - minI || 1;
    const bRange = maxB - minB || 1;

    const xFor = (i) => pad + ((i - minI) / iRange) * (cssWidth - pad * 2);
    const yFor = (b) =>
        cssHeight - pad - ((b - minB) / bRange) * (cssHeight - pad * 2);

    // Grid
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j <= 4; j++) {
        const x = xFor(minI + (j / 4) * iRange);
        ctx.moveTo(x, pad);
        ctx.lineTo(x, cssHeight - pad);
        const y = yFor(minB + (j / 4) * bRange);
        ctx.moveTo(pad, y);
        ctx.lineTo(cssWidth - pad, y);
    }
    ctx.stroke();

    const sorted = mapping.slice().sort((a, b) => a.intensity - b.intensity);

    function drawPolyline(points, xFn, yFn, lineColor, dotColor) {
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        points.forEach((pt, i) => {
            const x = xFn(pt),
                y = yFn(pt);
            i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();

        ctx.fillStyle = dotColor;
        for (const pt of points) {
            ctx.beginPath();
            ctx.arc(xFn(pt), yFn(pt), 3, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    // Baseline
    drawPolyline(
        sorted,
        (pt) => xFor(pt.intensity),
        (pt) => yFor(pt.bpm),
        'rgba(0,200,0,0.95)',
        '#fff'
    );

    // Calibrated
    const calibrated = sorted.map((pt) => ({
        intensity: pt.intensity,
        bpm: clamp(pt.bpm * getCalibrationMultiplier(pt.intensity), minB, maxB)
    }));
    drawPolyline(
        calibrated,
        (pt) => xFor(pt.intensity),
        (pt) => yFor(pt.bpm),
        'rgba(255,140,0,0.95)',
        'rgba(255,140,0,0.95)'
    );

    // Labels
    ctx.fillStyle = '#ddd';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${minI.toFixed(0)}`, pad, 12);
    ctx.fillText(`${maxI.toFixed(0)}`, cssWidth - pad - 56, 12);
    ctx.fillText('Intensity →', cssWidth / 2 - 30, cssHeight - 4);

    ctx.save();
    ctx.translate(8, cssHeight / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BPM', 0, 0);
    ctx.restore();

    // Legend
    const legendLeft = cssWidth - pad - 8 - 120;
    const legendTop = cssHeight - pad - 18;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,200,0,0.95)';
    ctx.fillRect(legendLeft, legendTop, 10, 10);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Baseline', legendLeft + 16, legendTop + 5);
    ctx.fillStyle = 'rgba(255,140,0,0.95)';
    ctx.fillRect(legendLeft + 56, legendTop, 10, 10);
    ctx.fillStyle = '#ddd';
    ctx.fillText('Calibrated', legendLeft + 72, legendTop + 5);
    ctx.textBaseline = 'alphabetic';
}

// ── Public API ─────────────────────────────────────────────────────────
export function getCalibrationMultiplier(rawIntensity) {
    const v = clamp(rawIntensity, 0, 100);
    const active = PRESETS.filter((p) => multipliers[p] !== undefined);
    if (active.length === 0) return 1.0;
    if (active.length === 1) return getMultiplier(active[0]);
    if (v <= active[0]) return getMultiplier(active[0]);
    if (v >= active.at(-1)) return getMultiplier(active.at(-1));

    for (let i = 0; i < active.length - 1; i++) {
        const a = active[i],
            b = active[i + 1];
        if (v >= a && v <= b) {
            const t = (v - a) / (b - a);
            return (
                getMultiplier(a) +
                (getMultiplier(b) - getMultiplier(a)) * smoothstep(t)
            );
        }
    }
    return 1.0;
}

export async function saveOnClose() {
    const name = getProfileName();
    if (name) await saveProfileToServer(name);
}

export function setup() {
    initWebSocket();
    initElements();
    buildPresetButtons();
    renderMappingList();

    // Load BPM mapping
    fetch('/api/calibration-mapping')
        .then((r) => r.json())
        .then((mapping) => {
            state.bpmIntensityMapping = Array.isArray(mapping) ? mapping : [];
            renderMappingList();
            renderMappingGraph();
            window.addEventListener('resize', renderMappingGraph);
        })
        .catch((err) =>
            console.error('Failed to load BPM->intensity mapping:', err)
        );

    // Load profiles
    loadProfilesFromServer().then(() => {
        els.profileSelect?.addEventListener('change', (e) => {
            const prof = window.__calibrationProfiles?.[e.target.value];
            if (prof) applyProfile(prof);
        });
    });

    // Multiplier controls
    els.multDecLarge.addEventListener('click', () => adjustMultiplier(-0.1));
    els.multDecSmall.addEventListener('click', () => adjustMultiplier(-0.01));
    els.multIncSmall.addEventListener('click', () => adjustMultiplier(+0.01));
    els.multIncLarge.addEventListener('click', () => adjustMultiplier(+0.1));
    els.multiplierInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) setMultiplier(val);
        else updateMultiplierDisplay(getMultiplier(state.selectedPreset));
    });

    els.startBtn.addEventListener('click', startCalibration);
    els.stopBtn.addEventListener('click', stopCalibration);
    els.resetBtn.addEventListener('click', () => resetSpinner(true));
    els.spinner.addEventListener('click', () => resetSpinner(true));
    els.spinner.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resetSpinner(true);
        }
    });

    // Initial state
    els.stopBtn.disabled = true;
    els.startBtn.disabled = false;
    updateMultiplierDisplay(1.0);
    els.selectedPreset.textContent = '—';
    els.targetSpin.textContent = '—';
    els.sentIntensity.textContent = '—';
    setMultiplierControlsEnabled(false);
}
