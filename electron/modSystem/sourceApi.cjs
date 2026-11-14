// electron/modSystem/sourceApi.cjs
// The members of a main entry's `api` that only source mods get (Folium 2.0 plan §5.5): their network
// (Electron `net`, binary, partitions), the old data a built-in source's sign-in lives in, sealing with the
// OS, media rules and `_media` streams, hidden windows, shell, dialogs, the host's locale, the moments
// before an unload or a quit, diagnostics, native files the app ships, and the host's cache budget and
// crash report. An ordinary mod's api has none of these: its limits stay as they were.
//
// Everything Electron is reached through `host` (the loader builds it from the electron module; tests hand
// in fakes), and everything a mod registers goes when the mod stops: `release()` runs from its unload.

'use strict';

const path = require('path');

const { assertEncryptionAvailable } = require('../osEncryption.cjs');
const { parseRangeHeader } = require('./modProtocol.cjs');

const MEDIA_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const PARTITION_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/*
 * The partition a source mod's own session `name` lives in. Neither a mod id nor a partition name can hold a dot, so
 * `persist:folium.<mod id>.<name>` reads back one way only. (A hyphen, which both can hold, did not: mod `foo` with
 * session `bar-login` and mod `foo-bar` with session `login` were the same partition, the same cookies, and one's
 * "clear data" cleared the other's sign-in.) The client's `folium.net.fetch` with `session` uses it too.
 */
const ownPartitionOf = (modId, name) => `persist:folium.${modId}.${name}`;

const requireFunction = (value, what) => {
    if (typeof value !== 'function') throw new TypeError(`${what} requires a function`);
};

/* http(s) only: anything else a mod asks the system to open is refused at the call. */
const requireWebUrl = (value) => {
    let url;
    try {
        url = new URL(String(value));
    } catch {
        throw new Error('shell.openExternal requires an http(s) URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('shell.openExternal requires an http(s) URL');
    return url.href;
};

/**
 * context: { modId, manifest, sources (resolved: [{ sourceId, legacy }]), cacheDir, userDataDir, emitLog }
 * host:    see the top of this file; `mediaRules` (mediaRules.cjs), `mediaHandlers` (Map modId -> Map name ->
 *          handler, read by the folia-mod:// protocol), `cacheProviders` (Map modId -> provider),
 *          `isMainWindowPresent()`.
 * Returns { members, hooks, release }: `members` joins the api object; `hooks` are the handlers the mod
 * registered for the loader to call (beforeUnload, beforeQuit, playersOrphaned, mainWindow).
 */
const createSourceApi = (context, host) => {
    const { modId, manifest } = context;
    const hooks = { beforeUnload: new Set(), beforeQuit: new Set(), playersOrphaned: new Set(), mainWindow: new Set() };
    const releases = new Set();
    let released = false;

    // Keeps `release` for the unload, and gives the mod a function that releases it early.
    const keep = (release) => {
        if (released) {
            release();
            return () => {};
        }
        releases.add(release);
        return () => {
            if (releases.delete(release)) release();
        };
    };

    // What the old data grants allow: the union over the mod's sources (one row each).
    const grants = { storeKeys: new Set(), partitions: new Set(), userDataDirs: new Set(), native: new Set() };
    (context.sources ?? []).forEach(({ legacy }) => {
        if (!legacy) return;
        Object.keys(grants).forEach((field) => legacy[field].forEach((value) => grants[field].add(value)));
    });
    const ownSourceIds = new Set((context.sources ?? []).map(({ sourceId }) => sourceId));

    const requireStoreKey = (key) => {
        if (!grants.storeKeys.has(key)) throw new Error(`legacy-key-not-claimed:${String(key)}`);
    };

    /*
     * A session partition: one the source claims from before (its row or claims), or one of its own, kept apart from
     * every other mod's (`persist:folium.<mod id>.<name>`, ownPartitionOf).
     */
    const partitionOf = (name) => {
        if (grants.partitions.has(name)) return name;
        if (typeof name !== 'string' || !PARTITION_NAME_PATTERN.test(name)) {
            throw new Error('net.session requires a partition name matching /^[a-z0-9][a-z0-9-]{0,63}$/ or a claimed one');
        }
        const partition = ownPartitionOf(modId, name);
        // Remembered for the source's "clear data": Electron cannot list partitions.
        host.notePartition?.(modId, partition);
        return partition;
    };

    /*
     * Electron `net.request` (a ClientRequest), for what a web fetch cannot send: a GET with a body (a platform's desktop
     * API signs one). `session` and `partition` are the host's to set: a mod names the partition with `session`.
     */
    const clientRequest = (options, partition) => {
        if (!options || typeof options !== 'object' || typeof options.url !== 'string') {
            throw new TypeError('net.request requires { url, method?, … }');
        }
        const { session: _name, partition: _partition, ...rest } = options;
        return host.netRequest(partition === undefined ? rest : { ...rest, session: host.sessionFromPartition(partition) });
    };

    const sessionApi = (name) => {
        const partition = partitionOf(name);
        const session = () => host.sessionFromPartition(partition);
        return Object.freeze({
            partition,
            fetch: (url, init) => session().fetch(String(url), init),
            request: (options) => clientRequest(options, partition),
            resolveProxy: (url) => session().resolveProxy(String(url)),
            setProxy: (config) => session().setProxy(config),
            clearStorageData: (options) => session().clearStorageData(options),
        });
    };

    const nativePath = (name) => {
        if (!Array.isArray(manifest.native) || !manifest.native.includes(name) || !grants.native.has(name)) {
            throw new Error(`native-not-granted:${String(name)}`);
        }
        const resolved = host.nativePath(name);
        if (!resolved) throw new Error(`native-unavailable:${name}`);
        return resolved;
    };

    const members = {
        /*
         * The main-process store keys a built-in source (or an override or takeover of one) keeps its sign-in
         * under. Only the keys its row or claims name; every other key throws.
         */
        legacy: Object.freeze({
            store: Object.freeze({
                get: (key) => {
                    requireStoreKey(key);
                    return host.store.get(key);
                },
                set: (key, value) => {
                    requireStoreKey(key);
                    host.store.set(key, value);
                },
                has: (key) => {
                    requireStoreKey(key);
                    return host.store.has ? host.store.has(key) : host.store.get(key) !== undefined;
                },
                delete: (key) => {
                    requireStoreKey(key);
                    host.store.delete(key);
                },
            }),
        }),
        /* Electron safeStorage. `available()` is false on Linux's basic_text backend, as for the platforms. */
        seal: Object.freeze({
            available: () => {
                try {
                    assertEncryptionAvailable(host.safeStorage, host.platform);
                    return true;
                } catch {
                    return false;
                }
            },
            seal: (text) => {
                if (typeof text !== 'string') throw new TypeError('seal.seal requires a string');
                assertEncryptionAvailable(host.safeStorage, host.platform);
                return host.safeStorage.encryptString(text).toString('base64');
            },
            open: (sealed) => {
                if (typeof sealed !== 'string') throw new TypeError('seal.open requires a base64 string');
                assertEncryptionAvailable(host.safeStorage, host.platform);
                return host.safeStorage.decryptString(Buffer.from(sealed, 'base64'));
            },
        }),
        /*
         * The source's cache folder (mods-cache/<id>), counted in the host's cache budget: `requestPrune()`
         * asks the host to trim it when the source has just stored something big. `provideEntries` hands the
         * host the source's cache entries, so the host's cache view can list, remove and clear them.
         */
        cache: Object.freeze({
            dir: () => {
                host.ensureDir(context.cacheDir);
                return context.cacheDir;
            },
            requestPrune: (limitBytes) => host.requestCachePrune(limitBytes),
            provideEntries: (provider) => {
                if (!provider || typeof provider.list !== 'function') throw new TypeError('cache.provideEntries requires { list, remove?, clear? }');
                host.cacheProviders.set(modId, provider);
                return keep(() => {
                    if (host.cacheProviders.get(modId) === provider) host.cacheProviders.delete(modId);
                });
            },
        }),
        /*
         * Electron `net`: binary, streamed, no answer cap and no time limit of the host's. `init.session` names a
         * partition (see net.session); without it the default session. `fetch` answers a web Response; `request`
         * hands Electron's ClientRequest, for a request a web fetch cannot make (a GET with a body).
         */
        net: Object.freeze({
            fetch: (url, init = {}) => {
                const { session: name, ...rest } = init ?? {};
                return name === undefined ? host.netFetch(String(url), rest) : sessionApi(name).fetch(url, rest);
            },
            /* `net.request(options)`: Electron's ClientRequest; `options.session` names a partition as for fetch. */
            request: (options) => (options?.session === undefined ? clientRequest(options) : sessionApi(options.session).request(options)),
            session: sessionApi,
            resolveProxy: (url) => host.defaultSession().resolveProxy(String(url)),
        }),
        /*
         * Media: `allow(rule)` registers cross-origin headers for the source's media (mediaRules.cjs) and
         * returns the function that removes it; `serve(name, handler)` answers folia-mod://<mod id>/_media/<name>/…
         * (modProtocol.cjs, with Range); `url(name, rest)` builds such a URL.
         */
        media: Object.freeze({
            allow: (rule) => {
                const remove = host.mediaRules.allow(modId, rule);
                const off = keep(remove);
                // `off.add(url)` registers an address the source issued later (an audio URL), as the rule's own.
                off.add = remove.add;
                return off;
            },
            /* One Range header against a size: { start, end }, 'unsatisfiable', or null (modProtocol.cjs). */
            parseRange: (header, size) => parseRangeHeader(header, size),
            serve: (name, handler) => {
                if (typeof name !== 'string' || !MEDIA_NAME_PATTERN.test(name)) {
                    throw new Error('media.serve requires a name matching /^[a-z0-9][a-z0-9-]{0,63}$/');
                }
                requireFunction(handler, 'media.serve');
                const handlers = host.mediaHandlers.get(modId) ?? new Map();
                if (handlers.has(name)) throw new Error(`media.serve: "${name}" is already served`);
                handlers.set(name, handler);
                host.mediaHandlers.set(modId, handlers);
                return keep(() => {
                    if (handlers.get(name) === handler) handlers.delete(name);
                    if (handlers.size === 0 && host.mediaHandlers.get(modId) === handlers) host.mediaHandlers.delete(modId);
                });
            },
            url: (name, rest = '') => `folia-mod://${modId}/_media/${encodeURIComponent(String(name))}${rest ? `/${String(rest).replace(/^\/+/, '')}` : ''}`,
        }),
        /*
         * Windows. `hidden(options)` opens a hidden, sandboxed window without the app's preload (a source's
         * sign-in or signature sandbox); it is destroyed when the mod stops. `mainWindowPresent()` and
         * `onMainWindowChanged(listener)` say whether the main window is there (a source whose sandbox only works
         * while it is).
         */
        windows: Object.freeze({
            hidden: (options = {}) => {
                const { session: name, ...rest } = options ?? {};
                const window = host.createHiddenWindow({
                    ...rest,
                    partition: name === undefined ? undefined : partitionOf(name),
                });
                keep(() => {
                    try {
                        if (!window.isDestroyed()) window.destroy();
                    } catch {
                        // Already gone.
                    }
                });
                return window;
            },
            mainWindowPresent: () => host.isMainWindowPresent(),
            onMainWindowChanged: (listener) => {
                requireFunction(listener, 'windows.onMainWindowChanged');
                hooks.mainWindow.add(listener);
                return keep(() => hooks.mainWindow.delete(listener));
            },
        }),
        shell: Object.freeze({
            openExternal: (url) => host.openExternal(requireWebUrl(url)),
        }),
        dialog: Object.freeze({
            /* A file the user picks, or null. */
            pickFile: async (options = {}) => {
                const result = await host.showOpenDialog({
                    properties: ['openFile'],
                    ...(Array.isArray(options?.filters) ? { filters: options.filters } : {}),
                    ...(typeof options?.defaultPath === 'string' ? { defaultPath: options.defaultPath } : {}),
                });
                return result?.canceled ? null : result?.filePaths?.[0] ?? null;
            },
        }),
        /* Waited for (3 seconds at most) before the source is unloaded; playback of its songs has stopped by then. */
        onBeforeUnload: (handler) => {
            requireFunction(handler, 'onBeforeUnload');
            hooks.beforeUnload.add(handler);
            return keep(() => hooks.beforeUnload.delete(handler));
        },
        /* Waited for (3 seconds at most) when the app quits. */
        onBeforeQuit: (handler) => {
            requireFunction(handler, 'onBeforeQuit');
            hooks.beforeQuit.add(handler);
            return keep(() => hooks.beforeQuit.delete(handler));
        },
        /* The main window went and no window takes its playback over: pause what plays outside it. */
        onPlayersOrphaned: (handler) => {
            requireFunction(handler, 'onPlayersOrphaned');
            hooks.playersOrphaned.add(handler);
            return keep(() => hooks.playersOrphaned.delete(handler));
        },
        /*
         * The sign-in diagnostics and self-check of one of the mod's own sources (electron/loginBackendIpc.cjs):
         * `backend` has getStatus(), getDiagnostics() and selfCheckHosts, as the embedded backends do.
         */
        diagnostics: Object.freeze({
            register: (sourceId, backend) => {
                if (!ownSourceIds.has(sourceId)) throw new Error(`diagnostics.register: "${String(sourceId)}" is not a source of this mod`);
                if (!backend || typeof backend.getDiagnostics !== 'function') {
                    throw new TypeError('diagnostics.register requires a backend with getDiagnostics()');
                }
                if (!host.diagnostics) return () => {};
                return keep(host.diagnostics.register(sourceId, backend));
            },
        }),
        /* Native files the app ships for a built-in source, by the names its manifest and its table row both list. */
        native: Object.freeze({
            path: nativePath,
            load: (name) => require(nativePath(name)),
        }),
        /* An error the source could not handle: into the host's crash report, without telling the user. */
        reportError: (error, where) => host.reportError(`mod:${modId}${where ? ` ${String(where)}` : ''}`, error),
    };

    /* `api.paths.legacy(name)`: the userData folder the source's row or claims name. */
    const legacyPath = (name) => {
        if (!grants.userDataDirs.has(name)) throw new Error(`legacy-folder-not-claimed:${String(name)}`);
        return path.join(context.userDataDir, name);
    };

    const release = () => {
        released = true;
        Array.from(releases).forEach((run) => {
            try {
                run();
            } catch (error) {
                context.emitLog('warn', 'releasing a source registration failed', error);
            }
        });
        releases.clear();
        Object.values(hooks).forEach((set) => set.clear());
        host.mediaRules.removeMod(modId);
    };

    return { members, legacyPath, hooks, release };
};

module.exports = { createSourceApi, ownPartitionOf, PARTITION_NAME_PATTERN };
