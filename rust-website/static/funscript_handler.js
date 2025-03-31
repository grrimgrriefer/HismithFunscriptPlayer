import { intensityPattern } from './funscript_conversion_helper.js';

let funscriptActions = [];
let intensityActions = [];

export function loadFunscript(funscriptUrl) {
    fetch(funscriptUrl)
        .then(response => response.json())
        .then(data => {
            funscriptActions = data.actions || [];
            const actionsCopy = funscriptActions.map(action => ({ ...action }));
            intensityActions = intensityPattern(actionsCopy);
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

    return interpolatedIntensity;
}