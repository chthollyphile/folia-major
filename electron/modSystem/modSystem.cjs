// electron/modSystem/modSystem.cjs
// The Folium mod loader (Node side): discovers mods from the mods directories,
// validates manifests, resolves dependencies, activates each mod's `main` entry
// in a per-mod error boundary, and serves the renderer half (`client` entries,
// rpc, storage) over IPC and the folia-mod:// protocol. Designed to fail per-mod
// instead of crashing the host application.
//
// Trust model: a mod runs only after the user confirms it in a main-process
// dialog, and that confirmation is bound to the mod's content digest. Mods run
// with full Node privileges once enabled, so the confirmation is the security
// boundary — it lives here rather than in the renderer precisely because a
// loaded mod shares the renderer with the app UI and could otherwise drive its
// own approval.

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dialog, ipcMain, protocol, shell } = require('electron');
const Store = require('electron-store').default || require('electron-store');
const { unzipSync } = require('fflate');

const { FOLIUM_VERSION, validateManifest, resolveLoadPlan, satisfiesHostRange } = require('./manifest.cjs');
const { computeModDigest, shortDigest } = require('./modDigest.cjs');
const { createModApi, createModDataStore, STORAGE_PERMISSION } = require('./modApi.cjs');
const { resolveFfmpeg, MODS_RUNTIME_DIR } = require('./ffmpeg.cjs');
const { createExportService } = require('./exportService.cjs');
const { attachModProtocolHandler } = require('./modProtocol.cjs');

const SETTINGS_NAMESPACE = 'mods';
const EXPORT_PERMISSION = 'render.export';
const NET_FETCH_PERMISSION = 'net.fetch';

// folium.net.fetch limits: a mod fetches small JSON/text, not downloads.
const NET_FETCH_LIMITS = {
    defaultTimeoutMs: 15000,
    maxTimeoutMs: 60000,
    maxBodyBytes: 5 * 1024 * 1024,
    methods: new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']),
};

// folium.ui.pickFile dialog filters.
const PICK_FILE_FILTERS = {
    video: [{ name: 'Video', extensions: ['mp4', 'm4v', 'webm', 'mov', 'mkv'] }],
    audio: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'flac', 'ogg', 'wav'] }],
    image: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'] }],
    any: [],
};

// Staged installs and their rollback copies live under this directory inside
// the user mods folder; discovery skips it (and every other dot-directory).
const STAGING_DIRECTORY = '.staging';

/*
 * Install guards. A .zip is untrusted input: it is size-checked before it is
 * read, entry-checked against its declared uncompressed sizes before anything
 * is inflated, and checked again against the real inflated bytes. The caps
 * match modDigest's, so anything installable is also verifiable.
 */
const INSTALL_LIMITS = {
    maxArchiveBytes: 64 * 1024 * 1024,
    maxEntries: 2000,
    maxTotalBytes: 64 * 1024 * 1024,
    maxFileBytes: 32 * 1024 * 1024,
};

// Native confirmation dialog copy. The main process cannot reach the renderer's
// i18n bundle, so the three shipped locales are mirrored here like main.cjs's
// own dialog strings.
const TRUST_DIALOG_LOCALE = {
    'zh-CN': {
        title: '启用模组',
        message: (name, id) => `确定要启用模组“${name}”（${id}）吗？`,
        risk: '模组是第三方代码，未经官方安全审计。一旦启用，它将以应用的完整权限运行：可读写本地文件、访问网络、读取或修改任意应用设置（包括 AI 服务地址与密钥），并可在界面中执行代码。请仅启用你信任来源的模组。',
        permissions: '声明的权限：',
        noPermissions: '声明的权限：无',
        location: '安装位置：',
        fingerprint: '内容指纹：',
        client: '界面代码：',
        noClient: '界面代码：无',
        experimental: '选用的实验接口：',
        embedOrigins: '可嵌入的外部网页：',
        internals: '使用内部接口，仅兼容宿主版本：',
        rebind: '本次确认仅对当前文件内容生效；模组文件发生变化后需要重新确认。',
        enable: '仍要启用',
        cancel: '取消',
    },
    en: {
        title: 'Enable mod',
        message: (name, id) => `Enable the mod "${name}" (${id})?`,
        risk: 'Mods are third-party code and are not security-audited. Once enabled, a mod runs with the full privileges of the app: it can read and write local files, access the network, read or change any app setting (including the AI service URL and key), and run code inside the UI. Only enable mods from sources you trust.',
        permissions: 'Declared permissions: ',
        noPermissions: 'Declared permissions: none',
        location: 'Installed at: ',
        fingerprint: 'Content fingerprint: ',
        client: 'UI code: ',
        noClient: 'UI code: none',
        experimental: 'Experimental APIs opted into: ',
        embedOrigins: 'External pages it may embed: ',
        internals: 'Uses internal APIs; only compatible with host versions: ',
        rebind: 'This confirmation applies to the current files only; the mod must be confirmed again after its code changes.',
        enable: 'Enable anyway',
        cancel: 'Cancel',
    },
    in: {
        title: 'Aktifkan mod',
        message: (name, id) => `Aktifkan mod "${name}" (${id})?`,
        risk: 'Mod adalah kode pihak ketiga dan tidak diaudit keamanannya. Setelah diaktifkan, mod berjalan dengan hak penuh aplikasi: dapat membaca dan menulis berkas lokal, mengakses jaringan, membaca atau mengubah pengaturan apa pun (termasuk URL dan kunci layanan AI), serta menjalankan kode di dalam antarmuka. Aktifkan hanya mod dari sumber yang Anda percayai.',
        permissions: 'Izin yang dideklarasikan: ',
        noPermissions: 'Izin yang dideklarasikan: tidak ada',
        location: 'Terpasang di: ',
        fingerprint: 'Sidik konten: ',
        client: 'Kode antarmuka: ',
        noClient: 'Kode antarmuka: tidak ada',
        experimental: 'API eksperimental yang dipakai: ',
        embedOrigins: 'Halaman eksternal yang dapat disematkan: ',
        internals: 'Memakai API internal; hanya kompatibel dengan versi host: ',
        rebind: 'Konfirmasi ini hanya berlaku untuk berkas saat ini; mod harus dikonfirmasi ulang setelah kodenya berubah.',
        enable: 'Tetap aktifkan',
        cancel: 'Batal',
    },
};

const IPC = {
    list: 'folia-mods:list',
    setEnabled: 'folia-mods:set-enabled',
    reload: 'folia-mods:reload',
    rpc: 'folia-mods:rpc',
    storage: 'folia-mods:storage',
    netFetch: 'folia-mods:net-fetch',
    pickFile: 'folia-mods:pick-file',
    pushRuntimeSnapshot: 'folia-mods:push-runtime-snapshot',
    exportCancel: 'folia-mods:export-cancel',
    ffmpegStatus: 'folia-mods:ffmpeg-status',
    openDirectory: 'folia-mods:open-directory',
    installZip: 'folia-mods:install-zip',
    fStateChanged: 'folia-mods:state-changed',
    fExportProgress: 'folia-mods:export-progress',
    fLog: 'folia-mods:log',
};

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

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

const serializeError = (error) => {
    if (!error) {
        return 'unknown error';
    }
    return error && error.message ? error.message : String(error);
};

const createModSystem = ({ app, BrowserWindow, getMainWindow, getLocaleKey, isFeatureEnabled }) => {
    let store = null;
    try {
        store = new Store({ name: 'mod-system' });
    } catch {
        // electron-store may fail in odd environments; degrade to a no-op store
        // so the loader itself can still run in-memory.
        const memory = new Map();
        store = {
            get: (key) => memory.get(key),
            set: (key, value) => { memory.set(key, value); },
        };
    }

    const enabledKey = (modId) => `${SETTINGS_NAMESPACE}.enabled.${modId}`;

    const mods = new Map();       // modId -> runtime entry
    let runtimeSnapshot = null;   // last snapshot pushed by the renderer
    let ffmpegStatus = { available: false, path: null, version: null, candidates: [] };
    let ffmpegProbePromise = null;

    const getMainWindowSafe = () => {
        try {
            return typeof getMainWindow === 'function' ? getMainWindow() : null;
        } catch {
            return null;
        }
    };

    /*
     * The experimental master switch (Lab settings). Fail closed: anything the
     * caller cannot answer counts as off, and off means no mod is discovered,
     * activated, or reachable through the mutating IPC handlers — hiding the UI
     * alone would leave previously confirmed mods running with full privileges.
     */
    const isModSystemEnabled = () => {
        try {
            return typeof isFeatureEnabled === 'function' ? Boolean(isFeatureEnabled()) : false;
        } catch {
            return false;
        }
    };

    const resolveDialogLocale = () => {
        try {
            const key = typeof getLocaleKey === 'function' ? getLocaleKey() : null;
            return TRUST_DIALOG_LOCALE[key] ?? TRUST_DIALOG_LOCALE.en;
        } catch {
            return TRUST_DIALOG_LOCALE.en;
        }
    };

    const sendToRenderer = (channel, payload) => {
        const win = getMainWindowSafe();
        if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
            win.webContents.send(channel, payload);
        }
    };

    const emitLog = (modId, level, message, details) => {
        const [method, fallback] = level === 'warn' ? ['warn', console.warn] : level === 'error' ? ['error', console.error] : ['log', console.log];
        (typeof console[method] === 'function' ? console[method] : fallback)(`[Mod:${modId}] ${message}`, details ?? '');
        sendToRenderer(IPC.fLog, { modId, level, message: String(message), details: details ? serializeError(details) : undefined });
    };

    const hostInfo = () => ({
        folium: { major: FOLIUM_VERSION.major, minor: FOLIUM_VERSION.minor },
        folia: typeof app.getVersion === 'function' ? app.getVersion() : null,
    });

    /*
     * The Folium DTO half of the last snapshot the renderer pushed. The other
     * half (`internal`) is host-private and only feeds the export service.
     * The renderer pushes on changes, not every frame, so while playing the
     * position is extrapolated from the push time (capped at the duration).
     */
    const getPublicSnapshot = () => {
        if (!runtimeSnapshot?.public) {
            return null;
        }
        const snapshot = cloneJson(runtimeSnapshot.public);
        const capturedAt = Number(runtimeSnapshot.capturedAt);
        if (snapshot.state === 'playing' && Number.isFinite(capturedAt)) {
            const advanced = snapshot.position + Math.max(0, Date.now() - capturedAt) / 1000;
            snapshot.position = snapshot.duration > 0 ? Math.min(snapshot.duration, advanced) : advanced;
        }
        return snapshot;
    };

    const buildModRuntime = (manifest, entries) => {
        const dataDir = path.join(app.getPath('userData'), 'mods-data', manifest.id);
        const dataStore = createModDataStore(dataDir);
        const rpcHandlers = new Map();
        const disposers = [];

        const context = {
            modId: manifest.id,
            manifest,
            dataStore,
            hostInfo: hostInfo(),
            emitLog: (level, message, details) => emitLog(manifest.id, level, message, details),
            getPlaybackSnapshot: getPublicSnapshot,
            registerDisposer: (disposer) => {
                if (typeof disposer !== 'function') {
                    throw new Error('lifecycle.onDeactivate requires a function');
                }
                disposers.push(disposer);
            },
            registerRpc: (name, handler) => {
                if (rpcHandlers.has(name)) {
                    throw new Error(`duplicate rpc handler "${name}"`);
                }
                rpcHandlers.set(name, handler);
            },
            requestExport: (spec) => {
                if (!manifest.permissions.includes(EXPORT_PERMISSION)) {
                    return Promise.reject(new Error(`permission-denied:${EXPORT_PERMISSION}`));
                }
                return exportService.runExport({
                    modId: manifest.id,
                    spec,
                    hostState: runtimeSnapshot?.internal ?? null,
                    onProgress: (progress) => {
                        sendToRenderer(IPC.fExportProgress, { modId: manifest.id, ...progress });
                    },
                });
            },
        };

        const modApi = createModApi(context);

        // A client-only mod has no Node entry: loading it runs nothing here.
        const load = () => {
            if (!manifest.main) {
                return;
            }
            const entryPath = path.join(entries.dirPath, manifest.main);
            // Drop the whole mod subtree from the cache so a reload re-executes
            // the mod against its current files instead of returning stale state.
            purgeModuleCache(entries.dirPath);
            const moduleFactory = require(entryPath);
            if (typeof moduleFactory !== 'function') {
                throw new Error(`mod main must export a function, got ${typeof moduleFactory}`);
            }
            // activate() may return a disposer (or an object carrying one),
            // which joins anything registered through lifecycle.onDeactivate.
            const activation = moduleFactory(modApi);
            if (typeof activation === 'function') {
                disposers.push(activation);
            } else if (activation && typeof activation.dispose === 'function') {
                disposers.push(() => activation.dispose());
            }
        };

        /*
         * Runs the mod's cleanup before it stops being active. Disposers run
         * last-registered first, and one throwing never blocks the rest.
         */
        const unload = () => {
            while (disposers.length > 0) {
                const disposer = disposers.pop();
                try {
                    disposer();
                } catch (error) {
                    emitLog(manifest.id, 'error', 'deactivate handler failed', error);
                }
            }
            rpcHandlers.clear();
        };

        return { load, unload, dataStore, getRpcHandler: (name) => rpcHandlers.get(name) ?? null };
    };

    /*
     * Persisted trust record: `{ enabled, digest }`. Anything else in the store
     * (nothing yet, or a bare boolean written by an earlier build) counts as an
     * approval that is not bound to any content and is therefore not honoured.
     */
    const readTrust = (modId) => {
        try {
            const stored = store.get(enabledKey(modId));
            if (stored && typeof stored === 'object') {
                return {
                    enabled: Boolean(stored.enabled),
                    digest: typeof stored.digest === 'string' ? stored.digest : null,
                };
            }
            return stored ? { enabled: true, digest: null } : null;
        } catch {
            return null;
        }
    };

    const writeTrust = (modId, enabled, digest) => {
        try {
            store.set(enabledKey(modId), {
                enabled: Boolean(enabled),
                digest: enabled ? digest : null,
                confirmedAt: enabled ? new Date().toISOString() : null,
            });
        } catch {
            // Persistence is best-effort; in-memory state still applies.
        }
    };

    /*
     * Decides whether a discovered mod may run. Trust is granted to bytes, not
     * to a mod id: when the digest moved (an upgrade dropped in over the old
     * copy, an edited file, or a legacy record with no digest at all) the
     * approval is revoked on the spot and the mod stays off until the user
     * confirms the new code.
     */
    const resolveTrust = (modId, digest) => {
        const stored = readTrust(modId);
        if (!stored || !stored.enabled) {
            return { enabled: false, trustStale: false };
        }
        if (!digest || stored.digest !== digest) {
            writeTrust(modId, false, null);
            return { enabled: false, trustStale: true };
        }
        return { enabled: true, trustStale: false };
    };

    // folia-mod:// URL for a mod's client entry. The digest is carried as a
    // version query so the renderer's ES module map treats a changed mod as a
    // different module instead of replaying the code it already imported.
    const clientUrl = (runtime) => (
        runtime.manifest.client
            ? `folia-mod://${runtime.manifest.id}/${runtime.manifest.client}?v=${shortDigest(runtime.digest)}`
            : null
    );

    const publicModState = (runtime) => {
        const entry = mods.get(runtime.manifest.id);
        if (!entry) {
            return null;
        }
        return {
            id: entry.manifest.id,
            name: entry.manifest.name,
            version: entry.manifest.version,
            author: entry.manifest.author,
            description: entry.manifest.description,
            permissions: entry.manifest.permissions,
            experimental: entry.manifest.experimental ?? [],
            embedOrigins: entry.manifest.embedOrigins ?? [],
            folia: entry.manifest.folia ?? null,
            hasMain: Boolean(entry.manifest.main),
            // Client entries are only exposed for mods that are enabled and
            // loaded; the protocol handler enforces the same rule per request.
            clientUrl: entry.status === 'loaded' ? clientUrl(entry) : null,
            status: entry.status,
            error: entry.error,
            enabled: entry.enabled,
            trustStale: Boolean(entry.trustStale),
        };
    };

    /*
     * Client entries of every loaded mod, for the export window: it runs without
     * a preload, so it is handed these descriptors inside its render config and
     * activates the clients in its own ('export') context.
     */
    const listClientDescriptors = () => listMods().filter((mod) => mod.clientUrl);

    const getModsDirectories = () => {
        const directories = [];
        const repoMods = path.join(app.getAppPath(), 'mods');
        // In production the packaged app is read-only; user-installed mods live
        // under userData and packaged mods under resources.
        const isPackaged = app.isPackaged;
        if (!isPackaged) {
            directories.push(repoMods);
        }
        directories.push(path.join(app.getPath('userData'), 'mods'));
        if (process.resourcesPath) {
            directories.push(path.join(process.resourcesPath, 'mods'));
        }
        return directories;
    };

    const readManifestFiles = () => {
        const discovered = new Map();
        const seenIds = new Set();
        getModsDirectories().forEach((dirPath) => {
            let dirEntries = [];
            try {
                dirEntries = fs.readdirSync(dirPath, { withFileTypes: true });
            } catch {
                return; // Directory missing — nothing to discover here.
            }
            // Dot-directories are the loader's own bookkeeping (staged installs
            // and rollback copies), never mods.
            dirEntries.filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).forEach((entry) => {
                const modDirectory = path.join(dirPath, entry.name);
                const manifestPath = path.join(modDirectory, 'mod.json');
                let raw = null;
                try {
                    raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                } catch (error) {
                    const existing = discovered.get(entry.name) ?? { dirPath: modDirectory, manifest: null, validationErrors: null };
                    if (!existing.validationErrors) {
                        existing.validationErrors = [`cannot read mod.json: ${serializeError(error)}`];
                        discovered.set(entry.name, existing);
                    }
                    return;
                }
                const validation = validateManifest(raw);
                if (!validation.ok) {
                    discovered.set(entry.name, { dirPath: modDirectory, manifest: null, validationErrors: validation.errors });
                    return;
                }
                const manifest = validation.value;
                if (seenIds.has(manifest.id)) {
                    discovered.set(`${entry.name}-duplicate-${manifest.id}`, {
                        dirPath: modDirectory,
                        manifest,
                        validationErrors: [`duplicate mod id "${manifest.id}"`],
                    });
                    return;
                }
                seenIds.add(manifest.id);
                discovered.set(manifest.id, { dirPath: modDirectory, manifest, validationErrors: null });
            });
        });
        return discovered;
    };

    // Placeholder manifest for a discovery that never produced a usable one, so
    // broken mods still show up in the panel with their validation errors.
    const brokenManifest = (id, discovery) => ({
        id,
        name: discovery.manifest?.name ?? id,
        version: discovery.manifest?.version ?? null,
        author: discovery.manifest?.author ?? null,
        description: discovery.manifest?.description ?? null,
        permissions: [],
        experimental: [],
        embedOrigins: [],
        folia: null,
        main: null,
        client: null,
    });

    /*
     * Deactivates every mod currently active. Every loadAll re-executes each
     * enabled mod's entry, so the previous activation has to be torn down first
     * or each reload would leave another generation of the mod's timers and
     * listeners behind.
     */
    const unloadAll = () => {
        mods.forEach((runtime) => {
            if (runtime.status === 'loaded' && typeof runtime.unload === 'function') {
                runtime.unload();
            }
        });
    };

    /*
     * Full load cycle: deactivate what is running, then discover, validate,
     * digest, resolve the dependency graph for the *enabled* mods only, and
     * activate each entry in order inside per-mod error boundaries. Returns the
     * renderer-facing state list. Re-entrant: reloads replace previous state.
     */
    const loadAll = () => {
        unloadAll();
        if (!isModSystemEnabled()) {
            mods.clear();
            notifyStateChanged();
            return listMods();
        }
        const discovered = readManifestFiles();
        const manifestsById = new Map();
        const prepared = new Map();
        const broken = [];

        discovered.forEach((discovery, key) => {
            // A duplicate id carries a manifest *and* validation errors; both
            // copies stay visible under the discovery key so neither silently
            // replaces the other.
            if (!discovery.manifest || discovery.validationErrors) {
                broken.push({ key, discovery });
                return;
            }
            const modId = discovery.manifest.id;
            const digest = computeModDigest(discovery.dirPath);
            const trust = resolveTrust(modId, digest);
            manifestsById.set(modId, discovery.manifest);
            prepared.set(modId, {
                manifest: discovery.manifest,
                dirPath: discovery.dirPath,
                digest,
                enabled: trust.enabled,
                trustStale: trust.trustStale,
            });
        });

        // Only enabled mods are roots of the resolution, and a broken subgraph
        // fails only the mods inside it. A mod nobody enabled — including one
        // dropped in specifically to declare a missing dependency or a cycle —
        // can no longer take the whole loader down with it.
        const enabledIds = [];
        prepared.forEach((entry, modId) => {
            if (entry.enabled) {
                enabledIds.push(modId);
            }
        });
        const plan = resolveLoadPlan(manifestsById, {
            roots: enabledIds,
            source: 'mods',
            isEnabled: (modId) => Boolean(prepared.get(modId)?.enabled),
        });

        const buildEntry = (entry, status, error) => ({
            manifest: entry.manifest,
            dirPath: entry.dirPath,
            digest: entry.digest,
            status,
            error,
            enabled: entry.enabled,
            trustStale: entry.trustStale,
            ...buildModRuntime(entry.manifest, entry),
        });

        const nextMods = new Map();
        const hostVersion = typeof app.getVersion === 'function' ? app.getVersion() : null;
        plan.order.forEach((modId) => {
            const runtime = buildEntry(prepared.get(modId), 'disabled', null);
            // A mod pinned to host versions (it uses folium.internals) never runs
            // on a host outside that range: internals carry no compatibility promise.
            const range = runtime.manifest.folia;
            if (range && !satisfiesHostRange(hostVersion, range)) {
                runtime.status = 'error';
                runtime.error = 'host-version-mismatch';
                nextMods.set(modId, runtime);
                return;
            }
            try {
                runtime.load();
                runtime.status = 'loaded';
            } catch (error) {
                runtime.status = 'error';
                runtime.error = serializeError(error);
            }
            nextMods.set(modId, runtime);
        });

        prepared.forEach((entry, modId) => {
            if (nextMods.has(modId)) {
                return;
            }
            const failure = plan.failures.get(modId);
            if (failure) {
                nextMods.set(modId, buildEntry(entry, 'dependency-failed', failure.join('; ')));
                return;
            }
            // No digest means the tree could not be hashed, so it can never be
            // trusted; say so instead of showing an innocuous "disabled".
            nextMods.set(modId, entry.digest
                ? buildEntry(entry, 'disabled', null)
                : buildEntry(entry, 'error', 'mod-content-unverifiable'));
        });

        broken.forEach(({ key, discovery }) => {
            nextMods.set(key, {
                manifest: brokenManifest(key, discovery),
                dirPath: discovery.dirPath,
                digest: null,
                status: 'error',
                error: (discovery.validationErrors ?? ['invalid manifest']).join('; '),
                enabled: false,
                trustStale: false,
                getRpcHandler: () => null,
            });
        });

        mods.clear();
        nextMods.forEach((runtime, modId) => mods.set(modId, runtime));
        notifyStateChanged();
        return listMods();
    };

    /*
     * The enable confirmation. Native and main-process owned on purpose: a
     * loaded mod's client code shares the renderer with the app UI, so a dialog
     * drawn there could be spoofed or dismissed by mod code. This one cannot,
     * and it is the only path that writes an "enabled" trust record.
     */
    const confirmEnableMod = async (runtime, digest) => {
        const locale = resolveDialogLocale();
        const permissions = Array.isArray(runtime.manifest.permissions) ? runtime.manifest.permissions : [];
        const { client, experimental = [], embedOrigins = [], folia } = runtime.manifest;
        const detail = [
            locale.risk,
            '',
            permissions.length > 0 ? `${locale.permissions}${permissions.join(', ')}` : locale.noPermissions,
            client ? `${locale.client}${client}` : locale.noClient,
            ...(experimental.length > 0 ? [`${locale.experimental}${experimental.join(', ')}`] : []),
            ...(embedOrigins.length > 0 ? [`${locale.embedOrigins}${embedOrigins.join(', ')}`] : []),
            ...(folia ? [`${locale.internals}${folia}`] : []),
            `${locale.location}${runtime.dirPath ?? '-'}`,
            `${locale.fingerprint}${shortDigest(digest)}`,
            '',
            locale.rebind,
        ].join('\n');
        const options = {
            type: 'warning',
            title: locale.title,
            message: locale.message(runtime.manifest.name, runtime.manifest.id),
            detail,
            buttons: [locale.cancel, locale.enable],
            // Cancel is the default so an accidental Enter never enables a mod.
            defaultId: 0,
            cancelId: 0,
            noLink: true,
        };
        const win = getMainWindowSafe();
        const result = win && !win.isDestroyed()
            ? await dialog.showMessageBox(win, options)
            : await dialog.showMessageBox(options);
        return result.response === 1;
    };

    const setModEnabled = async (modId, enabled) => {
        if (!isModSystemEnabled()) {
            return { ok: false, error: 'mod-system-disabled', mods: [] };
        }
        let runtime = mods.get(modId);
        if (!runtime) {
            loadAll();
            runtime = mods.get(modId);
        }
        if (!runtime) {
            return { ok: false, error: 'mod-not-found', mods: listMods() };
        }
        if (!enabled) {
            writeTrust(modId, false, null);
            return { ok: true, mods: loadAll() };
        }
        // Re-hash right before asking: the confirmation must describe, and bind
        // to, exactly the bytes on disk at this moment.
        const digest = computeModDigest(runtime.dirPath);
        if (!digest) {
            return { ok: false, error: 'mod-content-unverifiable', mods: listMods() };
        }
        const confirmed = await confirmEnableMod(runtime, digest);
        if (!confirmed) {
            return { ok: false, error: 'enable-declined', mods: listMods() };
        }
        writeTrust(modId, true, digest);
        return { ok: true, mods: loadAll() };
    };

    const requireLoadedMod = (modId) => {
        const runtime = mods.get(modId);
        if (!runtime) {
            throw new Error('mod-not-found');
        }
        if (runtime.status !== 'loaded') {
            throw new Error('mod-not-loaded');
        }
        return runtime;
    };

    // client → main call routed to the handler the mod registered with api.rpc.handle.
    const invokeModRpc = async (modId, name, args) => {
        const runtime = requireLoadedMod(modId);
        const handler = runtime.getRpcHandler(name);
        if (!handler) {
            return { ok: false, error: `rpc-not-found:${name}` };
        }
        try {
            const result = await handler(...(Array.isArray(args) ? args : []));
            return { ok: true, result: result === undefined ? null : cloneJson(result) };
        } catch (error) {
            emitLog(modId, 'error', `rpc ${name} failed`, error);
            return { ok: false, error: serializeError(error) };
        }
    };

    /*
     * folium.net.fetch: the request runs here, in Node, so it is not subject to
     * the renderer's CORS rules — which is why it sits behind `net.fetch`.
     * http(s) only, bounded time and body size, text bodies only.
     */
    const invokeModNetFetch = async (modId, url, init) => {
        const runtime = requireLoadedMod(modId);
        if (!runtime.manifest.permissions.includes(NET_FETCH_PERMISSION)) {
            return { ok: false, error: `permission-denied:${NET_FETCH_PERMISSION}` };
        }
        let target;
        try {
            target = new URL(String(url));
        } catch {
            return { ok: false, error: 'net-invalid-url' };
        }
        if (target.protocol !== 'http:' && target.protocol !== 'https:') {
            return { ok: false, error: 'net-unsupported-protocol' };
        }
        const options = init && typeof init === 'object' ? init : {};
        const method = String(options.method ?? 'GET').toUpperCase();
        if (!NET_FETCH_LIMITS.methods.has(method)) {
            return { ok: false, error: `net-unsupported-method:${method}` };
        }
        const timeoutMs = Math.min(
            NET_FETCH_LIMITS.maxTimeoutMs,
            Math.max(1000, Number(options.timeoutMs) || NET_FETCH_LIMITS.defaultTimeoutMs),
        );
        const headers = {};
        if (options.headers && typeof options.headers === 'object') {
            Object.entries(options.headers).forEach(([key, value]) => {
                if (typeof value === 'string') headers[key] = value;
            });
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(target, {
                method,
                headers,
                body: method === 'GET' || method === 'HEAD' || typeof options.body !== 'string' ? undefined : options.body,
                signal: controller.signal,
                redirect: 'follow',
            });
            const declaredLength = Number(response.headers.get('content-length'));
            if (Number.isFinite(declaredLength) && declaredLength > NET_FETCH_LIMITS.maxBodyBytes) {
                controller.abort();
                return { ok: false, error: 'net-body-too-large' };
            }
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.byteLength > NET_FETCH_LIMITS.maxBodyBytes) {
                return { ok: false, error: 'net-body-too-large' };
            }
            const responseHeaders = {};
            response.headers.forEach((value, key) => { responseHeaders[key] = value; });
            return {
                ok: true,
                result: {
                    status: response.status,
                    statusText: response.statusText,
                    headers: responseHeaders,
                    body: buffer.toString('utf8'),
                },
            };
        } catch (error) {
            return { ok: false, error: controller.signal.aborted ? 'net-timeout' : serializeError(error) };
        } finally {
            clearTimeout(timer);
        }
    };

    /*
     * folium.ui.pickFile: the user chooses the file in a native dialog, so no
     * permission is involved; the mod only ever gets an unguessable
     * folia-mod://_files/<token>/<name> URL, valid until the app quits.
     */
    const pickedFiles = new Map();
    const invokeModPickFile = async (modId, accept) => {
        requireLoadedMod(modId);
        const win = getMainWindowSafe();
        const options = {
            properties: ['openFile'],
            filters: PICK_FILE_FILTERS[accept] ?? PICK_FILE_FILTERS.any,
        };
        const result = win && !win.isDestroyed()
            ? await dialog.showOpenDialog(win, options)
            : await dialog.showOpenDialog(options);
        const filePath = result.canceled ? null : result.filePaths[0];
        if (!filePath) {
            return { ok: true, result: null };
        }
        const stat = fs.statSync(filePath);
        const token = crypto.randomBytes(18).toString('hex');
        pickedFiles.set(token, filePath);
        const name = path.basename(filePath);
        return {
            ok: true,
            result: {
                url: `folia-mod://_files/${token}/${encodeURIComponent(name)}`,
                name,
                size: stat.size,
            },
        };
    };

    const STORAGE_OPERATIONS = new Set(['get', 'set', 'has', 'delete', 'keys']);

    // folium.storage from the client: same data file and permission as api.storage.data.
    const invokeModStorage = async (modId, operation, key, value) => {
        const runtime = requireLoadedMod(modId);
        if (!runtime.manifest.permissions.includes(STORAGE_PERMISSION)) {
            return { ok: false, error: `permission-denied:${STORAGE_PERMISSION}` };
        }
        if (!STORAGE_OPERATIONS.has(operation)) {
            return { ok: false, error: `storage-unknown-operation:${operation}` };
        }
        const result = await runtime.dataStore[operation](key, value);
        return { ok: true, result: result === undefined ? null : result };
    };

    const listMods = () => Array.from(mods.values())
        .map((runtime) => publicModState(runtime))
        .filter(Boolean)
        .sort((left, right) => left.id.localeCompare(right.id));

    // The per-user writable mod directory (the packaged app's own tree is read-only).
    const getUserModsDirectory = () => path.join(app.getPath('userData'), 'mods');

    /*
     * Clears leftovers from an install that was interrupted (a crash or a kill
     * between extraction and the swap). Called once at startup, when no install
     * can be in flight, so it never races a live staging directory.
     */
    const pruneStagingDirectory = () => {
        try {
            fs.rmSync(path.join(getUserModsDirectory(), STAGING_DIRECTORY), { recursive: true, force: true });
        } catch {
            // Leftovers are inert (discovery skips dot-directories); ignore.
        }
    };

    const openModsDirectory = async () => {
        try {
            const target = getUserModsDirectory();
            fs.mkdirSync(target, { recursive: true });
            const error = await shell.openPath(target);
            if (error) {
                return { ok: false, error: `open-directory-failed:${error}` };
            }
            return { ok: true, directory: target };
        } catch (error) {
            return { ok: false, error: serializeError(error) };
        }
    };

    /*
     * Reads a .zip into memory under the install limits. The archive size is
     * checked before the file is read, and each entry is checked against its
     * declared uncompressed size (and the running total) inside fflate's filter
     * — before that entry is inflated — so a zip bomb is refused rather than
     * expanded. The inflated bytes are then re-checked, because the declared
     * sizes come from the archive itself and are not trustworthy.
     */
    const readZipEntries = (zipPath) => {
        let archiveBytes = null;
        try {
            const stat = fs.statSync(zipPath);
            if (stat.size > INSTALL_LIMITS.maxArchiveBytes) {
                return { ok: false, error: 'install-too-large' };
            }
            archiveBytes = fs.readFileSync(zipPath);
        } catch {
            return { ok: false, error: 'install-corrupt-zip' };
        }

        let limitError = null;
        let declaredTotal = 0;
        let entryCount = 0;
        let archive;
        try {
            archive = unzipSync(archiveBytes, {
                filter: (file) => {
                    if (limitError) {
                        return false;
                    }
                    entryCount += 1;
                    if (entryCount > INSTALL_LIMITS.maxEntries) {
                        limitError = 'install-too-many-files';
                        return false;
                    }
                    if (file.originalSize > INSTALL_LIMITS.maxFileBytes) {
                        limitError = 'install-too-large';
                        return false;
                    }
                    declaredTotal += file.originalSize;
                    if (declaredTotal > INSTALL_LIMITS.maxTotalBytes) {
                        limitError = 'install-too-large';
                        return false;
                    }
                    return true;
                },
            });
        } catch {
            return { ok: false, error: limitError ?? 'install-corrupt-zip' };
        }
        if (limitError) {
            return { ok: false, error: limitError };
        }

        // Normalize + sanitize entry paths (reject traversal and absolute paths).
        const entries = [];
        let inflatedTotal = 0;
        for (const [rawPath, bytes] of Object.entries(archive)) {
            if (rawPath.endsWith('/')) continue; // directory marker
            const segments = rawPath.split('/').filter((segment) => segment !== '' && segment !== '.');
            if (segments.some((segment) => segment === '..' || segment.includes('\\'))) {
                return { ok: false, error: 'install-unsafe-path' };
            }
            if (path.isAbsolute(segments.join(path.sep))) {
                return { ok: false, error: 'install-unsafe-path' };
            }
            inflatedTotal += bytes.length;
            if (bytes.length > INSTALL_LIMITS.maxFileBytes || inflatedTotal > INSTALL_LIMITS.maxTotalBytes) {
                return { ok: false, error: 'install-too-large' };
            }
            entries.push({ segments, bytes });
        }
        if (entries.length === 0) {
            return { ok: false, error: 'install-empty-zip' };
        }
        return { ok: true, entries };
    };

    /*
     * Locates the manifest root: mod.json at the archive root, or under exactly
     * one top-level folder. Returns the depth to strip from every entry path.
     */
    const resolveArchiveRoot = (entries) => {
        const manifestEntries = entries.filter((entry) => entry.segments[entry.segments.length - 1] === 'mod.json');
        let rootDepth = 0;
        if (!manifestEntries.some((entry) => entry.segments.length === 1)) {
            const roots = new Set(manifestEntries.map((entry) => entry.segments[0]));
            if (roots.size !== 1) {
                return { ok: false, error: 'install-no-manifest' };
            }
            rootDepth = 1;
        }
        const manifestEntry = manifestEntries.find((entry) => entry.segments.length === rootDepth + 1);
        if (!manifestEntry) {
            return { ok: false, error: 'install-no-manifest' };
        }
        return { ok: true, rootDepth, manifestEntry };
    };

    /*
     * Installs a mod from a .zip into the per-user mod directory. The zip may
     * carry mod.json at its root or under exactly one top-level folder. The
     * install is staged: everything is written to a temporary directory next to
     * the target and verified there (manifest, declared main/client entry
     * files), and only then swapped into place — an existing install is kept
     * until the replacement is known-good, and restored if the swap fails.
     * Zip-slip is blocked and the archive is size-capped before extraction.
     *
     * A replaced mod's stored approval no longer matches the new content
     * digest, so an upgrade always lands disabled and must be confirmed again.
     */
    const installModFromZip = async (zipPath) => {
        if (!isModSystemEnabled()) {
            return { ok: false, error: 'mod-system-disabled' };
        }
        if (typeof zipPath !== 'string' || !zipPath.toLowerCase().endsWith('.zip')) {
            return { ok: false, error: 'install-not-zip' };
        }

        const read = readZipEntries(zipPath);
        if (!read.ok) {
            return { ok: false, error: read.error };
        }
        const { entries } = read;

        const root = resolveArchiveRoot(entries);
        if (!root.ok) {
            return { ok: false, error: root.error };
        }
        const { rootDepth, manifestEntry } = root;

        let manifest;
        try {
            manifest = JSON.parse(new TextDecoder().decode(manifestEntry.bytes));
        } catch {
            return { ok: false, error: 'install-invalid-manifest' };
        }
        const validation = validateManifest(manifest);
        if (!validation.ok) {
            return { ok: false, error: `install-invalid-manifest:${validation.errors.join('; ')}` };
        }

        const modId = validation.value.id;
        const target = path.join(getUserModsDirectory(), modId);
        const stagingRoot = path.join(getUserModsDirectory(), STAGING_DIRECTORY);
        const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`;
        const stagingDir = path.join(stagingRoot, `${modId}-${suffix}`);
        const backupDir = path.join(stagingRoot, `${modId}-backup-${suffix}`);
        let backupTaken = false;

        const removeQuietly = (directory) => {
            try {
                fs.rmSync(directory, { recursive: true, force: true });
            } catch {
                // Clean-up is best-effort.
            }
        };

        try {
            fs.mkdirSync(stagingDir, { recursive: true });
            for (const entry of entries) {
                // Directory markers were already filtered out, so every entry here
                // is a real file that must be written. `relative` is only empty for
                // a stray wrapper directory path, which has no file content to write.
                const relative = entry.segments.slice(rootDepth).join(path.sep);
                if (!relative) {
                    continue;
                }
                const destination = path.resolve(stagingDir, relative);
                if (destination !== stagingDir && !destination.startsWith(stagingDir + path.sep)) {
                    throw new Error('install-unsafe-path');
                }
                fs.mkdirSync(path.dirname(destination), { recursive: true });
                fs.writeFileSync(destination, Buffer.from(entry.bytes));
            }

            // Verify the staged tree before anything replaces a working install.
            if (validation.value.main && !fs.existsSync(path.join(stagingDir, validation.value.main))) {
                throw new Error('install-main-missing');
            }
            if (validation.value.client && !fs.existsSync(path.join(stagingDir, validation.value.client))) {
                throw new Error('install-client-missing');
            }

            // Atomic-ish swap: move the old copy aside, move the new one in, and
            // put the old one back if the second rename fails.
            if (fs.existsSync(target)) {
                fs.renameSync(target, backupDir);
                backupTaken = true;
            }
            try {
                fs.renameSync(stagingDir, target);
            } catch (error) {
                if (backupTaken) {
                    fs.renameSync(backupDir, target);
                    backupTaken = false;
                }
                throw error;
            }
            removeQuietly(backupDir);
            backupTaken = false;

            const modsAfterInstall = loadAll();
            emitLog(modId, 'info', `installed mod ${modId} from zip`);
            return { ok: true, id: modId, mods: modsAfterInstall };
        } catch (error) {
            removeQuietly(stagingDir);
            if (backupTaken) {
                try {
                    fs.rmSync(target, { recursive: true, force: true });
                    fs.renameSync(backupDir, target);
                } catch {
                    // The previous copy is still in the staging directory; the
                    // message below tells the user the install did not apply.
                }
            }
            removeQuietly(backupDir);
            return { ok: false, error: serializeError(error) };
        }
    };

    const notifyStateChanged = () => sendToRenderer(IPC.fStateChanged, listMods());

    const probeFfmpeg = () => {
        if (!ffmpegProbePromise) {
            ffmpegProbePromise = resolveFfmpeg({ appGetAppPath: () => app.getAppPath(), packagedDirName: MODS_RUNTIME_DIR })
                .then((status) => {
                    ffmpegStatus = status;
                    return status;
                })
                .finally(() => {
                    ffmpegProbePromise = null;
                });
        }
        return ffmpegProbePromise;
    };

    const exportService = createExportService({
        app,
        BrowserWindow,
        resolveFfmpeg: probeFfmpeg,
        // The export window runs without a preload, so it cannot ask for the
        // mod list itself; client descriptors are injected with the render config.
        getModClients: () => listClientDescriptors(),
    });

    // folia-mod:// resolves only enabled, successfully loaded mods. Disabled
    // or broken mods disappear from the protocol on the next loadAll pass.
    const resolveModDirectory = (modId) => {
        const runtime = mods.get(modId);
        return runtime && runtime.status === 'loaded' && runtime.dirPath ? runtime.dirPath : null;
    };
    attachModProtocolHandler(protocol, resolveModDirectory, (token) => pickedFiles.get(token) ?? null);

    pruneStagingDirectory();

    const registerIpc = () => {
        const handle = (channel, handler) => {
            try {
                ipcMain.removeHandler(channel);
            } catch {
                // First registration has nothing to remove.
            }
            ipcMain.handle(channel, async (event, ...args) => {
                try {
                    return await handler(event, ...args);
                } catch (error) {
                    return { ok: false, error: serializeError(error) };
                }
            });
        };

        handle(IPC.list, () => ({ mods: listMods(), ffmpeg: ffmpegStatus, directories: getModsDirectories() }));
        handle(IPC.setEnabled, (_event, modId, enabled) => setModEnabled(modId, enabled));
        handle(IPC.reload, () => ({ mods: loadAll() }));
        handle(IPC.exportCancel, () => ({ ok: exportService.cancelActiveExport() }));
        handle(IPC.rpc, (_event, modId, name, args) => invokeModRpc(modId, name, args));
        handle(IPC.storage, (_event, modId, operation, key, value) => invokeModStorage(modId, operation, key, value));
        handle(IPC.netFetch, (_event, modId, url, init) => invokeModNetFetch(modId, url, init));
        handle(IPC.pickFile, (_event, modId, accept) => invokeModPickFile(modId, accept));
        handle(IPC.pushRuntimeSnapshot, (_event, snapshot) => {
            if (snapshot && typeof snapshot === 'object') {
                runtimeSnapshot = snapshot;
            }
            return { ok: true };
        });
        handle(IPC.ffmpegStatus, async () => ({ ffmpeg: await probeFfmpeg() }));
        handle(IPC.openDirectory, () => openModsDirectory());
        handle(IPC.installZip, (_event, zipPath) => installModFromZip(zipPath));
    };

    const dispose = () => {
        exportService.cancelActiveExport();
        // Mods get their deactivate pass on the way out too, so anything they
        // hold (timers, handles, child processes) is released before quit.
        unloadAll();
        mods.clear();
    };

    return {
        loadAll,
        listMods,
        listClientDescriptors,
        setModEnabled,
        probeFfmpeg,
        registerIpc,
        dispose,
        IPC,
    };
};

module.exports = { createModSystem, INSTALL_LIMITS, IPC };
