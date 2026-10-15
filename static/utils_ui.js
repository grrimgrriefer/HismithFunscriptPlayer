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
