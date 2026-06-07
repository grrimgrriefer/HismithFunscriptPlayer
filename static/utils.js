// static/utils.js

export function lerp(start, end, progress) {
    return start + (end - start) * progress;
}

export function mixHue(h1, h2, t) {
    const d = ((((h2 - h1) % 360) + 540) % 360) - 180;
    return (h1 + d * t + 360) % 360;
}

export function hueDistance(a, b) {
    const d = Math.abs(a - b) % 360;
    return d > 180 ? 360 - d : d;
}

export function intensityToColor(v) {
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

export function relativeIntensityToColor(d) {
    return d > 5
        ? '#ff4444'
        : d > 0
          ? '#ffbb33'
          : d < -5
            ? '#00C851'
            : d < 0
              ? '#99cc00'
              : '#fff';
}

export function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
}

export function smoothstep(t) {
    return t * t * (3 - 2 * t);
}

export function toFunscriptPath(videoPath) {
    return videoPath.replace(/\.[^/.]+$/, '.funscript');
}

export function getFunscriptStats(entry) {
    if (!entry) return { peak: 0, avg: 0 };
    const peak =
        entry.peak_intensity ??
        entry.peak ??
        entry.peakIntensity ??
        entry.max_intensity ??
        0;
    const avg =
        entry.average_intensity ?? entry.avg ?? entry.averageIntensity ?? 0;
    return { peak: Number(peak) || 0, avg: Number(avg) || 0 };
}

export function isTextInput(target) {
    const tag = target?.tagName?.toUpperCase() ?? '';
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
}
