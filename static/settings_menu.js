// static/settings_menu.js

import { setAbsoluteMaximum, getAbsoluteMaximum, setVibrateMode, loadFunscript, setSelectedFunscriptVariant, getSelectedFunscriptVariant } from './funscript_handler.js?v=258';

export function createSettingsMenu() {
    let settingsMenu = document.getElementById('settings-menu');
    if (!settingsMenu) {
        settingsMenu = document.createElement('div');
        settingsMenu.id = 'settings-menu';
        settingsMenu.style.position = 'absolute';
        settingsMenu.style.top = '60px';
        settingsMenu.style.right = '10px';
        settingsMenu.style.width = '250px';
        settingsMenu.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        settingsMenu.style.color = 'white';
        settingsMenu.style.padding = '10px';
        settingsMenu.style.borderRadius = '5px';
        settingsMenu.style.boxShadow = '0 4px 8px rgba(0, 0, 0, 0.2)';
        settingsMenu.style.display = 'none'; // Hidden by default
        settingsMenu.style.zIndex = '10';

        // Add the loop toggle button
        const loopToggle = document.createElement('button');
        loopToggle.id = 'loop-toggle';
        loopToggle.textContent = 'Loop: Off';
        loopToggle.style.backgroundColor = 'rgb(70, 70, 70)';
        loopToggle.style.color = 'white';
        loopToggle.style.border = 'none';
        loopToggle.style.padding = '5px 10px';
        loopToggle.style.cursor = 'pointer';
        loopToggle.style.borderRadius = '3px';
        loopToggle.style.marginBottom = '10px';
        loopToggle.onclick = () => {
            const videoElement = document.querySelector('video');
            videoElement.loop = !videoElement.loop;
            loopToggle.textContent = `Loop: ${videoElement.loop ? 'On' : 'Off'}`;
        };
        settingsMenu.appendChild(loopToggle);

        const variantLabel = document.createElement('label');
        variantLabel.textContent = 'Funscript Variant: ';
        variantLabel.style.display = 'block';
        variantLabel.style.marginTop = '10px';
        variantLabel.style.marginBottom = '5px';

        const variantSelect = document.createElement('select');
        variantSelect.id = 'funscript-variant-select';
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
                try {
                    const url = new URL(videoEl.src, window.location.origin);
                    const m = url.pathname.match(/\/site\/video\/(.+)/);
                    const videoPath = m ? m[1] : url.pathname;
                    const baseFunscript = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, ".funscript")}`;
                    loadFunscript(baseFunscript);
                } catch (e) {
                    // ignore
                }
            }
        };

        const refreshBtn = document.createElement('button');
        refreshBtn.id = 'refresh-variants-button';
        refreshBtn.textContent = 'Refresh';
        refreshBtn.style.backgroundColor = 'rgb(70, 70, 70)';
        refreshBtn.style.color = 'white';
        refreshBtn.style.border = 'none';
        refreshBtn.style.padding = '5px 10px';
        refreshBtn.style.cursor = 'pointer';
        refreshBtn.style.borderRadius = '3px';
        refreshBtn.style.marginLeft = '6px';
        refreshBtn.onclick = () => refreshVariantsForCurrentVideo();

        const variantRow = document.createElement('div');
        variantRow.style.display = 'flex';
        variantRow.style.gap = '6px';
        variantRow.appendChild(variantSelect);
        variantRow.appendChild(refreshBtn);

        settingsMenu.appendChild(variantLabel);
        settingsMenu.appendChild(variantRow);

        // Add a Calibration button (opens an overlay instead of navigating away)
        const calibrationButton = document.createElement('button');
        calibrationButton.id = 'calibration-button';
        calibrationButton.textContent = 'Calibration';
        calibrationButton.style.backgroundColor = 'rgb(70, 70, 70)';
        calibrationButton.style.color = 'white';
        calibrationButton.style.border = 'none';
        calibrationButton.style.padding = '5px 10px';
        calibrationButton.style.cursor = 'pointer';
        calibrationButton.style.borderRadius = '3px';
        calibrationButton.style.marginBottom = '10px';

        // open overlay handler
        async function openCalibrationOverlay() {
            if (document.getElementById('calibration-overlay')) return;

            let resp;
            try {
                resp = await fetch('/site/static/calibration.html?v=258');
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
            if (remoteStyle && !document.getElementById('calibration-style-injected')) {
                const styleEl = document.createElement('style');
                styleEl.id = 'calibration-style-injected';
                styleEl.textContent = remoteStyle.textContent;
                document.head.appendChild(styleEl);
            }

            // extract the card (main content)
            const card = doc.querySelector('.card') ? doc.querySelector('.card').outerHTML : doc.body.innerHTML;

            // create overlay
            const overlay = document.createElement('div');
            overlay.id = 'calibration-overlay';
            Object.assign(overlay.style, {
                position: 'fixed',
                left: '0',
                top: '0',
                right: '0',
                bottom: '0',
                backgroundColor: 'rgba(0,0,0,0.6)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: '9999',
                padding: '20px',
            });

            const inner = document.createElement('div');
            inner.style.position = 'relative';
            inner.innerHTML = card;

            // close (X) button
            const closeBtn = document.createElement('button');
            closeBtn.textContent = '✕';
            closeBtn.title = 'Close';
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
                fontSize: '16px',
            });
            inner.appendChild(closeBtn);

            overlay.appendChild(inner);
            document.body.appendChild(overlay);
            document.body.style.overflow = 'hidden';

            // dynamic import and initialize the calibration module
            try {
                const mod = await import('/site/static/calibration.js?v=258');
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

        // Add the hard limit input field with lock/unlock
        const hardLimitInputLabel = document.createElement('label');
        hardLimitInputLabel.textContent = 'Max Intensity Limit: ';
        hardLimitInputLabel.style.display = 'block';
        hardLimitInputLabel.style.marginBottom = '5px';
        hardLimitInputLabel.style.pointerEvents = 'none'; // Ensure the button itself is clickable

        const hardLimitLockButton = document.createElement('button');
        hardLimitLockButton.id = 'hard-limit-lock-button';
        hardLimitLockButton.textContent = 'Unlock';
        hardLimitLockButton.style.backgroundColor = 'rgb(70, 70, 70)';
        hardLimitLockButton.style.color = 'white';
        hardLimitLockButton.style.border = 'none';
        hardLimitLockButton.style.padding = '5px 10px';
        hardLimitLockButton.style.cursor = 'pointer';
        hardLimitLockButton.style.borderRadius = '3px';
        hardLimitLockButton.style.marginBottom = '10px';
        hardLimitLockButton.style.pointerEvents = 'auto'; // Ensure the button itself is clickable

        const hardLimitInput = document.createElement('input');
        hardLimitInput.id = 'hard-limit-input';
        hardLimitInput.type = 'number';
        hardLimitInput.min = '0';
        hardLimitInput.max = '100';
        hardLimitInput.value = getAbsoluteMaximum().toString();
        hardLimitInput.style.width = '100%';
        hardLimitInput.disabled = true; // Initially disabled

        hardLimitLockButton.onclick = () => {
            if (hardLimitInput.disabled) {
                hardLimitInput.disabled = false;
                hardLimitLockButton.textContent = 'Lock';
                hardLimitInputLabel.style.pointerEvents = 'auto';
            } else {
                hardLimitInput.disabled = true;
                hardLimitLockButton.textContent = 'Unlock';
                hardLimitInputLabel.style.pointerEvents = 'none';
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

        hardLimitInputLabel.appendChild(hardLimitLockButton); // Add the lock button next to the label
        hardLimitInputLabel.appendChild(hardLimitInput); // Add the input field
        settingsMenu.appendChild(hardLimitInputLabel);

        const vibrateModeLabel = document.createElement('label');
        vibrateModeLabel.textContent = 'Vibrate Mode: ';
        vibrateModeLabel.style.display = 'block';
        vibrateModeLabel.style.marginBottom = '5px';

        const vibrateModeSelect = document.createElement('select');
        vibrateModeSelect.id = 'vibrate-mode-select';
        ['Rate', 'Beat'].forEach(mode => {
            const option = document.createElement('option');
            option.value = mode.toLowerCase();
            option.textContent = mode;
            vibrateModeSelect.appendChild(option);
        });
        vibrateModeSelect.value = 'Rate';

        vibrateModeSelect.onchange = () => {
            setVibrateMode(vibrateModeSelect.value);
        };

        settingsMenu.appendChild(vibrateModeLabel);
        settingsMenu.appendChild(vibrateModeSelect);

        // button to open the funscript editor for the currently loaded video
        const editorButton = document.createElement('button');
        editorButton.id = 'open-editor-button';
        editorButton.textContent = 'Open Editor';
        editorButton.style.backgroundColor = 'rgb(70, 70, 70)';
        editorButton.style.color = 'white';
        editorButton.style.border = 'none';
        editorButton.style.padding = '5px 10px';
        editorButton.style.cursor = 'pointer';
        editorButton.style.borderRadius = '3px';
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
                    videoPath = videoEl.getAttribute('src') || videoEl.src || '';
                }
            }
            if (!videoPath) {
                alert('No video loaded. Open a video from the directory first.');
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
    try {
        const url = new URL(videoEl.src, window.location.origin);
        const m = url.pathname.match(/\/site\/video\/(.+)/);
        return m ? m[1] : url.pathname;
    } catch (e) {
        return null;
    }
}

export async function refreshVariantsForCurrentVideo() {
    const videoPath = currentVideoPathFromPlayer();
    if (!videoPath) return;
    const listUrl = `/site/funscripts/${videoPath.replace(/\.[^/.]+$/, ".funscript")}?list=1`;
    try {
        const resp = await fetch(listUrl);
        if (!resp.ok) return;
        const data = await resp.json();
        const select = document.getElementById('funscript-variant-select');
        if (!select) return;

        const serverVariants = Array.isArray(data.variants) ? data.variants : [];
        const variants = serverVariants.length ? serverVariants : ['original'];

        // rebuild options
        select.innerHTML = '';
        variants.forEach(v => {
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
    const settingsMenu = document.getElementById('settings-menu');
    if (settingsMenu) {
        const willShow = settingsMenu.style.display === 'none';
        settingsMenu.style.display = willShow ? 'block' : 'none';
        if (willShow) {
            setTimeout(() => refreshVariantsForCurrentVideo(), 80);
        }
    }
}