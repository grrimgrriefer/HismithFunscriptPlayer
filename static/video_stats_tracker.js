// static/video_stats_tracker.js

import { getFunscriptDuration } from './funscript_handler.js';
import { showTemporaryOverlayMessage } from './utils_ui.js';

const state = {
    currentVideoRelativePath: null,
    playedVideos: new Set(),
    likedVideos: new Set(),
    viewRecorded: false,
    autoLikeRecorded: false,
    actualPlayTimeMs: 0,
    lastPlayTick: null
};

export function findNodeByPath(node, path) {
    if (!node) return null;
    if (node.path === path) return node;
    if (node.children) {
        for (const child of node.children) {
            const found = findNodeByPath(child, path);
            if (found) return found;
        }
    }
    return null;
}

export function getPlayedVideos() {
    return state.playedVideos;
}

export function initVideoStats(relativePath, globalTree) {
    state.currentVideoRelativePath = relativePath;
    state.playedVideos.add(relativePath);
    state.viewRecorded = false;
    state.actualPlayTimeMs = 0;
    state.lastPlayTick = null;

    const alreadyLikedThisSession = state.likedVideos.has(relativePath);
    state.autoLikeRecorded = alreadyLikedThisSession;

    const likeBtn = document.getElementById('like-button');
    if (!likeBtn) return;

    likeBtn.style.display = 'block';
    likeBtn.style.right = '110px';

    const currentNode = findNodeByPath(globalTree, relativePath);
    const currentLikes = currentNode?.user_stats?.likes ?? 0;
    likeBtn.textContent = `❤️ ${currentLikes}`;
    likeBtn.disabled = alreadyLikedThisSession;
    likeBtn.title = alreadyLikedThisSession
        ? 'Already liked this session'
        : 'Like Video';

    likeBtn.onclick = async () => {
        if (state.likedVideos.has(relativePath)) {
            showTemporaryOverlayMessage('Already liked this session!', 1000);
            return;
        }

        state.autoLikeRecorded = true;
        likeBtn.disabled = true;

        const updated = await recordLike(relativePath, globalTree);
        if (updated) {
            showTemporaryOverlayMessage(`Liked ❤️ (${updated.likes})`, 1000);
        }
    };
}

export function trackPlayTick(videoElement) {
    const now = Date.now();
    if (state.lastPlayTick) {
        const dt = Math.min(now - state.lastPlayTick, 250);
        if (!videoElement.paused && !videoElement.seeking) {
            state.actualPlayTimeMs += dt;
        }
    }
    state.lastPlayTick = now;
}

export function resetPlayTick() {
    state.lastPlayTick = null;
}

export function recordView(relativePath, globalTree) {
    if (state.viewRecorded || !relativePath) return;
    state.viewRecorded = true;

    fetch('/api/video-stats/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: relativePath })
    })
        .then((res) => res.json())
        .then((updated) => {
            const node = findNodeByPath(globalTree, relativePath);
            if (node) node.user_stats = updated;
        })
        .catch((err) => console.error('Failed to record view', err));
}

export async function recordLike(relativePath, globalTree) {
    if (!relativePath || state.likedVideos.has(relativePath)) return null;
    state.likedVideos.add(relativePath);

    try {
        const res = await fetch('/api/video-stats/like', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: relativePath })
        });
        if (res.ok) {
            const updated = await res.json();
            const node = findNodeByPath(globalTree, relativePath);
            if (node) node.user_stats = updated;

            const likeBtn = document.getElementById('like-button');
            if (likeBtn && state.currentVideoRelativePath === relativePath) {
                likeBtn.textContent = `❤️ ${updated.likes}`;
                likeBtn.disabled = true;
                likeBtn.title = 'Already liked this session';
            }
            return updated;
        }
    } catch (err) {
        console.error('Failed to record like', err);
    }
    return null;
}

export function checkAndTriggerAutoLike(
    videoElement,
    relativePath,
    globalTree
) {
    if (
        state.autoLikeRecorded ||
        !relativePath ||
        state.likedVideos.has(relativePath)
    ) {
        return;
    }

    const durationMs =
        videoElement?.duration && isFinite(videoElement.duration)
            ? videoElement.duration * 1000
            : getFunscriptDuration();

    const minThresholdMs =
        durationMs > 0 ? Math.min(durationMs * 0.4, 30000) : 15000;

    if (state.actualPlayTimeMs >= minThresholdMs) {
        state.autoLikeRecorded = true;
        recordLike(relativePath, globalTree).then((updated) => {
            if (updated) {
                showTemporaryOverlayMessage(
                    `Auto-liked ❤️ (${updated.likes})`,
                    1200
                );
            }
        });
    }
}
