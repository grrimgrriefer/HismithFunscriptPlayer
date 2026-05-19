// static/settings_menu.js

import {
    setAbsoluteMaximum,
    getAbsoluteMaximum,
    setVibrateMode,
    loadFunscript,
    setSelectedFunscriptVariant,
    getSelectedFunscriptVariant
} from './funscript_handler.js';

export function createSettingsMenu() {
    let settingsMenu = document.getElementById('settings-menu');
    if (!settingsMenu) {
        settingsMenu = document.createElement('div');
        settingsMenu.id = 'settings-menu';
        settingsMenu.className = 'settings-menu';

        // Loop toggle
        const loopToggle = document.createElement('button');
        loopToggle.id = 'loop-toggle';
        loopToggle.textContent = 'Loop: Off';
        loopToggle.className = 'btn';
        loopToggle.onclick = () => {
            const videoElement = document.querySelector('video');
            videoElement.loop = !videoElement.loop;
            loopToggle.textContent = `Loop: ${videoElement.loop ? 'On' : 'Off'}`;
        };
        settingsMenu.appendChild(loopToggle);

        // Variant label + select + refresh
        const variantLabel = document.createElement('label');
        variantLabel.textContent = 'Funscript Variant: ';
        variantLabel.className = 'settings-label';

        const variantSelect = document.createElement('select');
        variantSelect.id = 'funscript-variant-select';
        variantSelect.className = 'settings-select';
        const optDefault = document.createElement('option');
        optDefault.value = 'original';
        optDefault.text = 'original';
        variantSelect.appendChild(optDefault);
        variantSelect.value = getSelectedFunscriptVariant();
        variantSelect.onchange = () => {
            const sel = variantSelect.value;
            setSelectedFunscriptVariant(sel);
            // Reload funscript for current video (if any)
            const videoEl = document.querySelector('#video-player video');
            if (videoEl && videoEl.src) {
                const url = new URL(videoEl.src, window.location.origin);
                const m = url.pathname.match(/\/site\/video\/(.+)/);
                const videoPath = m ? m[1] : url.pathname;
                const baseFunscript = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, '.funscript')}`;
                loadFunscript(baseFunscript);
            }
        };

        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'refresh-variants-button';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.className = 'btn btn-sm';
        refreshBtn.onclick = () => refreshVariantsForCurrentVideo();

        const variantRow = document.createElement('div');
        variantRow.className = 'variant-row';
        variantRow.appendChild(variantSelect);
        variantRow.appendChild(refreshBtn);

        settingsMenu.appendChild(variantLabel);
        settingsMenu.appendChild(variantRow);

        // Calibration button (opens overlay)
        const calibrationButton = document.createElement('button');
        calibrationButton.id = 'calibration-button';
        calibrationButton.textContent = 'Calibration';
        calibrationButton.className = 'btn btn-sm';

        // open overlay handler
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

            // inject style from fetched page once
            const remoteStyle = doc.querySelector('head > style');
            if (
                remoteStyle &&
                !document.getElementById('calibration-style-injected')
            ) {
                const styleEl = document.createElement('style');
                styleEl.id = 'calibration-style-injected';
                styleEl.textContent = remoteStyle.textContent;
                document.head.appendChild(styleEl);
            }

            // extract the card (main content)
            const card = doc.querySelector('.card')
                ? doc.querySelector('.card').outerHTML
                : doc.body.innerHTML;

            // create overlay
            const overlay = document.createElement('div');
            overlay.id = 'calibration-overlay';
            overlay.className = 'calibration-overlay';

            const inner = document.createElement('div');
            inner.className = 'calibration-inner';
            inner.innerHTML = card;

            // close (X) button
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

            // dynamic import and initialize the calibration module
            try {
                const mod = await import('/site/static/calibration.js');
                if (mod && typeof mod.setup === 'function') {
                    mod.setup();
                }
            } catch (err) {
                console.error('Failed to load calibration module', err);
            }

            // helper to stop calibration (click stop btn) and remove overlay
            function closeOverlay() {
                const stopBtn = overlay.querySelector('#stop-button');
                if (stopBtn) stopBtn.click();
                document.body.style.overflow = '';
                document.removeEventListener('keydown', keyHandler);
                overlay.remove();
            }

            // close on X
            closeBtn.addEventListener('click', closeOverlay);

            // close when clicking outside the card
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) closeOverlay();
            });

            // close when confirm is pressed (confirm applies mapping; we also stop and close)
            const confirmBtn = overlay.querySelector('#confirm-button');
            if (confirmBtn) {
                confirmBtn.addEventListener('click', () => {
                    const stopBtn = overlay.querySelector('#stop-button');
                    if (stopBtn) stopBtn.click();
                    // short delay to allow stop to run
                    setTimeout(closeOverlay, 60);
                });
            }

            // ESC to close
            function keyHandler(e) {
                if (e.key === 'Escape') closeOverlay();
            }
            document.addEventListener('keydown', keyHandler);
        }

        calibrationButton.onclick = () => openCalibrationOverlay();
        settingsMenu.appendChild(calibrationButton);

        // Hard limit input with lock
        const hardLimitInputLabel = document.createElement('label');
        hardLimitInputLabel.className = 'settings-label';
        hardLimitInputLabel.textContent = 'Max Intensity Limit: ';

        const hardLimitLockButton = document.createElement('button');
        hardLimitLockButton.id = 'hard-limit-lock-button';
        hardLimitLockButton.textContent = 'Unlock';
        hardLimitLockButton.className = 'btn btn-sm';

        const hardLimitInput = document.createElement('input');
        hardLimitInput.id = 'hard-limit-input';
        hardLimitInput.type = 'number';
        hardLimitInput.min = '0';
        hardLimitInput.max = '100';
        hardLimitInput.value = getAbsoluteMaximum().toString();
        hardLimitInput.className = 'settings-input';
        hardLimitInput.disabled = true;

        hardLimitLockButton.onclick = () => {
            if (hardLimitInput.disabled) {
                hardLimitInput.disabled = false;
                hardLimitLockButton.textContent = 'Lock';
                hardLimitLockButton.classList.remove('locked');
            } else {
                hardLimitInput.disabled = true;
                hardLimitLockButton.textContent = 'Unlock';
                hardLimitLockButton.classList.add('locked');
            }
        };

        hardLimitInput.onchange = () => {
            const value = parseInt(hardLimitInput.value, 10);
            if (value >= 0 && value <= 100) {
                setAbsoluteMaximum(value);
            } else {
                alert('Please enter a value between 0 and 100.');
                hardLimitInput.value = getAbsoluteMaximum().toString();
            }
        };

        hardLimitInputLabel.appendChild(hardLimitLockButton);
        hardLimitInputLabel.appendChild(hardLimitInput);
        settingsMenu.appendChild(hardLimitInputLabel);

        // Vibrate mode
        const vibrateModeLabel = document.createElement('label');
        vibrateModeLabel.textContent = 'Vibrate Mode: ';
        vibrateModeLabel.className = 'settings-label';

        const vibrateModeSelect = document.createElement('select');
        vibrateModeSelect.id = 'vibrate-mode-select';
        vibrateModeSelect.className = 'settings-select';
        ['Rate', 'Beat'].forEach((mode) => {
            const option = document.createElement('option');
            option.value = mode; // keep the same capitalization used across the app
            option.textContent = mode;
            vibrateModeSelect.appendChild(option);
        });
        vibrateModeSelect.value = getSelectedFunscriptVariant()
            ? getSelectedFunscriptVariant()
            : 'Rate';
        vibrateModeSelect.value =
            typeof window !== 'undefined' && window.getVibrateMode
                ? window.getVibrateMode()
                : 'Rate';
        vibrateModeSelect.onchange = () => {
            setVibrateMode(vibrateModeSelect.value);
        };

        settingsMenu.appendChild(vibrateModeLabel);
        settingsMenu.appendChild(vibrateModeSelect);

        // Open editor for current video
        const editorButton = document.createElement('button');
        editorButton.id = 'open-editor-button';
        editorButton.textContent = 'Open Editor';
        editorButton.className = 'btn';
        editorButton.style.marginTop = '10px';
        editorButton.onclick = () => {
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
        };
        settingsMenu.appendChild(editorButton);

        document.body.appendChild(settingsMenu);
    }

    return settingsMenu;
}

function currentVideoPathFromPlayer() {
    const videoEl = document.querySelector('#video-player video');
    if (!videoEl || !videoEl.src) return null;

    const url = new URL(videoEl.src, window.location.origin);
    const m = url.pathname.match(/\/site\/video\/(.+)/);
    return m ? m[1] : url.pathname;
}

export async function refreshVariantsForCurrentVideo() {
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

        // rebuild options
        select.innerHTML = '';
        variants.forEach((v) => {
            const opt = document.createElement('option');
            opt.value = v;
            opt.text = v;
            select.appendChild(opt);
        });

        // prefer the handler's selected variant, fall back to 'original' or first available
        const preferred = getSelectedFunscriptVariant() || 'original';
        if (variants.includes(preferred)) {
            select.value = preferred;
        } else if (variants.includes('original')) {
            select.value = 'original';
        } else if (select.options.length > 0) {
            select.selectedIndex = 0;
        }

        // ensure handler and UI stay in sync
        setSelectedFunscriptVariant(select.value);
    } catch (err) {
        console.error('Failed to refresh funscript variants', err);
    }
}

export function toggleSettingsMenu() {
    // ensure the menu exists (robust if createSettingsMenu wasn't run)
    let settingsMenu = document.getElementById('settings-menu');
    if (!settingsMenu) settingsMenu = createSettingsMenu();

    // toggle visibility via class to avoid computed/inline display race
    const opened = settingsMenu.classList.toggle('visible');

    if (opened) {
        document.body.style.overflow = 'hidden';

        // close on outside click or Escape (one-time handlers)
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
        // attach after a tick so the click that opened it doesn't immediately close it
        setTimeout(() => {
            document.addEventListener('click', onDocClick);
            document.addEventListener('keydown', onKey);
        }, 0);
    } else {
        document.body.style.overflow = '';
    }
}
