// static/settings_menu.js

import {
    setAbsoluteMaximum,
    getAbsoluteMaximum,
    setVibrateMode,
    loadFunscript,
    setSelectedFunscriptVariant,
    getSelectedFunscriptVariant,
    getVibrateMode
} from './funscript_handler.js';

let initialized = false;

export function createSettingsMenu() {
    ensureInit();
    return document.getElementById('settings-menu');
}

function ensureInit() {
    if (initialized) return;
    initialized = true;

    const menu = document.getElementById('settings-menu');
    if (!menu) return;

    // Loop toggle
    const loopToggle = menu.querySelector('#loop-toggle');
    if (loopToggle) {
        loopToggle.addEventListener('click', () => {
            const videoElement = document.querySelector('video');
            if (!videoElement) return;
            videoElement.loop = !videoElement.loop;
            loopToggle.textContent = `Loop: ${videoElement.loop ? 'On' : 'Off'}`;
        });
    }

    // Variant select + refresh
    const variantSelect = menu.querySelector('#funscript-variant-select');
    const refreshBtn = menu.querySelector('#refresh-variants-button');
    if (variantSelect) {
        // ensure there's at least the original option
        if (![...variantSelect.options].some((o) => o.value === 'original')) {
            const opt = document.createElement('option');
            opt.value = 'original';
            opt.text = 'original';
            variantSelect.appendChild(opt);
        }
        variantSelect.value = getSelectedFunscriptVariant() || 'original';
        variantSelect.addEventListener('change', async () => {
            const sel = variantSelect.value;
            setSelectedFunscriptVariant(sel);
            const videoEl = document.querySelector('#video-player video');
            if (videoEl && videoEl.src) {
                try {
                    const url = new URL(videoEl.src, window.location.origin);
                    const m = url.pathname.match(/\/site\/video\/(.+)/);
                    const videoPath = m ? m[1] : url.pathname;
                    const baseFunscript = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, '.funscript')}`;
                    loadFunscript(baseFunscript);
                } catch (e) {
                    console.error('Failed to reload funscript', e);
                }
            }
        });
    }
    if (refreshBtn)
        refreshBtn.addEventListener('click', () =>
            refreshVariantsForCurrentVideo()
        );

    // Calibration overlay opener
    const calibrationButton = menu.querySelector('#calibration-button');
    if (calibrationButton) {
        calibrationButton.addEventListener('click', async () => {
            openCalibrationOverlay();
        });
    }

    // Hard limit lock + input
    const hardLimitLockButton = menu.querySelector('#hard-limit-lock-button');
    const hardLimitInput = menu.querySelector('#hard-limit-input');
    if (hardLimitInput) {
        hardLimitInput.value = getAbsoluteMaximum().toString();
        hardLimitInput.disabled = true;
        if (hardLimitLockButton) {
            hardLimitLockButton.addEventListener('click', () => {
                if (hardLimitInput.disabled) {
                    hardLimitInput.disabled = false;
                    hardLimitLockButton.textContent = 'Lock';
                } else {
                    hardLimitInput.disabled = true;
                    hardLimitLockButton.textContent = 'Unlock';
                }
            });
        }
        hardLimitInput.addEventListener('change', () => {
            const value = parseInt(hardLimitInput.value, 10);
            if (value >= 0 && value <= 100) {
                setAbsoluteMaximum(value);
            } else {
                alert('Please enter a value between 0 and 100.');
                hardLimitInput.value = getAbsoluteMaximum().toString();
            }
        });
    }

    // Vibrate mode
    const vibrateModeSelect = menu.querySelector('#vibrate-mode-select');
    if (vibrateModeSelect) {
        vibrateModeSelect.value =
            typeof getVibrateMode === 'function' ? getVibrateMode() : 'Rate';
        vibrateModeSelect.addEventListener('change', () => {
            setVibrateMode(vibrateModeSelect.value);
        });
    }

    // Open editor
    const editorButton = menu.querySelector('#open-editor-button');
    if (editorButton) {
        editorButton.addEventListener('click', () => {
            const videoEl = document.querySelector('#video-player video');
            let videoPath = null;
            if (videoEl && videoEl.src) {
                try {
                    const url = new URL(videoEl.src, window.location.origin);
                    const m = url.pathname.match(/\/site\/video\/(.+)/);
                    if (m) videoPath = m[1];
                    else videoPath = url.pathname;
                } catch (e) {
                    videoPath =
                        videoEl.getAttribute('src') || videoEl.src || '';
                }
            }
            if (!videoPath) {
                alert(
                    'No video loaded. Open a video from the directory first.'
                );
                return;
            }
            const editorUrl = `/site/editor?video=${encodeURIComponent(videoPath)}`;
            window.open(editorUrl, '_blank');
        });
    }
}

function currentVideoPathFromPlayer() {
    const videoEl = document.querySelector('#video-player video');
    if (!videoEl || !videoEl.src) return null;
    const url = new URL(videoEl.src, window.location.origin);
    const m = url.pathname.match(/\/site\/video\/(.+)/);
    return m ? m[1] : url.pathname;
}

export async function refreshVariantsForCurrentVideo() {
    ensureInit();
    const videoPath = currentVideoPathFromPlayer();
    if (!videoPath) return;
    const listUrl = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, '.funscript')}?list=1`;
    try {
        const resp = await fetch(listUrl);
        if (!resp.ok) return;
        const data = await resp.json();
        const select = document.getElementById('funscript-variant-select');
        if (!select) return;

        const serverVariants = Array.isArray(data.variants)
            ? data.variants
            : [];
        const variants = serverVariants.length ? serverVariants : ['original'];

        select.innerHTML = '';
        variants.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.text = v;
            select.appendChild(opt);
        });

        const preferred = getSelectedFunscriptVariant() || 'original';
        if (variants.includes(preferred)) select.value = preferred;
        else if (variants.includes('original')) select.value = 'original';
        else if (select.options.length > 0) select.selectedIndex = 0;

        setSelectedFunscriptVariant(select.value);
    } catch (err) {
        console.error('Failed to refresh funscript variants', err);
    }
}

export function toggleSettingsMenu() {
    // ensure the menu exists and is initialized
    ensureInit();
    const settingsMenu = document.getElementById('settings-menu');
    if (!settingsMenu) return;

    const opened = settingsMenu.classList.toggle('visible');
    if (opened) {
        document.body.style.overflow = 'hidden';
        const onDocClick = (e) => {
            if (!settingsMenu.contains(e.target)) {
                settingsMenu.classList.remove('visible');
                document.body.style.overflow = '';
                document.removeEventListener('click', onDocClick);
                document.removeEventListener('keydown', onKey);
            }
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                settingsMenu.classList.remove('visible');
                document.body.style.overflow = '';
                document.removeEventListener('click', onDocClick);
                document.removeEventListener('keydown', onKey);
            }
        };
        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onKey);
        }, 0);
    } else {
        document.body.style.overflow = '';
    }
}

// lightweight calibration overlay opener
async function openCalibrationOverlay() {
    if (document.getElementById('calibration-overlay')) return;

    let resp;
    try {
        resp = await fetch('/site/static/calibration.html');
    } catch (err) {
        console.error('Failed to fetch calibration UI', err);
        alert('Failed to load calibration UI');
        return;
    }
    if (!resp.ok) {
        alert('Failed to load calibration UI');
        return;
    }
    const html = await resp.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    // extract card
    const card = doc.querySelector('.card')
        ? doc.querySelector('.card').outerHTML
        : doc.body.innerHTML;

    const overlay = document.createElement('div');
    overlay.id = 'calibration-overlay';
    overlay.className = 'calibration-overlay';

    const inner = document.createElement('div');
    inner.className = 'calibration-inner';
    inner.innerHTML = card;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close';
    closeBtn.className = 'btn btn-sm';
    Object.assign(closeBtn.style, {
        position: 'absolute',
        top: '-12px',
        right: '-12px',
        padding: '6px 10px',
        borderRadius: '50%',
        border: 'none',
        background: 'rgb(70,70,70)',
        color: 'white',
        cursor: 'pointer',
        fontSize: '16px'
    });
    inner.appendChild(closeBtn);
    overlay.appendChild(inner);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // initialize calibration module if present
    try {
        const mod = await import('/site/static/calibration.js');
        if (mod && typeof mod.setup === 'function') mod.setup();
    } catch (err) {
        console.error('Failed to load calibration module', err);
    }

    function closeOverlay() {
        const stopBtn = overlay.querySelector('#stop-button');
        if (stopBtn) stopBtn.click();
        document.body.style.overflow = '';
        document.removeEventListener('keydown', keyHandler);
        overlay.remove();
    }
    closeBtn.addEventListener('click', closeOverlay);
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeOverlay();
    });

    const confirmBtn = overlay.querySelector('#confirm-button');
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            const stopBtn = overlay.querySelector('#stop-button');
            if (stopBtn) stopBtn.click();
            setTimeout(closeOverlay, 60);
        });
    }
    function keyHandler(e) {
        if (e.key === 'Escape') closeOverlay();
    }
    document.addEventListener('keydown', keyHandler);
}
