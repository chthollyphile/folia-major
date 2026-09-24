// electron/modSystem/modApi.cjs
// The restricted Folium API surface injected into a mod's Node entry (`main`).
// A mod only ever sees this object plus what the loader explicitly grants;
// it never receives Electron primitives, Node internals, or loader internals.

'use strict';

const fs = require('fs');
const path = require('path');

const DATA_FILE_NAME = 'mod-data.json';
// Per-mod cap on the serialized data file. Storage is for settings-sized state;
// anything larger belongs in files the mod manages itself.
const DATA_MAX_BYTES = 1024 * 1024;

// Permission each guarded API family requires. `render.export` is enforced by
// the loader itself (it owns the export service), everything else is enforced
// here, at the call site, so a permission a mod did not declare is unreachable
// rather than merely undocumented.
const STORAGE_PERMISSION = 'filesystem.data';
const PLAYBACK_PERMISSION = 'runtime.playback';

const RPC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const permissionDenied = (permission) => new Error(`permission-denied:${permission}`);

/*
 * Per-mod key/value store persisted as one JSON file under the mod data
 * directory. Shared by the Node API (`api.storage.data`) and the renderer
 * client (`folium.storage`, routed over IPC), so both sides see one state.
 * Every operation is async and queued: two overlapping writes from the two
 * sides can never interleave their read-modify-write cycles.
 */
const createModDataStore = (dataDir, { maxBytes = DATA_MAX_BYTES } = {}) => {
    const dataFilePath = () => path.join(dataDir, DATA_FILE_NAME);
    let queue = Promise.resolve();

    const enqueue = (task) => {
        const run = queue.then(task, task);
        // Keep the chain alive after a failure; the caller still sees the rejection.
        queue = run.catch(() => undefined);
        return run;
    };

    const loadData = async () => {
        try {
            const raw = await fs.promises.readFile(dataFilePath(), 'utf8');
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch {
            return {};
        }
    };

    const saveData = async (data) => {
        const serialized = JSON.stringify(data, null, 2);
        if (Buffer.byteLength(serialized, 'utf8') > maxBytes) {
            throw new Error(`storage-quota-exceeded:${maxBytes}`);
        }
        await fs.promises.mkdir(dataDir, { recursive: true });
        const tempPath = dataFilePath() + '.tmp';
        await fs.promises.writeFile(tempPath, serialized, 'utf8');
        await fs.promises.rename(tempPath, dataFilePath());
    };

    const requireKey = (key) => {
        if (typeof key !== 'string' || key.length === 0) {
            throw new Error('storage key must be a non-empty string');
        }
    };

    return {
        get: (key) => enqueue(async () => {
            requireKey(key);
            const data = await loadData();
            return key in data ? cloneJson(data[key]) : undefined;
        }),
        set: (key, value) => enqueue(async () => {
            requireKey(key);
            if (value === undefined) {
                throw new Error('storage value must be JSON-serializable (use delete to remove a key)');
            }
            const data = await loadData();
            data[key] = cloneJson(value);
            await saveData(data);
        }),
        has: (key) => enqueue(async () => {
            requireKey(key);
            return key in (await loadData());
        }),
        delete: (key) => enqueue(async () => {
            requireKey(key);
            const data = await loadData();
            if (!(key in data)) return;
            delete data[key];
            await saveData(data);
        }),
        keys: () => enqueue(async () => Object.keys(await loadData())),
    };
};

/*
 * context: {
 *   modId, manifest, dataStore,
 *   hostInfo: { folium: { major, minor }, folia },
 *   emitLog(level, message, details),
 *   getPlaybackSnapshot(),      // Folium DTO, or null before the renderer pushed one
 *   registerDisposer(fn),       // run when the mod is disabled, reloaded, or the app quits
 *   registerRpc(name, fn),      // callable from this mod's client entry
 *   requestExport(spec),        // permission render.export enforced by the loader
 * }
 */
const createModApi = (context) => {
    const declaredPermissions = Array.isArray(context.manifest?.permissions) ? context.manifest.permissions : [];

    /*
     * Fail-closed permission gate. Throws the same `permission-denied:<id>`
     * shape everywhere, so a mod sees one consistent error.
     */
    const requirePermission = (permission) => {
        if (!declaredPermissions.includes(permission)) {
            throw permissionDenied(permission);
        }
    };

    const log = {
        info: (message, details) => context.emitLog('info', message, details),
        warn: (message, details) => context.emitLog('warn', message, details),
        error: (message, details) => context.emitLog('error', message, details),
    };

    // Rejects instead of throwing so every storage call has one failure channel.
    const guardedStorage = (method) => (...args) => {
        try {
            requirePermission(STORAGE_PERMISSION);
        } catch (error) {
            return Promise.reject(error);
        }
        return context.dataStore[method](...args);
    };

    return {
        // Frozen manifest so mods cannot rewrite their own contract at runtime.
        manifest: Object.freeze(cloneJson(context.manifest)),
        host: Object.freeze(cloneJson(context.hostInfo)),
        log,
        storage: {
            data: {
                get: guardedStorage('get'),
                set: guardedStorage('set'),
                has: guardedStorage('has'),
                delete: guardedStorage('delete'),
                keys: guardedStorage('keys'),
            },
        },
        /*
         * Cleanup hook. Anything a mod starts in activate() — timers, watchers,
         * listeners, child processes — should be released here; the loader runs
         * these before the mod stops being active. Returning a function from
         * activate() registers it the same way.
         */
        lifecycle: {
            onDeactivate: (disposer) => context.registerDisposer(disposer),
        },
        runtime: {
            getPlaybackSnapshot: () => {
                requirePermission(PLAYBACK_PERMISSION);
                return context.getPlaybackSnapshot();
            },
        },
        /*
         * The Node half of the client ↔ main channel. The mod's client entry
         * calls `folium.rpc.call(name, ...args)`; arguments and results cross
         * IPC, so both must be JSON-serializable.
         */
        rpc: {
            handle: (name, handler) => {
                if (typeof name !== 'string' || !RPC_NAME_PATTERN.test(name)) {
                    throw new Error('rpc.handle requires a name matching /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/');
                }
                if (typeof handler !== 'function') {
                    throw new Error('rpc.handle requires a handler function');
                }
                context.registerRpc(name, handler);
            },
        },
        /*
         * Starts a video export of the *current* song with the host's live mode,
         * tuning, lyrics, theme and Folium parameter values. The spec only carries
         * output choices. The loader enforces `render.export`.
         */
        render: {
            exportVideo: (spec) => context.requestExport(spec),
        },
        // Unfrozen surfaces live here; empty in Folium 1.0.
        experimental: Object.freeze({}),
    };
};

module.exports = {
    createModApi,
    createModDataStore,
    DATA_FILE_NAME,
    DATA_MAX_BYTES,
    PLAYBACK_PERMISSION,
    STORAGE_PERMISSION,
};
