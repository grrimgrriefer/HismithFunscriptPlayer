const predefinedTags = [
    'Favorite', 'Fast', 'Slow', 'Intense', 'Gentle',
    'Long', 'Short', 'Rhythmic', 'Random', 'Complex'
].sort();

export function createMetadataPanel() {
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
                        <option value="">Select a tag...</option>
                        ${predefinedTags.map(tag => `<option value="${tag}">${tag}</option>`).join('')}
                    </select>
                    <div id="tags-list" class="selected-tags"></div>
                </div>
                <div class="metadata-stats">
                    <p>Raw Average Intensity: <span id="avg-intensity">-</span></p>
                    <p>Raw Maximum Intensity: <span id="max-intensity">-</span></p>
                    <p>Duration: <span id="video-duration">-</span></p>
                </div>
                <button id="save-metadata" class="primary-button">Save Rating & Tags</button>
            </div>
        `;

        metadataPanel.innerHTML = content;
        document.body.appendChild(metadataPanel);
        setupMetadataHandlers(metadataPanel);
    }
    return metadataPanel;
}

function setupMetadataHandlers(panel) {
    const tagsDropdown = panel.querySelector('#tags-dropdown');
    const tagsList = panel.querySelector('#tags-list');
    const saveButton = panel.querySelector('#save-metadata');
    let currentVideoId = null;

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
        currentVideoId = videoData.id;

        // Update title (filename)
        panel.querySelector('#video-title').textContent = videoData.filename;

        // Update runtime stats
        panel.querySelector('#avg-intensity').textContent =
            videoData.avgIntensity?.toFixed(2) || '-';
        panel.querySelector('#max-intensity').textContent =
            videoData.maxIntensity?.toFixed(2) || '-';
        panel.querySelector('#video-duration').textContent =
            formatDuration(videoData.duration);

        // Update rating if exists
        if (videoData.rating) {
            panel.querySelector('#video-rating').value = videoData.rating;
        }

        // Clear and reload tags
        tagsList.innerHTML = '';
        videoData.tags?.forEach(tag => {
            if (predefinedTags.includes(tag)) {
                addTag(tag);
            }
        });
    };

    // Handle save button
    saveButton.addEventListener('click', async () => {
        if (!currentVideoId) return;

        const metadata = {
            id: currentVideoId,
            rating: parseInt(panel.querySelector('#video-rating').value) || null,
            tags: getSelectedTags()
        };

        try {
            const response = await fetch('/api/metadata', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(metadata)
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

function formatDuration(seconds) {
    if (!seconds) return '-';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function toggleMetadataPanel() {
    const panel = document.getElementById('metadata-panel');
    if (panel) {
        panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
}