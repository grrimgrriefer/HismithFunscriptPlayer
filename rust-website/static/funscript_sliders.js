export function createFunscriptDisplayBox() {
    let funscriptBox = document.getElementById('funscript-box');
    if (!funscriptBox) {
        funscriptBox = document.createElement('div');
        funscriptBox.id = 'funscript-box';
        funscriptBox.style.position = 'absolute';
        funscriptBox.style.bottom = '10px';
        funscriptBox.style.right = '10px';
        funscriptBox.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
        funscriptBox.style.color = 'white';
        funscriptBox.style.padding = '10px';
        funscriptBox.style.borderRadius = '5px';
        funscriptBox.style.fontSize = '16px';
        funscriptBox.style.width = '200px';
        funscriptBox.style.height = '50px'; // Increased height to fit two bars
        funscriptBox.style.display = 'flex';
        funscriptBox.style.flexDirection = 'column';
        funscriptBox.style.alignItems = 'center';
        funscriptBox.style.overflow = 'hidden';
        funscriptBox.style.border = '1px solid white';

        // Create the position progress bar
        const positionBar = document.createElement('div');
        positionBar.id = 'position-bar';
        positionBar.style.height = '50%';
        positionBar.style.width = '0%';
        positionBar.style.backgroundColor = 'lime';
        positionBar.style.transition = 'width 0.1s ease-out';
        positionBar.style.position = 'relative';

        const positionText = document.createElement('span');
        positionText.id = 'position-text';
        positionText.style.position = 'absolute';
        positionText.style.width = '100%';
        positionText.style.textAlign = 'center';
        positionText.style.color = 'black';
        positionText.style.fontWeight = 'bold';
        positionBar.appendChild(positionText);

        // Create the intensity progress bar
        const intensityBar = document.createElement('div');
        intensityBar.id = 'intensity-bar';
        intensityBar.style.height = '50%';
        intensityBar.style.width = '0%';
        intensityBar.style.backgroundColor = 'orange';
        intensityBar.style.transition = 'width 0.1s ease-out';
        intensityBar.style.position = 'relative';

        const intensityText = document.createElement('span');
        intensityText.id = 'intensity-text';
        intensityText.style.position = 'absolute';
        intensityText.style.width = '100%';
        intensityText.style.textAlign = 'center';
        intensityText.style.color = 'black';
        intensityText.style.fontWeight = 'bold';
        intensityBar.appendChild(intensityText);

        funscriptBox.appendChild(positionBar);
        funscriptBox.appendChild(intensityBar);
        document.body.appendChild(funscriptBox);
    }
}

export function updateFunscriptDisplayBox(currentAction, intensity) {
    // Update position bar
    const positionBar = document.getElementById('position-bar');
    const positionText = document.getElementById('position-text');
    if (currentAction) {
        positionBar.style.width = `${Math.round(currentAction.pos)}%`;
        positionText.textContent = `${Math.round(currentAction.pos)}%`;
    }

    // Update intensity bar
    const intensityBar = document.getElementById('intensity-bar');
    const intensityText = document.getElementById('intensity-text');
    if (intensity !== undefined) {
        intensityBar.style.width = `${intensity}%`;
        intensityText.textContent = `${Math.round(intensity)}`;
    }
}