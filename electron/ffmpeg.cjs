// electron/ffmpeg.cjs
// Locates an ffmpeg executable with a clear, deterministic priority order.
// The loader never hard-codes a machine-specific path; everything goes through
// the candidates below, and the renderer always sees the resolution result.
//
// Two callers with different needs share this resolver, so they must not share ANY candidate:
// mod exporters need a full build the user supplies, while the transcode fallback ships its own
// audio-only runtime that can encode nothing but FLAC and WAV. Every slot is per-caller for the
// same reason - the packaged directory, the in-repo directory, and the environment override.
// Sharing one of them puts the wrong binary in front of the right one: the audio-only runtime
// answering a transparent video export dies on a missing rawvideo demuxer, and a full build
// dropped in for exports answers the transcode fallback with codecs the shipped one lacks - so
// what dev proves says nothing about what ships. `-version` looks healthy in both directions.

'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const FFMPEG_BINARY_NAME = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

/** `<resources>/ffmpeg`: a full build the user drops in, used by the mod export service. */
const MODS_RUNTIME_DIR = 'ffmpeg';
/** `<resources>/ffmpeg-audio`: the audio-only runtime this app bundles for the transcode fallback. */
const TRANSCODE_RUNTIME_DIR = 'ffmpeg-audio';

/**
 * What each caller is allowed to answer with, keyed by the packaged directory that already tells
 * the two apart. `localDirName` is the in-repo slot that also serves dev, where `resourcesPath`
 * holds no runtime at all: unsplit, the full build a developer drops in for mod exports was the
 * first thing the transcode fallback found, and every dev run tested a binary the release does
 * not ship.
 */
const RUNTIME_SLOTS = Object.freeze({
    [MODS_RUNTIME_DIR]: Object.freeze({
        envVar: 'FOLIA_FFMPEG_PATH',
        localDirName: 'ffmpeg-8.1.2',
    }),
    [TRANSCODE_RUNTIME_DIR]: Object.freeze({
        envVar: 'FOLIA_TRANSCODE_FFMPEG_PATH',
        localDirName: TRANSCODE_RUNTIME_DIR,
    }),
});

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

const buildCandidates = (appGetAppPath, packagedDirName) => {
    const slot = RUNTIME_SLOTS[packagedDirName] ?? RUNTIME_SLOTS[MODS_RUNTIME_DIR];
    const candidates = [];

    // 1. Explicit override wins over everything else. Named per caller, so pointing the mod
    // exporters at a binary cannot silently re-point the transcode fallback as well.
    const fromEnv = process.env[slot.envVar];
    if (typeof fromEnv === 'string' && fromEnv.trim().length > 0) {
        candidates.push(fromEnv.trim());
    }

    // 2. In-repo placement: <appPath>/<slot.localDirName>/ffmpeg(.exe). Works in dev
    // (appPath is the repository root) and keeps the bundled layout portable.
    try {
        candidates.push(path.join(appGetAppPath(), slot.localDirName, FFMPEG_BINARY_NAME));
    } catch {
        // app.getAppPath can fail before app ready; ignore this candidate then.
    }

    // 3. Packaged resources: <resources>/<packagedDirName>/ffmpeg(.exe). The directory differs
    // per caller so the bundled audio-only runtime can never answer a mod export.
    if (process.resourcesPath) {
        candidates.push(path.join(process.resourcesPath, packagedDirName, FFMPEG_BINARY_NAME));
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
const resolveFfmpeg = async ({ appGetAppPath, packagedDirName = MODS_RUNTIME_DIR }) => {
    const candidates = buildCandidates(appGetAppPath, packagedDirName);
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

module.exports = { resolveFfmpeg, FFMPEG_BINARY_NAME, MODS_RUNTIME_DIR, TRANSCODE_RUNTIME_DIR, RUNTIME_SLOTS };