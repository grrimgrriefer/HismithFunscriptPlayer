// static/calibration.js

import { initWebSocket, sendDeviceCommand } from './socket.js?v=258';

const PRESETS = [10, 20, 30, 40, 50];
const multipliers = {};
multipliers[PRESETS[0]] = 1.0;

let selectedPreset = null;
let running = false;
let sendInterval = null;
let spinnerAnimId = null;
let spinnerAngle = 0;
let lastTs = null;

let lastSentIntensity = null;
let lastSendTime = 0;

const elements = {
    presetsContainer: null,
    spinner: null,
    multiplierValue: null,
    startBtn: null,
    stopBtn: null,
    confirmBtn: null,
    resetBtn: null,
    multDecLarge: null,
    multDecSmall: null,
    multIncSmall: null,
    multIncLarge: null,
    multiplierInput: null,
    selectedPreset: null,
    targetSpin: null,
    sentIntensity: null,
    mappingList: null
};

function initElements() {
    elements.presetsContainer = document.getElementById('preset-buttons');
    elements.spinner = document.getElementById('calibration-spinner');
    elements.multiplierValue = document.getElementById('multiplier-value');
    elements.startBtn = document.getElementById('start-button');
    elements.stopBtn = document.getElementById('stop-button');
    elements.confirmBtn = document.getElementById('confirm-button');
    elements.resetBtn = document.getElementById('reset-button');
    elements.multDecLarge = document.getElementById('mult-dec-large');
    elements.multDecSmall = document.getElementById('mult-dec-small');
    elements.multIncSmall = document.getElementById('mult-inc-small');
    elements.multIncLarge = document.getElementById('mult-inc-large');
    elements.multiplierInput = document.getElementById('multiplier-input');
    elements.selectedPreset = document.getElementById('selected-preset');
    elements.targetSpin = document.getElementById('target-spin');
    elements.sentIntensity = document.getElementById('sent-intensity');
    elements.mappingList = document.getElementById('mapping-list');
}

function buildPresetButtons() {
    elements.presetsContainer.innerHTML = '';
    PRESETS.forEach(p => {
        const btn = document.createElement('button');
        btn.className = 'preset-btn';
        btn.textContent = p.toString();
        if (multipliers[p] === undefined) btn.classList.add('inactive');
        btn.onclick = () => {
            // activate on first click if inactive, then select
            if (multipliers[p] === undefined) {
                multipliers[p] = 1.0;
                btn.classList.remove('inactive');
            }
            selectPreset(p, btn);
        };
        elements.presetsContainer.appendChild(btn);
    });
}

function setMultiplierControlsEnabled(enabled) {
    const list = [elements.multDecLarge, elements.multDecSmall, elements.multIncSmall, elements.multIncLarge, elements.multiplierInput];
    list.forEach(el => { if (el) el.disabled = !enabled; });
}

function selectPreset(preset, btn) {
    selectedPreset = preset;
    // highlight active
    Array.from(elements.presetsContainer.children).forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    btn.classList.remove('inactive');
    // update UI
    elements.selectedPreset.textContent = `${preset}`;
    elements.multiplierInput.value = (multipliers[preset] ?? 1.0).toFixed(2);
    elements.multiplierValue.textContent = (multipliers[preset] ?? 1.0).toFixed(2);
    updateTargetSpinDisplay();
    updateSentIntensityDisplay();
    setMultiplierControlsEnabled(true);
}

function updateTargetSpinDisplay() {
    if (!selectedPreset) {
        elements.targetSpin.textContent = '—';
        return;
    }
    const nominal = selectedPreset / 25.0; // nominal spins/sec (preset -> visual speed)
    elements.targetSpin.textContent = `${nominal.toFixed(2)}`;
}

function computeIntensityNormalized(preset, multiplier) {
    // baseline intensity = preset/100, apply multiplier, clamp to 1.0
    return Math.min(1.0, (preset / 100.0) * multiplier);
}

function updateSentIntensityDisplay() {
    if (!selectedPreset) {
        elements.sentIntensity.textContent = '—';
        return;
    }
    const val = computeIntensityNormalized(selectedPreset, multipliers[selectedPreset]);
    elements.sentIntensity.textContent = val.toFixed(3);
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
function round2(v) { return Math.round(v * 100) / 100; }

function setMultiplier(value, doSendImmediately = true) {
    if (!selectedPreset) return;
    const clamped = round2(clamp(value, 0.5, 3.0));
    multipliers[selectedPreset] = clamped;
    elements.multiplierInput.value = clamped.toFixed(2);
    elements.multiplierValue.textContent = clamped.toFixed(2);
    updateTargetSpinDisplay();
    updateSentIntensityDisplay();
    renderMappingList();

    if (running && doSendImmediately) {
        const intensity = computeIntensityNormalized(selectedPreset, multipliers[selectedPreset]);
        if (lastSentIntensity === null || Math.abs(intensity - lastSentIntensity) > 1e-6) {
            sendDeviceCommand(intensity, 0);
            lastSentIntensity = intensity;
            lastSendTime = Date.now();
        }
    }
}

function adjustMultiplier(delta) {
    if (!selectedPreset) return;
    const newVal = (multipliers[selectedPreset] || 1.0) + delta;
    setMultiplier(newVal);
}

function startCalibration() {
    if (!selectedPreset || running) return;

    running = true;
    lastSentIntensity = null;
    lastSendTime = 0;

    // initial immediate send
    const initial = computeIntensityNormalized(selectedPreset, multipliers[selectedPreset]);
    sendDeviceCommand(initial, 0);
    lastSentIntensity = initial;
    lastSendTime = Date.now();
    updateSentIntensityDisplay();

    sendInterval = setInterval(() => {
        if (!running) return;
        const intensity = computeIntensityNormalized(selectedPreset, multipliers[selectedPreset]);
        if (lastSentIntensity === null || Math.abs(intensity - lastSentIntensity) > 1e-6) {
            sendDeviceCommand(intensity, 0);
            lastSentIntensity = intensity;
            lastSendTime = Date.now();
            updateSentIntensityDisplay();
        } else if (Date.now() - lastSendTime >= 1500) {
            sendDeviceCommand(intensity, 0);
            lastSendTime = Date.now();
        }
    }, 200);

    startSpinner();
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
}

function stopCalibration() {
    if (!running) return;
    running = false;
    if (sendInterval) { clearInterval(sendInterval); sendInterval = null; }
    if (spinnerAnimId) cancelAnimationFrame(spinnerAnimId);
    spinnerAnimId = null;
    lastTs = null;
    sendDeviceCommand(0, 0);
    lastSentIntensity = null;
    lastSendTime = 0;
    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

function confirmMultiplier() {
    if (!selectedPreset) return;
    // multipliers already applied
    renderMappingList();
}

function resetMultipliers() {
    PRESETS.forEach((p, i) => {
        if (i === 0) multipliers[p] = 1.0; // keep first preset active
        else delete multipliers[p];
    });
    selectedPreset = null;
    buildPresetButtons();
    elements.multiplierInput.value = '1.00';
    elements.multiplierValue.textContent = '1.00';
    elements.selectedPreset.textContent = '—';
    elements.targetSpin.textContent = '—';
    elements.sentIntensity.textContent = '—';
    setMultiplierControlsEnabled(false);
    renderMappingList();
}

function renderMappingList() {
    elements.mappingList.innerHTML = PRESETS.map(p => {
        const v = multipliers[p];
        return v === undefined ? `${p}: (inactive)` : `${p}: ${v.toFixed(3)}x`;
    }).join(' | ');
}

/* Spinner animation -- uses preset nominal speed only (multiplier does not affect visual) */
function startSpinner() {
    if (!selectedPreset) return;
    if (spinnerAnimId) cancelAnimationFrame(spinnerAnimId);
    lastTs = null;
    spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

function spinnerFrame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000.0;
    lastTs = ts;
    const spinsPerSecNominal = selectedPreset / 25.0; // visual is based on preset only
    spinnerAngle = (spinnerAngle + dt * spinsPerSecNominal * 360) % 360;
    elements.spinner.style.transform = `rotate(${spinnerAngle}deg)`;
    spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

/* Events binding */
export function setup() {
    initWebSocket();
    initElements();
    buildPresetButtons();
    renderMappingList();

    // multiplier controls
    elements.multDecLarge.addEventListener('click', () => adjustMultiplier(-0.10));
    elements.multDecSmall.addEventListener('click', () => adjustMultiplier(-0.01));
    elements.multIncSmall.addEventListener('click', () => adjustMultiplier(+0.01));
    elements.multIncLarge.addEventListener('click', () => adjustMultiplier(+0.10));
    elements.multiplierInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) setMultiplier(val);
        else elements.multiplierInput.value = (multipliers[selectedPreset] || 1.0).toFixed(2);
    });

    elements.startBtn.addEventListener('click', startCalibration);
    elements.stopBtn.addEventListener('click', stopCalibration);
    elements.confirmBtn.addEventListener('click', confirmMultiplier);
    elements.resetBtn.addEventListener('click', resetMultipliers);

    // initial state
    elements.stopBtn.disabled = true;
    elements.startBtn.disabled = false;
    elements.multiplierValue.textContent = '1.00';
    elements.selectedPreset.textContent = '—';
    elements.targetSpin.textContent = '—';
    elements.sentIntensity.textContent = '—';
    setMultiplierControlsEnabled(false);
}

export function getCalibrationMultiplier(rawIntensity) {
    const v = clamp(rawIntensity, 0, 100);
    const active = PRESETS.filter(p => multipliers[p] !== undefined);
    if (active.length === 0) return 1.0;
    if (active.length === 1) return multipliers[active[0]] ?? 1.0;
    if (v <= active[0]) return multipliers[active[0]];
    if (v >= active[active.length - 1]) return multipliers[active[active.length - 1]];
    for (let i = 0; i < active.length - 1; i++) {
        const a = active[i], b = active[i + 1];
        if (v >= a && v <= b) {
            const t = (v - a) / (b - a);
            const s = t * t * (3 - 2 * t); // smoothstep (cubic) easing
            const ma = multipliers[a];
            const mb = multipliers[b];
            return ma + (mb - ma) * s;
        }
    }
    return 1.0;
}