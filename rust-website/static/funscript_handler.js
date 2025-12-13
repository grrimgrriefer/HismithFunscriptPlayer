// static/funscript_handler.js

export let funscriptActions = [];
export let intensityActions = [];

let currentVideoRawMaxIntensity = 0;
let currentVideoRawAverageIntensity = 0;

let intensityMulitplier = 1; // Default multiplier
let absoluteMax = 60; // Default maximum intensity

let vibrateMode = 'Rate'; // Default vibrate mode
let lastBeatTime = -1;

export async function loadFunscript(funscriptUrl) {
    funscriptActions = [];
    intensityActions = [];
    currentVideoRawMaxIntensity = 0;
    currentVideoRawAverageIntensity = 0;
    await fetch(funscriptUrl)
        .then(response => response.json())
        .then(data => {
            funscriptActions = data.original.actions || [];
            intensityActions = data.intensity.actions || [];
            const positions = intensityActions.map(action => action.pos);
            if (positions.length > 0) {
                currentVideoRawMaxIntensity = Math.max(...positions);
                currentVideoRawAverageIntensity = getTimeWeightedAverage(intensityActions);
            }
        })
        .catch(error => {
            console.error('Failed to load funscript:', error);
            funscriptActions = [];
            intensityActions = [];
        });
}

export function getCurrentIntensity(currentTime) {
    return Math.min(getCurrentIntensityUnclamped(currentTime), absoluteMax);
}

export function getCurrentIntensityUnclamped(currentTime) {
    if (intensityActions.length === 0) {
        return 0;
    }

    // Find the two closest intensity actions
    let previousAction = null;
    let nextAction = null;

    for (let i = 0; i < intensityActions.length; i++) {
        if (intensityActions[i].at <= currentTime) {
            previousAction = intensityActions[i];
        } else {
            nextAction = intensityActions[i];
            break;
        }
    }

    // If there's no next action, return the last action's intensity
    if (!nextAction) {
        return previousAction.pos;
    }

    // If there's no previous action, return the first action's intensity
    if (!previousAction) {
        return nextAction.pos;
    }

    // Perform linear interpolation between the two intensity actions
    const t = (currentTime - previousAction.at) / (nextAction.at - previousAction.at);
    const interpolatedIntensity = previousAction.pos + t * (nextAction.pos - previousAction.pos);

    return Math.floor(interpolatedIntensity * intensityMulitplier);
}

export function getCurrentVideoMaxIntensity() {
    return Math.floor(currentVideoRawMaxIntensity * intensityMulitplier);
}

export function setIntensityMultiplier(multiplier) {
    intensityMulitplier = multiplier;

    // Emit a custom event to notify about the update
    const event = new CustomEvent('intensityMultiplierUpdated', { detail: { intensityMulitplier } });
    window.dispatchEvent(event);
}

export function getIntensityMultiplier() {
    return intensityMulitplier;
}

export function setVibrateMode(mode) {
    vibrateMode = mode;
}

export function getVibrateMode() {
    return vibrateMode;
}

export function setAbsoluteMaximum(max) {
    absoluteMax = max;
}

export function getAbsoluteMaximum() {
    return absoluteMax;
}

export function getCurrentVideoRawMaxIntensity() {
    return currentVideoRawMaxIntensity;
}

export function getCurrentVideoRawAverageIntensity() {
    return currentVideoRawAverageIntensity;
}

export function getCurrentBeatValue(currentTime) {
    let lastBeat = null, nextBeat = null, vibrateValue = 0;
    for (let i = 0; i < funscriptActions.length; i++) {
        if (funscriptActions[i].at <= currentTime && funscriptActions[i].pos === 100) {
            lastBeat = funscriptActions[i];
        } else if (funscriptActions[i].at > currentTime && funscriptActions[i].pos === 100) {
            nextBeat = funscriptActions[i];
            break;
        }
    }
    if (lastBeat) {
        if (lastBeatTime !== lastBeat.at) {
            vibrateValue = 1.0; // Pulse on beat
            lastBeatTime = lastBeat.at;
        } else {
            // Lerp down until next beat or to zero
            let nextAt = nextBeat ? nextBeat.at : currentTime + 500;
            let t = Math.max(0, Math.min(1, (currentTime - lastBeat.at) / (nextAt - lastBeat.at)));
            vibrateValue = 1.0 - t;
        }
    } else {
        vibrateValue = 0;
    }
    return vibrateValue;
};

const getTimeWeightedAverage = (actions) => {
    if (actions.length < 2) return 0;

    let totalWeighted = 0;
    let totalDuration = 0;

    for (let i = 0; i < actions.length - 1; i++) {
        const curr = actions[i];
        const next = actions[i + 1];

        const duration = next.at - curr.at;
        totalWeighted += curr.pos * duration;
        totalDuration += duration;
    }

    return totalWeighted / totalDuration;
};