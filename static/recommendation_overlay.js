// static/recommendation_overlay.js

import {
    formatDuration,
    intensityToColor,
    volatilityToColor,
    relativeIntensityToColor
} from './utils.js';
import { getNodeByPath } from './directory_tree.js';

const state = {
    nextVideoTimer: null,
    isOverlayVisible: false
};

export function isOverlayVisible() {
    return state.isOverlayVisible;
}

export function hideNextVideoOverlay() {
    state.isOverlayVisible = false;
    if (state.nextVideoTimer) {
        clearTimeout(state.nextVideoTimer);
        state.nextVideoTimer = null;
    }

    document.getElementById('next-video-overlay')?.classList.add('hidden');
    const settingsBtn = document.getElementById('settings-button');
    if (settingsBtn) settingsBtn.style.display = 'block';
}

function getStatHtml(candidate, mode = 'relative') {
    if (!candidate) return '';

    const durText = candidate.duration
        ? formatDuration(candidate.duration)
        : '—';

    const node = getNodeByPath(candidate.path);
    const views = node?.user_stats?.views ?? candidate.views ?? 0;
    const likes = node?.user_stats?.likes ?? candidate.likes ?? 0;

    const userHtml = `<span style="color:#ff4081" title="${likes} likes">❤️ ${likes}</span> <span style="color:#aaa" title="${views} views">👁️ ${views}</span>`;

    if (mode === 'absolute') {
        const peakColor = intensityToColor(candidate.peak);
        const avgColor = intensityToColor(candidate.avg);
        const volColor = volatilityToColor(candidate.volatility);

        return (
            `<span style="color:${peakColor}">🔺 ${candidate.peak.toFixed(1)} Peak</span><br>` +
            `<span style="color:${avgColor}">🌡️ ${candidate.avg.toFixed(1)} Avg</span><br>` +
            `<span style="color:${volColor}">⚡️ ${candidate.volatility.toFixed(1)} Vol</span><br>` +
            `<span style="color:rgba(255,255,255,0.85)">⏱️ ${durText}</span><br>` +
            `<span>${userHtml}</span>`
        );
    }

    const dPeak = candidate.delta_peak ?? 0;
    const dAvg = candidate.delta_avg ?? 0;
    const dVol = candidate.delta_volatility ?? 0;

    const peakPrefix = dPeak > 0 ? '+' : '';
    const avgPrefix = dAvg > 0 ? '+' : '';
    const volPrefix = dVol > 0 ? '+' : '';

    const peakColor = relativeIntensityToColor(dPeak);
    const avgColor = relativeIntensityToColor(dAvg);
    const volColor = relativeIntensityToColor(dVol);

    return (
        `<span style="color:${peakColor}">🔺 ${peakPrefix}${dPeak.toFixed(1)} Peak</span><br>` +
        `<span style="color:${avgColor}">🌡️ ${avgPrefix}${dAvg.toFixed(1)} Avg</span><br>` +
        `<span style="color:${volColor}">⚡️ ${volPrefix}${dVol.toFixed(1)} Vol</span><br>` +
        `<span style="color:rgba(255,255,255,0.85)">⏱️ ${durText}</span><br>` +
        `<span>${userHtml}</span>`
    );
}

function updateOverlayButtons(candidates, labels, statMode, onSelectVideo) {
    document.querySelector('#next-lower-btn .next-label').textContent =
        labels[0];
    document.querySelector('#next-similar-btn .next-label').textContent =
        labels[1];
    document.querySelector('#next-higher-btn .next-label').textContent =
        labels[2];

    const formatBtn = (id, candidate) => {
        const btn = document.getElementById(id);
        if (!btn) return;

        const thumbImg = btn.querySelector('.next-thumb');
        const statsEl = btn.querySelector('.next-stats');

        if (!candidate) {
            btn.disabled = true;
            statsEl.textContent = 'N/A';
            if (thumbImg) thumbImg.style.display = 'none';
            btn.onclick = null;
            return;
        }

        btn.disabled = false;
        if (thumbImg) {
            thumbImg.style.display = 'block';
            thumbImg.src = `/site/thumbnails/${candidate.path}.jpg`;
        }
        statsEl.innerHTML = getStatHtml(candidate, statMode);
        btn.onclick = () => onSelectVideo(candidate);
    };

    formatBtn('next-lower-btn', candidates.lower);
    formatBtn('next-similar-btn', candidates.similar);
    formatBtn('next-higher-btn', candidates.higher);
}

export async function showNextVideoOverlay({
    currentVideoRelativePath,
    playedVideos,
    onSelectVideo,
    onReplay,
    onCancel
}) {
    if (state.isOverlayVisible) return;
    state.isOverlayVisible = true;
    if (state.nextVideoTimer) {
        clearTimeout(state.nextVideoTimer);
        state.nextVideoTimer = null;
    }

    const overlay = document.getElementById('next-video-overlay');
    const timerEl = document.getElementById('next-timer');
    if (!overlay) return;

    const titleEl =
        document.getElementById('next-overlay-title') ||
        overlay.querySelector('h3');
    if (titleEl) titleEl.textContent = 'Up Next';

    overlay.classList.remove('hidden');

    if (document.fullscreenElement) {
        document.exitFullscreen()?.catch(() => {});
    }

    const excludedPaths = new Set(playedVideos);

    async function fetchNextCandidates() {
        const excludeStr = Array.from(excludedPaths).join(',');
        try {
            const resp = await fetch(
                `/api/recommendations/next?video=${encodeURIComponent(currentVideoRelativePath)}&exclude=${encodeURIComponent(excludeStr)}`
            );
            if (resp.ok) {
                return await resp.json();
            }
        } catch (err) {
            console.error('Failed to fetch next recommendations:', err);
        }
        return { lower: null, similar: null, higher: null };
    }

    let candidates = await fetchNextCandidates();

    function recordCandidates(c) {
        const paths = [c.lower?.path, c.similar?.path, c.higher?.path].filter(
            Boolean
        );
        const allAlreadyExcluded =
            paths.length > 0 && paths.every((p) => excludedPaths.has(p));
        if (allAlreadyExcluded) {
            excludedPaths.clear();
            playedVideos.forEach((p) => excludedPaths.add(p));
        }
        paths.forEach((p) => excludedPaths.add(p));
    }

    recordCandidates(candidates);

    updateOverlayButtons(
        candidates,
        ['Lower', 'Similar', 'Higher'],
        'relative',
        onSelectVideo
    );

    let currentFallback =
        candidates.similar || candidates.higher || candidates.lower;
    let timeLeft = 6;

    function startTimer() {
        if (state.nextVideoTimer) {
            clearTimeout(state.nextVideoTimer);
            state.nextVideoTimer = null;
        }
        timeLeft = 6;
        currentFallback =
            candidates.similar || candidates.higher || candidates.lower;

        const tick = () => {
            if (!state.isOverlayVisible) return;
            if (timerEl) {
                timerEl.innerHTML = `Starting random video in ${timeLeft}s...`;
            }
            if (timeLeft <= 0) {
                if (currentFallback) onSelectVideo(currentFallback);
                else hideNextVideoOverlay();
                return;
            }
            timeLeft--;
            state.nextVideoTimer = setTimeout(tick, 1000);
        };
        tick();
    }

    const rerollBtn = document.getElementById('next-reroll-btn');
    if (rerollBtn) {
        rerollBtn.style.display = 'inline-block';
        rerollBtn.disabled = false;
        rerollBtn.textContent = '🎲 Reroll';
        rerollBtn.onclick = async () => {
            rerollBtn.disabled = true;
            rerollBtn.textContent = '🎲 Rerolling...';
            if (state.nextVideoTimer) {
                clearTimeout(state.nextVideoTimer);
                state.nextVideoTimer = null;
            }
            if (timerEl) {
                timerEl.textContent = 'Finding new recommendations...';
            }

            try {
                const newCandidates = await fetchNextCandidates();
                if (
                    newCandidates.lower ||
                    newCandidates.similar ||
                    newCandidates.higher
                ) {
                    candidates = newCandidates;
                    recordCandidates(candidates);
                    updateOverlayButtons(
                        candidates,
                        ['Lower', 'Similar', 'Higher'],
                        'relative',
                        onSelectVideo
                    );
                }
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.textContent = '🎲 Reroll';
                if (state.isOverlayVisible) {
                    startTimer();
                }
            }
        };
    }

    const replayBtn = document.getElementById('next-replay-btn');
    if (replayBtn) {
        replayBtn.style.display = 'inline-block';
        replayBtn.onclick = () => {
            hideNextVideoOverlay();
            onReplay?.();
        };
    }

    const cancelBtn = document.getElementById('next-cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideNextVideoOverlay();
            onCancel?.();
        };
    }

    startTimer();
}

export async function showFolderStartOverlay(
    folderPath,
    { onSelectVideo, onCancel }
) {
    const excludedPaths = new Set();

    async function fetchFolderCandidates() {
        const excludeStr = Array.from(excludedPaths).join(',');
        try {
            const resp = await fetch(
                `/api/recommendations/folder-start?folder=${encodeURIComponent(folderPath)}&exclude=${encodeURIComponent(excludeStr)}`
            );
            if (resp.ok) {
                return await resp.json();
            }
        } catch (err) {
            console.error('Failed to fetch folder start recommendations:', err);
        }
        return { low: null, med: null, high: null };
    }

    let candidates = await fetchFolderCandidates();

    if (!candidates.low && !candidates.med && !candidates.high) return;

    function recordFolderCandidates(c) {
        const paths = [c.low?.path, c.med?.path, c.high?.path].filter(Boolean);
        const allAlreadyExcluded =
            paths.length > 0 && paths.every((p) => excludedPaths.has(p));
        if (allAlreadyExcluded) {
            excludedPaths.clear();
        }
        paths.forEach((p) => excludedPaths.add(p));
    }

    recordFolderCandidates(candidates);

    state.isOverlayVisible = true;
    if (state.nextVideoTimer) {
        clearTimeout(state.nextVideoTimer);
        state.nextVideoTimer = null;
    }

    const overlay = document.getElementById('next-video-overlay');
    if (!overlay) return;

    const titleEl =
        document.getElementById('next-overlay-title') ||
        overlay.querySelector('h3');
    if (titleEl) titleEl.textContent = 'Select Starting Video';

    overlay.classList.remove('hidden');
    document.getElementById('video-container')?.classList.remove('hidden');

    if (document.fullscreenElement) {
        document.exitFullscreen()?.catch(() => {});
    }

    updateOverlayButtons(
        {
            lower: candidates.low,
            similar: candidates.med,
            higher: candidates.high
        },
        ['Low', 'Medium', 'High'],
        'absolute',
        onSelectVideo
    );

    const timerEl = document.getElementById('next-timer');
    if (timerEl) {
        timerEl.innerHTML = 'Select a starting intensity to begin...';
    }

    const rerollBtn = document.getElementById('next-reroll-btn');
    if (rerollBtn) {
        rerollBtn.style.display = 'inline-block';
        rerollBtn.disabled = false;
        rerollBtn.textContent = '🎲 Reroll';
        rerollBtn.onclick = async () => {
            rerollBtn.disabled = true;
            rerollBtn.textContent = '🎲 Rerolling...';
            if (timerEl) {
                timerEl.textContent = 'Finding new recommendations...';
            }

            try {
                const newCandidates = await fetchFolderCandidates();
                if (
                    newCandidates.low ||
                    newCandidates.med ||
                    newCandidates.high
                ) {
                    candidates = newCandidates;
                    recordFolderCandidates(candidates);
                    updateOverlayButtons(
                        {
                            lower: candidates.low,
                            similar: candidates.med,
                            higher: candidates.high
                        },
                        ['Low', 'Medium', 'High'],
                        'absolute',
                        onSelectVideo
                    );
                }
            } finally {
                rerollBtn.disabled = false;
                rerollBtn.textContent = '🎲 Reroll';
                if (timerEl && state.isOverlayVisible) {
                    timerEl.innerHTML =
                        'Select a starting intensity to begin...';
                }
            }
        };
    }

    const replayBtn = document.getElementById('next-replay-btn');
    if (replayBtn) replayBtn.style.display = 'none';

    const cancelBtn = document.getElementById('next-cancel-btn');
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            hideNextVideoOverlay();
            const activeVideo = document.querySelector('#video-player video');
            if (!activeVideo?.src) {
                document
                    .getElementById('video-container')
                    ?.classList.add('hidden');
            }
            onCancel?.();
        };
    }
}
