// static/directory_tree.js

import { playVideo, showFolderStartOverlay } from './video_player.js';
import {
    toVideoUrl,
    toFunscriptUrl,
    intensityToColor,
    volatilityToColor,
    formatDuration
} from './utils.js';
import {
    getPlayedVideos,
    getCurrentVideoRelativePath
} from './video_stats_tracker.js';

// ── Flat Tree Map (O(1) Lookups) & State ───────────────────────────────

const nodeMap = new Map();
let currentRootData = null;
let currentContainer = null;
let currentSortKey = 'peak';

const normalizePath = (p) => (p ? p.replace(/^\/+|\/+$/g, '') : '');

function indexTree(root) {
    nodeMap.clear();
    if (!root) return;

    function traverse(node) {
        if (node.path !== undefined) {
            nodeMap.set(normalizePath(node.path), node);
        }
        if (node.children) {
            for (const child of node.children) {
                traverse(child);
            }
        }
    }
    traverse(root);
}

export function getNodeByPath(path) {
    if (!path) return null;
    return nodeMap.get(normalizePath(path)) || null;
}

function ensureParentFoldersOpen(path, openFolders) {
    if (!path) return;
    const normalized = normalizePath(path);
    const parts = normalized.split('/');
    let acc = '';
    for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        openFolders.add(acc);
    }
}

export function updateTreeUserStats(statsMap) {
    if (!statsMap) return;
    for (const [normPath, node] of nodeMap.entries()) {
        if (!node.is_dir) {
            const s = statsMap[node.path] || statsMap[normPath];
            if (s) {
                node.user_stats = s;
            }
        }
    }
}

// ── Active Video DOM Synchronization ───────────────────────────────────

function updateDirectoryActiveStates() {
    const container =
        currentContainer || document.getElementById('directory-tree');
    if (!container) return;

    const currentPath = getCurrentVideoRelativePath();
    const playedVideos = getPlayedVideos();
    const normCurrent = currentPath ? normalizePath(currentPath) : null;

    const items = container.querySelectorAll('li[data-path]');
    items.forEach((li) => {
        const p = li.getAttribute('data-path');
        const normP = normalizePath(p);
        const isCurrent = normCurrent !== null && normP === normCurrent;
        const isWatched =
            (playedVideos && playedVideos.has(p)) ||
            (playedVideos && playedVideos.has(normP));

        li.classList.toggle('is-current-video', Boolean(isCurrent));
        li.classList.toggle('is-watched', Boolean(isWatched));

        const row = li.querySelector('.file-row');
        if (row) {
            row.querySelector('.current-video-indicator')?.remove();
            row.querySelector('.watched-video-indicator')?.remove();

            const link = row.querySelector('a');
            if (isCurrent) {
                const icon = document.createElement('span');
                icon.className = 'current-video-indicator';
                icon.textContent = '▶';
                icon.title = 'Currently Playing';
                row.insertBefore(icon, link);
            } else if (isWatched) {
                const icon = document.createElement('span');
                icon.className = 'watched-video-indicator';
                icon.textContent = '✓';
                icon.title = 'Watched this session';
                row.insertBefore(icon, link);
            }
        }
    });
}

if (typeof window !== 'undefined') {
    window.addEventListener('video-played', () => {
        updateDirectoryActiveStates();
    });
}

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

function buildIntensityBadge(stats, userStats) {
    const uStats = userStats || { views: 0, likes: 0 };
    const views = uStats.views ?? 0;
    const likes = uStats.likes ?? 0;

    const statEntries =
        stats && stats.length > 0
            ? stats
            : [{ peak: NaN, avg: NaN, volatility: NaN, duration: 0 }];

    const parts = [];

    for (const e of statEntries) {
        const peakText = isFinite(e.peak) ? String(e.peak) : '—';
        const avgText = isFinite(e.avg) ? String(e.avg) : '—';
        const volText = isFinite(e.volatility)
            ? Number(e.volatility).toFixed(1)
            : '—';
        const durText = e.duration ? formatDuration(e.duration) : '—';

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
                `<span style="color:${volColor}">⚡️${volText}</span> ` +
                `<span style="color:rgba(255,255,255,0.75)">⏱️${durText}</span> ` +
                `<span style="color:#ff4081" title="${likes} likes">❤️${likes}</span> ` +
                `<span style="color:#aaa" title="${views} views">👁️${views}</span>` +
                `</span>`
        );
    }

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
        li.setAttribute('data-path', node.path);

        const currentVideoPath = getCurrentVideoRelativePath();
        const playedVideos = getPlayedVideos();
        const normPath = normalizePath(node.path);

        const isCurrent =
            currentVideoPath && normPath === normalizePath(currentVideoPath);
        const isWatched =
            (playedVideos && playedVideos.has(node.path)) ||
            (playedVideos && playedVideos.has(normPath));

        if (isCurrent) {
            li.classList.add('is-current-video');
        }
        if (isWatched) {
            li.classList.add('is-watched');
        }

        const row = document.createElement('div');
        row.className = 'file-row';

        const badge = buildIntensityBadge(node.stats, node.user_stats);
        if (badge) row.appendChild(badge);

        if (isCurrent) {
            const icon = document.createElement('span');
            icon.className = 'current-video-indicator';
            icon.textContent = '▶';
            icon.title = 'Currently Playing';
            row.appendChild(icon);
        } else if (isWatched) {
            const icon = document.createElement('span');
            icon.className = 'watched-video-indicator';
            icon.textContent = '✓';
            icon.title = 'Watched this session';
            row.appendChild(icon);
        }

        const link = document.createElement('a');
        link.textContent = node.name;
        link.href = '#';
        link.onclick = (e) => {
            e.preventDefault();
            playVideo(
                toVideoUrl(node.path),
                toFunscriptUrl(node.path),
                node.path,
                false
            );
        };
        row.appendChild(link);
        li.appendChild(row);
    }

    parent.appendChild(li);
}

function sortTreeNodes(node, sortBy = 'peak') {
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
            const statsKeys = {
                likes: ['likes', 'views'],
                views: ['views', 'likes']
            };

            if (statsKeys[sortBy]) {
                const [primary, secondary] = statsKeys[sortBy];
                const diffPrimary =
                    (b.user_stats?.[primary] || 0) -
                    (a.user_stats?.[primary] || 0);
                if (diffPrimary !== 0) return diffPrimary;
                const diffSecondary =
                    (b.user_stats?.[secondary] || 0) -
                    (a.user_stats?.[secondary] || 0);
                if (diffSecondary !== 0) return diffSecondary;
            }

            // intensity sort fallback
            if (sortBy !== 'name' && sortBy !== 'likes' && sortBy !== 'views') {
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

// ── Public API ─────────────────────────────────────────────────────────

export function initDirectoryTree(treeData, containerElement, sortBy = 'peak') {
    if (!treeData || !containerElement) {
        console.error('Directory tree data or container element is missing.');
        return;
    }

    currentRootData = treeData;
    currentContainer = containerElement;
    currentSortKey = sortBy;

    indexTree(treeData);

    const openFolders = new Set(
        Array.from(containerElement.querySelectorAll('ul:not(.hidden)'))
            .map((el) => el.id)
            .filter(Boolean)
    );

    const currentPath = getCurrentVideoRelativePath();
    if (currentPath) {
        ensureParentFoldersOpen(currentPath, openFolders);
    }

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

export async function refreshDirectoryTreeStats() {
    if (!currentRootData) return;

    try {
        const resp = await fetch('/api/video-stats');
        if (resp.ok) {
            const statsMap = await resp.json();
            updateTreeUserStats(statsMap);
        }
    } catch (err) {
        console.error('Failed to refresh video stats for directory tree:', err);
    }

    const container =
        currentContainer || document.getElementById('directory-tree');
    const dirContainer = document.getElementById('directory-container');
    const prevScrollTop = dirContainer ? dirContainer.scrollTop : 0;

    if (container) {
        initDirectoryTree(currentRootData, container, currentSortKey);
    }

    if (dirContainer) {
        dirContainer.scrollTop = prevScrollTop;
        if (!dirContainer.classList.contains('hidden')) {
            const currentEl = container?.querySelector('li.is-current-video');
            if (currentEl) {
                currentEl.scrollIntoView({
                    block: 'nearest',
                    behavior: 'smooth'
                });
            }
        }
    }
}
