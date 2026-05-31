// static/calibration.js

import { initWebSocket, sendDeviceCommand } from './socket.js';

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
    spinnerRotor: null,
    multiplierValue: null,
    startBtn: null,
    stopBtn: null,
    multDecLarge: null,
    multDecSmall: null,
    multIncSmall: null,
    multIncLarge: null,
    multiplierInput: null,
    selectedPreset: null,
    targetSpin: null,
    sentIntensity: null,
    mappingList: null,
    profileSelect: null,
    profileName: null,
    resetBtn: null
};

let bpmIntensityMapping = [];

let audioCtx = null;
let spinnerAccum = 0;
let lastSpinCount = 0;
const FLASH_DURATION_MS = 220;

let ramping = false;
let rampStartIntensity = 0; // normalized [0..1]
let rampTargetIntensity = 0;
let rampStartTime = 0;
const RAMP_MS = 700; // ramp duration (ms)

let spinnerStartBpm = 0;
let spinnerTargetBpm = 0;
let spinnerCurrentBpm = 0;

function initElements() {
    elements.presetsContainer = document.getElementById('preset-buttons');
    elements.spinner = document.getElementById('calibration-spinner');
    elements.spinnerRotor = document.getElementById('calibration-rotor');
    elements.multiplierValue = document.getElementById('multiplier-value');
    elements.startBtn = document.getElementById('start-button');
    elements.stopBtn = document.getElementById('stop-button');
    elements.multDecLarge = document.getElementById('mult-dec-large');
    elements.multDecSmall = document.getElementById('mult-dec-small');
    elements.multIncSmall = document.getElementById('mult-inc-small');
    elements.multIncLarge = document.getElementById('mult-inc-large');
    elements.multiplierInput = document.getElementById('multiplier-input');
    elements.selectedPreset = document.getElementById('selected-preset');
    elements.targetSpin = document.getElementById('target-spin');
    elements.sentIntensity = document.getElementById('sent-intensity');
    elements.mappingList = document.getElementById('mapping-list');
    elements.profileSelect = document.getElementById('profile-select');
    elements.profileName = document.getElementById('profile-name');
    elements.resetBtn = document.getElementById('reset-button');
}

function buildPresetButtons() {
    elements.presetsContainer.innerHTML = '';
    PRESETS.forEach((p) => {
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
    const list = [
        elements.multDecLarge,
        elements.multDecSmall,
        elements.multIncSmall,
        elements.multIncLarge,
        elements.multiplierInput
    ];
    list.forEach((el) => {
        if (el) el.disabled = !enabled;
    });
}

function selectPreset(preset, btn) {
    const previousPreset = selectedPreset;
    selectedPreset = preset;
    // highlight active
    Array.from(elements.presetsContainer.children).forEach((b) =>
        b.classList.remove('active')
    );
    btn.classList.add('active');
    btn.classList.remove('inactive');
    // update UI
    elements.selectedPreset.textContent = `${preset}`;
    elements.multiplierInput.value = (multipliers[preset] ?? 1.0).toFixed(2);
    elements.multiplierValue.textContent = (multipliers[preset] ?? 1.0).toFixed(
        2
    );
    updateTargetSpinDisplay();
    updateSentIntensityDisplay();
    setMultiplierControlsEnabled(true);

    // smooth transition if already running: ramp both device intensity and spinner BPM
    if (running) {
        const targetIntensity = computeIntensityNormalized(
            selectedPreset,
            multipliers[selectedPreset] ?? 1.0
        );
        rampStartIntensity = getCurrentRampedIntensity();
        rampTargetIntensity = targetIntensity;
        rampStartTime = performance.now();
        ramping = true;

        spinnerStartBpm =
            spinnerCurrentBpm ||
            (previousPreset ? getBpmForIntensity(previousPreset) : 0);
        spinnerTargetBpm = getBpmForIntensity(preset);
    }
}

function getBpmForIntensity(intensity) {
    const i = Number(intensity);
    if (!isFinite(i)) return 0;
    if (
        !Array.isArray(bpmIntensityMapping) ||
        bpmIntensityMapping.length === 0
    ) {
        // fallback: previous approximate mapping -> bpm = (intensity/25) * 60
        return (i / 25.0) * 60.0;
    }
    const sorted = bpmIntensityMapping
        .slice()
        .sort((a, b) => a.intensity - b.intensity);
    const minI = sorted[0].intensity;
    const maxI = sorted[sorted.length - 1].intensity;
    if (i <= minI) return sorted[0].bpm;
    if (i >= maxI) return sorted[sorted.length - 1].bpm;
    for (let k = 0; k < sorted.length - 1; k++) {
        const i0 = sorted[k].intensity,
            b0 = sorted[k].bpm;
        const i1 = sorted[k + 1].intensity,
            b1 = sorted[k + 1].bpm;
        if (i >= i0 && i <= i1) {
            const t = (i - i0) / (i1 - i0);
            return b0 + (b1 - b0) * t;
        }
    }
    return (i / 25.0) * 60.0;
}

function getCurrentRampedIntensity() {
    if (!ramping) return lastSentIntensity ?? 0;
    const t = clamp((performance.now() - rampStartTime) / RAMP_MS, 0, 1);
    const s = t * t * (3 - 2 * t); // smoothstep
    return rampStartIntensity + (rampTargetIntensity - rampStartIntensity) * s;
}

function updateTargetSpinDisplay() {
    if (!selectedPreset) {
        elements.targetSpin.textContent = '—';
        return;
    }
    const bpm = getBpmForIntensity(selectedPreset);
    const nominal = bpm / 60.0; // spins/sec
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
    let val;
    if (running && lastSentIntensity !== null) {
        val = lastSentIntensity;
    } else {
        val = computeIntensityNormalized(
            selectedPreset,
            multipliers[selectedPreset]
        );
    }
    elements.sentIntensity.textContent = val.toFixed(3);
}

function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
}
function round2(v) {
    return Math.round(v * 100) / 100;
}

function setMultiplier(value, doSendImmediately = true) {
    if (!selectedPreset) return;
    const clamped = round2(clamp(value, 0.5, 3.0));
    multipliers[selectedPreset] = clamped;
    elements.multiplierInput.value = clamped.toFixed(2);
    elements.multiplierValue.textContent = clamped.toFixed(2);
    updateTargetSpinDisplay();
    updateSentIntensityDisplay();
    renderMappingList();

    renderMappingGraph(bpmIntensityMapping);

    if (running && doSendImmediately) {
        const targetIntensity = computeIntensityNormalized(
            selectedPreset,
            multipliers[selectedPreset]
        );
        rampStartIntensity = getCurrentRampedIntensity();
        rampTargetIntensity = targetIntensity;
        rampStartTime = performance.now();
        ramping = true;

        // multiplier doesn't affect visual spinner speed, keep spinner BPM unchanged
        spinnerStartBpm =
            spinnerCurrentBpm || getBpmForIntensity(selectedPreset);
        spinnerTargetBpm = spinnerStartBpm;
    }
}

function adjustMultiplier(delta) {
    if (!selectedPreset) return;
    const newVal = (multipliers[selectedPreset] || 1.0) + delta;
    setMultiplier(newVal);
}

function ensureAudioContext() {
    if (audioCtx) return;
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) {
        console.warn('Web Audio API not available', e);
        audioCtx = null;
    }
}

function playClick() {
    if (!audioCtx) return;
    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.07);
}

function handleFullRotations(count) {
    if (!elements.spinner || !elements.spinnerRotor) return;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    for (let i = 0; i < count; i++) {
        const delay = i * FLASH_DURATION_MS;
        setTimeout(() => {
            elements.spinner.classList.remove('spinner-flash');
            void elements.spinner.offsetWidth; // force reflow to restart animation
            elements.spinner.classList.add('spinner-flash');
            playClick();
        }, delay);
    }
}

function startCalibration() {
    if (!selectedPreset || running) return;

    ensureAudioContext();
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

    running = true;
    lastSentIntensity = 0;
    lastSendTime = Date.now();

    // target intensity (normalized)
    const initial = computeIntensityNormalized(
        selectedPreset,
        multipliers[selectedPreset]
    );

    // start ramp from 0 -> initial
    rampStartIntensity = 0;
    rampTargetIntensity = initial;
    rampStartTime = performance.now();
    ramping = true;

    // spinner: ramp from 0 BPM -> nominal BPM for selectedPreset
    spinnerStartBpm = 0;
    spinnerTargetBpm = getBpmForIntensity(selectedPreset);
    spinnerCurrentBpm = spinnerStartBpm;

    // ensure device starts at 0
    sendDeviceCommand(0, 0);
    lastSentIntensity = 0;
    lastSendTime = Date.now();
    updateSentIntensityDisplay();

    // more frequent sends during ramps for smoothness
    if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
    }
    sendInterval = setInterval(() => {
        if (!running) return;

        const nowPerf = performance.now();
        let intensity = computeIntensityNormalized(
            selectedPreset,
            multipliers[selectedPreset]
        );

        if (ramping) {
            const t = clamp((nowPerf - rampStartTime) / RAMP_MS, 0, 1);
            const s = t * t * (3 - 2 * t); // smoothstep
            const start = rampStartIntensity ?? 0;
            const target = rampTargetIntensity ?? intensity;
            intensity = start + (target - start) * s;

            // update spinner current BPM in lock-step
            const sb = spinnerStartBpm ?? 0;
            const tb = spinnerTargetBpm ?? getBpmForIntensity(selectedPreset);
            spinnerCurrentBpm = sb + (tb - sb) * s;

            if (t >= 1) {
                ramping = false;
                spinnerCurrentBpm = tb;
            }
        } else {
            spinnerCurrentBpm = getBpmForIntensity(selectedPreset);
        }

        if (
            lastSentIntensity === null ||
            Math.abs(intensity - lastSentIntensity) > 1e-6
        ) {
            sendDeviceCommand(intensity, 0);
            lastSentIntensity = intensity;
            lastSendTime = Date.now();
            updateSentIntensityDisplay();
        } else if (Date.now() - lastSendTime >= 1500) {
            sendDeviceCommand(intensity, 0);
            lastSendTime = Date.now();
        }
    }, 100);

    startSpinner();
    elements.startBtn.disabled = true;
    elements.stopBtn.disabled = false;
}

function stopCalibration() {
    if (!running) return;
    running = false;
    if (sendInterval) {
        clearInterval(sendInterval);
        sendInterval = null;
    }
    if (spinnerAnimId) cancelAnimationFrame(spinnerAnimId);
    spinnerAnimId = null;
    lastTs = null;
    sendDeviceCommand(0, 0);
    lastSentIntensity = null;
    lastSendTime = 0;

    // reset ramp state
    ramping = false;
    rampStartIntensity = 0;
    rampTargetIntensity = 0;
    rampStartTime = 0;
    spinnerStartBpm = 0;
    spinnerTargetBpm = 0;
    spinnerCurrentBpm = 0;

    elements.startBtn.disabled = false;
    elements.stopBtn.disabled = true;
}

async function saveProfileToServer(name) {
    if (!name) return;
    const payload = { name: name, multipliers: {} };
    PRESETS.forEach((p) => {
        if (multipliers[p] !== undefined)
            payload.multipliers[p.toString()] = multipliers[p];
    });
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
        if (elements.profileSelect) elements.profileSelect.value = name;
    } catch (err) {
        console.error('Failed to save profile', err);
        alert('Failed to save calibration profile');
    }
}

function confirmMultiplier() {
    // make non-blocking save; users expect fast close
    (async () => {
        if (!selectedPreset) return;
        renderMappingList();
        renderMappingGraph(bpmIntensityMapping);
        const name =
            (elements.profileName && elements.profileName.value.trim()) ||
            (elements.profileSelect && elements.profileSelect.value) ||
            '';
        if (name) await saveProfileToServer(name);
    })();
}

export async function saveOnClose() {
    if (!elements.profileSelect && !elements.profileName) return;
    const name =
        (elements.profileName && elements.profileName.value.trim()) ||
        (elements.profileSelect && elements.profileSelect.value) ||
        '';
    if (!name) return;
    await saveProfileToServer(name);
}

function resetMultipliers() {
    PRESETS.forEach((p, i) => {
        if (i === 0)
            multipliers[p] = 1.0; // keep first preset active
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
    renderMappingGraph(bpmIntensityMapping);
}

function renderMappingList() {
    elements.mappingList.innerHTML = PRESETS.map((p) => {
        const v = multipliers[p];
        return v === undefined ? `${p}: (inactive)` : `${p}: ${v.toFixed(3)}x`;
    }).join(' | ');

    // append intensity->bpm mapping summary (show intensity:bpm)
    if (Array.isArray(bpmIntensityMapping) && bpmIntensityMapping.length) {
        const mapText = bpmIntensityMapping
            .map((pt) => `${pt.intensity.toFixed(0)}:${pt.bpm.toFixed(0)}`)
            .join(' | ');
        elements.mappingList.innerHTML +=
            '<br/><small style="opacity:0.85; margin-top:6px; display:block;">Mapping (intensity:bpm): ' +
            mapText +
            '</small>';
    }
}

/* Spinner animation -- uses preset nominal speed only (multiplier does not affect visual) */
function startSpinner() {
    if (!selectedPreset) return;
    if (spinnerAnimId) cancelAnimationFrame(spinnerAnimId);
    lastTs = null;
    spinnerAccum = spinnerAngle;
    lastSpinCount = Math.floor(spinnerAccum / 360);
    spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

function spinnerFrame(ts) {
    if (!lastTs) lastTs = ts;
    const dt = (ts - lastTs) / 1000.0;
    lastTs = ts;

    // update current spinner BPM smoothly if ramping, using the same ramp timeline
    if (ramping) {
        const t = clamp((ts - rampStartTime) / RAMP_MS, 0, 1);
        const s = t * t * (3 - 2 * t);
        spinnerCurrentBpm =
            spinnerStartBpm + (spinnerTargetBpm - spinnerStartBpm) * s;
        if (t >= 1) {
            ramping = false;
            spinnerCurrentBpm = spinnerTargetBpm;
        }
    } else {
        spinnerCurrentBpm = getBpmForIntensity(selectedPreset);
    }

    const spinsPerSecNominal = spinnerCurrentBpm / 60.0;
    const degDelta = dt * spinsPerSecNominal * 360;
    spinnerAccum += degDelta;
    spinnerAngle = spinnerAccum % 360;
    if (elements.spinnerRotor) {
        elements.spinnerRotor.style.transform = `rotate(${spinnerAngle}deg)`;
    }

    const spinCount = Math.floor(spinnerAccum / 360);
    if (spinCount > lastSpinCount) {
        const times = spinCount - lastSpinCount;
        lastSpinCount = spinCount;
        handleFullRotations(times);
    }

    spinnerAnimId = requestAnimationFrame(spinnerFrame);
}

/* Profiles: load from server and apply to UI */
async function loadProfilesFromServer() {
    try {
        const resp = await fetch('/api/calibration-profiles');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        window.__calibrationProfiles = data || {};
        const sel = elements.profileSelect;
        if (!sel) return;
        sel.innerHTML = '';
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '(none)';
        sel.appendChild(noneOpt);
        Object.keys(window.__calibrationProfiles).forEach((name) => {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            sel.appendChild(opt);
        });
    } catch (err) {
        console.error('Failed to load profiles', err);
    }
}

function applyProfile(profile) {
    PRESETS.forEach((p) => {
        if (
            profile &&
            Object.prototype.hasOwnProperty.call(profile, String(p))
        ) {
            multipliers[p] = parseFloat(profile[String(p)]);
        } else {
            delete multipliers[p];
        }
    });
    buildPresetButtons();

    // auto-select first active preset if any
    const first = PRESETS.find((p) => multipliers[p] !== undefined);
    if (first) {
        const btns = elements.presetsContainer.children;
        for (let i = 0; i < btns.length; i++) {
            const b = btns[i];
            if (b.textContent === String(first)) {
                selectPreset(first, b);
                break;
            }
        }
    } else {
        elements.multiplierInput.value = '1.00';
        elements.multiplierValue.textContent = '1.00';
        elements.selectedPreset.textContent = '—';
        setMultiplierControlsEnabled(false);
    }

    renderMappingList();
    renderMappingGraph(bpmIntensityMapping);
}

/* Events binding */
export function setup() {
    initWebSocket();
    initElements();
    buildPresetButtons();
    renderMappingList();

    fetch('/api/calibration-mapping')
        .then((r) => r.json())
        .then((mapping) => {
            bpmIntensityMapping = Array.isArray(mapping) ? mapping : [];
            renderMappingList();
            renderMappingGraph(bpmIntensityMapping);
            window.addEventListener('resize', () =>
                renderMappingGraph(bpmIntensityMapping)
            );
        })
        .catch((err) => {
            console.error('Failed to load BPM->intensity mapping:', err);
        });

    // load saved profiles
    loadProfilesFromServer().then(() => {
        if (elements.profileSelect) {
            elements.profileSelect.addEventListener('change', (e) => {
                const name = e.target.value;
                if (!name) return;
                const prof = window.__calibrationProfiles
                    ? window.__calibrationProfiles[name]
                    : null;
                if (prof) applyProfile(prof);
            });
        }
    });

    // multiplier controls
    elements.multDecLarge.addEventListener('click', () =>
        adjustMultiplier(-0.1)
    );
    elements.multDecSmall.addEventListener('click', () =>
        adjustMultiplier(-0.01)
    );
    elements.multIncSmall.addEventListener('click', () =>
        adjustMultiplier(+0.01)
    );
    elements.multIncLarge.addEventListener('click', () =>
        adjustMultiplier(+0.1)
    );
    elements.multiplierInput.addEventListener('change', (e) => {
        const val = parseFloat(e.target.value);
        if (!isNaN(val)) setMultiplier(val);
        else
            elements.multiplierInput.value = (
                multipliers[selectedPreset] || 1.0
            ).toFixed(2);
    });

    elements.startBtn.addEventListener('click', startCalibration);
    elements.stopBtn.addEventListener('click', stopCalibration);

    elements.resetBtn.addEventListener('click', () => resetSpinner(true));
    elements.spinner.addEventListener('click', () => resetSpinner(true));
    elements.spinner.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            resetSpinner(true);
        }
    });

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
    const active = PRESETS.filter((p) => multipliers[p] !== undefined);
    if (active.length === 0) return 1.0;
    if (active.length === 1) return multipliers[active[0]] ?? 1.0;
    if (v <= active[0]) return multipliers[active[0]];
    if (v >= active[active.length - 1])
        return multipliers[active[active.length - 1]];
    for (let i = 0; i < active.length - 1; i++) {
        const a = active[i],
            b = active[i + 1];
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

// Reset rotation to zero (keep same speed). If running, emit one click/flash so user can sync.
function resetSpinner(flash = true) {
    // set to zero position
    spinnerAccum = 0;
    spinnerAngle = 0;
    lastSpinCount = Math.floor(spinnerAccum / 360);
    if (elements.spinnerRotor)
        elements.spinnerRotor.style.transform = `rotate(0deg)`;
    // avoid a large delta on next frame
    lastTs = performance.now();
    // optional immediate click/flash to mark reset point
    if (running && flash) {
        handleFullRotations(1);
    }
}

function renderMappingGraph(mapping) {
    const canvas = document.getElementById('mapping-canvas');
    if (!canvas || !Array.isArray(mapping) || mapping.length === 0) return;

    const dpr = window.devicePixelRatio || 1;
    const cssWidth = canvas.clientWidth;
    const cssHeight = 120;
    canvas.width = Math.floor(cssWidth * dpr);
    canvas.height = Math.floor(cssHeight * dpr);
    canvas.style.height = cssHeight + 'px';

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    const pad = 12;
    const minIntensity = Math.min(...mapping.map((pt) => pt.intensity));
    const maxIntensity = Math.max(...mapping.map((pt) => pt.intensity));
    const minBpm = Math.min(...mapping.map((pt) => pt.bpm));
    const maxBpm = Math.max(...mapping.map((pt) => pt.bpm));
    const intRange = maxIntensity - minIntensity || 1;
    const bpmRange = maxBpm - minBpm || 1;

    const xFor = (i) =>
        pad + ((i - minIntensity) / intRange) * (cssWidth - pad * 2);
    const yFor = (b) =>
        cssHeight - pad - ((b - minBpm) / bpmRange) * (cssHeight - pad * 2);

    // grid lines (vertical for intensity, horizontal for bpm)
    ctx.strokeStyle = '#333';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let j = 0; j <= 4; j++) {
        const val = minIntensity + (j / 4) * (maxIntensity - minIntensity);
        const x = xFor(val);
        ctx.moveTo(x, pad);
        ctx.lineTo(x, cssHeight - pad);
    }
    for (let j = 0; j <= 4; j++) {
        const val = minBpm + (j / 4) * (maxBpm - minBpm);
        const y = yFor(val);
        ctx.moveTo(pad, y);
        ctx.lineTo(cssWidth - pad, y);
    }
    ctx.stroke();

    // baseline polyline (intensity -> bpm) - sort by intensity for a clean line
    const sorted = mapping.slice().sort((a, b) => a.intensity - b.intensity);
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0,200,0,0.95)';
    ctx.lineWidth = 2;
    sorted.forEach((pt, i) => {
        const x = xFor(pt.intensity);
        const y = yFor(pt.bpm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // baseline points
    ctx.fillStyle = '#fff';
    sorted.forEach((pt) => {
        const x = xFor(pt.intensity);
        const y = yFor(pt.bpm);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // calibrated polyline: apply multiplier to BPM so same intensity -> higher BPM
    const calibrated = sorted.map((pt) => {
        const rawI = clamp(pt.intensity, minIntensity, maxIntensity);
        const mult = getCalibrationMultiplier(rawI);
        const calBpm = clamp(pt.bpm * mult, minBpm, maxBpm);
        return { intensity: rawI, bpm: calBpm };
    });

    ctx.beginPath();
    ctx.strokeStyle = 'rgba(255,140,0,0.95)';
    ctx.lineWidth = 2;
    calibrated.forEach((pt, i) => {
        const x = xFor(pt.intensity);
        const y = yFor(pt.bpm);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // calibrated points
    ctx.fillStyle = 'rgba(255,140,0,0.95)';
    calibrated.forEach((pt) => {
        const x = xFor(pt.intensity);
        const y = yFor(pt.bpm);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
    });

    // labels + legend
    ctx.fillStyle = '#ddd';
    ctx.font = '12px sans-serif';
    ctx.fillText(`${minIntensity.toFixed(0)}`, pad, 12);
    ctx.fillText(`${maxIntensity.toFixed(0)}`, cssWidth - pad - 56, 12);
    ctx.fillText('Intensity →', cssWidth / 2 - 30, cssHeight - 4);

    ctx.save();
    ctx.translate(8, cssHeight / 2 + 30);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('BPM', 0, 0);
    ctx.restore();

    // legend: bottom-right
    const legendWidth = 120;
    const legendPadding = 8;
    const legendRectSize = 10;
    const legendRight = cssWidth - pad - legendPadding;
    const legendLeft = legendRight - legendWidth;
    const legendTop = cssHeight - pad - 18; // place legend just above bottom padding

    // draw legend entries (aligned vertically centered with rect)
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,200,0,0.95)';
    ctx.fillRect(legendLeft, legendTop, legendRectSize, legendRectSize);
    ctx.fillStyle = '#ddd';
    ctx.fillText(
        'Baseline',
        legendLeft + legendRectSize + 6,
        legendTop + legendRectSize / 2
    );

    ctx.fillStyle = 'rgba(255,140,0,0.95)';
    ctx.fillRect(legendLeft + 56, legendTop, legendRectSize, legendRectSize);
    ctx.fillStyle = '#ddd';
    ctx.fillText(
        'Calibrated',
        legendLeft + 56 + legendRectSize + 6,
        legendTop + legendRectSize / 2
    );
    ctx.textBaseline = 'alphabetic';
}
