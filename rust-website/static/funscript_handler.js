import { calculateThrustIntensityByScaledSpeed } from './funscript_conversion_helper.js?v=46';

let funscriptActions = [];
let intensityActions = [];

let currentRawMaxIntensity = 0;
let intensityMulitplier = 1;

let absoluteMax = 100;

export function loadFunscript(funscriptUrl) {
    fetch(funscriptUrl)
        .then(response => response.json())
        .then(data => {
            funscriptActions = data.actions || [];
            const actionsCopy = funscriptActions.map(action => ({ ...action }));
            intensityActions = calculateThrustIntensityByScaledSpeed(actionsCopy);
            currentRawMaxIntensity = Math.max(...intensityActions.map(action => action.pos));
        })
        .catch(error => {
            console.error('Failed to load funscript:', error);
            funscriptActions = [];
            intensityActions = [];
        });
}

export function getCurrentFunscriptAction(currentTime) {
    if (funscriptActions.length === 0) {
        return null;
    }

    // Find the two closest actions
    let previousAction = null;
    let nextAction = null;

    for (let i = 0; i < funscriptActions.length; i++) {
        if (funscriptActions[i].at <= currentTime) {
            previousAction = funscriptActions[i];
        } else {
            nextAction = funscriptActions[i];
            break;
        }
    }

    // If there's no next action, return the last action's position
    if (!nextAction) {
        return { pos: previousAction.pos };
    }

    // If there's no previous action, return the first action's position
    if (!previousAction) {
        return { pos: nextAction.pos };
    }

    // Perform linear interpolation between the two actions
    const t = (currentTime - previousAction.at) / (nextAction.at - previousAction.at);
    const interpolatedPos = previousAction.pos + t * (nextAction.pos - previousAction.pos);

    return { pos: interpolatedPos };
}

export function getCurrentIntensity(currentTime) {
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

    return Math.min(Math.floor(interpolatedIntensity * intensityMulitplier), absoluteMax);
}

export function getCurrentRawMaxIntensity() {
    return Math.floor(currentRawMaxIntensity * intensityMulitplier);
}

export function setIntensityMultiplier(multiplier) {
    intensityMulitplier = multiplier;
}

export function setAbsoluteMaximum(max) {
    absoluteMax = max;
}

export function getAbsoluteMaximum() {
    return absoluteMax;
}