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

function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '-';

    const totalSeconds = Math.round(seconds);
    const minutes = Math.floor(totalSeconds / 60);
    const remainingSeconds = totalSeconds % 60;

    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export function toggleMetadataPanel() {
    const panel = document.getElementById('metadata-panel');
    if (panel) {
        const isHidden = panel.style.display === 'none';
        panel.style.display = isHidden ? 'block' : 'none';
    }
}