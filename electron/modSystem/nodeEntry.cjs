// electron/modSystem/nodeEntry.cjs
// One mod's Node entry (`main` in mod.json): the api object it is given, loading
// and activating it through the gate, keeping what it asks to have released,
// and releasing it. A mod without a Node entry runs nothing here. Cut out of
// modSystem.cjs, which decides which mods are loaded and when.

'use strict';

const path = require('path');

const { createModApi, createModDataStore } = require('./modApi.cjs');
const { resolveModStorageDirs } = require('./modFiles.cjs');
const { isThenable } = require('./guard.cjs');
const { readOldActivation } = require('./deprecated.cjs');
const { channels: IPC } = require('./foliumShared.json');

/*
 * Drops every cached module that lives inside a mod directory, not just its
 * entry file. Clearing only the entry left a mod's own helper modules cached,
 * so editing them and hitting "reload" kept running the previous code — the
 * Node-side twin of the ES module map problem the client URLs solve with a
 * digest. Windows paths are compared case-insensitively because require.cache
 * keys and readdir paths can disagree on case.
 */
const purgeModuleCache = (dirPath) => {
    const prefix = path.resolve(dirPath) + path.sep;
    const normalize = (value) => (process.platform === 'win32' ? value.toLowerCase() : value);
    const normalizedPrefix = normalize(prefix);
    Object.keys(require.cache).forEach((cached) => {
        if (normalize(cached).startsWith(normalizedPrefix)) {
            delete require.cache[cached];
        }
    });
};

/*
 * `app` is Electron's. The rest is the loader's: `guard` is the gate every call
 * into a mod goes through and `RETHROW` its option for calls whose failure the
 * loader answers itself; `emitLog`, `hostInfo`, `getPublicSnapshot` and
 * `sendToRenderer` are its functions, `secrets` its store of `secret` settings
 * values (modSecrets.cjs). Two things are asked for only when a
 * mod's code needs them, because they are not fixed when this is set up:
 * `getExportService()` (the loader makes the export service after this) and
 * `getRuntimeSnapshot()` (the window pushes a new snapshot as the app runs).
 */
const createNodeEntryRuntime = ({
    app, guard, RETHROW, emitLog, hostInfo, getPublicSnapshot, sendToRenderer, secrets, getExportService, getRuntimeSnapshot,
}) => {
    const buildModRuntime = (manifest, entries) => {
        // mods-data/<id> (with files/ for api.storage.paths.data) and mods-cache/<id>.
        const { dataDir, filesDir, cacheDir } = resolveModStorageDirs(app.getPath('userData'), manifest.id);
        const dataStore = createModDataStore(dataDir);
        const rpcHandlers = new Map();
        const disposers = [];
        // What api.secrets.subscribe added, removed when the mod stops.
        const secretSubscriptions = new Set();
        let unloaded = false;

        const context = {
            modId: manifest.id,
            manifest,
            dataStore,
            dataDir,
            filesDir,
            cacheDir,
            hostInfo: hostInfo(),
            getUserFolder: (name) => app.getPath(name),
            emitLog: (level, message, details) => emitLog(manifest.id, level, message, details),
            getPlaybackSnapshot: getPublicSnapshot,
            registerDisposer: (disposer) => {
                if (typeof disposer !== 'function') {
                    throw new Error('onDispose requires a function');
                }
                if (unloaded) {
                    // Registered after the mod was deactivated (an async activate that was still
                    // pending): nothing drains the list again, so it runs now.
                    runDisposer(disposer);
                    return;
                }
                disposers.push(disposer);
            },
            /*
             * api.secrets, bound to this mod. A listener runs through the gate, so one that throws is
             * logged on the mod's row and the others still hear the change.
             */
            secrets: {
                get: (key) => secrets.get(manifest.id, key),
                has: (key) => secrets.has(manifest.id, key),
                set: (key, value) => secrets.set(manifest.id, key, value),
                subscribe: (listener) => {
                    if (typeof listener !== 'function') {
                        throw new TypeError('secrets.subscribe requires a listener function');
                    }
                    if (unloaded) {
                        // Nothing would remove it: the mod has already stopped.
                        return () => {};
                    }
                    const off = secrets.subscribe(manifest.id, (key) => guard.call(manifest.id, 'secrets.subscribe listener', () => listener(key)));
                    secretSubscriptions.add(off);
                    return () => {
                        secretSubscriptions.delete(off);
                        off();
                    };
                },
            },
            registerRpc: (name, handler) => {
                if (rpcHandlers.has(name)) {
                    throw new Error(`duplicate rpc handler "${name}"`);
                }
                rpcHandlers.set(name, handler);
            },
            // api.rpc.send, already checked: to the main window only (the export window has no
            // preload to hear it). Nothing is queued, so once the mod stopped a message is dropped.
            sendToClient: (name, json) => {
                if (unloaded) {
                    return;
                }
                sendToRenderer(IPC.fRpcMessage, { modId: manifest.id, name, json });
            },
            requestExport: (spec) => getExportService().runExport({
                modId: manifest.id,
                spec,
                hostState: getRuntimeSnapshot()?.internal ?? null,
                onProgress: (progress) => {
                    sendToRenderer(IPC.fExportProgress, { modId: manifest.id, ...progress });
                },
            }),
        };

        const modApi = createModApi(context);

        // A throw, or a promise that rejects, is logged as "deactivate handler failed".
        const runDisposer = (disposer) => guard.call(manifest.id, 'deactivate handler', disposer);

        // A function activate() returns joins what api.onDispose registered; anything
        // else it returns is not kept. These two are the only ways to register a cleanup.
        const keepDisposer = (returned) => {
            // Folium 1.6 only: a `{ dispose }` object is read as its function (deprecated.cjs).
            const activation = readOldActivation(returned, manifest);
            if (typeof activation !== 'function') {
                return;
            }
            if (unloaded) {
                // The entry finished activating after the mod was deactivated:
                // nothing will run this disposer later, so it runs now.
                runDisposer(activation);
                return;
            }
            disposers.push(activation);
        };

        /*
         * A client-only mod has no Node entry: loading it runs nothing here.
         * A throw (from require, from the entry) is the caller's to record.
         * activate() may return a promise: the load loop is synchronous, so the
         * promise is followed, not awaited. A disposer it resolves to is kept;
         * a rejection goes to `onActivationRejected`.
         */
        const load = (onActivationRejected) => {
            if (!manifest.main) {
                return;
            }
            const entryPath = path.join(entries.dirPath, manifest.main);
            // Drop the whole mod subtree from the cache so a reload re-executes
            // the mod against its current files instead of returning stale state.
            purgeModuleCache(entries.dirPath);
            const moduleFactory = guard.call(manifest.id, 'require', () => require(entryPath), RETHROW);
            if (typeof moduleFactory !== 'function') {
                throw new Error(`mod main must export a function, got ${typeof moduleFactory}`);
            }
            const activation = guard.call(manifest.id, 'activate', () => moduleFactory(modApi), RETHROW);
            if (isThenable(activation)) {
                Promise.resolve(activation).then(keepDisposer).catch(onActivationRejected);
            } else {
                keepDisposer(activation);
            }
        };

        /*
         * Runs the mod's cleanup before it stops being active. Disposers run
         * last-registered first, and one failing never blocks the rest.
         */
        const unload = () => {
            unloaded = true;
            while (disposers.length > 0) {
                runDisposer(disposers.pop());
            }
            rpcHandlers.clear();
            secretSubscriptions.forEach((off) => off());
            secretSubscriptions.clear();
        };

        return { load, unload, dataStore, getRpcHandler: (name) => rpcHandlers.get(name) ?? null };
    };

    return { buildModRuntime };
};

module.exports = { createNodeEntryRuntime, purgeModuleCache };
