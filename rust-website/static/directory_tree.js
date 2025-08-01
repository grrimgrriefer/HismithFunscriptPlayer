// static/directory_tree.js

import { playVideo } from './video_player.js?v=109';
import { createSearchBox } from './search.js?v=109';

document.addEventListener('DOMContentLoaded', () => {
    const directoryTree = window.directoryTree;

    function toggleFolder(id) {
        const element = document.getElementById(id);

        if (element.parentElement.parentElement.id === 'directory-tree') {
            document.querySelectorAll('#directory-tree ul').forEach(ul => {
                if (ul.id !== id) {
                    ul.classList.add('hidden');
                }
            });
        }

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
        } else if (node.name.endsWith('.mp4') || node.name.endsWith('.avi') || node.name.endsWith('.mkv')) {
            const file = document.createElement('a');
            file.textContent = node.name;
            file.href = '#';
            file.onclick = (e) => {
                e.preventDefault();
                playVideo(`/site/video/${node.path}`, `/site/funscripts/${node.path.replace('.mp4', '.funscript')}`);
            };
            li.appendChild(file);
        } else {
            return;
        }
        parent.appendChild(li);
    }

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

    document.getElementById('toggle-directory').onclick = () => {
        const directoryContainer = document.getElementById('directory-container');
        if (directoryContainer.classList.contains('hidden')) {
            directoryContainer.classList.remove('hidden');
        } else {
            directoryContainer.classList.add('hidden');
        }
    };

    const directoryContainer = document.getElementById('directory-container');
    createSearchBox(directoryContainer);
});