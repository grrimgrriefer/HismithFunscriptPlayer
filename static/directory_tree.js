// static/directory_tree.js

import { playVideo, showFolderStartOverlay } from './video_player.js';
import { toFunscriptPath, intensityToColor } from './utils.js';

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

function renderTree(node, parent) {
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

        (node.children || []).forEach((child) => renderTree(child, ul));
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

export function initDirectoryTree(treeData, containerElement) {
    if (!treeData || !containerElement) {
        console.error('Directory tree data or container element is missing.');
        return;
    }

    containerElement.innerHTML = '';
    const rootUl = document.createElement('ul');
    rootUl.id = 'directory-tree-root';

    (treeData.children || []).forEach((child) => renderTree(child, rootUl));

    containerElement.appendChild(rootUl);
}
