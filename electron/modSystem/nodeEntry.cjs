// electron/modSystem/nodeEntry.cjs
// One mod's Node entry (`main` in mod.json): the api object it is given, loading
// and activating it through the gate, keeping what it asks to have released,
// and releasing it. A mod without a Node entry runs nothing here. Cut out of
// modSystem.cjs, which decides which mods are loaded and when.

'use strict';

const path = require('path');

const { createModApi, createModDataStore, DATA_MAX_BYTES } = require('./modApi.cjs');
const { createSourceApi } = require('./sourceApi.cjs');
const shared = require('./foliumShared.json');
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
// Folium 2.0 (plan §5.2): a source mod's data file may be 16 MB; an ordinary mod's stays at 1 MB.
const SOURCE_DATA_MAX_BYTES = shared.limits.source.storage.maxBytes;
// How long the loader waits for a source's onBeforeUnload / onBeforeQuit handlers, all of them together.
const BEFORE_UNLOAD_MS = shared.limits.source.unload.beforeUnloadMs;
const BEFORE_QUIT_MS = shared.limits.source.unload.beforeQuitMs;
// How long an rpc call waits for an activate() that is still running before it answers rpc-not-found.
const ACTIVATION_WAIT_MS = 30000;

/* Runs every handler of `set` (each through the gate); resolves true when all settled, false at `limitMs`. */
const settleWithin = (guard, modId, where, set, limitMs) => {
    const running = Array.from(set).map((handler) => Promise.resolve(guard.call(modId, where, handler)).catch(() => undefined));
    if (running.length === 0) return Promise.resolve(true);
    let timer;
    return Promise.race([
        Promise.all(running).then(() => true),
        new Promise((resolve) => { timer = setTimeout(() => resolve(false), limitMs); }),
    ]).finally(() => clearTimeout(timer));
};

const createNodeEntryRuntime = ({
    app, guard, RETHROW, emitLog, hostInfo, getPublicSnapshot, sendToRenderer, secrets, getExportService, getRuntimeSnapshot,
    sourceHost = null, getLocale = () => null,
}) => {
    /*
     * `entries`: { dirPath } and, for a source mod (Folium 2.0), `source`: { sources } (the resolved ids and
     * the old data each may reach, sourceOwnership.cjs). An ordinary mod gets exactly what it got before.
     */
    const buildModRuntime = (manifest, entries) => {
        // mods-data/<id> (with files/ for api.storage.paths.data) and mods-cache/<id>.
        const { dataDir, filesDir, cacheDir } = resolveModStorageDirs(app.getPath('userData'), manifest.id);
        const isSource = Boolean(entries.source);
        const dataStore = createModDataStore(dataDir, { maxBytes: isSource ? SOURCE_DATA_MAX_BYTES : DATA_MAX_BYTES });
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
            hostInfo: hostInfo(manifest),
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

        // The members only a source mod has (sourceApi.cjs), released with the mod.
        const sourceApi = isSource && sourceHost
            ? createSourceApi({
                modId: manifest.id,
                manifest,
                sources: entries.source.sources,
                cacheDir,
                userDataDir: app.getPath('userData'),
                emitLog: context.emitLog,
            }, sourceHost)
            : null;
        context.sourceApi = sourceApi;
        context.getLocale = getLocale;

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
        /*
         * Where the Node entry stands: 'none' (no main, or not loaded yet), 'deferred' (a source used only for
         * matching: started by its client's first rpc, plan §5.3), 'activating' (an async activate() still
         * running), 'ready'. `ready` resolves once activate() has settled, so an rpc that arrives meanwhile
         * waits for the handlers it registers instead of answering rpc-not-found (plan §5.4).
         */
        let mainState = 'none';
        let markReady = () => {};
        let ready = Promise.resolve();
        let rejectedHandler = () => {};

        /* Requires and activates the main entry; a throw is the caller's to record. */
        const startMain = () => {
            if (!manifest.main || unloaded || (mainState !== 'none' && mainState !== 'deferred')) {
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
                mainState = 'activating';
                ready = new Promise((resolve) => { markReady = resolve; });
                Promise.resolve(activation).then(keepDisposer).catch((error) => rejectedHandler(error)).finally(() => {
                    if (mainState === 'activating') mainState = 'ready';
                    markReady();
                });
            } else {
                keepDisposer(activation);
                mainState = 'ready';
            }
        };

        /*
         * Loads the entry. `deferMain` (a source used only for matching): the main entry is not required now;
         * startMain() runs it on the first rpc from its client. A rejected async activate() goes to
         * `onActivationRejected`.
         */
        const load = (onActivationRejected, { deferMain = false } = {}) => {
            rejectedHandler = onActivationRejected;
            if (!manifest.main) {
                return;
            }
            if (deferMain) {
                mainState = 'deferred';
                return;
            }
            startMain();
        };

        /* Resolves once an activate() under way has settled, or after `limitMs`; at once when none is. */
        const whenReady = (limitMs = ACTIVATION_WAIT_MS) => {
            if (mainState !== 'activating') return Promise.resolve();
            let timer;
            return Promise.race([ready, new Promise((resolve) => { timer = setTimeout(resolve, limitMs); })])
                .finally(() => clearTimeout(timer));
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
            sourceApi?.release();
            markReady();
        };

        return {
            load,
            unload,
            startMain,
            whenReady,
            dataStore,
            getRpcHandler: (name) => rpcHandlers.get(name) ?? null,
            /* 'none' | 'deferred' | 'activating' | 'ready', see startMain. */
            getMainState: () => mainState,
            /* A source's onBeforeUnload handlers, 3 seconds at most together; resolves false at the limit. */
            beforeUnload: () => (sourceApi
                ? settleWithin(guard, manifest.id, 'onBeforeUnload', sourceApi.hooks.beforeUnload, BEFORE_UNLOAD_MS)
                : Promise.resolve(true)),
            /* Whether the source registered an onBeforeQuit handler (the quit is held only for one that did). */
            hasQuitHandlers: () => Boolean(sourceApi && sourceApi.hooks.beforeQuit.size > 0),
            /* A source's onBeforeQuit handlers, 3 seconds at most together. */
            beforeQuit: () => (sourceApi
                ? settleWithin(guard, manifest.id, 'onBeforeQuit', sourceApi.hooks.beforeQuit, BEFORE_QUIT_MS)
                : Promise.resolve(true)),
            /* The main window went with no window taking its playback over. */
            playersOrphaned: (reason) => sourceApi?.hooks.playersOrphaned.forEach((handler) => {
                guard.call(manifest.id, 'onPlayersOrphaned', () => handler(reason));
            }),
            /* The main window came or went. */
            mainWindowChanged: (present) => sourceApi?.hooks.mainWindow.forEach((listener) => {
                guard.call(manifest.id, 'onMainWindowChanged', () => listener(present));
            }),
        };
    };

    return { buildModRuntime };
};

module.exports = { createNodeEntryRuntime, purgeModuleCache };
