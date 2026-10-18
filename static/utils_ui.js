// static/utils_ui.js

export function showTemporaryOverlayMessage(message, durationMs = 2000) {
    let overlay = document.getElementById('temporary-message-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'temporary-message-overlay';
        overlay.classList.add('temporary-message-overlay');
        document.body.appendChild(overlay);
    }

    overlay.textContent = message;
    overlay.style.whiteSpace = 'pre-wrap';

    void overlay.offsetWidth;
    overlay.style.opacity = '1';

    if (overlay.timeoutId) clearTimeout(overlay.timeoutId);
    if (overlay.removeTimeoutId) clearTimeout(overlay.removeTimeoutId);

    overlay.timeoutId = setTimeout(() => {
        overlay.style.opacity = '0';
        overlay.removeTimeoutId = setTimeout(() => {
            if (overlay.parentNode) {
                overlay.parentNode.removeChild(overlay);
            }
        }, 300); // fade out matches CSS transition
    }, durationMs);
}

let activeToast = null;
let toastDismissTimeout = null;

export function dismissAutoLikeToast() {
    if (activeToast) {
        if (toastDismissTimeout) {
            clearTimeout(toastDismissTimeout);
            toastDismissTimeout = null;
        }
        const el = activeToast;
        activeToast = null;
        el.classList.add('fade-out');
        setTimeout(() => {
            if (el.parentNode) {
                el.parentNode.removeChild(el);
            }
        }, 300);
    }
}

export function showAutoLikeToast({ likes, onUndo, durationMs = 15000 }) {
    dismissAutoLikeToast();

    const toast = document.createElement('div');
    toast.id = 'autolike-toast';
    toast.className = 'autolike-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    toast.innerHTML = `
        <div class="autolike-pill" title="Click or hover to expand">
            <span class="autolike-heart">❤️</span>
            <span class="autolike-text">Auto-liked</span>
            <div class="autolike-expandable">
                <span class="autolike-count">(${likes})</span>
                <button type="button" class="autolike-undo-btn">Undo</button>
            </div>
        </div>
        <div class="autolike-progress-track">
            <div class="autolike-progress-bar"></div>
        </div>
    `;

    document.body.appendChild(toast);
    activeToast = toast;

    let remainingMs = durationMs;
    let timerStart = Date.now();
    let isPaused = false;
    let isUndone = false;

    const progressBar = toast.querySelector('.autolike-progress-bar');
    if (progressBar) {
        progressBar.style.animationDuration = `${durationMs}ms`;
    }

    function startTimer() {
        if (isPaused || isUndone) return;
        timerStart = Date.now();
        toastDismissTimeout = setTimeout(() => {
            dismissAutoLikeToast();
        }, remainingMs);
        if (progressBar) {
            progressBar.style.animationPlayState = 'running';
        }
    }

    function pauseTimer() {
        if (toastDismissTimeout) {
            clearTimeout(toastDismissTimeout);
            toastDismissTimeout = null;
        }
        const elapsed = Date.now() - timerStart;
        remainingMs = Math.max(500, remainingMs - elapsed);
        if (progressBar) {
            progressBar.style.animationPlayState = 'paused';
        }
    }

    toast.addEventListener('mouseenter', () => {
        isPaused = true;
        pauseTimer();
    });

    toast.addEventListener('mouseleave', () => {
        isPaused = false;
        startTimer();
    });

    const pill = toast.querySelector('.autolike-pill');
    pill?.addEventListener('click', () => {
        toast.classList.toggle('expanded');
    });

    const undoBtn = toast.querySelector('.autolike-undo-btn');
    const textEl = toast.querySelector('.autolike-text');

    undoBtn?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (isUndone) return;
        isUndone = true;

        undoBtn.disabled = true;
        undoBtn.textContent = 'Undone';
        if (textEl) textEl.textContent = 'Cancelled';
        toast.classList.add('cancelled');

        try {
            if (onUndo) await onUndo();
        } catch (err) {
            console.error('Failed to undo auto-like:', err);
        }

        setTimeout(() => {
            dismissAutoLikeToast();
        }, 1200);
    });

    startTimer();
}
