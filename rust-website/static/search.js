import { playVideo } from './video_player.js?v=107';

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
    input.placeholder = 'Search videos...';

    const resultsContainer = document.createElement('div');
    resultsContainer.id = 'search-results';
    resultsContainer.className = 'search-results';

    searchBox.appendChild(input);
    searchBox.appendChild(resultsContainer);

    // Insert before directory-tree
    const directoryTree = document.getElementById('directory-tree');
    container.insertBefore(searchBox, directoryTree);

    input.addEventListener('input', debounce(async (e) => {
        const query = e.target.value;
        if (query.length < 2) {
            resultsContainer.innerHTML = '';
            directoryTree.style.display = 'block';
            return;
        }

        try {
            const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            const results = await response.json();

            directoryTree.style.display = 'none';
            resultsContainer.innerHTML = '';

            results.forEach(video => {
                const resultItem = document.createElement('div');
                resultItem.className = 'search-result-item';

                const title = document.createElement('a');
                title.href = '#';
                title.textContent = video.title || video.filename;
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

                if (video.avg_intensity) {
                    const intensity = document.createElement('span');
                    intensity.className = 'intensity';
                    intensity.textContent = `📊 ${video.avg_intensity.toFixed(1)}`;
                    metadata.appendChild(intensity);
                }

                if (video.tags && video.tags.length > 0) {
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
        }
    }, 300));
}