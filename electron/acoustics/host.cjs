const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { createSenderGuardedHandler } = require('../ipcAccessGuard.cjs');
const { STEAM_AUDIO_VERSION, DEFAULTS, validateRoomRequest } = require('./phonon.cjs');

// electron/acoustics/host.cjs
// The main process's half of the scene engine's room sound: window.electron.sceneAcoustics
// (SceneAcousticsApi of src/services/sceneSound/acousticsTypes.ts) answered from a disk cache under userData,
// or by the utility process in worker.cjs, which is started on demand and stopped once idle - the analysis
// host's way (electron/analysis/host.cjs). A seat already heard is read back, not simulated again.
//
// Without the library (a platform Steam Audio has none for, a dev checkout before `npm run steam-audio:fetch`,
// a library that will not load) available() says why and computeRoom rejects with that reason; nothing else
// in the app depends on it.

/** = ROOM_FORMAT of acousticsTypes.ts (test/unit/sceneAcoustics checks they agree): a new one drops old files. */
const ROOM_FORMAT = 1;

/** A seat change usually comes a while after the last; the context and HRTF are kept for one minute. */
const IDLE_MS = 60_000;

/** About 1.5 MB a room (4 channels, 2 s, 48 kHz): the least recently used beyond this many are deleted. */
const MAX_CACHE_FILES = 64;

/** The cache file of a key: hashed, since the key comes from a renderer and is no file name. */
const cacheFileFor = (dir, key) => path.join(dir, `${crypto.createHash('sha256').update(key).digest('hex').slice(0, 40)}.room`);

/** A length-prefixed JSON header, then each channel as float32. */
const encodeRoom = ({ key, sampleRate, channels }, bassCutoffHz) => {
    const length = channels[0].length;
    const header = Buffer.from(JSON.stringify({
        format: ROOM_FORMAT, steamAudio: STEAM_AUDIO_VERSION, bassCutoffHz, key, sampleRate, channels: channels.length, length,
    }));
    const bytes = Buffer.alloc(4 + header.length + channels.length * length * 4);
    bytes.writeUInt32LE(header.length, 0);
    header.copy(bytes, 4);
    channels.forEach((ch, i) => bytes.set(new Uint8Array(ch.buffer, ch.byteOffset, ch.byteLength), 4 + header.length + i * length * 4));
    return bytes;
};

/** The four channels stored in `bytes`, or null unless it is a whole file made for exactly this request. */
const decodeRoom = (bytes, { key, sampleRate }, bassCutoffHz) => {
    try {
        const headerLength = bytes.readUInt32LE(0);
        const header = JSON.parse(bytes.toString('utf8', 4, 4 + headerLength));
        const { length } = header;
        const matches = header.format === ROOM_FORMAT && header.steamAudio === STEAM_AUDIO_VERSION && header.bassCutoffHz === bassCutoffHz
            && header.key === key && header.sampleRate === sampleRate && header.channels === 4
            && Number.isInteger(length) && length > 0 && bytes.length === 4 + headerLength + 4 * length * 4;
        if (!matches) return null;
        return [0, 1, 2, 3].map((i) => {
            const ch = new Float32Array(length);
            const from = 4 + headerLength + i * length * 4;
            new Uint8Array(ch.buffer).set(bytes.subarray(from, from + length * 4));
            return ch;
        });
    } catch {
        return null;
    }
};

/** The cached channels for `request`, or null (none, or a file that is broken or stale: it is recomputed). */
const readCachedRoom = async (dir, request, bassCutoffHz) => {
    const file = cacheFileFor(dir, request.key);
    const bytes = await fs.promises.readFile(file).catch(() => null);
    const channels = bytes && decodeRoom(bytes, request, bassCutoffHz);
    if (channels) {
        const now = new Date();
        await fs.promises.utimes(file, now, now).catch(() => {}); // most recently used, for pruneCache
    }
    return channels || null;
};

/** Deletes the least recently used rooms beyond `max`. */
const pruneCache = async (dir, max = MAX_CACHE_FILES) => {
    const names = (await fs.promises.readdir(dir)).filter(name => name.endsWith('.room'));
    if (names.length <= max) return;
    const files = await Promise.all(names.map(async name => ({ file: path.join(dir, name), at: (await fs.promises.stat(path.join(dir, name))).mtimeMs })));
    files.sort((a, b) => a.at - b.at);
    for (const { file } of files.slice(0, files.length - max)) await fs.promises.rm(file, { force: true });
};

/** Stores a computed room; a failure is logged, never thrown (the room was computed all the same). */
const writeCachedRoom = async (dir, result, bassCutoffHz) => {
    try {
        await fs.promises.mkdir(dir, { recursive: true });
        const file = cacheFileFor(dir, result.key);
        await fs.promises.writeFile(`${file}.tmp`, encodeRoom(result, bassCutoffHz));
        await fs.promises.rename(`${file}.tmp`, file);
        await pruneCache(dir);
    } catch (error) {
        console.warn('[acoustics] could not cache the room', error);
    }
};

/**
 * Registers the scene-acoustics IPC handlers and returns { available, computeRoom }.
 *
 * @param isTrusted (event) => whether the sender may use it: the main window, where the scene plays.
 * @param libraryFile phonon.cjs steamAudioLibraryPath(), or null when there is none.
 * @param getCacheDir userData/scene-acoustics; a getter, so it is read once the app has set its paths.
 */
const createAcousticsHost = ({ app, ipcMain, isTrusted, libraryFile, getCacheDir, idleMs = IDLE_MS }) => {
    let child = null;
    let idleTimer = null;
    let quitting = false;
    let nextId = 0;
    /** { resolve, reject } of each request sent to `child` and not answered yet, by id. */
    const pending = new Map();

    const stop = (reason) => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        const dying = child;
        child = null;
        if (dying) dying.kill();
        const orphans = [...pending.values()];
        pending.clear();
        for (const { reject } of orphans) reject(new Error(reason));
    };

    const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (pending.size) { armIdle(); return; }
            console.log('[acoustics] worker idle, stopping');
            stop('the acoustics process was stopped');
        }, idleMs);
        idleTimer.unref?.();
    };

    const spawn = () => {
        if (child) return child;
        const { utilityProcess } = require('electron');
        const started = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [libraryFile], {
            // Piped and forwarded: `inherit` drops a utility process's output on Windows (analysis/host.cjs).
            stdio: 'pipe',
            serviceName: 'folia-acoustics',
        });
        const forward = stream => stream?.on('data', chunk => console.log(`[acoustics] ${String(chunk).trimEnd()}`));
        forward(started.stdout);
        forward(started.stderr);
        started.on('message', ({ id, result, error }) => {
            const entry = pending.get(id);
            if (!entry) return;
            pending.delete(id);
            if (error) entry.reject(new Error(error));
            else entry.resolve(result);
        });
        started.on('exit', (code) => {
            if (child !== started || quitting) return;
            console.warn(`[acoustics] worker exited on its own (${code})`);
            stop(`the acoustics process exited (${code})`);
        });
        child = started;
        return started;
    };

    const ask = (kind, payload) => new Promise((resolve, reject) => {
        const id = nextId += 1;
        pending.set(id, { resolve, reject });
        try {
            spawn().postMessage({ id, kind, payload });
        } catch (error) {
            pending.delete(id);
            reject(error);
        }
        armIdle();
    });

    let availability = null;
    /** Whether Steam Audio loads on this machine; asked once, in the worker, so a bad library cannot take this process down. */
    const available = () => {
        availability ??= (libraryFile
            ? ask('available').then(() => ({ ok: true }), (error) => {
                console.warn('[acoustics] Steam Audio did not load', error);
                return { ok: false, reason: error.message };
            })
            : Promise.resolve({ ok: false, reason: 'no Steam Audio library in this build (npm run steam-audio:fetch)' })
        ).then((answer) => {
            console.log(`[acoustics] Steam Audio ${STEAM_AUDIO_VERSION} ${answer.ok ? `available (${libraryFile})` : `unavailable: ${answer.reason}`}`);
            return answer;
        });
        return availability;
    };

    /** RoomResult for `request`: from the cache when this key was computed before, else from the worker. */
    const computeRoom = async (request) => {
        validateRoomRequest(request);
        const started = performance.now();
        const { bassCutoffHz } = DEFAULTS;
        const elapsed = () => Math.round(performance.now() - started);
        const cached = await readCachedRoom(getCacheDir(), request, bassCutoffHz);
        if (cached) {
            console.log(`[acoustics] room from cache in ${elapsed()} ms (${request.output})`);
            return { key: request.key, sampleRate: request.sampleRate, channels: cached, source: 'cache', ms: elapsed() };
        }
        const state = await available();
        if (!state.ok) throw new Error(state.reason);
        const channels = await ask('compute', request);
        const result = { key: request.key, sampleRate: request.sampleRate, channels, source: 'computed', ms: elapsed() };
        console.log(`[acoustics] room computed in ${result.ms} ms (${request.output}, ${request.sampleRate} Hz)`);
        await writeCachedRoom(getCacheDir(), result, bassCutoffHz);
        return result;
    };

    ipcMain.handle('scene-acoustics-available', createSenderGuardedHandler({
        channel: 'scene-acoustics-available',
        isTrusted,
        onUntrusted: () => ({ ok: false, reason: 'not available to this window' }),
        handler: () => available(),
    }));
    ipcMain.handle('scene-acoustics-compute', createSenderGuardedHandler({
        channel: 'scene-acoustics-compute',
        isTrusted,
        handler: (_event, request) => computeRoom(request),
    }));

    app?.on('will-quit', () => { quitting = true; stop('the app is quitting'); });

    return { available, computeRoom };
};

module.exports = {
    ROOM_FORMAT, MAX_CACHE_FILES, createAcousticsHost, cacheFileFor, encodeRoom, decodeRoom, readCachedRoom, writeCachedRoom, pruneCache,
};
