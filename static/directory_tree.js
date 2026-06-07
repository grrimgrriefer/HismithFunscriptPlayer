// static/directory_tree.js

import { playVideo } from './video_player.js';
import {
    toFunscriptPath,
    getFunscriptStats,
    intensityToColor
} from './utils.js';

// ── Data Helpers ───────────────────────────────────────────────────────

function collectVariantStats(filePath, funscriptMap) {
    const baseNorm = toFunscriptPath(filePath).replace('.funscript', '');
    return Object.entries(funscriptMap)
        .filter(([key]) => key.startsWith(baseNorm))
        .map(([, entry]) => getFunscriptStats(entry))
        .filter((s) => isFinite(s.avg) || isFinite(s.peak));
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
                `/site/funscripts/${toFunscriptPath(node.path)}`,
                node.path,
                false
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
