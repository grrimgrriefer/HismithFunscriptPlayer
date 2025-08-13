// static/metadata_panel.js

let availableTags = [];
let currentVideoData = null;

export async function createMetadataPanel() {
    let metadataPanel = document.getElementById('metadata-panel');
    if (!metadataPanel) {
        metadataPanel = document.createElement('div');
        metadataPanel.id = 'metadata-panel';
        metadataPanel.className = 'settings-panel';
        metadataPanel.style.display = 'none';

        const content = `
            <h3>Video Information</h3>
            <div class="metadata-form">
                <div class="form-group">
                    <label>Filename:</label>
                    <div id="video-title" class="readonly-text"></div>
                </div>
                <div class="form-group">
                    <label for="video-rating">Rating:</label>
                    <select id="video-rating">
                        <option value="">Not Rated</option>
                        <option value="1">⭐</option>
                        <option value="2">⭐⭐</option>
                        <option value="3">⭐⭐⭐</option>
                        <option value="4">⭐⭐⭐⭐</option>
                        <option value="5">⭐⭐⭐⭐⭐</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Tags:</label>
                    <select id="tags-dropdown">
                        <option value="">Loading tags...</option>
                    </select>
                    <div id="tags-list" class="selected-tags"></div>
                </div>
                <div class="metadata-stats">
                    <p>Raw Average Intensity: <span id="avg-intensity">-</span></p>
                    <p>Raw Maximum Intensity: <span id="max-intensity">-</span></p>
                    <p>Duration: <span id="video-duration">-</span></p>
                </div>
                <button id="save-metadata" class="primary-button">Save Rating & Tags</button>
                <div id="funscript-creator-container" style="display: none; margin-top: 15px; padding-top: 15px; border-top: 1px solid #555;">
                    <p>This video has no funscript.</p>
                    <a id="funscript-creator-link" href="#" target="_blank" class="primary-button" style="text-decoration: none; display: block; text-align: center;">Create Funscript</a>
                </div>
            </div>
        `;

        metadataPanel.innerHTML = content;
        document.body.appendChild(metadataPanel);
        setupMetadataHandlers(metadataPanel);

        // Fetch tags and populate dropdown
        try {
            const response = await fetch('/api/tags');
            if (response.ok) {
                availableTags = await response.json(); // Rely on backend for case-insensitive sorting
                const tagsDropdown = metadataPanel.querySelector('#tags-dropdown');
                tagsDropdown.innerHTML = '<option value="">Select a tag...</option>'; // Reset
                availableTags.forEach(tag => {
                    tagsDropdown.innerHTML += `<option value="${tag}">${tag}</option>`;
                });
            } else {
                throw new Error('Failed to fetch tags');
            }
        } catch (error) {
            console.error('Error fetching tags:', error);
            metadataPanel.querySelector('#tags-dropdown').innerHTML = '<option value="">Error loading tags</option>';
        }
    }
    return metadataPanel;
}

function setupMetadataHandlers(panel) {
    const tagsDropdown = panel.querySelector('#tags-dropdown');
    const tagsList = panel.querySelector('#tags-list');
    const saveButton = panel.querySelector('#save-metadata');

    // Handle tag selection
    tagsDropdown.addEventListener('change', () => {
        const selectedTag = tagsDropdown.value;
        if (selectedTag && !getSelectedTags().includes(selectedTag)) {
            addTag(selectedTag);
        }
        tagsDropdown.value = ''; // Reset dropdown
    });

    function getSelectedTags() {
        return Array.from(tagsList.children).map(tag =>
            tag.textContent.replace('×', '').trim()
        );
    }

    // Add tag to UI
    function addTag(tagText) {
        const tag = document.createElement('span');
        tag.className = 'metadata-tag';
        tag.innerHTML = `${tagText}<span class="remove-tag">×</span>`;

        tag.querySelector('.remove-tag').addEventListener('click', () => {
            tag.remove();
        });

        tagsList.appendChild(tag);
    }

    // Update metadata with runtime data
    window.updateMetadataPanel = (videoData) => {
        currentVideoData = videoData;

        // Always update the DOM, even if hidden. It's cheap and simplifies logic.
        // When the panel is made visible, it will have the correct data.
        panel.querySelector('#video-title').textContent = videoData.filename;

        // Update runtime stats
        panel.querySelector('#avg-intensity').textContent =
            videoData.avgIntensity?.toFixed(2) || '-';
        panel.querySelector('#max-intensity').textContent =
            videoData.maxIntensity?.toFixed(2) || '-';
        panel.querySelector('#video-duration').textContent =
            formatDuration(videoData.duration);

        // Update rating if it exists, otherwise reset to "Not Rated"
        panel.querySelector('#video-rating').value = videoData.rating || "";

        // Clear and reload tags
        tagsList.innerHTML = '';
        videoData.tags?.forEach(tag => {
            if (availableTags.includes(tag)) {
                addTag(tag);
            }
        });

        // Show/hide funscript creator link
        const creatorContainer = panel.querySelector('#funscript-creator-container');
        const creatorLink = panel.querySelector('#funscript-creator-link');

        creatorContainer.style.display = 'block'; // Always show the container
        creatorLink.href = `/site/editor?video=${encodeURIComponent(videoData.path)}`;

        if (videoData.hasFunscript) {
            creatorContainer.querySelector('p').textContent = 'This video has a funscript.';
            creatorLink.textContent = 'Edit Funscript';
        } else {
            creatorContainer.querySelector('p').textContent = 'This video has no funscript.';
            creatorLink.textContent = 'Create Funscript';
        }
    };

    // Handle save button
    saveButton.addEventListener('click', async () => {
        if (!currentVideoData || !currentVideoData.id) {
            const message = "Cannot save: No current video data or video ID is missing.";
            console.error(message, currentVideoData);
            alert(message + " The video might not be properly registered in the database.");
            return;
        }

        const payload = {
            id: currentVideoData.id,
            rating: parseInt(panel.querySelector('#video-rating').value) || null,
            tags: getSelectedTags(),
            avg_intensity: currentVideoData.avgIntensity ? Math.round(currentVideoData.avgIntensity) : null,
            max_intensity: currentVideoData.maxIntensity ? Math.round(currentVideoData.maxIntensity) : null,
            duration: currentVideoData.duration,
            has_funscript: currentVideoData.hasFunscript,
        };

        try {
            const response = await fetch('/api/metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (response.ok) {
                alert('Metadata saved successfully!');
            } else {
                throw new Error('Failed to save metadata');
            }
        } catch (error) {
            console.error('Error saving metadata:', error);
            alert('Failed to save metadata');
        }
    });
}

export function toggleMetadataPanel() {
    const panel = document.getElementById('metadata-panel');
    if (panel) {
        const isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
    }
}

function formatDuration(seconds) {
    if (seconds === null || seconds === undefined) return 'N/A';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [
        h > 0 ? h : null,
        m,
        s
    ].filter(x => x !== null).map(x => x.toString().padStart(2, '0')).join(':');
}

export function clearMetadataPanel() {
    const panel = document.getElementById('metadata-panel');
    if (!panel) {
        return;
    }

    // Reset data model
    currentVideoData = null;

    // Reset UI elements
    panel.querySelector('#video-title').textContent = '';
    panel.querySelector('#video-rating').value = '';
    panel.querySelector('#tags-list').innerHTML = '';
    panel.querySelector('#avg-intensity').textContent = '-';
    panel.querySelector('#max-intensity').textContent = '-';
    panel.querySelector('#video-duration').textContent = '-';
}

export function createDuplicateVideoModal(videoData) {
    const existingModal = document.getElementById('duplicate-modal-overlay');
    if (existingModal) {
        existingModal.remove();
    }
    const modalOverlay = document.createElement('div');
    modalOverlay.id = 'duplicate-modal-overlay';
    modalOverlay.className = 'cleanup-modal-overlay';

    const modal = document.createElement('div');
    modal.className = 'cleanup-modal';

    const ratingStars = videoData.rating ? '⭐'.repeat(videoData.rating) : 'Not Rated';
    const tagsHtml = videoData.tags && videoData.tags.length > 0
        ? videoData.tags.map(tag => `<span class="tag-item">${tag}</span>`).join(' ')
        : 'No tags';

    modal.innerHTML = `
        <h2>Duplicate Video Detected</h2>
        <p>A video with the same file size already exists in the database:</p>
        <div class="duplicate-metadata-display">
            <p><strong>Filename:</strong> ${videoData.filename}</p>
            <div class="path-copy-container">
                <input type="text" readonly value="${videoData.path}">
                <button id="copy-path-btn">Copy Path</button>
            </div>
            <p><strong>Rating:</strong> ${ratingStars}</p>
            <p><strong>Tags:</strong> ${tagsHtml}</p>
            <p><strong>Duration:</strong> ${formatDuration(videoData.duration)}</p>
            <p><strong>Avg/Max Intensity:</strong> ${videoData.avg_intensity ?? 'N/A'} / ${videoData.max_intensity ?? 'N/A'}</p>
        </div>
    `;

    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'modal-buttons';

    const closeButton = document.createElement('button');
    closeButton.textContent = 'Close';
    closeButton.className = 'modal-button-confirm';
    closeButton.onclick = () => modalOverlay.remove();

    buttonContainer.appendChild(closeButton);
    modal.appendChild(buttonContainer);

    modalOverlay.appendChild(modal);
    document.body.appendChild(modalOverlay);

    modal.querySelector('#copy-path-btn').addEventListener('click', (e) => {
        const pathInput = e.target.parentElement.querySelector('input');
        navigator.clipboard.writeText(pathInput.value)
            .then(() => {
                e.target.textContent = 'Copied!';
                setTimeout(() => { e.target.textContent = 'Copy Path'; }, 2000);
            })
            .catch(err => {
                alert('Failed to copy path.');
                console.error('Failed to copy path: ', err);
            });
    });
}