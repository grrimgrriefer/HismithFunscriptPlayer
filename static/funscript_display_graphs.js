// static/funscript_display_graphs.js

import {
    getAbsoluteMaximum,
    getAbsoluteMaximumInverseCalibrated,
    funscriptActions,
    intensityActions,
    getCurrentIntensity,
    getCurrentVideoMaxIntensity,
    getCurrentIntensityUnclamped
} from './funscript_handler.js';

const TIME_RANGE_MS = 1500; // visible range before/after current time
const BEAT_CIRCLE_OFFSET_Y = 30;
const HIT_MARGIN_PX = 5;
const FLASH_DECAY = 0.05;
const MAX_CANVAS_HEIGHT = 150;
const CANVAS_HEIGHT_RATIO = 0.1;

let flashIntensity = 0;

export function createFunscriptDisplayBox() {
    let box = document.getElementById('funscript-box');
    if (box) return;

    box = document.createElement('div');
    box.id = 'funscript-box';
    Object.assign(box.style, {
        position: 'absolute',
        bottom: '0',
        left: '0',
        padding: '0',
        width: '100%',
        backgroundColor: 'rgba(0, 0, 0, 0)',
        overflow: 'hidden',
        pointerEvents: 'none',
        justifyContent: 'center',
        display: 'flex'
    });

    const canvas = document.createElement('canvas');
    canvas.id = 'funscript-canvas';
    resizeCanvas(canvas);
    box.appendChild(canvas);
    document.body.appendChild(box);

    window.addEventListener('resize', () => resizeCanvas(canvas));
}

function resizeCanvas(canvas) {
    canvas.width = window.innerWidth / 2;
    canvas.height = Math.min(
        window.innerHeight * CANVAS_HEIGHT_RATIO,
        MAX_CANVAS_HEIGHT
    );
    canvas.style.backgroundColor = 'rgba(0, 0, 0, 0)';
}

export function updateFunscriptDisplayBox(currentTime) {
    const canvas = document.getElementById('funscript-canvas');
    if (!canvas || !funscriptActions || !intensityActions) return;

    const rawMax = getCurrentVideoMaxIntensity();
    const absMax = getAbsoluteMaximum();
    const absMaxInvCal = getAbsoluteMaximumInverseCalibrated();
    const intensity = getCurrentIntensity(currentTime);
    const intensityUnclamped = getCurrentIntensityUnclamped(currentTime);

    const ctx = canvas.getContext('2d');
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);

    const startTime = Math.max(0, currentTime - TIME_RANGE_MS);
    const endTime = currentTime + TIME_RANGE_MS;
    const scaleX = width / (2 * TIME_RANGE_MS);
    const scaleY = height / rawMax;
    const progressX = (currentTime - startTime) * scaleX;

    drawBackground(ctx, width, height);
    drawIntensityCurve(
        ctx,
        startTime,
        endTime,
        scaleX,
        scaleY,
        width,
        height,
        absMaxInvCal,
        intensity,
        rawMax
    );
    const hit = drawBeatCircles(
        ctx,
        startTime,
        endTime,
        scaleX,
        height,
        progressX
    );
    drawProgressLine(ctx, progressX, height, hit);
    drawClampLine(
        ctx,
        width,
        height,
        scaleY,
        absMaxInvCal,
        absMax,
        rawMax,
        intensityUnclamped
    );
    drawEdgeFadeMask(ctx, width, height);
}

function drawBackground(ctx, width, height) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, 'rgba(0, 0, 0, 0.4)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
}

function drawIntensityCurve(
    ctx,
    startTime,
    endTime,
    scaleX,
    scaleY,
    width,
    height,
    absMaxInvCal,
    intensity,
    rawMax
) {
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';

    // Dynamic gradient based on current intensity
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    let gradStop = 1 - intensity / rawMax;
    if (!isFinite(gradStop)) gradStop = 0;
    gradStop = Math.max(0, Math.min(0.95, gradStop));

    gradient.addColorStop(gradStop, 'rgba(0, 255, 0, 0.25)');
    gradient.addColorStop(
        Math.min(0.95, gradStop + 0.2),
        'rgba(0, 255, 0, 0.12)'
    );
    gradient.addColorStop(1, 'rgba(0, 255, 0, 0)');
    ctx.fillStyle = gradient;

    let started = false;
    for (let i = 0; i < intensityActions.length - 1; i++) {
        const cur = intensityActions[i];
        const next = intensityActions[i + 1];
        if (cur.at < startTime || next.at > endTime) continue;

        const curX = (cur.at - startTime) * scaleX;
        const curY = height - Math.min(cur.pos, absMaxInvCal) * scaleY;
        const nextX = (next.at - startTime) * scaleX;
        const nextY = height - Math.min(next.pos, absMaxInvCal) * scaleY;

        if (!started) {
            ctx.moveTo(curX, height);
            started = true;
        }
        ctx.lineTo(curX, curY);
        ctx.lineTo(nextX, nextY);
    }

    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();

    ctx.lineWidth = flashIntensity > 0 ? 2 + flashIntensity * 5 : 1;
    if (flashIntensity > 0) flashIntensity -= FLASH_DECAY;
    ctx.stroke();
}

function drawBeatCircles(ctx, startTime, endTime, scaleX, height, progressX) {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0, 122, 0, 0.5)';
    ctx.strokeStyle = 'rgb(255, 255, 255)';

    let hit = false;
    const circleSize = height * 0.08;
    const circleY = height - BEAT_CIRCLE_OFFSET_Y;

    for (let i = 1; i < funscriptActions.length; i++) {
        const prev = funscriptActions[i - 1];
        const cur = funscriptActions[i];

        if (cur.pos !== 100 || prev.pos !== 0) continue;
        if (cur.at < startTime || cur.at > endTime) continue;

        const x = (cur.at - startTime) * scaleX;
        if (x < progressX) continue;

        ctx.moveTo(x + circleSize, circleY);
        ctx.ellipse(x, circleY, circleSize, circleSize, 0, 0, Math.PI * 2);

        if (Math.abs(x - progressX) < HIT_MARGIN_PX) hit = true;
    }

    ctx.fill();
    ctx.stroke();
    return hit;
}

function drawProgressLine(ctx, progressX, height, hit) {
    if (hit) flashIntensity = 1;

    if (flashIntensity > 0) {
        ctx.strokeStyle = `rgba(255, 255, 0, ${flashIntensity})`;
        flashIntensity -= FLASH_DECAY;
    } else {
        ctx.strokeStyle = 'red';
    }

    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
}

function drawClampLine(
    ctx,
    width,
    height,
    scaleY,
    absMaxInvCal,
    absMax,
    rawMax,
    intensityUnclamped
) {
    const clampY = height - absMaxInvCal * scaleY;

    // Label
    ctx.fillStyle = 'white';
    let label = `Max: ${rawMax.toFixed(2)}`;
    if (rawMax > absMax) label += ` (Clamped: ${absMax.toFixed(2)})`;

    const fontSize = Math.min(16, height * 0.1);
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = 'center';
    ctx.fillText(label, width / 2, clampY + fontSize / 4);

    const textWidth = ctx.measureText(label).width;
    const gapLeft = (width - textWidth - 10) / 2;
    const gapRight = (width + textWidth + 10) / 2;

    // Clamp line (red if exceeding, white otherwise)
    ctx.beginPath();
    if (intensityUnclamped > absMax) {
        ctx.strokeStyle = 'rgb(255, 0, 0)';
        ctx.lineWidth = 8;
    } else {
        ctx.strokeStyle = 'rgb(255, 255, 255)';
        ctx.lineWidth = 2;
    }
    ctx.moveTo(0, clampY);
    ctx.lineTo(gapLeft, clampY);
    ctx.moveTo(gapRight, clampY);
    ctx.lineTo(width, clampY);
    ctx.stroke();
}

function drawEdgeFadeMask(ctx, width, height) {
    const mask = ctx.createLinearGradient(0, 0, width, 0);
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)');
    mask.addColorStop(0.5, 'rgba(0, 0, 0, 1)');
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)');

    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
}
