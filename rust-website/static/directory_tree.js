// static/directory_tree.js

import { playVideo } from './video_player.js?v=228';

function toggleFolder(id) {
    const element = document.getElementById(id);
    if (!element) {
        return;
    }

    // Get the parent <ul> of the clicked folder's <li>
    const parentUl = element.parentElement.parentElement;

    // Find all direct sibling <ul> elements and hide them.
    // We query from the parent <ul> to get only the siblings at the current level.
    const siblingUls = parentUl.querySelectorAll(':scope > li > ul');
    siblingUls.forEach(ul => {
        if (ul.id !== id) {
            ul.classList.add('hidden');
        }
    });

    // Toggle the visibility of the clicked folder's content
    element.classList.toggle('hidden');
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
        node.children.sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        }).forEach(child => renderTree(child, ul));
        li.appendChild(ul);
    } else if (node.name.endsWith('.mp4') || node.name.endsWith('.avi') || node.name.endsWith('.mkv')) {
        const file = document.createElement('a');
        file.textContent = node.name;
        file.href = '#';
        file.onclick = (e) => {
            e.preventDefault();
            playVideo(`/site/video/${node.path}`, `/site/funscripts/${node.path.replace(/\.[^/.]+$/, ".funscript")}`);
        };
        li.appendChild(file);
    } else {
        return;
    }
    parent.appendChild(li);
}


export function initDirectoryTree(directoryTreeData, containerElement) {
    if (!directoryTreeData || !containerElement) {
        console.error("Directory tree data or container element is missing.");
        return;
    }

    containerElement.innerHTML = ''; // Clear previous content
    const rootUl = document.createElement('ul');
    rootUl.id = 'directory-tree-root';

    // Sort top-level children and render them
    directoryTreeData.children
        .sort((a, b) => {
            if (a.is_dir && !b.is_dir) return -1;
            if (!a.is_dir && b.is_dir) return 1;
            return a.name.localeCompare(b.name);
        })
        .forEach(child => renderTree(child, rootUl));

    containerElement.appendChild(rootUl);
}

