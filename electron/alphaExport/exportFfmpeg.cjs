'use strict';

const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const { listRuntimeSlotCandidates, pathExists, MODS_RUNTIME_DIR } = require('../ffmpeg.cjs');
const { listSystemFfmpegCandidates } = require('./systemFfmpegLocator.cjs');
const { parseFfmpegVersion, parseCodecList, describeExportCapabilities } = require('./ffmpegCapabilities.cjs');

// electron/alphaExport/exportFfmpeg.cjs
// Which ffmpeg the transparent video export uses, and what it can write. A file the user chose in
// Settings wins; otherwise the fixed slots of the mod exporters (FOLIA_FFMPEG_PATH, the in-repo
// ffmpeg-8.1.2 folder, <resources>/ffmpeg), then PATH and the usual install places. Every
// candidate is run (`-version`, `-encoders`, `-demuxers`) and only a build that reads a raw pixel
// pipe and has an encoder with alpha is used, so an audio-only or stripped build on PATH is passed
// over instead of failing on the first frame. The bundled transcode runtime is never a candidate.

/** electron-store key of the file the user chose (registered in dev/dedicatus/storageKeys.mjs). */
const MANUAL_PATH_STORE_KEY = 'video_export_ffmpeg_path';
const PROBE_TIMEOUT_MS = 8000;

const runFfmpeg = (execFileImpl, ffmpegPath, args) => new Promise((resolve) => {
    execFileImpl(ffmpegPath, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
        resolve(error ? null : String(stdout ?? ''));
    });
});

/**
 * Runs one file and says what it can export:
 * { path, ok, version, formats, problem } with `problem` one of `not-found`, `not-runnable`,
 * `not-ffmpeg`, `no-rawvideo`, `no-alpha-encoder` (null when ok).
 */
const probeFfmpegBinary = async (ffmpegPath, { execFileImpl = execFile, exists = pathExists } = {}) => {
    const base = { path: ffmpegPath, ok: false, version: null, formats: [], problem: null };
    if (typeof ffmpegPath !== 'string' || !ffmpegPath || !exists(ffmpegPath)) {
        return { ...base, problem: 'not-found' };
    }
    const [versionText, encodersText, demuxersText] = await Promise.all([
        runFfmpeg(execFileImpl, ffmpegPath, ['-hide_banner', '-version']),
        runFfmpeg(execFileImpl, ffmpegPath, ['-hide_banner', '-encoders']),
        runFfmpeg(execFileImpl, ffmpegPath, ['-hide_banner', '-demuxers']),
    ]);
    if (versionText === null) {
        return { ...base, problem: 'not-runnable' };
    }
    const version = parseFfmpegVersion(versionText);
    if (!version) {
        return { ...base, problem: 'not-ffmpeg' };
    }
    const capabilities = describeExportCapabilities({
        encoders: parseCodecList(encodersText),
        demuxers: parseCodecList(demuxersText),
    });
    return { ...base, ok: capabilities.usable, version, formats: capabilities.formats, problem: capabilities.problem };
};

/**
 * createExportFfmpegResolver({ store, appGetAppPath }) -> { resolve, chooseManual, clearManual, getStatus }.
 * The status is cached; `resolve({ refresh: true })` searches again. The other options exist for tests.
 */
const createExportFfmpegResolver = ({
    store,
    appGetAppPath,
    platform = process.platform,
    env = process.env,
    homedir = os.homedir(),
    readdir = (dir) => fs.readdirSync(dir),
    exists = pathExists,
    execFileImpl = execFile,
    logger = console,
}) => {
    let status = null;
    let pending = null;
    // Searches run one after another; the number says which is the latest, the only one that writes `status`.
    let chain = Promise.resolve();
    let latest = 0;

    const readManualPath = () => {
        const value = store?.get?.(MANUAL_PATH_STORE_KEY);
        return typeof value === 'string' && value.trim() ? value.trim() : null;
    };

    const listAutoCandidates = () => {
        const fixed = (() => {
            try {
                return listRuntimeSlotCandidates({ appGetAppPath, packagedDirName: MODS_RUNTIME_DIR });
            } catch {
                return [];
            }
        })();
        const all = [...fixed, ...listSystemFfmpegCandidates({ platform, env, homedir, readdir })];
        const seen = new Set();
        return all.filter((candidate) => {
            const key = platform === 'win32' ? candidate.toLowerCase() : candidate;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    };

    const probe = (candidate) => probeFfmpegBinary(candidate, { execFileImpl, exists });

    const search = async () => {
        const manualPath = readManualPath();
        const checked = [];
        let manualProblem = null;
        if (manualPath) {
            const result = await probe(manualPath);
            if (result.ok) {
                logger.info?.(`[VideoExportFfmpeg] using the chosen ffmpeg ${result.version}`);
                return {
                    available: true, source: 'manual', path: result.path, version: result.version, formats: result.formats,
                    manualPath, manualProblem: null, checked: [{ path: result.path, problem: null, version: result.version }],
                    candidates: [manualPath],
                };
            }
            manualProblem = result.problem;
            checked.push({ path: manualPath, problem: result.problem, version: result.version });
            logger.warn?.(`[VideoExportFfmpeg] the chosen ffmpeg cannot export transparent video (${result.problem}); searching instead`);
        }
        const candidates = listAutoCandidates();
        for (const candidate of candidates) {
            if (!exists(candidate)) continue;
            const result = await probe(candidate);
            checked.push({ path: candidate, problem: result.problem, version: result.version });
            if (result.ok) {
                logger.info?.(`[VideoExportFfmpeg] found ffmpeg ${result.version} with ${result.formats.join(', ')}`);
                return {
                    available: true, source: 'auto', path: result.path, version: result.version, formats: result.formats,
                    manualPath, manualProblem, checked, candidates,
                };
            }
        }
        logger.info?.(`[VideoExportFfmpeg] no usable ffmpeg (${checked.length} found, none fit)`);
        return {
            available: false, source: null, path: null, version: null, formats: [],
            manualPath, manualProblem, checked, candidates,
        };
    };

    const startSearch = () => {
        const id = ++latest;
        const run = chain.catch(() => {}).then(search).then((next) => {
            if (id === latest) status = next;
            return next;
        });
        chain = run;
        pending = run;
        void run.catch(() => {}).finally(() => {
            if (pending === run) pending = null;
        });
        return run;
    };

    /*
     * The cached status, or the search in flight. `refresh` starts a new search even while one runs
     * (a choice made meanwhile must be seen: that search read the stored path before it changed).
     */
    const resolve = ({ refresh = false } = {}) => {
        if (refresh) return startSearch();
        if (pending) return pending;
        if (status) return Promise.resolve(status);
        return startSearch();
    };

    /** Probes a file the user picked; stores it only when it can export. Returns { ok, problem, status }. */
    const chooseManual = async (filePath) => {
        const result = await probe(filePath);
        if (!result.ok) {
            return { ok: false, problem: result.problem, version: result.version, status: await resolve() };
        }
        store.set(MANUAL_PATH_STORE_KEY, filePath);
        return { ok: true, problem: null, version: result.version, status: await resolve({ refresh: true }) };
    };

    const clearManual = async () => {
        store.delete(MANUAL_PATH_STORE_KEY);
        return resolve({ refresh: true });
    };

    return { resolve, chooseManual, clearManual, getStatus: () => status };
};

module.exports = { createExportFfmpegResolver, probeFfmpegBinary, MANUAL_PATH_STORE_KEY };
