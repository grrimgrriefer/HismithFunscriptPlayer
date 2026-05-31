// static/directory_tree.js

import { playVideo } from './video_player.js';

// ── Color Utilities ────────────────────────────────────────────────────

function mixHue(h1, h2, t) {
    const d = ((((h2 - h1) % 360) + 540) % 360) - 180;
    return (h1 + d * t + 360) % 360;
}

function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

function intensityToColor(v) {
    const val = Math.max(0, Math.min(100, Number(v) || 0));

    let hue;
    if (val <= 20) hue = 120;
    else if (val <= 40) hue = mixHue(120, 0, (val - 20) / 20);
    else if (val <= 60) hue = mixHue(0, 330, (val - 40) / 20);
    else if (val <= 80) hue = mixHue(330, 180, (val - 60) / 20);
    else hue = 180;

    const redBoost =
        hueDistance(hue, 0) <= 60 ? (1 - hueDistance(hue, 0) / 60) * 12 : 0;

    const blueBoost =
        hueDistance(hue, 240) <= 40 ? (1 - hueDistance(hue, 240) / 40) * 18 : 0;

    const lightness = Math.min(90, 50 + redBoost + blueBoost);

    return `hsl(${hue.toFixed(1)}, 100%, ${lightness.toFixed(1)}%)`;
}

// ── Data Helpers ───────────────────────────────────────────────────────

const STAT_KEYS_AVG = [
    'average_intensity',
    'avg',
    'average',
    'averageIntensity'
];
const STAT_KEYS_PEAK = [
    'peak_intensity',
    'max_intensity',
    'maximum_intensity',
    'peak',
    'max',
    'maximum',
    'peakIntensity'
];

function getNumberFromEntry(entry, keys) {
    if (!entry) return NaN;
    for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(entry, k)) {
            const n = Number(entry[k]);
            if (isFinite(n)) return n;
        }
    }
    return NaN;
}

function collectVariantStats(filePath, funscriptMap) {
    const baseNorm = filePath.replace(/\.[^/.]+$/, '').replace(/^\/+/, '');
    const stats = [];

    for (const [key, entry] of Object.entries(funscriptMap)) {
        const keyNorm = key.replace(/^\/+/, '');
        if (!keyNorm.endsWith('.funscript')) continue;
        if (
            keyNorm !== `${baseNorm}.funscript` &&
            !keyNorm.startsWith(`${baseNorm}.`)
        )
            continue;

        const avg = getNumberFromEntry(entry, STAT_KEYS_AVG);
        const peak = getNumberFromEntry(entry, STAT_KEYS_PEAK);
        if (isFinite(avg) || isFinite(peak)) {
            stats.push({
                avg: isFinite(avg) ? avg : NaN,
                peak: isFinite(peak) ? peak : NaN
            });
        }
    }
    return stats;
}

// ── Sorting ────────────────────────────────────────────────────────────

function compareNodes(a, b, funscriptMap) {
    if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;

    if (!a.is_dir) {
        const aStats = collectVariantStats(a.path, funscriptMap);
        const bStats = collectVariantStats(b.path, funscriptMap);
        const aHas = aStats.some((s) => isFinite(s.peak));
        const bHas = bStats.some((s) => isFinite(s.peak));

        if (aHas !== bHas) return aHas ? -1 : 1;

        if (aHas && bHas) {
            const aPeak = Math.min(
                ...aStats.filter((s) => isFinite(s.peak)).map((s) => s.peak)
            );
            const bPeak = Math.min(
                ...bStats.filter((s) => isFinite(s.peak)).map((s) => s.peak)
            );
            if (aPeak !== bPeak) return aPeak - bPeak;
        }
    }

    return a.name.localeCompare(b.name);
}

// ── Rendering ──────────────────────────────────────────────────────────

function toggleFolder(id) {
    const element = document.getElementById(id);
    if (!element) return;

    const parentUl = element.parentElement.parentElement;
    for (const ul of parentUl.querySelectorAll(':scope > li > ul')) {
        if (ul.id !== id) ul.classList.add('hidden');
    }

    element.classList.toggle('hidden');
}

function buildIntensityBadge(stats) {
    if (stats.length === 0) return null;

    const entries = stats
        .map((s) => ({
            peak: isFinite(s.peak) ? Math.round(s.peak) : NaN,
            avg: isFinite(s.avg) ? Math.round(s.avg) : NaN
        }))
        .filter((e) => isFinite(e.peak) || isFinite(e.avg))
        .sort((a, b) => {
            const ap = isFinite(a.peak) ? a.peak : Infinity;
            const bp = isFinite(b.peak) ? b.peak : Infinity;
            if (ap !== bp) return ap - bp;
            return (
                (isFinite(a.avg) ? a.avg : 0) - (isFinite(b.avg) ? b.avg : 0)
            );
        });

    const seen = new Set();
    const parts = [];

    for (const e of entries) {
        const key = `${isFinite(e.peak) ? e.peak : '_'}|${isFinite(e.avg) ? e.avg : '_'}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const peakText = isFinite(e.peak) ? String(e.peak) : '—';
        const avgText = isFinite(e.avg) ? String(e.avg) : '—';
        const peakColor = isFinite(e.peak)
            ? intensityToColor(e.peak)
            : 'rgba(255,255,255,0.75)';
        const avgColor = isFinite(e.avg)
            ? intensityToColor(e.avg)
            : 'rgba(255,255,255,0.5)';

        parts.push(
            `<span><span style="color:${peakColor}">${peakText}</span>` +
                `<span style="color:${avgColor}"> (${avgText})</span></span>`
        );
    }

    if (parts.length === 0) return null;

    const badge = document.createElement('span');
    badge.className = 'file-intensity';
    badge.innerHTML = parts.join('');
    return badge;
}

function renderTree(node, parent, funscriptMap) {
    const li = document.createElement('li');

    if (node.is_dir) {
        const folder = document.createElement('span');
        folder.textContent = node.name;
        folder.className = 'folder';
        folder.setAttribute('data-id', node.path);
        folder.onclick = () => toggleFolder(node.path);
        li.appendChild(folder);

        const ul = document.createElement('ul');
        ul.id = node.path;
        ul.className = 'hidden';

        const children = (node.children || []).slice();
        children
            .sort((a, b) => compareNodes(a, b, funscriptMap))
            .forEach((child) => renderTree(child, ul, funscriptMap));
        li.appendChild(ul);
    } else {
        const row = document.createElement('div');
        row.className = 'file-row';

        const badge = buildIntensityBadge(
            collectVariantStats(node.path, funscriptMap)
        );
        if (badge) row.appendChild(badge);

        const link = document.createElement('a');
        link.textContent = node.name;
        link.href = '#';
        link.onclick = (e) => {
            e.preventDefault();
            playVideo(
                `/site/video/${node.path}`,
                `/site/funscripts/${node.path.replace(/\.[^/.]+$/, '.funscript')}`
            );
        };
        row.appendChild(link);
        li.appendChild(row);
    }

    parent.appendChild(li);
}

// ── Public API ─────────────────────────────────────────────────────────

export function initDirectoryTree(
    treeData,
    containerElement,
    funscriptMap = {}
) {
    if (!treeData || !containerElement) {
        console.error('Directory tree data or container element is missing.');
        return;
    }

    containerElement.innerHTML = '';
    const rootUl = document.createElement('ul');
    rootUl.id = 'directory-tree-root';

    const children = (treeData.children || []).slice();
    children
        .sort((a, b) => compareNodes(a, b, funscriptMap))
        .forEach((child) => renderTree(child, rootUl, funscriptMap));

    containerElement.appendChild(rootUl);
}
