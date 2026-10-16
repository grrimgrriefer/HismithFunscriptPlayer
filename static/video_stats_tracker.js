// static/video_stats_tracker.js

import { getFunscriptDuration } from './funscript_handler.js';
import {
    showTemporaryOverlayMessage,
    showAutoLikeToast,
    markAutoLikeToastPrevious
} from './utils_ui.js';
import { getNodeByPath } from './directory_tree.js';

const state = {
    currentVideoRelativePath: null,
    playedVideos: new Set(),
    likedVideos: new Set(),
    viewRecorded: false,
    autoLikeRecorded: false,
    actualPlayTimeMs: 0,
    lastPlayTick: null
};

export function getPlayedVideos() {
    return state.playedVideos;
}

export function getCurrentVideoRelativePath() {
    return state.currentVideoRelativePath;
}

export function initVideoStats(relativePath) {
    markAutoLikeToastPrevious(relativePath);

    state.currentVideoRelativePath = relativePath;
    state.playedVideos.add(relativePath);
    state.viewRecorded = false;
    state.actualPlayTimeMs = 0;
    state.lastPlayTick = null;

    if (typeof window !== 'undefined') {
        window.dispatchEvent(
            new CustomEvent('video-played', { detail: { path: relativePath } })
        );
    }

    const alreadyLikedThisSession = state.likedVideos.has(relativePath);
    state.autoLikeRecorded = alreadyLikedThisSession;

    const likeBtn = document.getElementById('like-button');
    if (!likeBtn) return;

    likeBtn.style.display = 'block';
    likeBtn.style.right = '110px';

    const currentNode = getNodeByPath(relativePath);
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

        const updated = await recordLike(relativePath);
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
            checkAndTriggerAutoLike(
                videoElement,
                state.currentVideoRelativePath
            );
        }
    }
    state.lastPlayTick = now;
}

export function resetPlayTick() {
    state.lastPlayTick = null;
}

export function recordView(relativePath) {
    if (state.viewRecorded || !relativePath) return;
    state.viewRecorded = true;

    fetch('/api/video-stats/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_path: relativePath })
    })
        .then((res) => res.json())
        .then((updated) => {
            const node = getNodeByPath(relativePath);
            if (node) node.user_stats = updated;
        })
        .catch((err) => console.error('Failed to record view', err));
}

export async function recordLike(relativePath) {
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
            const node = getNodeByPath(relativePath);
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

export async function recordUnlike(relativePath) {
    if (!relativePath) return null;
    state.likedVideos.delete(relativePath);

    try {
        const res = await fetch('/api/video-stats/unlike', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ video_path: relativePath })
        });
        if (res.ok) {
            const updated = await res.json();
            const node = getNodeByPath(relativePath);
            if (node) node.user_stats = updated;

            const likeBtn = document.getElementById('like-button');
            if (likeBtn && state.currentVideoRelativePath === relativePath) {
                likeBtn.textContent = `❤️ ${updated.likes}`;
                likeBtn.disabled = false;
                likeBtn.title = 'Like Video';
            }
            return updated;
        }
    } catch (err) {
        console.error('Failed to record unlike', err);
    }

    const node = getNodeByPath(relativePath);
    if (node?.user_stats && node.user_stats.likes > 0) {
        node.user_stats.likes -= 1;
    }
    const currentLikes = node?.user_stats?.likes ?? 0;
    const likeBtn = document.getElementById('like-button');
    if (likeBtn && state.currentVideoRelativePath === relativePath) {
        likeBtn.textContent = `❤️ ${currentLikes}`;
        likeBtn.disabled = false;
        likeBtn.title = 'Like Video';
    }
    return { likes: currentLikes };
}

export function checkAndTriggerAutoLike(videoElement, relativePath) {
    if (
        state.autoLikeRecorded ||
        !relativePath ||
        state.likedVideos.has(relativePath)
    ) {
        return;
    }

    const durationMs =
        videoElement?.duration &&
        isFinite(videoElement.duration) &&
        videoElement.duration > 0
            ? videoElement.duration * 1000
            : getFunscriptDuration();

    if (!durationMs || durationMs <= 0) {
        return;
    }

    // Must be watched for at least 90% of the whole video duration
    const minThresholdMs = durationMs * 0.9;

    if (state.actualPlayTimeMs >= minThresholdMs) {
        state.autoLikeRecorded = true;
        const targetPath = relativePath;
        const node = getNodeByPath(targetPath);
        const videoTitle =
            node?.name?.replace(/\.[^/.]+$/, '') ||
            targetPath
                .split('/')
                .pop()
                .replace(/\.[^/.]+$/, '');

        recordLike(targetPath).then((updated) => {
            if (updated) {
                showAutoLikeToast({
                    likes: updated.likes,
                    videoPath: targetPath,
                    videoTitle,
                    durationMs: 10000,
                    onUndo: async () => {
                        await recordUnlike(targetPath);
                    }
                });
            }
        });
    }
}
