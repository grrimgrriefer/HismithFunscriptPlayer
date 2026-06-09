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
    getSelectedSpeed
} from './funscript_handler.js';
import { toFunscriptPath } from './utils.js';

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

// ── Helpers ────────────────────────────────────────────────────────────

function getCurrentVideoPath() {
    const videoEl = document.querySelector('#video-player video');
    if (!videoEl?.src) return null;

    const url = new URL(videoEl.src, window.location.origin);
    const match = url.pathname.match(/\/site\/video\/(.+)/);
    return match ? match[1] : url.pathname;
}

function getBaseFunscriptUrl() {
    const videoPath = getCurrentVideoPath();
    if (!videoPath) return null;
    return `/site/funscripts/${toFunscriptPath(videoPath)}`;
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

        select.addEventListener('change', () => {
            setSelectedFunscriptVariant(select.value);
            const baseUrl = getBaseFunscriptUrl();
            if (baseUrl) loadFunscript(baseUrl);
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
    const lockBtn = menu.querySelector('#hard-limit-lock-button');
    const input = menu.querySelector('#hard-limit-input');
    if (!input) return;

    input.value = getAbsoluteMaximum().toString();
    input.disabled = true;

    if (lockBtn) {
        lockBtn.addEventListener('click', () => {
            input.disabled = !input.disabled;
            lockBtn.textContent = input.disabled ? 'Unlock' : 'Lock';
        });
    }

    input.addEventListener('change', () => {
        const value = parseInt(input.value, 10);
        if (value >= 0 && value <= 100) {
            setAbsoluteMaximum(value);
        } else {
            alert('Please enter a value between 0 and 100.');
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
            alert('No video loaded. Open a video from the directory first.');
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
    select.addEventListener('change', () => {
        setSelectedSpeed(select.value);
        const baseUrl = getBaseFunscriptUrl();
        if (baseUrl) loadFunscript(baseUrl);
    });
}

// ── Calibration Overlay ────────────────────────────────────────────────

async function openCalibrationOverlay() {
    if (document.getElementById('calibration-overlay')) return;

    const html = await fetchCalibrationHtml();
    if (!html) return;

    const overlay = buildOverlay(html);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    await initCalibrationModule();
    bindOverlayClose(overlay);
}

async function fetchCalibrationHtml() {
    try {
        const resp = await fetch('/site/static/calibration.html');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const text = await resp.text();
        const doc = new DOMParser().parseFromString(text, 'text/html');
        const card = doc.querySelector('.card');
        return card ? card.outerHTML : doc.body.innerHTML;
    } catch (err) {
        console.error('Failed to fetch calibration UI', err);
        alert('Failed to load calibration UI');
        return null;
    }
}

function buildOverlay(cardHtml) {
    const overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.className = 'calibration-overlay';

    const inner = document.createElement('div');
    inner.className = 'calibration-inner';
    inner.innerHTML = cardHtml;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.className = 'btn btn-sm overlay-close-btn';

    inner.appendChild(closeBtn);
    overlay.appendChild(inner);
    return overlay;
}

async function initCalibrationModule() {
    try {
        const mod = await import('/site/static/calibration.js');
        if (typeof mod.setup === 'function') mod.setup();
        window.__calibrationModule = mod;
    } catch (err) {
        console.error('Failed to load calibration module', err);
    }
}

function bindOverlayClose(overlay) {
    const closeBtn = overlay.querySelector('.btn.btn-sm');
    const confirmBtn = overlay.querySelector('#confirm-button');

    async function closeOverlay() {
        overlay.querySelector('#stop-button')?.click();

        try {
            await window.__calibrationModule?.saveOnClose?.();
        } catch (err) {
            console.error('Failed to save calibration on close', err);
        }

        document.body.style.overflow = '';
        document.removeEventListener('keydown', onKey);
        overlay.remove();
    }

    const onKey = (e) => {
        if (e.key === 'Escape') closeOverlay();
    };

    closeBtn?.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });

    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            overlay.querySelector('#stop-button')?.click();
            setTimeout(closeOverlay, 60);
        });
    }

    document.addEventListener('keydown', onKey);
}
