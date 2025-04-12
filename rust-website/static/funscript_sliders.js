import { getAbsoluteMaximum, funscriptActions, intensityActions, getCurrentIntensity, getCurrentRawMaxIntensity, getCurrentIntensityUnclamped, getIntensityMultiplier } from './funscript_handler.js?v=29';

export function createFunscriptDisplayBox() {
    let funscriptBox = document.getElementById('funscript-box');
    if (!funscriptBox) {
        funscriptBox = document.createElement('div');
        funscriptBox.id = 'funscript-box';
        funscriptBox.style.position = 'absolute';
        funscriptBox.style.bottom = '0';
        funscriptBox.style.left = '0';
        funscriptBox.style.padding = '0';
        funscriptBox.style.width = '100%'; // Full width of the page
        funscriptBox.style.backgroundColor = 'rgba(0, 0, 0, 0)';
        funscriptBox.style.overflow = 'hidden';
        funscriptBox.style.pointerEvents = 'none';
        funscriptBox.style.justifyContent = 'center';
        funscriptBox.style.display = 'flex';

        // Create the canvas for rendering the curve and dots
        const canvas = document.createElement('canvas');
        canvas.id = 'funscript-canvas';
        canvas.width = window.innerWidth / 2; // Match the full width of the page
        canvas.height = Math.min(window.innerHeight * 0.2, 200); // 20% of screen height, max 200px
        canvas.style.backgroundColor = 'rgba(0, 0, 0, 0)';
        funscriptBox.appendChild(canvas);

        document.body.appendChild(funscriptBox);

        // Update canvas size on window resize
        window.addEventListener('resize', () => {
            canvas.width = window.innerWidth / 2;
            canvas.height = Math.min(window.innerHeight * 0.2, 200); // Recalculate height
        });
    }
}

let flashIntensity = 0; // Global variable to track the flash intensity

export function updateFunscriptDisplayBox(currentTime) {
    const canvas = document.getElementById('funscript-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const blackBase = ctx.createLinearGradient(0, 0, 0, canvas.height);
    blackBase.addColorStop(0, 'rgba(0, 0, 0, 0.4)'); // Fully visible green at the top
    blackBase.addColorStop(1, 'rgba(0, 0, 0, 0)');   // Fully transparent at the bottom
    ctx.fillStyle = blackBase; // Use the gradient as the fill style
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const range = 1500; // 3 seconds before and after in milliseconds
    const startTime = Math.max(0, currentTime - range);
    const endTime = currentTime + range;

    const scaleX = canvas.width / (2 * range); // Scale to fit 6 seconds (3 before + 3 after)
    const scaleY = canvas.height / getCurrentRawMaxIntensity();

    if (funscriptActions === undefined || intensityActions === undefined) {
        return;
    }

    // Draw the intensity curve as a filled graph
    ctx.beginPath();
    ctx.strokeStyle = 'rgba(0, 255, 0, 1)'; // Semi-transparent green

    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    let customGradientValue = 1 - getCurrentIntensity(currentTime) / getCurrentRawMaxIntensity();
    if (isNaN(customGradientValue) || !isFinite(customGradientValue)) {
        customGradientValue = 0;
    }
    gradient.addColorStop(Math.max(0, Math.min(0.95, customGradientValue)), 'rgba(0, 255, 0, 0.75)'); // Fully visible green at the top
    gradient.addColorStop(Math.max(0, Math.min(0.95, customGradientValue + 0.2)), 'rgba(0, 255, 0, 0.5)');   // Fully transparent at the bottom
    gradient.addColorStop(1, 'rgba(0, 255, 0, 0)');   // Fully transparent at the bottom

    ctx.fillStyle = gradient; // Use the gradient as the fill style

    for (let i = 0; i < intensityActions.length - 1; i++) {
        const current = intensityActions[i];
        const next = intensityActions[i + 1];

        if (current.at >= startTime && next.at <= endTime) {
            const currentX = (current.at - startTime) * scaleX;
            const currentY = canvas.height - Math.min(current.pos * getIntensityMultiplier(), getAbsoluteMaximum()) * scaleY;
            const nextX = (next.at - startTime) * scaleX;
            const nextY = canvas.height - Math.min(next.pos * getIntensityMultiplier(), getAbsoluteMaximum()) * scaleY;

            if (i === 0) ctx.moveTo(currentX, canvas.height); // Start from the bottom
            ctx.lineTo(currentX, currentY);
            ctx.lineTo(nextX, nextY);
        }
    }
    ctx.lineTo(canvas.width, canvas.height); // Close the graph at the bottom
    ctx.lineTo(0, canvas.height)
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // flashing width
    if (flashIntensity > 0) {
        ctx.lineWidth = 2 + flashIntensity * 5; // Line width surges smoothly
        flashIntensity -= 0.05; // Gradually decrease the intensity
    } else {
        ctx.lineWidth = 1; // Default line width
    }

    // Draw and animate ellipses
    ctx.beginPath();
    ctx.fillStyle = 'rgba(0, 122, 0, 0.5)';
    ctx.strokeStyle = 'rgb(255, 255, 255)';

    let hit = false; // Flag to detect if a circle hits the progress bar

    for (let i = 0; i < funscriptActions.length; i++) {
        const current = funscriptActions[i];
        const prev = funscriptActions[i - 1];

        if (
            current.pos === 0 &&
            prev && prev.pos === 100 &&
            current.at >= startTime &&
            current.at <= (currentTime + range)
        ) {
            const currentX = (current.at - startTime) * scaleX;
            const currentY = canvas.height - 30;

            if (currentX >= (currentTime - startTime) * scaleX) {
                const size = canvas.height * 0.08;
                ctx.moveTo(currentX + size, currentY);
                ctx.ellipse(currentX, currentY, size, size, 0, 0, 360);

                const progressX = (currentTime - startTime) * scaleX;
                if (Math.abs(currentX - progressX) < 5) { // Allow a small margin of error
                    hit = true; // Trigger the surge effect
                }
            }
        }
    }
    ctx.fill();
    ctx.stroke();

    // Draw a progress line
    const progressX = (currentTime - startTime) * scaleX;

    if (hit) {
        flashIntensity = 1; // Start the surge effect
    }
    if (flashIntensity > 0) {
        ctx.strokeStyle = `rgba(255, 255, 0, ${flashIntensity})`; // Yellow with fading intensity
        flashIntensity -= 0.05; // Gradually decrease the intensity
    } else {
        ctx.strokeStyle = 'red'; // Default red color
    }

    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, canvas.height);
    ctx.stroke();

    ctx.fillStyle = 'white';

    const rawMaxIntensity = getCurrentRawMaxIntensity();
    const absoluteMax = getAbsoluteMaximum();

    let displayText = `Max: ${rawMaxIntensity.toFixed(2)}`;
    if (rawMaxIntensity > absoluteMax) {
        displayText += ` (Clamped: ${absoluteMax.toFixed(2)})`;
    }

    const fontSize = Math.min(16, canvas.height * 0.10);
    ctx.font = `${fontSize}px Arial`;
    ctx.textAlign = "center";
    ctx.fillText(displayText, canvas.width / 2, canvas.height + (fontSize / 4) - getAbsoluteMaximum() * scaleY);

    // Calculate text dimensions
    const textMetrics = ctx.measureText(displayText);
    const textWidth = textMetrics.width;


    ctx.beginPath();
    if (getCurrentIntensityUnclamped(currentTime) > getAbsoluteMaximum()) {
        ctx.strokeStyle = 'rgb(255, 0, 0)';
        ctx.lineWidth = 8;
    }
    else {
        ctx.strokeStyle = 'rgb(255, 255, 255)';
        ctx.lineWidth = 2;
    }
    ctx.moveTo(0, canvas.height - getAbsoluteMaximum() * scaleY);
    ctx.lineTo((canvas.width - textWidth - 10) / 2, canvas.height - getAbsoluteMaximum() * scaleY);
    ctx.moveTo((canvas.width + textWidth + 10) / 2, canvas.height - getAbsoluteMaximum() * scaleY);
    ctx.lineTo(canvas.width, canvas.height - getAbsoluteMaximum() * scaleY);
    ctx.stroke();


    // Create a gradient mask
    const mask = ctx.createLinearGradient(0, 0, canvas.width, 0);
    const center = 0.5; // Center of the canvas (50%)

    // Define mask stops
    mask.addColorStop(0, 'rgba(0, 0, 0, 0)'); // Fully transparent at the left edge
    mask.addColorStop(center, 'rgba(0, 0, 0, 1)'); // Fully opaque in the center
    mask.addColorStop(1, 'rgba(0, 0, 0, 0)'); // Fully transparent at the right edge

    // Save the current canvas state
    ctx.save();

    // Set the global composite operation to 'destination-in' to apply the mask
    ctx.globalCompositeOperation = 'destination-in';

    // Fill the canvas with the mask mask
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Restore the canvas state
    ctx.restore();
}