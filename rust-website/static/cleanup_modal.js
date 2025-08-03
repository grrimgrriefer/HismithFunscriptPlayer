async function handleRemap(orphanId, newPath, modalElement) {
    try {
        const response = await fetch('/api/videos/remap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                orphan_id: orphanId,
                new_path: newPath
            })
        });

        if (response.ok) {
            alert('Video path updated successfully!');
            modalElement.remove();
        } else {
            const errorText = await response.text();
            throw new Error(`Failed to remap video: ${errorText}`);
        }
    } catch (error) {
        console.error(error);
        alert(error.message);
    }
}

export function createCleanupModal(suggestion) {
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'cleanup-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'cleanup-modal';

    modal.innerHTML = `
        <h2>File System Mismatch</h2>
        <p>The database has a record for a file that no longer exists:</p>
        <code class="path-display">${suggestion.orphan_path}</code>
        <p>A new file with the exact same size was found. It may have been moved or renamed:</p>
        <code class="path-display">${suggestion.potential_match_path}</code>
        <p>Do you want to update the database record to point to the new file path?</p>
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'modal-buttons';

    const remapButton = document.createElement('button');
    remapButton.textContent = 'Yes, Update Path';
    remapButton.className = 'modal-button-confirm';
    remapButton.onclick = () => handleRemap(suggestion.orphan_id, suggestion.potential_match_path, modalOverlay);

    const ignoreButton = document.createElement('button');
    ignoreButton.textContent = 'Ignore';
    ignoreButton.className = 'modal-button-ignore';
    ignoreButton.onclick = () => modalOverlay.remove();

    buttonContainer.appendChild(remapButton);
    buttonContainer.appendChild(ignoreButton);
    modal.appendChild(buttonContainer);
    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);
}