'use strict';

const path = require('node:path');

// Keep release resource paths separate from development outputs and explicit developer overrides.
function resolveNativeExecutable({ platform, isPackaged, resourcesPath, projectRoot, override = '' }) {
    if (platform !== 'darwin' && platform !== 'win32') return '';
    if (!isPackaged && override) return path.isAbsolute(override) ? override : '';
    const root = isPackaged ? path.join(resourcesPath, 'apple-music') : path.join(projectRoot, 'build/apple-music-native');
    return platform === 'darwin'
        ? path.join(root, 'FoliaAppleMusicCompanion.app/Contents/MacOS/FoliaAppleMusicCompanion')
        : path.join(root, 'windows/FoliaAppleMusicCompanion.exe');
}

module.exports = { resolveNativeExecutable };
