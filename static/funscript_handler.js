// static/funscript_handler.js

import { getCalibrationMultiplier } from './calibration.js';

export let funscriptActions = [];
export let intensityActions = [];

let currentVideoRawMaxIntensity = 0;
let absoluteMax = 60;
let vibrateMode = 'Rate';
let selectedVariant = 'original';
let selectedSpeed = 'normal';
let lastBeatAt = null;

export async function loadFunscript(funscriptUrl) {
    funscriptActions = [];
    intensityActions = [];
    currentVideoRawMaxIntensity = 0;
    let fetchUrl = funscriptUrl;
    const url = new URL(fetchUrl, window.location.origin);
    url.searchParams.set('variant', selectedVariant);
    url.searchParams.set('speed', selectedSpeed);
    try {
        const response = await fetch(url.toString());
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (data && data.original && Array.isArray(data.original.actions)) {
            funscriptActions = data.original.actions;
        } else {
            funscriptActions = [];
        }
        if (data && data.intensity && Array.isArray(data.intensity.actions)) {
            intensityActions = data.intensity.actions;
            const positions = intensityActions.map((action) => action.pos);
            if (positions.length > 0) {
                currentVideoRawMaxIntensity = Math.max(...positions);
            }
        } else {
            intensityActions = [];
        }
    } catch (error) {
        console.error('Failed to load funscript:', error);
        funscriptActions = [];
        intensityActions = [];
    }
}

export function getCurrentIntensity(currentTime) {
    return Math.min(getCurrentIntensityUnclamped(currentTime), absoluteMax);
}

export function getCurrentIntensityUnclamped(currentTime) {
    if (intensityActions.length === 0) return 0;

    const idx = intensityActions.findIndex((a) => a.at > currentTime);

    if (idx === 0) return intensityActions[0].pos;
    if (idx === -1) return intensityActions[intensityActions.length - 1].pos;

    const prev = intensityActions[idx - 1];
    const next = intensityActions[idx];
    const t = (currentTime - prev.at) / (next.at - prev.at);

    return prev.pos + t * (next.pos - prev.pos);
}

export function getCurrentVideoMaxIntensity() {
    return Math.floor(currentVideoRawMaxIntensity);
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

export function getAbsoluteMaximumInverseCalibrated() {
    return absoluteMax / getCalibrationMultiplier(absoluteMax);
}

export function getCurrentVideoRawMaxIntensity() {
    return currentVideoRawMaxIntensity;
}

export function getFunscriptDuration() {
    if (intensityActions.length === 0) return 0;
    return intensityActions[intensityActions.length - 1].at;
}

export function getCurrentBeatValue(currentTime) {
    let lastBeatTime = null;
    let nextBeatTime = null;

    for (let i = 1; i < funscriptActions.length; i++) {
        const prev = funscriptActions[i - 1];
        const curr = funscriptActions[i];
        if (prev.pos === 100 && curr.pos === 0) {
            if (curr.at <= currentTime) lastBeatTime = curr.at;
            else {
                nextBeatTime = curr.at;
                break;
            }
        }
    }

    if (lastBeatTime === null) return 0;

    let vibrateValue = 0;
    if (lastBeatAt !== lastBeatTime) {
        vibrateValue = 1.0;
        lastBeatAt = lastBeatTime;
    } else {
        const nextAt = nextBeatTime || currentTime + 500;
        const t = Math.max(
            0,
            Math.min(1, (currentTime - lastBeatTime) / (nextAt - lastBeatTime))
        );
        vibrateValue = 1.0 - Math.sqrt(t);
    }
    return vibrateValue;
}

export function setSelectedFunscriptVariant(v) {
    selectedVariant = v && v.length ? v : 'original';
}

export function getSelectedFunscriptVariant() {
    return selectedVariant;
}

export function setSelectedSpeed(speed) {
    selectedSpeed = speed;
}

export function getSelectedSpeed() {
    return selectedSpeed;
}
