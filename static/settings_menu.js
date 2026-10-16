// static/settings_menu.js

import {
    setAbsoluteMaximum,
    getAbsoluteMaximum,
    setVibrateMode,
    loadFunscript,
    setSelectedFunscriptVariant,
    getSelectedFunscriptVariant,
    getVibrateMode,
    setSelectedSpeed,
    getSelectedSpeed,
    getLastIntensityStats
} from './funscript_handler.js';
import {
    toFunscriptPath,
    getCurrentVideoPath,
    getCurrentFunscriptUrl,
    intensityToColor,
    volatilityToColor,
    formatDuration,
    updateSbsPlayingState
} from './utils.js';
import { showTemporaryOverlayMessage } from './utils_ui.js';
import { renderIntensityGraphHUD } from './funscript_display_graphs.js';
import {
    setupCalibration,
    stopCalibration,
    saveCalibrationOnClose
} from './calibration.js';

let initialized = false;

// ── Public API ─────────────────────────────────────────────────────────

export function createSettingsMenu() {
    ensureInit();
    return document.getElementById('settings-menu');
}

export function toggleSettingsMenu() {
    ensureInit();
    const menu = document.getElementById('settings-menu');
    if (!menu) return;

    const opened = menu.classList.toggle('visible');
    if (!opened) {
        document.body.style.overflow = '';
        return;
    }

    updateIntensityDisplay();
    document.body.style.overflow = 'hidden';

    const cleanup = () => {
        menu.classList.remove('visible');
        document.body.style.overflow = '';
        document.removeEventListener('click', onDocClick);
        document.removeEventListener('keydown', onKey);
    };

    const onDocClick = (e) => {
        if (!menu.contains(e.target)) cleanup();
    };
    const onKey = (e) => {
        if (e.key === 'Escape') cleanup();
    };

    setTimeout(() => {
        document.addEventListener('click', onDocClick);
        document.addEventListener('keydown', onKey);
    }, 0);
}

export async function refreshVariantsForCurrentVideo() {
    ensureInit();
    const videoPath = getCurrentVideoPath();
    if (!videoPath) return;

    const listUrl = `/site/funscripts/${toFunscriptPath(videoPath)}?list=1`;

    try {
        const resp = await fetch(listUrl);
        if (!resp.ok) return;

        const data = await resp.json();
        const select = document.getElementById('funscript-variant-select');
        if (!select) return;

        const serverVariants = Array.isArray(data.variants)
            ? data.variants
            : [];

        const variantRow = select.closest('.variant-row');
        const variantLabel = variantRow?.previousElementSibling;
        const hasVariants = serverVariants.length > 1;

        if (variantRow && variantLabel) {
            variantRow.style.display = hasVariants ? 'flex' : 'none';
            variantLabel.style.display = hasVariants ? 'block' : 'none';
        }

        const variants = serverVariants.length ? serverVariants : ['original'];

        select.innerHTML = '';
        for (const v of variants) {
            const opt = document.createElement('option');
            opt.value = v;
            opt.text = v;
            select.appendChild(opt);
        }

        const preferred = getSelectedFunscriptVariant() || 'original';
        if (variants.includes(preferred)) select.value = preferred;
        else if (variants.includes('original')) select.value = 'original';
        else if (select.options.length > 0) select.selectedIndex = 0;

        setSelectedFunscriptVariant(select.value);
    } catch (err) {
        console.error('Failed to refresh funscript variants', err);
    }
}

export function updateIntensityDisplay() {
    const stats = getLastIntensityStats();
    const peakEl = document.getElementById('settings-peak-val');
    const avgEl = document.getElementById('settings-avg-val');
    const volEl = document.getElementById('settings-vol-val');
    const durEl = document.getElementById('settings-dur-val');

    peakEl.textContent = Math.round(stats.peak);
    peakEl.style.color = intensityToColor(stats.peak);

    avgEl.textContent = Math.round(stats.avg);
    avgEl.style.color = intensityToColor(stats.avg);

    volEl.textContent = Number(stats.volatility).toFixed(1);
    volEl.style.color = volatilityToColor(stats.volatility || 0);

    durEl.textContent = formatDuration(stats.duration);
}

export function setSBSMode(enabled) {
    const toggle = document.getElementById('sbs-toggle');
    const container = document.getElementById('video-container');
    if (toggle && container) {
        toggle.checked = enabled;
        localStorage.setItem('sbsMode', enabled);
        container.classList.toggle('sbs-mode', enabled);
        updateSbsPlayingState();
    }
}

export function isHardLimitUnlocked() {
    const input = document.getElementById('max-intensity-limit-input');
    return input ? !input.disabled : false;
}

async function syncMaxLimit(maxIntensityLimit) {
    try {
        await fetch('/api/max-intensity-limit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ max_intensity_limit: maxIntensityLimit })
        });
    } catch (err) {
        console.error('Failed to sync max limit to server:', err);
    }
}

// ── Initialization ─────────────────────────────────────────────────────

function ensureInit() {
    if (initialized) return;
    initialized = true;

    const menu = document.getElementById('settings-menu');
    if (!menu) return;

    initSBSToggle(menu);
    initLoopToggle(menu);
    initVariantSelect(menu);
    initCalibrationButton(menu);
    initCalibrationOverlayEvents();
    initHardLimit(menu);
    initVibrateMode(menu);
    initSpeedMode(menu);
    initEditorButton(menu);
}

function initSBSToggle(menu) {
    const toggle = menu.querySelector('#sbs-toggle');
    const container = document.getElementById('video-container');
    if (!toggle || !container) return;

    const saved = localStorage.getItem('sbsMode') === 'true';
    toggle.checked = saved;
    if (saved) container.classList.add('sbs-mode');

    toggle.onchange = () => {
        localStorage.setItem('sbsMode', toggle.checked);
        container.classList.toggle('sbs-mode', toggle.checked);
        updateSbsPlayingState();
    };
}

function initLoopToggle(menu) {
    const btn = menu.querySelector('#loop-toggle');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const video = document.querySelector('video');
        if (!video) return;
        video.loop = !video.loop;
        btn.textContent = `Loop: ${video.loop ? 'On' : 'Off'}`;
    });
}

function initVariantSelect(menu) {
    const select = menu.querySelector('#funscript-variant-select');
    const refreshBtn = menu.querySelector('#refresh-variants-button');

    if (select) {
        if (![...select.options].some((o) => o.value === 'original')) {
            const opt = document.createElement('option');
            opt.value = 'original';
            opt.text = 'original';
            select.appendChild(opt);
        }

        select.value = getSelectedFunscriptVariant() || 'original';

        select.addEventListener('change', async () => {
            setSelectedFunscriptVariant(select.value);
            const baseUrl = getCurrentFunscriptUrl();
            if (baseUrl) {
                await loadFunscript(baseUrl);
                updateIntensityDisplay();
            }
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshVariantsForCurrentVideo);
    }
}

function initCalibrationButton(menu) {
    const btn = menu.querySelector('#calibration-button');
    if (!btn) return;
    btn.addEventListener('click', openCalibrationOverlay);
}

function initHardLimit(menu) {
    const lockBtn = menu.querySelector('#max-intensity-limit-lock-button');
    const input = menu.querySelector('#max-intensity-limit-input');
    if (!input) return;

    input.value = getAbsoluteMaximum().toString();
    input.disabled = true;

    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            input.disabled = !input.disabled;
            lockBtn.textContent = input.disabled ? 'Unlock' : 'Lock';

            if (!input.disabled) {
                const video = document.querySelector('#video-player video');
                if (video && !video.paused) {
                    video.pause();
                    showTemporaryOverlayMessage(
                        'Playback paused: Max Intensity Limit unlocked.'
                    );
                }
            }
        });
    }

    input.addEventListener('change', () => {
        const value = parseInt(input.value, 10);
        if (value >= 0 && value <= 100) {
            setAbsoluteMaximum(value);
            syncMaxLimit(value);
        } else {
            showTemporaryOverlayMessage(
                'Please enter a value between 0 and 100.'
            );
            input.value = getAbsoluteMaximum().toString();
        }
    });
}

function initVibrateMode(menu) {
    const select = menu.querySelector('#vibrate-mode-select');
    if (!select) return;

    select.value = getVibrateMode?.() ?? 'Rate';
    select.addEventListener('change', () => setVibrateMode(select.value));
}

function initEditorButton(menu) {
    const btn = menu.querySelector('#open-editor-button');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const videoPath = getCurrentVideoPath();
        if (!videoPath) {
            showTemporaryOverlayMessage(
                'No video loaded. Open a video from the directory first.'
            );
            return;
        }
        window.open(
            `/site/editor?video=${encodeURIComponent(videoPath)}`,
            '_blank'
        );
    });
}

function initSpeedMode(menu) {
    const select = menu.querySelector('#speed-mode-select');
    if (!select) return;

    select.value = getSelectedSpeed() || 'normal';
    select.addEventListener('change', async () => {
        setSelectedSpeed(select.value);
        const baseUrl = getCurrentFunscriptUrl();
        if (baseUrl) {
            await loadFunscript(baseUrl);
            updateIntensityDisplay();
        }
    });
}

// ── Calibration Overlay ────────────────────────────────────────────────

function initCalibrationOverlayEvents() {
    const overlay = document.getElementById('calibration-overlay');
    if (!overlay) return;

    const closeBtn = document.getElementById('calibration-close-btn');
    closeBtn?.addEventListener('click', closeCalibrationOverlay);

    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCalibrationOverlay();
    });

    document.addEventListener(
        'keydown',
        (e) => {
            if (e.key === 'Escape' && !overlay.classList.contains('hidden')) {
                e.stopImmediatePropagation();
                closeCalibrationOverlay();
            }
        },
        { capture: true }
    );
}

async function openCalibrationOverlay() {
    const overlay = document.getElementById('calibration-overlay');
    if (!overlay) return;

    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';

    await setupCalibration();
}

async function closeCalibrationOverlay() {
    const overlay = document.getElementById('calibration-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return;

    stopCalibration();

    try {
        await saveCalibrationOnClose();
    } catch (err) {
        console.error('Failed to save calibration on close', err);
    }

    updateIntensityDisplay();
    const videoEl = document.querySelector('#video-player video');
    if (videoEl) {
        renderIntensityGraphHUD(videoEl.currentTime * 1000);
    }

    document.body.style.overflow = '';
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
}
