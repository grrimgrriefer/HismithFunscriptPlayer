document.addEventListener('DOMContentLoaded', () => {
    const directoryTree = window.directoryTree;

    function toggleFolder(id) {
        const element = document.getElementById(id);

        // Collapse all other folders if this is a root folder
        if (element.parentElement.parentElement.id === 'directory-tree') {
            document.querySelectorAll('#directory-tree ul').forEach(ul => {
                if (ul.id !== id) {
                    ul.classList.add('hidden');
                }
            });
        }

        // Toggle the clicked folder
        if (element.classList.contains('hidden')) {
            element.classList.remove('hidden');
        } else {
            element.classList.add('hidden');
        }
    }

    function renderTree(node, parent) {
        const li = document.createElement('li');
        if (node.is_dir) {
            const folder = document.createElement('span');
            folder.textContent = node.name;
            folder.className = 'folder';
            folder.setAttribute('data-id', node.path);
            folder.onclick = () => toggleFolder(node.path);
            li.appendChild(folder);

            const ul = document.createElement('ul');
            ul.id = node.path;
            ul.className = 'hidden';
            node.children.forEach(child => renderTree(child, ul));
            li.appendChild(ul);
        } else {
            const file = document.createElement('a');
            file.textContent = node.name;
            file.href = '#';
            file.onclick = (e) => {
                e.preventDefault();
                playVideo(`/video/${node.path}`);
            };
            li.appendChild(file);
        }
        parent.appendChild(li);
    }

    function playVideo(videoUrl) {
        const videoPlayer = document.getElementById('video-player');
        const videoElement = document.createElement('video');
        videoElement.src = videoUrl;
        videoElement.controls = true;
        videoElement.autoplay = true;
        videoElement.style.width = '100%';

        videoPlayer.innerHTML = ''; // Clear any existing video
        videoPlayer.appendChild(videoElement);

        // Hide the directory tree and show the video player
        document.getElementById('directory-container').classList.add('hidden');
        document.getElementById('video-container').classList.remove('hidden');
    }

    function toggleDirectory() {
        const directoryContainer = document.getElementById('directory-container');
        if (directoryContainer.classList.contains('hidden')) {
            directoryContainer.classList.remove('hidden');
        } else {
            directoryContainer.classList.add('hidden');
        }
    }

    // Render the directory tree
    const rootUl = document.createElement('ul');
    directoryTree.children.forEach(child => {
        if (child.is_dir) {
            const li = document.createElement('li');
            const folder = document.createElement('span');
            folder.textContent = child.name;
            folder.className = 'folder';
            folder.setAttribute('data-id', child.path);
            folder.onclick = () => toggleFolder(child.path);
            li.appendChild(folder);

            const ul = document.createElement('ul');
            ul.id = child.path;
            ul.className = 'hidden';
            child.children.forEach(grandchild => renderTree(grandchild, ul));
            li.appendChild(ul);

            rootUl.appendChild(li);
        } else {
            renderTree(child, rootUl);
        }
    });

    document.getElementById('directory-tree').appendChild(rootUl);

    // Add event listener to toggle directory button
    document.getElementById('toggle-directory').onclick = toggleDirectory;
});