// static/directory_tree.js

import { playVideo } from './video_player.js';

function mixHue(h1, h2, t) {
    const d = ((((h2 - h1) % 360) + 540) % 360) - 180;
    return (h1 + d * t + 360) % 360;
}
function intensityToColor(v) {
    const val = Math.max(0, Math.min(100, Number(v) || 0));
    let hue;
    if (val <= 20) {
        hue = 120; // pure green up to 20
    } else if (val <= 40) {
        const t = (val - 20) / 20;
        hue = mixHue(120, 0, t);
    } else if (val <= 60) {
        const t = (val - 40) / 20;
        hue = mixHue(0, 330, t);
    } else if (val <= 80) {
        const t = (val - 60) / 20;
        hue = mixHue(330, 180, t);
    } else {
        hue = 180; // pure cyan for 80+
    }

    const S = 100; // fixed saturation
    const baseL = 50; // base lightness

    // hue distance helper
    function hueDistance(a, b) {
        let d = Math.abs(a - b) % 360;
        if (d > 180) d = 360 - d;
        return d;
    }

    // brighten hues near red/orange (they look darker to the eye)
    const distToRed = hueDistance(hue, 0);
    const RED_BOOST_MAX = 12; // max lightness boost (percentage points)
    const redBoost = distToRed <= 60 ? (1 - distToRed / 60) * RED_BOOST_MAX : 0;

    // additional brighten for blue/purple hues (so ~70 becomes lighter)
    const distToBlue = hueDistance(hue, 240); // 240° = pure blue
    const BLUE_BOOST_MAX = 18;
    const BLUE_RANGE = 40; // degrees around blue to apply boost
    const blueBoost =
        distToBlue <= BLUE_RANGE
            ? (1 - distToBlue / BLUE_RANGE) * BLUE_BOOST_MAX
            : 0;

    const L = Math.min(90, baseL + redBoost + blueBoost);

    return `hsl(${hue.toFixed(1)}, ${S}%, ${L.toFixed(1)}%)`;
}

export function initDirectoryTree(
    directoryTreeData,
    containerElement,
    funscriptMap = {}
) {
    if (!directoryTreeData || !containerElement) {
        console.error('Directory tree data or container element is missing.');
        return;
    }

    containerElement.innerHTML = ''; // Clear previous content
    const rootUl = document.createElement('ul');
    rootUl.id = 'directory-tree-root';

    // helper: collect peak and average intensity values for all variants of a given video base path
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

    function collectVariantStats(filePath) {
        const base = filePath.replace(/\.[^/.]+$/, ''); // remove extension
        const baseNorm = base.replace(/^\/+/, '');
        const stats = [];
        const avgKeys = [
            'average_intensity',
            'avg',
            'average',
            'averageIntensity'
        ];
        const peakKeys = [
            'peak_intensity',
            'max_intensity',
            'maximum_intensity',
            'peak',
            'max',
            'maximum',
            'peakIntensity'
        ];

        for (const key in funscriptMap) {
            if (!Object.prototype.hasOwnProperty.call(funscriptMap, key))
                continue;
            if (!key) continue;
            const keyNorm = key.replace(/^\/+/, '');
            if (!keyNorm.endsWith('.funscript')) continue;
            // match either exact original (base.funscript) or variants base.<variant>.funscript
            if (
                keyNorm === `${baseNorm}.funscript` ||
                keyNorm.startsWith(`${baseNorm}.`)
            ) {
                const entry = funscriptMap[key];
                const avg = getNumberFromEntry(entry, avgKeys);
                const peak = getNumberFromEntry(entry, peakKeys);
                if (isFinite(avg) || isFinite(peak)) {
                    stats.push({
                        avg: isFinite(avg) ? avg : NaN,
                        peak: isFinite(peak) ? peak : NaN
                    });
                }
            }
        }
        return stats;
    }

    // comparator: directories first, then files with funscript peak info (sorted low->high by peak), then others
    function compareNodes(a, b) {
        if (a.is_dir && !b.is_dir) return -1;
        if (!a.is_dir && b.is_dir) return 1;

        if (!a.is_dir && !b.is_dir) {
            const aStats = collectVariantStats(a.path);
            const bStats = collectVariantStats(b.path);
            const aHas =
                aStats.length > 0 && aStats.some((s) => isFinite(s.peak));
            const bHas =
                bStats.length > 0 && bStats.some((s) => isFinite(s.peak));
            if (aHas !== bHas) return aHas ? -1 : 1;
            if (aHas && bHas) {
                const ai = Math.min(
                    ...aStats.filter((s) => isFinite(s.peak)).map((s) => s.peak)
                );
                const bi = Math.min(
                    ...bStats.filter((s) => isFinite(s.peak)).map((s) => s.peak)
                );
                if (isFinite(ai) && isFinite(bi) && ai !== bi) return ai - bi;
            }
            return a.name.localeCompare(b.name);
        }

        return a.name.localeCompare(b.name);
    }

    function toggleFolder(id) {
        const element = document.getElementById(id);
        if (!element) {
            return;
        }

        // Get the parent <ul> of the clicked folder's <li>
        const parentUl = element.parentElement.parentElement;

        // Find all direct sibling <ul> elements and hide them.
        const siblingUls = parentUl.querySelectorAll(':scope > li > ul');
        siblingUls.forEach((ul) => {
            if (ul.id !== id) {
                ul.classList.add('hidden');
            }
        });

        // Toggle the visibility of the clicked folder's content
        element.classList.toggle('hidden');
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

            const children = (node.children || []).slice();
            children
                .sort(compareNodes)
                .forEach((child) => renderTree(child, ul));
            li.appendChild(ul);
        } else {
            // gather variant stats (peak & avg)
            const stats = collectVariantStats(node.path);

            const row = document.createElement('div');
            row.className = 'file-row';

            // only render a badge when there are stats
            if (stats.length > 0) {
                const badge = document.createElement('span');
                badge.className = 'file-intensity';

                // round to whole numbers, filter duplicates, sort by peak asc
                const entries = stats
                    .map((s) => ({
                        peak: isFinite(s.peak) ? Math.round(s.peak) : NaN,
                        avg: isFinite(s.avg) ? Math.round(s.avg) : NaN
                    }))
                    .filter((e) => isFinite(e.peak) || isFinite(e.avg))
                    .sort((a, b) => {
                        const ap = isFinite(a.peak)
                            ? a.peak
                            : Number.POSITIVE_INFINITY;
                        const bp = isFinite(b.peak)
                            ? b.peak
                            : Number.POSITIVE_INFINITY;
                        if (ap !== bp) return ap - bp;
                        const aa = isFinite(a.avg) ? a.avg : 0;
                        const ba = isFinite(b.avg) ? b.avg : 0;
                        return aa - ba;
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

                    // show "PEAK (AVG)" with distinct colors
                    parts.push(
                        `<span><span style="color:${peakColor}">${peakText}</span><span style="color:${avgColor}"> (${avgText})</span></span>`
                    );
                }

                if (parts.length > 0) {
                    badge.innerHTML = parts.join('');
                    row.appendChild(badge);
                }
            }

            const file = document.createElement('a');
            file.textContent = node.name;
            file.href = '#';
            file.onclick = (e) => {
                e.preventDefault();
                playVideo(
                    `/site/video/${node.path}`,
                    `/site/funscripts/${node.path.replace(/\.[^/.]+$/, '.funscript')}`
                );
            };
            row.appendChild(file);
            li.appendChild(row);
        }
        parent.appendChild(li);
    }

    const topChildren = (directoryTreeData.children || []).slice();
    topChildren
        .sort(compareNodes)
        .forEach((child) => renderTree(child, rootUl));
    containerElement.appendChild(rootUl);
}
