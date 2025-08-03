import { playVideo } from './video_player.js?v=110';

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

export function createSearchBox(container) {
    const searchBox = document.createElement('div');
    searchBox.className = 'search-container';

    const input = document.createElement('input');
    input.type = 'text';
    input.id = 'video-search';
    input.placeholder = 'Search by filename or tag...';
    searchBox.appendChild(input);

    const filterContainer = document.createElement('div');
    filterContainer.className = 'filter-container';
    filterContainer.innerHTML = `
        <div class="filter-group">
            <label for="min-duration">Duration (s):</label>
            <input type="number" id="min-duration" placeholder="Min">
            <span>-</span>
            <input type="number" id="max-duration" placeholder="Max">
        </div>
        <div class="filter-group">
            <label for="min-intensity">Avg Intensity (%):</label>
            <input type="number" id="min-intensity" placeholder="Min" min="0" max="100">
            <span>-</span>
            <input type="number" id="max-intensity" placeholder="Max" min="0" max="100">
        </div>
    `;
    searchBox.appendChild(filterContainer);

    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'search-results';
    searchBox.appendChild(resultsContainer);

    const directoryTree = document.getElementById('directory-tree');
    container.insertBefore(searchBox, directoryTree);

    const performSearch = debounce(async () => {
        const query = input.value;
        const minDuration = document.getElementById('min-duration').value;
        const maxDuration = document.getElementById('max-duration').value;
        const minIntensity = document.getElementById('min-intensity').value;
        const maxIntensity = document.getElementById('max-intensity').value;

        if (query.length < 2 && !minDuration && !maxDuration && !minIntensity && !maxIntensity) {
            resultsContainer.innerHTML = '';
            directoryTree.style.display = 'block';
            return;
        }

        const params = new URLSearchParams({ q: query });
        if (minDuration) params.append('min_duration', minDuration);
        if (maxDuration) params.append('max_duration', maxDuration);
        if (minIntensity) params.append('min_avg_intensity', minIntensity);
        if (maxIntensity) params.append('max_avg_intensity', maxIntensity);

        try {
            const response = await fetch(`/api/search?${params.toString()}`);
            if (!response.ok) {
                let errorMsg = 'Search failed.';
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMsg = errorData.error;
                    }
                } catch (e) { /* Response was not JSON */ }
                throw new Error(errorMsg);
            }
            const results = await response.json();

            directoryTree.style.display = 'none';
            resultsContainer.innerHTML = '';

            if (results.length === 0) {
                resultsContainer.innerHTML = '<div class="search-result-item">No videos found.</div>';
                return;
            }

            results.forEach(video => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';

                const title = document.createElement('a');
                title.href = '#';
                title.textContent = video.filename;
                title.onclick = (e) => {
                    e.preventDefault();
                    playVideo(`/site/video/${video.path}`, `/site/funscripts/${video.path.replace('.mp4', '.funscript')}`);
                };

                const metadata = document.createElement('div');
                metadata.className = 'video-metadata';

                if (video.rating) {
                    const rating = document.createElement('span');
                    rating.className = 'rating';
                    rating.textContent = '⭐'.repeat(video.rating);
                    metadata.appendChild(rating);
                }

                if (video.duration) {
                    const duration = document.createElement('span');
                    duration.className = 'duration';
                    const minutes = Math.floor(video.duration / 60);
                    const seconds = Math.round(video.duration % 60).toString().padStart(2, '0');
                    duration.textContent = `🕒 ${minutes}:${seconds}`;
                    metadata.appendChild(duration);
                }

                if (video.avg_intensity) {
                    const intensity = document.createElement('span');
                    intensity.className = 'intensity';
                    intensity.textContent = `📊 ${video.avg_intensity.toFixed(1)}`;
                    metadata.appendChild(intensity);
                }

                if (video.max_intensity) {
                    const maxIntensity = document.createElement('span');
                    maxIntensity.className = 'intensity';
                    maxIntensity.textContent = `🔥 ${video.max_intensity.toFixed(1)}`;
                    metadata.appendChild(maxIntensity);
                }

                if (video.tags && video.tags.length > 0 && video.tags[0] !== null) {
                    const tags = document.createElement('span');
                    tags.className = 'tags';
                    tags.textContent = `🏷️ ${video.tags.join(', ')}`;
                    metadata.appendChild(tags);
                }

                resultItem.appendChild(title);
                resultItem.appendChild(metadata);
                resultsContainer.appendChild(resultItem);
            });
        } catch (error) {
            console.error('Search failed:', error);
            directoryTree.style.display = 'none';
            resultsContainer.innerHTML = `<div class="search-result-item" style="color: #ff5555;">Error: ${error.message}</div>`;
        }
    }, 300);

    input.addEventListener('input', performSearch);
    filterContainer.querySelectorAll('input').forEach(filterInput => {
        filterInput.addEventListener('input', performSearch);
    });
}