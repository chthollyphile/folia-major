'use strict';

const path = require('path');

// electron/alphaExport/systemFfmpegLocator.cjs
// Where a full ffmpeg the user installed may live, in the order they are tried: the directories on
// PATH first, then the places package managers and installers put it (winget, Scoop, Chocolatey,
// Program Files on Windows; Homebrew and MacPorts on macOS; the distribution, Linuxbrew and snap
// on Linux). The well-known places matter on their own: an app started from Finder or a desktop
// launcher gets a short PATH without Homebrew's directory. Only paths are built here; whether a
// file exists and what it can do is asked later, by the probe.

/**
 * `platform`, `env`, `homedir` and `readdir` are passed in so the list is the same under test as in
 * the app; `readdir(dir)` returns entry names or throws, and is only used to look into the
 * versioned folders winget and Chocolatey unpack into.
 */
const listSystemFfmpegCandidates = ({ platform, env = {}, homedir = '', readdir = () => [] }) => {
    const isWindows = platform === 'win32';
    const pathApi = isWindows ? path.win32 : path.posix;
    const binary = isWindows ? 'ffmpeg.exe' : 'ffmpeg';
    const candidates = [];
    const add = (...segments) => {
        if (segments.some((segment) => typeof segment !== 'string' || segment.length === 0)) {
            return;
        }
        candidates.push(pathApi.join(...segments));
    };
    const listDir = (dir) => {
        if (typeof dir !== 'string' || dir.length === 0) {
            return [];
        }
        try {
            const entries = readdir(dir);
            return Array.isArray(entries)
                ? entries.map(String).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
                : [];
        } catch {
            return [];
        }
    };

    const pathVariable = isWindows ? (env.Path ?? env.PATH ?? env.path) : env.PATH;
    for (const dir of String(pathVariable ?? '').split(isWindows ? ';' : ':')) {
        const trimmed = dir.trim().replace(/^"(.*)"$/, '$1');
        if (trimmed) {
            add(trimmed, binary);
        }
    }

    if (isWindows) {
        const localAppData = env.LOCALAPPDATA || (homedir ? pathApi.join(homedir, 'AppData', 'Local') : '');
        if (localAppData) {
            // winget: the Links shim, then the unpacked package (Gyan.FFmpeg_<source>\ffmpeg-<version>-full_build\bin).
            add(localAppData, 'Microsoft', 'WinGet', 'Links', binary);
            const packagesDir = pathApi.join(localAppData, 'Microsoft', 'WinGet', 'Packages');
            for (const pkg of listDir(packagesDir).filter((name) => /ffmpeg/i.test(name))) {
                const pkgDir = pathApi.join(packagesDir, pkg);
                // Newest version folder first: the names sort by version within one package.
                for (const build of listDir(pkgDir).filter((name) => /ffmpeg/i.test(name)).reverse()) {
                    add(pkgDir, build, 'bin', binary);
                }
                add(pkgDir, 'bin', binary);
            }
        }
        const scoopRoot = env.SCOOP || (homedir ? pathApi.join(homedir, 'scoop') : '');
        if (scoopRoot) {
            add(scoopRoot, 'apps', 'ffmpeg', 'current', 'bin', binary);
            add(scoopRoot, 'apps', 'ffmpeg-shared', 'current', 'bin', binary);
            add(scoopRoot, 'shims', binary);
        }
        const chocoRoot = env.ChocolateyInstall || env.CHOCOLATEYINSTALL || 'C:\\ProgramData\\chocolatey';
        add(chocoRoot, 'lib', 'ffmpeg-full', 'tools', 'ffmpeg', 'bin', binary);
        add(chocoRoot, 'lib', 'ffmpeg', 'tools', 'ffmpeg', 'bin', binary);
        add(chocoRoot, 'bin', binary);
        for (const programFiles of [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)']]) {
            add(programFiles, 'ffmpeg', 'bin', binary);
            add(programFiles, 'FFmpeg', 'bin', binary);
        }
        add('C:\\ffmpeg', 'bin', binary);
    } else if (platform === 'darwin') {
        add('/opt/homebrew/bin', binary);
        add('/usr/local/bin', binary);
        add('/opt/local/bin', binary);
        add('/usr/bin', binary);
    } else {
        add('/usr/bin', binary);
        add('/usr/local/bin', binary);
        add('/home/linuxbrew/.linuxbrew/bin', binary);
        if (homedir) {
            add(homedir, '.local', 'bin', binary);
        }
        add('/snap/bin', binary);
    }

    // The same file reached twice (PATH also names a well-known place) is probed once. Windows
    // paths compare without case.
    const seen = new Set();
    return candidates.filter((candidate) => {
        const key = isWindows ? candidate.toLowerCase() : candidate;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

module.exports = { listSystemFfmpegCandidates };
