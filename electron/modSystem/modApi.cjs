// electron/modSystem/modApi.cjs
// The Folium API object a mod's Node entry (`main`) receives as `activate(api)`.
// Its type, with what each member does, is FoliumMainApi in
// src/mods/folium/mainContract.ts. The object hands out no Electron object and
// none of the loader's own.

'use strict';

const fs = require('fs');
const path = require('path');

const { permissionGuarding } = require('./manifest.cjs');
const { addOldMainNames } = require('./deprecated.cjs');

const DATA_FILE_NAME = 'mod-data.json';
// Per-mod cap on the serialized data file. Storage is for settings-sized state;
// anything larger belongs in files under `api.storage.paths.data`.
const DATA_MAX_BYTES = 1024 * 1024;

// The permission each guarded member needs, as the guards lists in foliumShared.json
// say. requirePermission below checks them at the call, so a permission a mod did
// not declare is unreachable rather than merely undocumented.
const STORAGE_PERMISSION = permissionGuarding('api.storage');
const PLAYBACK_PERMISSION = permissionGuarding('api.runtime.getPlaybackSnapshot');
const EXPORT_PERMISSION = permissionGuarding('api.render.exportVideo');

const RPC_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
// Cap on one `api.rpc.send` payload, in bytes of its JSON text. A message is pushed to the
// window as it is sent; anything bulkier belongs in a file or behind an rpc.call.
const RPC_SEND_MAX_BYTES = 64 * 1024;

/*
 * `api.rpc.send`'s payload as the JSON text that crosses to the window, checked
 * here so a bad one throws at the mod's call instead of vanishing on the way.
 * Leaving the payload out sends null, as an rpc.call answer of undefined does.
 */
const serializeRpcPayload = (payload) => {
    if (payload === undefined) {
        return 'null';
    }
    let json;
    try {
        json = JSON.stringify(payload);
    } catch (error) {
        throw new Error('rpc.send requires a JSON-serializable payload', { cause: error });
    }
    // A function or a symbol on its own stringifies to undefined: nothing to send.
    if (typeof json !== 'string') {
        throw new Error('rpc.send requires a JSON-serializable payload');
    }
    if (Buffer.byteLength(json, 'utf8') > RPC_SEND_MAX_BYTES) {
        throw new Error(`rpc-payload-too-large:${RPC_SEND_MAX_BYTES}`);
    }
    return json;
};

const cloneJson = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));

const permissionDenied = (permission) => new Error(`permission-denied:${permission}`);

// Write queues by data directory, shared by every store instance for that
// directory. A reload builds new stores while an old instance may still have a
// write in flight; a per-instance queue would let both write the same .tmp file.
const queuesByDataDir = new Map();

/*
 * Per-mod key/value store persisted as one JSON file under the mod data
 * directory. Shared by the Node API (`api.storage`) and the renderer
 * client (`folium.storage`, routed over IPC), so both sides see one state.
 * Every operation is async and queued: two overlapping writes from the two
 * sides can never interleave their read-modify-write cycles.
 */
const createModDataStore = (dataDir, { maxBytes = DATA_MAX_BYTES } = {}) => {
    const dataFilePath = () => path.join(dataDir, DATA_FILE_NAME);
    const queueKey = path.resolve(dataDir);

    const enqueue = (task) => {
        const queue = queuesByDataDir.get(queueKey) ?? Promise.resolve();
        const run = queue.then(task, task);
        // Keep the chain alive after a failure; the caller still sees the rejection.
        const tail = run.catch(() => undefined);
        queuesByDataDir.set(queueKey, tail);
        void tail.then(() => {
            if (queuesByDataDir.get(queueKey) === tail) queuesByDataDir.delete(queueKey);
        });
        return run;
    };

    const loadData = async () => {
        try {
            const raw = await fs.promises.readFile(dataFilePath(), 'utf8');
            const parsed = JSON.parse(raw);
            // Prototype-free, so keys like "constructor" or "__proto__" are plain data.
            return Object.assign(
                Object.create(null),
                parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {},
            );
        } catch {
            return Object.create(null);
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
            return Object.hasOwn(data, key) ? cloneJson(data[key]) : undefined;
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
            return Object.hasOwn(await loadData(), key);
        }),
        delete: (key) => enqueue(async () => {
            requireKey(key);
            const data = await loadData();
            if (!Object.hasOwn(data, key)) return;
            delete data[key];
            await saveData(data);
        }),
        keys: () => enqueue(async () => Object.keys(await loadData())),
    };
};

/*
 * context: {
 *   modId, manifest, dataStore,
 *   dataDir,                    // this mod's folder, userData/mods-data/<id>
 *   filesDir, cacheDir,         // api.storage.paths.data / .cache; absolute, built from the manifest id
 *   hostInfo: { folium: { major, minor }, folia },
 *   getUserFolder(name),        // 'documents' | 'downloads' | 'music' | 'videos'
 *   emitLog(level, message, details),
 *   getPlaybackSnapshot(),      // Folium DTO, or null before the renderer pushed one
 *   registerDisposer(fn),       // run when the mod is disabled, reloaded, or the app quits
 *   secrets: { get, has, set, subscribe },  // api.secrets, bound to this mod (modSecrets.cjs)
 *   registerRpc(name, fn),      // callable from this mod's client entry
 *   sendToClient(name, json),   // pushes checked JSON text to this mod's client in the main window
 *   requestExport(spec),        // runs the export; its permission is checked here, not there
 * }
 */
const createModApi = (context) => {
    const declaredPermissions = Array.isArray(context.manifest?.permissions) ? context.manifest.permissions : [];

    /*
     * The one permission gate of the main entry, fail-closed. Throws the same
     * `permission-denied:<id>` shape everywhere, so a mod sees one consistent error.
     */
    const requirePermission = (permission) => {
        if (!declaredPermissions.includes(permission)) {
            throw permissionDenied(permission);
        }
    };

    // The gate of an async member: the same error as a rejection, so every call of
    // that member has one failure channel.
    const guardedAsync = (permission, run) => (...args) => {
        try {
            requirePermission(permission);
        } catch (error) {
            return Promise.reject(error);
        }
        return run(...args);
    };

    const log = {
        info: (message, details) => context.emitLog('info', message, details),
        warn: (message, details) => context.emitLog('warn', message, details),
        error: (message, details) => context.emitLog('error', message, details),
    };

    /*
     * `api.storage.paths`: a getter per directory, so every read checks the permission (throwing
     * synchronously, like runtime.getPlaybackSnapshot) and re-creates the directory, which the user
     * may have emptied from the mods panel since the last read.
     */
    const modDirectory = (directory) => {
        requirePermission(STORAGE_PERMISSION);
        fs.mkdirSync(directory, { recursive: true });
        return directory;
    };

    /*
     * The getters are non-enumerable: anything that walks the api's own keys (JSON.stringify(api)
     * while debugging, `{ ...api.storage.paths }`, structuredClone) would otherwise read them, and a
     * read throws without the permission and creates directories with it. `'data' in
     * api.storage.paths` still finds them.
     */
    const storagePaths = Object.defineProperties({}, {
        data: { get: () => modDirectory(context.filesDir), enumerable: false },
        cache: { get: () => modDirectory(context.cacheDir), enumerable: false },
    });

    // Folium 1.6 only: the members Folium 2 removed, added back (deprecated.cjs).
    return addOldMainNames({
        // Frozen manifest so mods cannot rewrite their own contract at runtime.
        manifest: Object.freeze(cloneJson(context.manifest)),
        host: Object.freeze(cloneJson(context.hostInfo)),
        log,
        storage: {
            get: guardedAsync(STORAGE_PERMISSION, context.dataStore.get),
            set: guardedAsync(STORAGE_PERMISSION, context.dataStore.set),
            has: guardedAsync(STORAGE_PERMISSION, context.dataStore.has),
            delete: guardedAsync(STORAGE_PERMISSION, context.dataStore.delete),
            keys: guardedAsync(STORAGE_PERMISSION, context.dataStore.keys),
            // Always present, permission or not, so `'paths' in api.storage` detects it.
            paths: Object.freeze(storagePaths),
        },
        /*
         * Folium 1.7: the values of the mod's `secret` settings fields, shared with its client's
         * folium.secrets. No permission: a mod reaches only its own. Read from the context at the
         * call, so the store is only met when a mod uses it.
         */
        secrets: Object.freeze({
            get: (key) => context.secrets.get(key),
            has: (key) => context.secrets.has(key),
            set: (key, value) => context.secrets.set(key, value),
            subscribe: (listener) => context.secrets.subscribe(listener),
        }),
        /*
         * The user's folders are asked for when read: Electron throws for a folder
         * the system does not have, and that must not keep the mod from starting.
         */
        paths: Object.freeze({
            get documents() { return context.getUserFolder('documents'); },
            get downloads() { return context.getUserFolder('downloads'); },
            get music() { return context.getUserFolder('music'); },
            get videos() { return context.getUserFolder('videos'); },
        }),
        /*
         * Cleanup hook. Anything a mod starts in activate() — timers, watchers,
         * listeners, child processes — should be released here; the loader runs
         * these before the mod stops being active. Returning a function from
         * activate() registers it the same way.
         */
        onDispose: (disposer) => context.registerDisposer(disposer),
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
            /*
             * Folium 1.7: the other direction. Fire-and-forget to this mod's client in the
             * main window (`folium.rpc.on(name, ...)`); a bad name or payload throws here,
             * a missing window or client drops the message.
             */
            send: (name, payload) => {
                if (typeof name !== 'string' || !RPC_NAME_PATTERN.test(name)) {
                    throw new Error('rpc.send requires a name matching /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/');
                }
                context.sendToClient(name, serializeRpcPayload(payload));
            },
        },
        /*
         * Starts a video export of the *current* song with the host's live mode,
         * tuning, lyrics, theme and Folium parameter values. The spec only carries
         * output choices.
         */
        render: {
            exportVideo: guardedAsync(EXPORT_PERMISSION, (spec) => context.requestExport(spec)),
        },
    }, context.manifest);
};

module.exports = {
    createModApi,
    createModDataStore,
    DATA_FILE_NAME,
    DATA_MAX_BYTES,
    PLAYBACK_PERMISSION,
    RPC_SEND_MAX_BYTES,
};
