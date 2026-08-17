// static/directory_tree.js

import { playVideo, showFolderStartOverlay } from './video_player.js';
import {
    toFunscriptPath,
    intensityToColor,
    volatilityToColor
} from './utils.js';

// ── Rendering ──────────────────────────────────────────────────────────

function toggleFolder(id) {
    const element = document.getElementById(id);
    if (!element) return;

    const parentUl = element.parentElement.parentElement;
    for (const ul of parentUl.querySelectorAll(':scope > li > ul')) {
        if (ul.id !== id) ul.classList.add('hidden');
    }

    const wasHidden = element.classList.contains('hidden');
    element.classList.toggle('hidden');

    if (wasHidden) {
        showFolderStartOverlay(id);
    }
}

function buildIntensityBadge(stats) {
    if (!stats || stats.length === 0) return null;

    const parts = [];

    for (const e of stats) {
        const peakText = isFinite(e.peak) ? String(e.peak) : '—';
        const avgText = isFinite(e.avg) ? String(e.avg) : '—';
        const volText = isFinite(e.volatility)
            ? Number(e.volatility).toFixed(1)
            : '—';

        const peakColor = isFinite(e.peak)
            ? intensityToColor(e.peak)
            : 'rgba(255,255,255,0.75)';
        const avgColor = isFinite(e.avg)
            ? intensityToColor(e.avg)
            : 'rgba(255,255,255,0.5)';
        const volColor = isFinite(e.volatility)
            ? volatilityToColor(e.volatility)
            : 'rgba(255,255,255,0.5)';

        parts.push(
            `<span>` +
                `<span style="color:${peakColor}">🔺${peakText}</span> ` +
                `<span style="color:${avgColor}">🌡️${avgText}</span> ` +
                `<span style="color:${volColor}">⚡${volText}</span>` +
                `</span>`
        );
    }

    if (parts.length === 0) return null;

    const badge = document.createElement('span');
    badge.className = 'file-intensity';
    badge.innerHTML = parts.join('');
    return badge;
}

function renderTree(node, parent, openFolders = new Set()) {
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
        if (!openFolders.has(node.path)) {
            ul.className = 'hidden';
        }

        (node.children || []).forEach((child) =>
            renderTree(child, ul, openFolders)
        );
        li.appendChild(ul);
    } else {
        const row = document.createElement('div');
        row.className = 'file-row';

        const badge = buildIntensityBadge(node.stats);
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

export function sortTreeNodes(node, sortBy = 'peak') {
    if (!node.children || node.children.length === 0) return;

    const getMetric = (fileNode, key) => {
        if (!fileNode.stats || fileNode.stats.length === 0) return Infinity;
        const vals = fileNode.stats
            .map((s) => s[key])
            .filter((v) => typeof v === 'number' && isFinite(v));
        return vals.length > 0 ? Math.min(...vals) : Infinity;
    };

    node.children.sort((a, b) => {
        if (a.is_dir !== b.is_dir) {
            return a.is_dir ? -1 : 1;
        }

        if (!a.is_dir) {
            const aHasStats = a.stats && a.stats.length > 0;
            const bHasStats = b.stats && b.stats.length > 0;

            if (aHasStats !== bHasStats) {
                return aHasStats ? -1 : 1;
            }

            if (aHasStats && bHasStats && sortBy !== 'name') {
                const aPrimary = getMetric(a, sortBy);
                const bPrimary = getMetric(b, sortBy);

                if (Math.abs(aPrimary - bPrimary) > 1e-5) {
                    return aPrimary - bPrimary;
                }

                if (sortBy !== 'peak') {
                    const aPeak = getMetric(a, 'peak');
                    const bPeak = getMetric(b, 'peak');
                    if (Math.abs(aPeak - bPeak) > 1e-5) {
                        return aPeak - bPeak;
                    }
                }
            }
        }

        return a.name.localeCompare(b.name, undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    });

    for (const child of node.children) {
        if (child.is_dir) {
            sortTreeNodes(child, sortBy);
        }
    }
}

export function initDirectoryTree(treeData, containerElement, sortBy = 'peak') {
    if (!treeData || !containerElement) {
        console.error('Directory tree data or container element is missing.');
        return;
    }

    const openFolders = new Set(
        Array.from(containerElement.querySelectorAll('ul:not(.hidden)'))
            .map((el) => el.id)
            .filter(Boolean)
    );

    const treeCopy = JSON.parse(JSON.stringify(treeData));
    sortTreeNodes(treeCopy, sortBy);

    containerElement.innerHTML = '';
    const rootUl = document.createElement('ul');
    rootUl.id = 'directory-tree-root';

    (treeCopy.children || []).forEach((child) =>
        renderTree(child, rootUl, openFolders)
    );
    containerElement.appendChild(rootUl);
}
