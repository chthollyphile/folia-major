// electron/modSystem/ffmpeg.cjs
// Locates an ffmpeg executable with a clear, deterministic priority order.
// The loader never hard-codes a machine-specific path; everything goes through
// the candidates below, and the renderer always sees the resolution result.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FFMPEG_BINARY_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

// A path is considered executable when it exists and (on POSIX) carries any
// execute bit; Windows relies on extension + existence since ACL probing is unreliable.
const pathExists = (candidate) => {
    try {
        const stat = fs.statSync(candidate);
        if (!stat.isFile()) {
            return false;
        }
        if (process.platform === 'win32') {
            return true;
        }
        try {
            fs.accessSync(candidate, fs.constants.X_OK);
            return true;
        } catch {
            return false;
        }
    } catch {
        return false;
    }
};

const buildCandidates = (appGetAppPath) => {
    const candidates = [];

    // 1. Explicit override wins over everything else.
    const fromEnv = process.env.FOLIA_FFMPEG_PATH;
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
        candidates.push(fromEnv.trim());
    }

    // 2. In-repo placement: <appPath>/ffmpeg-8.1.2/ffmpeg(.exe). Works in dev
    // (appPath is the repository root) and keeps the bundled layout portable.
    try {
        candidates.push(path.join(appGetAppPath(), 'ffmpeg-8.1.2', FFMPEG_BINARY_NAME));
    } catch {
        // app.getAppPath can fail before app ready; ignore this candidate then.
    }

    // 3. Packaged resources: <resources>/ffmpeg/ffmpeg(.exe).
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, 'ffmpeg', FFMPEG_BINARY_NAME));
    }

    // 4. System PATH lookup is handled separately (no path to join).
    return candidates;
};

const firstResolvable = (candidates) => candidates.find((candidate) => pathExists(candidate)) ?? null;

const probeVersion = (ffmpegPath) => new Promise((resolve) => {
    execFile(ffmpegPath, ['-version'], { timeout: 8000, windowsHide: true }, (error, stdout) => {
        if (error) {
            resolve(null);
            return;
        }
        const firstLine = String(stdout ?? '').split(/\r?\n/)[0] ?? '';
        const match = /ffmpeg version ([^\s]+)/.exec(firstLine);
        resolve(match ? match[1] : firstLine || 'unknown');
    });
});

/*
 * Returns the full resolution result:
 * { available, path?, version?, probed?, candidates }
 * The result is cached by the caller (modSystem) so repeated IPC queries
 * never re-probe or re-stat the filesystem.
 */
const resolveFfmpeg = async ({ appGetAppPath }) => {
    const candidates = buildCandidates(appGetAppPath);
    const directHit = firstResolvable(candidates);

    if (directHit) {
        return { available: true, path: directHit, version: await probeVersion(directHit), probed: true, candidates };
    }

    // PATH fallback: `ffmpeg` bare name.
    const fromPath = await new Promise((resolve) => {
        execFile(
            process.platform === 'win32' ? 'where' : 'which',
            [FFMPEG_BINARY_NAME === 'ffmpeg.exe' ? 'ffmpeg' : 'ffmpeg'],
            { timeout: 8000, windowsHide: true },
            (error, stdout) => {
                if (error) {
                    resolve(null);
                    return;
                }
                const firstLine = String(stdout ?? '').split(/\r?\n/)[0];
                resolve(firstLine && pathExists(firstLine.trim()) ? firstLine.trim() : null);
            }
        );
    });

    if (fromPath) {
        return { available: true, path: fromPath, version: await probeVersion(fromPath), probed: true, candidates };
    }

    return { available: false, path: null, version: null, probed: true, candidates };
};

module.exports = { resolveFfmpeg, FFMPEG_BINARY_NAME };