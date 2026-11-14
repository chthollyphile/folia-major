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
//
// Official signatures (modSignature.cjs) only label a mod as verified, beta,
// unsigned or invalid, in that dialog and in the mods panel. They never enable
// a mod or skip the confirmation.
//
// Folium 2.0 (dev/folium/folium-2-plan.md §5): built-in mods (resources/builtin-mods, dist-mods/ in a
// development build) are a tier of their own: trusted by where they are, on unless switched off, outside
// the mod system's master switch, the start without mods and the stuck-window question; no digest, no
// signature. Source mods (`folium: 2` with `sources`) are a class of their own with their own limits
// (foliumShared.json `limits.source`); each of their sources is enabled, used only for matching, or
// disabled (sourceStates below). Who owns which short source id is sourceOwnership.cjs. A load only
// reloads the mods whose folder, content, enablement or source state changed; the rest keep running.
// Every IPC handler answers the main window's main frame only.
//
// This file keeps the table of mods and what changes it: the load cycle, enable
// and disable, the IPC handlers, the start of the app. The jobs around it each
// have a file of their own, set up here with the few things they need:
//   discovery.cjs       finding mods on disk and reading each mod.json
//   approval.cjs        the stored approval of a mod and the dialog that asks for it
//   nodeEntry.cjs       one mod's Node entry: its api object, loading, releasing
//   sourceApi.cjs       the api members only source mods have
//   sourceOwnership.cjs overrides of built-in mods, takeovers, the short source ids
//   builtinSources.cjs  the trusted table of the built-in sources, and what the installation carries
//   mediaRules.cjs      the media cross-origin rules of source mods
//   zipInstall.cjs      the user's mods folder and installing a .zip into it
//   netFetch.cjs        folium.net.fetch
//   pickedFiles.cjs     folium.ui.pickFile / restoreFile / releaseFile
//   modSecrets.cjs      the values of `secret` settings fields (folium.secrets / api.secrets)
//   safeStart.cjs       the start note and the two questions about starting without mods

'use strict';

const fs = require('fs');
const path = require('path');
const electron = require('electron');
const Store = require('electron-store').default || require('electron-store');

const { dialog, ipcMain, protocol, safeStorage, shell } = electron;
const {
    FOLIUM_VERSION, resolveLoadPlan, satisfiesHostRange, parseDependency, permissionGuarding, isSourceManifest,
} = require('./manifest.cjs');
const { computeModDigest, shortDigest } = require('./modDigest.cjs');
const { verifyModSignature } = require('./modSignature.cjs');
const { clearDirectoryContents, isBrokenDirectory, measureDirectoryBytes, resolveModStorageDirs } = require('./modFiles.cjs');
const { createFileGrantStore } = require('./fileGrants.cjs');
const { resolveFfmpeg, MODS_RUNTIME_DIR } = require('../ffmpeg.cjs');
const { createExportService } = require('./exportService.cjs');
const { attachModProtocolHandler } = require('./modProtocol.cjs');
const { createModGuard } = require('./guard.cjs');
const { createSafeStart } = require('./safeStart.cjs');
const { createModDiscovery } = require('./discovery.cjs');
const { createBuiltinBuildWatch, readBuildFingerprint } = require('./builtinBuildWatch.cjs');
const { createZipInstall, INSTALL_LIMITS } = require('./zipInstall.cjs');
const { createNetFetch } = require('./netFetch.cjs');
const { createPickedFiles } = require('./pickedFiles.cjs');
const { createModApproval } = require('./approval.cjs');
const { createNodeEntryRuntime } = require('./nodeEntry.cjs');
const { createModSecrets, SECRET_MAX_BYTES } = require('./modSecrets.cjs');
const { oldNameWarnings, onOldNameWarning } = require('./deprecated.cjs');
const { BUILTIN_SOURCE_IDS, builtinSourceRow, builtinModOfSource, readBundledSources } = require('./builtinSources.cjs');
const { resolveSourceOwnership, claimRefusal } = require('./sourceOwnership.cjs');
const { ownPartitionOf, PARTITION_NAME_PATTERN } = require('./sourceApi.cjs');
const { createMediaRules } = require('./mediaRules.cjs');
const { limits: FOLIUM_LIMITS, foliumOneVersion: FOLIUM_ONE_VERSION } = require('./foliumShared.json');

const SETTINGS_NAMESPACE = 'mods';
// Folium 2.0 (plan §5.3): the state of every source, by source id, and who holds each taken-over short id.
// One object each: source ids hold dots (`folium.<mod>.<name>`), which electron-store reads as nesting.
const SOURCE_STATES_KEY = 'mods.sourceStates';
const SOURCE_CLAIMS_KEY = 'mods.sourceClaims';
// The partitions of their own source mods have used (`persist:folium.<mod id>.<name>`), by mod id, for "clear data".
const SOURCE_PARTITIONS_KEY = 'mods.sourcePartitions';
// The built-in mods a confirmed override replaces, built-in id -> overriding mod id: such a built-in copy waits
// for the full start (which reads the user's folders) instead of starting before the window and being swapped.
const OVERRIDDEN_BUILTINS_KEY = 'mods.overriddenBuiltins';
const SOURCE_STATES = Object.freeze(['enabled', 'matching', 'disabled']);

// folium.storage over IPC is the same data file as api.storage, behind the permission that
// guards it in foliumShared.json.
const STORAGE_PERMISSION = permissionGuarding('folium.storage');

// The channel names are written once, in foliumShared.json. The preload script cannot read a
// file (it runs sandboxed), so it has its own copy: test/unit/mod-system/foliumShared.test.ts
// holds that copy to this one.
const IPC = { ...require('./foliumShared.json').channels };

// The label of a built-in copy: it carries no signature file and none is checked (plan §5.2).
const BUILTIN_SIGNATURE = Object.freeze({ status: 'builtin', reason: null, keyId: null, keyLabel: null, signedAt: null });

/** The trusted row that claims the short source id `shortId`, or null: what a takeover claim is held to (claimRefusal). */
const sourceRowOf = (shortId) => builtinSourceRow(builtinModOfSource(shortId));
const BUILTIN_TIERS = new Set(['builtin', 'override']);

const cloneJson = (value) => JSON.parse(JSON.stringify(value));

const serializeError = (error) => {
    if (!error) {
        return 'unknown error';
    }
    return error && error.message ? error.message : String(error);
};

/*
 * The renderer-facing signature state: plain JSON, with unknown or missing
 * values as null. A mod the loader never checked (a broken manifest) reads as
 * unsigned; a built-in copy reads as 'builtin'.
 */
const publicSignatureState = (signature) => ({
    status: signature?.status ?? 'unsigned',
    reason: signature?.reason ?? null,
    keyId: signature?.keyId ?? null,
    keyLabel: signature?.keyLabel ?? null,
    signedAt: signature?.signedAt ?? null,
});

/* 'active' when one of a source mod's sources is enabled; 'matching' when none is but one is used for matching; else 'off'. */
const sourceModeOf = (states) => {
    if (states.includes('enabled')) return 'active';
    if (states.includes('matching')) return 'matching';
    return 'off';
};

/*
 * Whether an IPC event comes from the main window's main frame (Folium 2.0 plan §2 item 1). Only that page
 * runs mod clients (src/bootstrap.tsx); a sub-frame of it (a mod's `ui.embed` page) or any other window,
 * the remote control included, is refused.
 */
const isMainWindowFrame = (event, mainWindow) => Boolean(
    mainWindow
    && !mainWindow.isDestroyed?.()
    && event?.sender
    && mainWindow.webContents
    && event.sender === mainWindow.webContents
    && (event.senderFrame === undefined || event.senderFrame === event.sender.mainFrame),
);

const createModSystem = ({
    app,
    BrowserWindow,
    getMainWindow,
    getLocaleKey,
    isFeatureEnabled,
    // Folium 2.0, all optional: the main config store (api.legacy.store), the sign-in diagnostics registry
    // (loginBackendIpc.cjs), the crash report, the host's media cache prune, the native files the app ships,
    // and fakes of the Electron services source mods use (tests).
    hostStore = null,
    diagnostics = null,
    reportError = null,
    requestCachePrune = null,
    nativePath = null,
    openExternal = null,
    sourceHostOverrides = {},
}) => {
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
    const fileGrantsKey = (modId) => `${SETTINGS_NAMESPACE}.fileGrants.${modId}`;
    const fileGrants = createFileGrantStore({
        readGrants: (modId) => store.get(fileGrantsKey(modId)),
        writeGrants: (modId, grants) => store.set(fileGrantsKey(modId), grants),
    });

    const mods = new Map();       // modId -> runtime entry
    let runtimeSnapshot = null;   // last snapshot pushed by the renderer
    let ffmpegStatus = { available: false, path: null, version: null, candidates: [] };
    let ffmpegProbePromise = null;
    // The last plan's ownership answer, for the source IPC (resolved ids, pending overrides).
    let lastOwnership = null;
    // Mods kept from loading while their data is cleared (clearSourceData).
    const clearing = new Set();

    const getMainWindowSafe = () => {
        try {
            return typeof getMainWindow === 'function' ? getMainWindow() : null;
        } catch {
            return null;
        }
    };

    /*
     * The experimental master switch (Lab settings). Fail closed: anything the
     * caller cannot answer counts as off, and off means no mod from the mods folders is discovered,
     * activated, or reachable through the mutating IPC handlers — hiding the UI
     * alone would leave previously confirmed mods running with full privileges. Built-in mods are not under it.
     */
    const isModSystemEnabled = () => {
        try {
            return typeof isFeatureEnabled === 'function' ? Boolean(isFeatureEnabled()) : false;
        } catch {
            return false;
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

    // Every call into a mod's Node entry goes through this gate (guard.cjs).
    const guard = createModGuard((modId, where, error) => emitLog(modId, 'error', `${where} failed`, error));
    const RETHROW = { rethrow: true };

    // Safe start (safeStart.cjs). `skippedThisRun` is the answer "without mods
    // this time": for the rest of this run no mod is run, and nothing is written
    // anywhere, so the next run starts them as usual. `startDecision` is pending
    // while the start question is open (`startQuestionOpen`). Until the answer
    // is in, no mod's code runs, whoever asks: every request from a window waits
    // for it, and a load asked for by anyone else does nothing (`loadAll`).
    // Built-in mods are outside all of this: they run without mods too.
    const safeStart = createSafeStart({
        directory: app.getPath('userData'),
        dialog,
        getLocaleKey,
        getWindow: getMainWindowSafe,
    });
    let skippedThisRun = false;
    let noteThisLoad = false;
    let startQuestionOpen = false;
    let startDecision = Promise.resolve();
    // While the start question is open: whether a source mod of the user's folders waits for the answer.
    let sourceModsAwaitAnswer = false;

    // Folium 2.0 (plan §9): a `folium: 1` mod reads 1.9, the version its interface stays at.
    const hostInfo = (manifest) => ({
        folium: manifest?.folium === 2
            ? { major: FOLIUM_VERSION.major, minor: FOLIUM_VERSION.minor }
            : { major: FOLIUM_ONE_VERSION.major, minor: FOLIUM_ONE_VERSION.minor },
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

    // The manifest of the mod running under `modId`, or null (for the secrets' per-class rules).
    const runningManifest = (modId) => mods.get(modId)?.manifest ?? null;

    // Folium 2.0 (S3, plan §5.4): the running copies of source mods whose client registered none of the
    // sources their manifest declares. They lose what the client side's exemptions give (net.fetch, the data
    // file, the secret slots) for as long as that copy runs; a reload starts a new copy with them.
    const revokedSourceExemptions = new WeakSet();
    const hasSourceExemptions = (runtime) => Boolean(runtime?.source) && !revokedSourceExemptions.has(runtime);

    // The values of `secret` settings fields (modSecrets.cjs). A change, whoever made it, reaches
    // the main window as the key alone; the main entry's subscribers hear it in the store.
    // Folium 2.0: a source mod's manifest `secrets` count as declared, and hold up to 64 KB each.
    const secrets = createModSecrets({
        userDataDir: app.getPath('userData'),
        safeStorage,
        onChange: (modId, key) => sendToRenderer(IPC.fSecretChanged, { modId, key }),
        slotsOf: (modId) => {
            const manifest = runningManifest(modId);
            const revoked = revokedSourceExemptions.has(mods.get(modId));
            return !revoked && isSourceManifest(manifest) && Array.isArray(manifest.secrets) ? manifest.secrets : [];
        },
        maxBytesOf: (modId) => (isSourceManifest(runningManifest(modId)) && !revokedSourceExemptions.has(mods.get(modId))
            ? FOLIUM_LIMITS.source.secrets.maxBytes
            : SECRET_MAX_BYTES),
    });

    // What source mods register and the host reads: media rules, `_media` handlers, cache entry providers.
    const mediaRules = createMediaRules();
    const mediaHandlers = new Map();
    const cacheProviders = new Map();

    const isMainWindowPresent = () => {
        const win = getMainWindowSafe();
        return Boolean(win && !win.isDestroyed());
    };

    // The Electron services source mods reach through `api` (sourceApi.cjs). Fakes replace them in tests.
    const sourceHost = {
        store: hostStore ?? { get: () => undefined, set: () => {}, delete: () => {} },
        safeStorage,
        platform: process.platform,
        netFetch: (url, init) => electron.net.fetch(url, init),
        netRequest: (options) => electron.net.request(options),
        sessionFromPartition: (partition) => electron.session.fromPartition(partition),
        defaultSession: () => electron.session.defaultSession,
        // The host's opener with its protocol allowlist (main.cjs openExternalUrl, D609); none without one.
        openExternal: typeof openExternal === 'function' ? openExternal : async () => false,
        showOpenDialog: (options) => {
            const win = getMainWindowSafe();
            return win && !win.isDestroyed() ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options);
        },
        createHiddenWindow: ({ partition, webPreferences: _ignored, ...options }) => new BrowserWindow({
            ...options,
            show: false,
            webPreferences: {
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                ...(partition ? { partition } : {}),
            },
        }),
        diagnostics,
        nativePath: typeof nativePath === 'function' ? nativePath : () => null,
        reportError: typeof reportError === 'function'
            ? reportError
            : (where, error) => console.error(`[Mods] ${where}: an error reported to the crash report`, error),
        requestCachePrune: typeof requestCachePrune === 'function' ? requestCachePrune : () => {},
        ensureDir: (directory) => fs.mkdirSync(directory, { recursive: true }),
        mediaRules,
        mediaHandlers,
        cacheProviders,
        isMainWindowPresent,
        // Called when a source names a partition of its own (sourceApi.cjs); the list is read by "clear data".
        notePartition: (modId, partition) => notePartition(modId, partition),
        ...sourceHostOverrides,
    };

    // One mod's Node entry: what it is given, loading it and releasing it (nodeEntry.cjs).
    // The export service is made further down and the snapshot changes while the app runs,
    // so both are asked for at the moment a mod's code needs them.
    const { buildModRuntime } = createNodeEntryRuntime({
        app, guard, RETHROW, emitLog, hostInfo, getPublicSnapshot, sendToRenderer, secrets,
        getExportService: () => exportService,
        getRuntimeSnapshot: () => runtimeSnapshot,
        sourceHost,
        getLocale: () => (typeof getLocaleKey === 'function' ? getLocaleKey() : null),
    });

    // Whether a mod may run: the stored approval, bound to the mod's files, and the native
    // dialog that asks for it (approval.cjs).
    const {
        writeTrust, isDevSourceMod, resolveTrust, confirmEnableMod,
        readBuiltinEnabled, writeBuiltinEnabled, isOverrideConfirmed, writeOverrideApproval, confirmOverride,
        confirmClearSourceData,
    } = createModApproval({ app, store, enabledKey, getMainWindowSafe, getLocaleKey });

    /*
     * Source states (plan §5.3). No record reads as enabled, so an upgraded install has every source on. The
     * states apply whether or not the master switch is on, and to the sources the host still registers
     * itself (the nine before they are mods): the window reads them through the source-states channel.
     */
    const readSourceStates = () => {
        const stored = store.get(SOURCE_STATES_KEY);
        const states = {};
        if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
            Object.entries(stored).forEach(([sourceId, state]) => {
                if (SOURCE_STATES.includes(state)) states[sourceId] = state;
            });
        }
        return states;
    };
    const sourceStateOf = (sourceId) => readSourceStates()[sourceId] ?? 'enabled';
    const writeSourceState = (sourceId, state) => {
        store.set(SOURCE_STATES_KEY, { ...readSourceStates(), [sourceId]: state });
    };

    const readSourceClaims = () => {
        const stored = store.get(SOURCE_CLAIMS_KEY);
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
    };
    const writeSourceClaims = (claims) => store.set(SOURCE_CLAIMS_KEY, claims);

    const readSourcePartitions = () => {
        const stored = store.get(SOURCE_PARTITIONS_KEY);
        return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...stored } : {};
    };
    // What this run already has on record: a source names its partition on every request, and each store.get
    // reads the settings file again; the record only grows, so a partition once on it needs no second look.
    const notedPartitions = new Set();
    const notePartition = (modId, partition) => {
        const noted = `${modId}
${partition}`;
        if (notedPartitions.has(noted)) return;
        notedPartitions.add(noted);
        const all = readSourcePartitions();
        const known = Array.isArray(all[modId]) ? all[modId] : [];
        if (known.includes(partition)) return;
        store.set(SOURCE_PARTITIONS_KEY, { ...all, [modId]: [...known, partition] });
    };

    /*
     * The version the URL of a client entry carries, so the renderer's ES module map treats changed code as a
     * different module: the digest for a mod from the mods folders; for a built-in one, which has no digest,
     * the app's and the mod's versions. In a development build also what changes with a rebuild of dist-mods/:
     * the fingerprint dev/sources/build.mjs stamped on the folder (build.json, covering the main entry, the
     * worker, the archive and the locale files as well), or else the client file's time. The token is part of
     * the reload key too, so a rebuild restarts that mod alone.
     */
    const builtinVersionToken = (discovery) => {
        const parts = ['builtin', typeof app.getVersion === 'function' ? app.getVersion() : '0', discovery.manifest.version];
        const fingerprint = app.isPackaged ? null : readBuildFingerprint(discovery.dirPath);
        if (fingerprint) {
            parts.push(fingerprint);
        } else if (!app.isPackaged && discovery.manifest.client) {
            try {
                parts.push(String(Math.round(fs.statSync(path.join(discovery.dirPath, discovery.manifest.client)).mtimeMs)));
            } catch {
                // No client file to date: the versions alone.
            }
        }
        return parts.join(':');
    };
    const versionTag = (runtime) => (runtime.tier === 'builtin' ? encodeURIComponent(runtime.digest) : shortDigest(runtime.digest));

    // folia-mod:// URL for a mod's client entry. The digest is carried as a
    // version query so the renderer's ES module map treats a changed mod as a
    // different module instead of replaying the code it already imported.
    const clientUrl = (runtime) => (
        runtime.manifest.client
            ? `folia-mod://${runtime.manifest.id}/${runtime.manifest.client}?v=${versionTag(runtime)}`
            : null
    );

    // The window-facing view of a source mod's sources: resolved ids with their states.
    const publicSources = (runtime) => (runtime.source?.sources ?? []).map((source) => {
        const entry = runtime.manifest.sources?.find((candidate) => candidate.id === source.localId);
        return {
            id: source.sourceId,
            localId: source.localId,
            name: entry?.name ?? source.localId,
            state: sourceStateOf(source.sourceId),
            keepForMatching: Boolean(source.keepForMatching),
            takeover: Boolean(source.takeover),
            requires: entry?.requires ?? [],
        };
    });

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
            signature: publicSignatureState(entry.signature),
            devSource: Boolean(entry.devSource),
            // Position in the dependency-resolved load plan; clients activate in this order.
            loadOrder: typeof entry.loadOrder === 'number' ? entry.loadOrder : null,
            // Folium 1.6 only: the old names the mod used (deprecated.cjs).
            warnings: oldNameWarnings(entry.manifest),
            // Folium 2.0: where the copy comes from, its class, its sources, and what its row has to say.
            folium: entry.manifest.folium ?? 1,
            tier: entry.tier ?? 'user',
            kind: isSourceManifest(entry.manifest) ? 'source' : 'standard',
            contexts: entry.manifest.contexts ?? null,
            locales: entry.manifest.locales ?? null,
            sources: publicSources(entry),
            sourcesOff: Boolean(entry.sourcesOff),
            mainState: typeof entry.getMainState === 'function' ? entry.getMainState() : 'none',
            alternate: entry.alternate ?? null,
            shadowedBy: entry.shadowedBy ?? null,
            notes: entry.notes ?? [],
        };
    };

    /*
     * Client entries of every loaded mod, for the export window: it runs without
     * a preload, so it is handed these descriptors inside its render config and
     * activates the clients in its own ('export') context. Folium 2.0: never a source mod's (plan §5.2),
     * nor a mod whose `contexts` leave the export window out.
     */
    const listClientDescriptors = () => listMods().filter((mod) => (
        mod.clientUrl
        && mod.kind !== 'source'
        && (!Array.isArray(mod.contexts) || mod.contexts.includes('export'))
    ));

    // Finding mods on disk: the folders, each mod's root in them, each mod.json (discovery.cjs).
    const {
        getModsDirectories, getBuiltinModsDirectory, readManifestFiles, readBuiltinManifests, brokenManifest,
    } = createModDiscovery({ app, serializeError });

    // The short source ids this installation carries (`foliaBundledSources`), read once: it is in app.asar.
    const bundledSources = readBundledSources(app.getAppPath());
    let reportedBrokenInstall = '';

    /*
     * What a load would do, without doing it: discover, validate, digest, decide ownership, and resolve the
     * dependency graph for the *enabled* mods only. `plan.order` lists the mods whose code a load would
     * run, built-in and source mods first. Runs no mod code. `withUserMods` is the master switch: off, only
     * the built-in mods are discovered.
     */
    const planMods = ({ withUserMods = isModSystemEnabled(), sourcesOnly = false, builtinOnly = false } = {}) => {
        const builtinFound = readBuiltinManifests();
        const discovered = withUserMods ? readManifestFiles() : new Map();
        const builtins = new Map();
        const candidates = new Map();
        const broken = [];

        builtinFound.forEach((discovery, key) => {
            if (!discovery.manifest || discovery.validationErrors) {
                broken.push({ key: `builtin:${key}`, discovery });
                return;
            }
            builtins.set(discovery.manifest.id, discovery);
        });

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
            const devSource = isDevSourceMod(discovery.dirPath);
            const trust = resolveTrust(modId, digest, { devSource });
            candidates.set(modId, {
                manifest: discovery.manifest,
                dirPath: discovery.dirPath,
                tier: discovery.tier ?? 'user',
                digest,
                signature: verifyModSignature(discovery.dirPath, discovery.manifest),
                devSource,
                enabled: trust.enabled,
                trustStale: trust.trustStale,
            });
        });

        // Overrides and takeovers are user-folder code: not this run when it was started without mods.
        const ownership = resolveSourceOwnership(builtins, skippedThisRun ? new Map() : candidates, bundledSources.ids, {
            hostVersion: typeof app.getVersion === 'function' ? app.getVersion() : null,
            tableRow: builtinSourceRow,
            sourceRow: sourceRowOf,
            isOverrideConfirmed,
            claimRecord: (shortId) => readSourceClaims()[shortId] ?? null,
        });
        lastOwnership = ownership;
        // Said once a run, and only by an installation that declares what it carries: until the nine are mods
        // (S5) an undeclared installation carries them as host code, and nothing is broken.
        const missing = ownership.brokenInstall.join(', ');
        if (bundledSources.declared && missing && missing !== reportedBrokenInstall) {
            reportedBrokenInstall = missing;
            console.error(`[Mods] installation broken: it declares the sources ${missing} but carries no built-in copy of them`);
        }
        // Takeover holders the user confirmed first: kept so the first one keeps the id.
        const claims = readSourceClaims();
        let claimsChanged = false;
        ownership.claimHolders.forEach((modId, shortId) => {
            if (claims[shortId] !== modId) {
                claims[shortId] = modId;
                claimsChanged = true;
            }
        });
        if (claimsChanged) writeSourceClaims(claims);

        const sourceInfo = (modId) => {
            const sources = ownership.sources.get(modId);
            return sources ? { sources } : null;
        };
        const modeOf = (modId) => {
            const sources = ownership.sources.get(modId);
            return sources ? sourceModeOf(sources.map((source) => sourceStateOf(source.sourceId))) : null;
        };

        const prepared = new Map();
        const overriddenBy = new Map(ownership.overrides);
        builtins.forEach((builtin, modId) => {
            const overrider = overriddenBy.get(modId);
            const sameIdCandidate = candidates.get(modId);
            if (overrider && overrider === modId) {
                const candidate = candidates.get(modId);
                prepared.set(modId, {
                    ...candidate,
                    tier: 'override',
                    enabled: readBuiltinEnabled(modId),
                    trustStale: false,
                    builtinId: modId,
                    source: sourceInfo(modId),
                    mode: modeOf(modId),
                    alternate: { tier: 'builtin', version: builtin.manifest.version, dirPath: builtin.dirPath, reason: null },
                });
                return;
            }
            const refusedCopy = sameIdCandidate ? ownership.refused.get(modId) : null;
            prepared.set(modId, {
                manifest: builtin.manifest,
                dirPath: builtin.dirPath,
                tier: 'builtin',
                digest: builtinVersionToken(builtin),
                signature: BUILTIN_SIGNATURE,
                devSource: false,
                enabled: readBuiltinEnabled(modId),
                trustStale: false,
                builtinId: modId,
                source: sourceInfo(modId),
                mode: modeOf(modId),
                shadowedBy: overrider ?? null,
                alternate: sameIdCandidate ? {
                    tier: sameIdCandidate.tier,
                    version: sameIdCandidate.manifest.version,
                    dirPath: sameIdCandidate.dirPath,
                    signature: publicSignatureState(sameIdCandidate.signature),
                    reason: refusedCopy?.reason ?? null,
                } : null,
            });
        });
        candidates.forEach((candidate, modId) => {
            if (builtins.has(modId)) return;
            const refused = ownership.refused.get(modId);
            const overriding = [...overriddenBy.entries()].find(([, by]) => by === modId)?.[0] ?? null;
            prepared.set(modId, {
                ...candidate,
                // A claim that replaces a carried built-in source follows the built-in mod's switch.
                ...(overriding ? { tier: 'override', enabled: readBuiltinEnabled(overriding), trustStale: false, builtinId: overriding } : {}),
                source: sourceInfo(modId),
                mode: modeOf(modId),
                blocked: refused ? (refused.detail ? `${refused.reason}:${refused.detail}` : refused.reason) : null,
                notes: ownership.notes.get(modId) ?? [],
            });
        });

        // Only enabled mods are roots of the resolution, and a broken subgraph
        // fails only the mods inside it. A mod nobody enabled — including one
        // dropped in specifically to declare a missing dependency or a cycle —
        // can no longer take the whole loader down with it. Built-in and source mods go first.
        // Before the window (`builtinOnly`): not a built-in copy an override was confirmed for.
        const overridden = builtinOnly ? (store.get(OVERRIDDEN_BUILTINS_KEY) ?? {}) : {};
        const runnable = (entry) => entry.enabled && !entry.blocked && !entry.shadowedBy && entry.mode !== 'off'
            && !clearing.has(entry.manifest.id) && (!sourcesOnly || entry.source)
            && !(builtinOnly && entry.tier === 'builtin' && Object.hasOwn(overridden, entry.manifest.id));
        const rank = (entry) => (BUILTIN_TIERS.has(entry.tier) ? 0 : entry.source ? 1 : 2);
        const roots = [...prepared.entries()]
            .filter(([, entry]) => runnable(entry))
            .sort(([, left], [, right]) => rank(left) - rank(right))
            .map(([modId]) => modId);
        const manifestsById = new Map([...prepared.entries()].map(([modId, entry]) => [modId, entry.manifest]));
        const plan = resolveLoadPlan(manifestsById, {
            roots,
            source: 'mods',
            isEnabled: (modId) => {
                const entry = prepared.get(modId);
                return Boolean(entry && runnable(entry));
            },
        });
        return { prepared, broken, plan, ownership };
    };

    // What decides whether a running copy is kept by the next load (plan §5.4, `unloadAll()` made differential).
    const reloadKeyOf = (entry) => JSON.stringify([
        entry.tier, entry.dirPath, entry.digest, entry.mode ?? null,
        (entry.source?.sources ?? []).map((source) => [source.sourceId, source.legacy]),
    ]);

    /*
     * Runs the cleanup of the running copies in `runtimes`: ordinary mods first, source mods after (plan
     * §5.2). Their `onBeforeUnload` has been awaited by `reloadChanged` when there was time for it.
     */
    const unloadRuntimes = (runtimes) => {
        const ordered = [...runtimes].sort((left, right) => Number(Boolean(left.source)) - Number(Boolean(right.source)));
        ordered.forEach((runtime) => {
            if (runtime.status === 'loaded' && typeof runtime.unload === 'function') {
                runtime.unload();
            }
        });
    };

    /*
     * Load cycle: plan (`planMods`), keep every running copy whose folder, content, enablement and source
     * state are what they were (and whose dependencies were kept), deactivate the rest, and activate what is
     * new in order inside per-mod error boundaries. Returns the renderer-facing state list. Re-entrant:
     * reloads replace previous state. `sourcesOnly` (the start before the window) plans the source mods
     * alone and leaves every other entry as it is. Without `differential` (the panel's reload, the master
     * switch, the start) every ordinary mod runs again as before Folium 2.0; a source mod is kept whenever
     * it is unchanged, whoever asks. Enabling, disabling, installing and switching a source go through
     * `reloadChanged`, which is differential for every mod.
     */
    const loadAll = ({ sourcesOnly = false, differential = false, builtinOnly = false } = {}) => {
        // While the start question is open no mod may run, whoever asks for a load. The load
        // that follows the answer reads the settings as they are then, so nothing is lost.
        if (startQuestionOpen) {
            return listMods();
        }
        const switchOn = isModSystemEnabled() && !builtinOnly;
        const { prepared, broken, plan } = planMods({ withUserMods: switchOn, sourcesOnly, builtinOnly });

        const buildEntry = (entry, status, error) => ({
            manifest: entry.manifest,
            dirPath: entry.dirPath,
            digest: entry.digest,
            signature: entry.signature,
            devSource: entry.devSource,
            tier: entry.tier,
            source: entry.source,
            mode: entry.mode,
            alternate: entry.alternate ?? null,
            shadowedBy: entry.shadowedBy ?? null,
            notes: entry.notes ?? [],
            sourcesOff: entry.mode === 'off',
            status,
            error,
            enabled: entry.enabled,
            trustStale: entry.trustStale,
            reloadKey: reloadKeyOf(entry),
            ...buildModRuntime(entry.manifest, entry),
        });

        // The app's own start, with mods from the mods folders about to run: the start note goes down
        // before the first of them does. A later load (a reload, a mod enabled
        // from the panel) writes none, because nothing would take it up again. Built-in mods do not count.
        const userModsInPlan = plan.order.filter((modId) => prepared.get(modId)?.tier !== 'builtin');
        if (noteThisLoad && !skippedThisRun && userModsInPlan.length > 0) {
            safeStart.writeNote();
        }

        const previous = new Map(mods);
        const kept = new Set();
        const nextMods = new Map();
        const hostVersion = typeof app.getVersion === 'function' ? app.getVersion() : null;
        const reloaded = new Set();

        // First the copies that stay; what does not stay is released before anything new starts.
        plan.order.forEach((modId) => {
            const entry = prepared.get(modId);
            const old = previous.get(modId);
            const dependencyReloaded = entry.manifest.depends.some((dependency) => reloaded.has(parseDependency(dependency).id));
            const skipped = skippedThisRun && !BUILTIN_TIERS.has(entry.tier);
            const keepable = differential || Boolean(entry.source);
            if (keepable && old && old.status === 'loaded' && !skipped && !old.unloadPrepared
                && old.reloadKey === reloadKeyOf(entry) && !dependencyReloaded) {
                kept.add(modId);
                return;
            }
            reloaded.add(modId);
        });
        unloadRuntimes([...previous.entries()]
            .filter(([modId]) => !kept.has(modId) && !(sourcesOnly && !prepared.get(modId)?.source))
            .map(([, runtime]) => runtime));

        plan.order.forEach((modId, loadOrder) => {
            const entry = prepared.get(modId);
            if (kept.has(modId)) {
                const runtime = previous.get(modId);
                Object.assign(runtime, {
                    loadOrder,
                    signature: entry.signature,
                    devSource: entry.devSource,
                    enabled: entry.enabled,
                    trustStale: entry.trustStale,
                    alternate: entry.alternate ?? null,
                    notes: entry.notes ?? [],
                });
                nextMods.set(modId, runtime);
                return;
            }
            const runtime = buildEntry(entry, 'disabled', null);
            runtime.loadOrder = loadOrder;
            if (skippedThisRun && !BUILTIN_TIERS.has(entry.tier)) {
                // "Without mods this time": the mod stays enabled and is not run.
                runtime.status = 'skipped';
                nextMods.set(modId, runtime);
                return;
            }
            // The plan is topological, so every dependency has already been
            // tried. One that did not load (host-version mismatch, a throwing
            // main) fails its dependents too instead of leaving them running
            // against a dependency that never ran.
            const failedDependencies = runtime.manifest.depends
                .map((dependency) => parseDependency(dependency).id)
                .filter((dependencyId) => nextMods.get(dependencyId)?.status !== 'loaded');
            if (failedDependencies.length > 0) {
                runtime.status = 'dependency-failed';
                runtime.error = failedDependencies
                    .map((dependencyId) => `dependency "${dependencyId}" required by "${modId}" failed to load`)
                    .join('; ');
                nextMods.set(modId, runtime);
                return;
            }
            // A mod that names the Folia versions it needs (manifest "folia")
            // never runs on a host outside that range.
            const range = runtime.manifest.folia;
            if (range && entry.tier !== 'builtin' && !satisfiesHostRange(hostVersion, range)) {
                runtime.status = 'error';
                runtime.error = 'host-version-mismatch';
                nextMods.set(modId, runtime);
                return;
            }
            try {
                runtime.load((error) => {
                    // The entry's activate() returned a promise and it rejected,
                    // after this loop moved on: the same record as a throw below.
                    emitLog(modId, 'error', 'activate failed', error);
                    if (mods.get(modId) !== runtime || runtime.status !== 'loaded') {
                        return;
                    }
                    // What the entry registered before it failed is released,
                    // or nothing would run it once the mod no longer counts as loaded.
                    runtime.unload();
                    runtime.status = 'error';
                    runtime.error = serializeError(error);
                    notifyStateChanged();
                }, { deferMain: entry.mode === 'matching' });
                runtime.status = 'loaded';
            } catch (error) {
                // A source mod's registrations (windows, media rules, diagnostics, cache entries) go with it.
                if (runtime.source) runtime.unload();
                runtime.status = 'error';
                runtime.error = serializeError(error);
            }
            nextMods.set(modId, runtime);
        });

        prepared.forEach((entry, modId) => {
            if (nextMods.has(modId)) {
                return;
            }
            if (sourcesOnly && !entry.source) {
                // Not this load's business: the entry stays as the last full load left it.
                if (previous.has(modId)) nextMods.set(modId, previous.get(modId));
                return;
            }
            if (entry.blocked) {
                nextMods.set(modId, buildEntry(entry, 'error', entry.blocked));
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
                // Its key and placeholder id are a directory name, not a validated id (requireDiscoveredMod).
                broken: true,
                dirPath: discovery.dirPath,
                digest: null,
                tier: discovery.tier ?? 'user',
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
        notifySourceStatesChanged();
        return listMods();
    };

    /*
     * A load that first lets the source mods it will stop finish (plan §5.2): each running source copy the
     * next load will not keep gets its `onBeforeUnload` handlers awaited, 3 seconds at most, before the load
     * releases it. The window stops the playback of those sources before it asks for the change
     * (src/mods/runtime/sourceSwitches.ts). Then `loadAll`. Calls run one after another.
     */
    let reloadQueue = Promise.resolve();
    const reloadChanged = ({ differential = true } = {}) => {
        // One at a time: a second switch waits for the first one's onBeforeUnload and load.
        const run = () => reloadChangedNow({ differential });
        const next = reloadQueue.then(run, run);
        reloadQueue = next.catch(() => undefined);
        return next;
    };
    const reloadChangedNow = async ({ differential }) => {
        if (!startQuestionOpen) {
            const { prepared, plan } = planMods({ withUserMods: isModSystemEnabled() });
            const inPlan = new Set(plan.order);
            const leaving = [...mods.entries()].filter(([modId, runtime]) => (
                runtime.status === 'loaded'
                && runtime.source
                && (!inPlan.has(modId) || runtime.reloadKey !== reloadKeyOf(prepared.get(modId)))
            ));
            // The window pauses what of these sources is playing (runtime/sourceSwitches.ts), whichever path
            // this is: a switch, the master switch, an install over a running copy, the panel.
            const stopping = leaving.flatMap(([, runtime]) => (runtime.source?.sources ?? []).map((source) => source.sourceId));
            if (stopping.length > 0) sendToRenderer(IPC.fSourcesStopping, { sourceIds: stopping });
            await Promise.all(leaving.map(async ([, runtime]) => {
                // Once its onBeforeUnload ran, the copy has wound down: the load below must not keep it.
                runtime.unloadPrepared = true;
                await runtime.beforeUnload();
            }));
        }
        return loadAll({ differential });
    };

    const setModEnabled = async (modId, enabled) => {
        let runtime = mods.get(modId);
        // A built-in mod (or the override running in its place) is switched without a dialog and whatever the
        // master switch says: its record is not bound to a digest (plan §5.1).
        if (runtime && BUILTIN_TIERS.has(runtime.tier)) {
            writeBuiltinEnabled(prepareBuiltinId(runtime), Boolean(enabled));
            return { ok: true, mods: await reloadChanged() };
        }
        if (!isModSystemEnabled()) {
            return { ok: false, error: 'mod-system-disabled', mods: [] };
        }
        if (!runtime) {
            loadAll({ differential: true });
            runtime = mods.get(modId);
        }
        if (!runtime) {
            return { ok: false, error: 'mod-not-found', mods: listMods() };
        }
        if (!enabled) {
            writeTrust(modId, false, null);
            return { ok: true, mods: await reloadChanged() };
        }
        // Re-hash right before asking: the confirmation must describe, and bind
        // to, exactly the bytes on disk at this moment.
        const digest = computeModDigest(runtime.dirPath);
        if (!digest) {
            return { ok: false, error: 'mod-content-unverifiable', mods: listMods() };
        }
        // Same moment as the digest: the label must describe the bytes being approved.
        const signature = verifyModSignature(runtime.dirPath, runtime.manifest);
        const confirmed = await confirmEnableMod(runtime, digest, signature);
        if (!confirmed) {
            return { ok: false, error: 'enable-declined', mods: listMods() };
        }
        writeTrust(modId, true, digest);
        /*
         * A takeover: the first one confirmed holds the short id (plan §5.1, one id to one mod). Only what this
         * confirmation showed as taken over is recorded: the plan described the mod's source as a takeover of that
         * id (nobody holds it, and the trusted row backs the claim). A plan without the user's mods in it (a run
         * started without mods, the start before the window) describes none, so it can never hand an id over.
         */
        const shownTakeovers = new Set((runtime.source?.sources ?? []).filter((source) => source.takeover).map((source) => source.sourceId));
        const claims = readSourceClaims();
        let claimed = false;
        (runtime.manifest.sources ?? []).forEach((entry) => {
            const shortId = entry.claims?.id;
            if (shortId && shownTakeovers.has(shortId) && !bundledSources.ids.includes(shortId)
                && claimRefusal(entry.claims, sourceRowOf) === null) {
                claims[shortId] = modId;
                claimed = true;
            }
        });
        if (claimed) writeSourceClaims(claims);
        return { ok: true, mods: await reloadChanged() };
    };

    // The built-in mod a built-in or override row stands for.
    const prepareBuiltinId = (runtime) => {
        if (runtime.tier === 'builtin') return runtime.manifest.id;
        const overridden = [...(lastOwnership?.overrides.entries() ?? [])].find(([, by]) => by === runtime.manifest.id);
        return overridden ? overridden[0] : runtime.manifest.id;
    };

    /*
     * The one confirmation of an override copy (plan §5.1): a copy that is signed, newer and in range, and
     * only lacks it. Bound to its digest; a changed copy needs it again.
     */
    const confirmModOverride = async (modId) => {
        const builtinId = lastOwnership?.pendingOverride.get(modId) ?? null;
        if (!builtinId) {
            return { ok: false, error: 'no-pending-override', mods: listMods() };
        }
        const discovery = readManifestFiles().get(modId);
        if (!discovery?.manifest) {
            return { ok: false, error: 'mod-not-found', mods: listMods() };
        }
        const digest = computeModDigest(discovery.dirPath);
        const signature = verifyModSignature(discovery.dirPath, discovery.manifest);
        if (!digest || signature.status !== 'verified') {
            return { ok: false, error: 'override-not-verified', mods: listMods() };
        }
        const builtinVersion = mods.get(builtinId)?.manifest.version ?? null;
        const confirmed = await confirmOverride({ manifest: discovery.manifest, dirPath: discovery.dirPath }, digest, signature, builtinVersion);
        if (!confirmed) {
            return { ok: false, error: 'override-declined', mods: listMods() };
        }
        writeOverrideApproval(modId, digest);
        store.set(OVERRIDDEN_BUILTINS_KEY, { ...(store.get(OVERRIDDEN_BUILTINS_KEY) ?? {}), [builtinId]: modId });
        return { ok: true, mods: await reloadChanged() };
    };

    /* "Settings → Sources" hands a taken-over short id to another mod that claims it (plan §5.1). */
    const assignSourceClaim = async (shortId, modId) => {
        if (bundledSources.ids.includes(shortId)) {
            return { ok: false, error: 'source-is-carried' };
        }
        const discovery = isModSystemEnabled() ? readManifestFiles().get(modId) : null;
        const claiming = discovery?.manifest?.sources?.filter((entry) => entry.claims?.id === shortId) ?? [];
        if (claiming.length === 0) {
            return { ok: false, error: 'mod-does-not-claim' };
        }
        const refusal = claiming.map((entry) => claimRefusal(entry.claims, sourceRowOf)).find(Boolean);
        if (refusal) {
            return { ok: false, error: refusal };
        }
        // The same confirmation as an enable of a takeover (plan §5.1): which id, which old data, the signature
        // as it is; bound to these files like any approval.
        const digest = computeModDigest(discovery.dirPath);
        if (!digest) {
            return { ok: false, error: 'mod-content-unverifiable' };
        }
        const signature = verifyModSignature(discovery.dirPath, discovery.manifest);
        if (signature.status === 'invalid') {
            return { ok: false, error: 'claim-signature-invalid' };
        }
        const takeovers = claiming.map((entry) => ({
            localId: entry.id,
            sourceId: shortId,
            takeover: true,
            keepForMatching: false,
            legacy: {
                storeKeys: [...(entry.claims.storeKeys ?? [])],
                partitions: [...(entry.claims.partitions ?? [])],
                userDataDirs: [...(entry.claims.userDataDirs ?? [])],
                native: [],
            },
        }));
        const confirmed = await confirmEnableMod({
            manifest: discovery.manifest,
            dirPath: discovery.dirPath,
            source: { sources: takeovers },
        }, digest, signature);
        if (!confirmed) {
            return { ok: false, error: 'enable-declined' };
        }
        writeTrust(modId, true, digest);
        writeSourceClaims({ ...readSourceClaims(), [shortId]: modId });
        return { ok: true, mods: await reloadChanged() };
    };

    /*
     * Every source the window should know the state of (plan §5.3): those of the discovered source mods, by
     * their resolved ids, and the built-in short ids the host still registers itself. `states` has one entry
     * per id (no record reads as enabled).
     */
    const listSourceStates = () => {
        const stored = readSourceStates();
        const sources = [];
        const seen = new Set();
        mods.forEach((runtime) => {
            (runtime.source?.sources ?? []).forEach((source) => {
                if (seen.has(source.sourceId)) return;
                seen.add(source.sourceId);
                sources.push({
                    sourceId: source.sourceId,
                    modId: runtime.manifest.id,
                    tier: runtime.tier,
                    state: stored[source.sourceId] ?? 'enabled',
                    keepForMatching: Boolean(source.keepForMatching),
                    takeover: Boolean(source.takeover),
                    loaded: runtime.status === 'loaded',
                    mainState: typeof runtime.getMainState === 'function' ? runtime.getMainState() : 'none',
                });
            });
        });
        bundledSources.ids.forEach((sourceId) => {
            if (seen.has(sourceId)) return;
            seen.add(sourceId);
            sources.push({ sourceId, modId: null, tier: 'host', state: stored[sourceId] ?? 'enabled', keepForMatching: false, takeover: false, loaded: false, mainState: 'none' });
        });
        const states = { ...stored };
        sources.forEach((source) => { states[source.sourceId] = source.state; });
        return { states, sources };
    };

    const notifySourceStatesChanged = () => sendToRenderer(IPC.fSourceStatesChanged, listSourceStates());

    /*
     * Whether a source mod's client may start in the window: one is loaded now, or (while the start question
     * is open) a source mod waits for the answer. The window's first screen waits for the source group only then.
     */
    const hasSourceMods = () => Array.from(mods.values()).some((runtime) => runtime.status === 'loaded' && runtime.source)
        || (startQuestionOpen && sourceModsAwaitAnswer);

    // A source id this host can switch: one of a discovered source mod, or a short id the installation carries.
    const isKnownSource = (sourceId) => typeof sourceId === 'string'
        && (bundledSources.ids.includes(sourceId) || BUILTIN_SOURCE_IDS.includes(sourceId)
            || [...mods.values()].some((runtime) => (runtime.source?.sources ?? []).some((source) => source.sourceId === sourceId)));

    /*
     * Switches one source to 'enabled', 'matching' or 'disabled' (plan §5.3). Only its own mod reloads, and
     * only when the switch changes how it runs; no other mod restarts, and no restart of the app is needed.
     * Who may be 'matching' is the window's to check (it knows the capabilities, S3); the stored value is kept as
     * it is given.
     */
    const setSourceState = async (sourceId, state) => {
        if (!SOURCE_STATES.includes(state)) {
            return { ok: false, error: `unknown-source-state:${String(state)}` };
        }
        if (!isKnownSource(sourceId)) {
            return { ok: false, error: 'source-not-found' };
        }
        writeSourceState(sourceId, state);
        console.info(`[Mods] source ${sourceId} switched to ${state}`);
        await reloadChanged();
        return { ok: true, ...listSourceStates() };
    };

    /*
     * What "clear data" of a source removes (plan §5.3), for the list the window shows before it asks. The
     * window clears what lives in its own storage (`pageStorePrefixes`) itself.
     */
    const describeSourceData = (sourceId) => {
        let owner = null;
        let entry = null;
        mods.forEach((runtime) => {
            const found = (runtime.source?.sources ?? []).find((source) => source.sourceId === sourceId);
            if (found && !owner) {
                owner = runtime;
                entry = found;
            }
        });
        if (!owner) {
            return { ok: false, error: bundledSources.ids.includes(sourceId) ? 'source-not-a-mod' : 'source-not-found' };
        }
        const { dataDir, cacheDir } = resolveModStorageDirs(app.getPath('userData'), owner.manifest.id);
        const legacy = entry.legacy ?? { storeKeys: [], partitions: [], userDataDirs: [], native: [] };
        const ownPartitions = readSourcePartitions()[owner.manifest.id];
        return {
            ok: true,
            sourceId,
            modId: owner.manifest.id,
            storeKeys: [...legacy.storeKeys],
            partitions: [...new Set([...legacy.partitions, ...(Array.isArray(ownPartitions) ? ownPartitions : [])])],
            userDataDirs: legacy.userDataDirs.map((folder) => path.join(app.getPath('userData'), folder)),
            modData: dataDir,
            modCache: cacheDir,
            pageStorePrefixes: [`online_provider:${sourceId}:`, `online_provider_${sourceId}_`],
        };
    };

    /*
     * "Clear data" of one source (plan §5.3): its mod stops (its onBeforeUnload is awaited), the old store keys,
     * partitions and userData folders its row or claims name go, and so do its secrets and its mod data and
     * cache folders; then it starts again as it was switched, signed out. A source the host still registers
     * itself (the nine before they are mods) is refused: its platform code keeps its sign-in in memory.
     */
    const clearSourceData = async (sourceId) => {
        const described = describeSourceData(sourceId);
        if (!described.ok) {
            return described;
        }
        const { modId } = described;
        // The list goes to the user in the main process first (plan §5.3), as an enable does: page code cannot
        // answer it.
        if (!await confirmClearSourceData(sourceId, described)) {
            return { ok: false, error: 'clear-declined' };
        }
        const runtime = mods.get(modId);
        if (runtime?.status === 'loaded') {
            runtime.unloadPrepared = true;
            await runtime.beforeUnload();
        }
        clearing.add(modId);
        const failures = [];
        try {
            loadAll({ differential: true });
            described.storeKeys.forEach((key) => {
                try {
                    sourceHost.store.delete(key);
                } catch (error) {
                    failures.push(`store:${key}`);
                    console.warn(`[Mods] clearing ${sourceId}: store key ${key} could not be removed`, error);
                }
            });
            for (const partition of described.partitions) {
                try {
                    await sourceHost.sessionFromPartition(partition).clearStorageData();
                } catch (error) {
                    failures.push(`partition:${partition}`);
                    console.warn(`[Mods] clearing ${sourceId}: partition ${partition} could not be cleared`, error);
                }
            }
            for (const directory of [...described.userDataDirs, described.modData, described.modCache]) {
                try {
                    await fs.promises.rm(directory, { recursive: true, force: true, maxRetries: 3 });
                } catch (error) {
                    failures.push(`folder:${directory}`);
                    console.warn(`[Mods] clearing ${sourceId}: ${directory} could not be removed`, error);
                }
            }
            await secrets.forget(modId);
        } finally {
            clearing.delete(modId);
            loadAll({ differential: true });
        }
        console.info(`[Mods] data of source ${sourceId} cleared${failures.length ? `, except ${failures.join(', ')}` : ''}`);
        return failures.length > 0
            ? { ok: false, error: 'clear-partial', failed: failures, pageStorePrefixes: described.pageStorePrefixes }
            : { ok: true, pageStorePrefixes: described.pageStorePrefixes };
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

    /*
     * client → main call routed to the handler the mod registered with api.rpc.handle. A source used only for
     * matching has its main entry started here, by its client's first rpc (plan §5.3); an activate() still
     * running is waited for, so its handlers are found (plan §5.4).
     */
    const invokeModRpc = async (modId, name, args) => {
        const runtime = requireLoadedMod(modId);
        if (typeof runtime.getMainState === 'function' && runtime.getMainState() === 'deferred') {
            try {
                runtime.startMain();
                console.info(`[Mods] ${modId}: main entry started by the first rpc (source used only for matching)`);
            } catch (error) {
                runtime.unload();
                runtime.status = 'error';
                runtime.error = serializeError(error);
                notifyStateChanged();
                return { ok: false, error: runtime.error };
            }
            notifyStateChanged();
        }
        let handler = runtime.getRpcHandler(name);
        if (!handler && typeof runtime.whenReady === 'function') {
            await runtime.whenReady();
            handler = runtime.getRpcHandler(name);
        }
        if (!handler) {
            return { ok: false, error: `rpc-not-found:${name}` };
        }
        try {
            // Timed and counted by the gate; a failure stays this function's to answer.
            const result = await guard.call(modId, `rpc ${name}`, () => handler(...(Array.isArray(args) ? args : [])), RETHROW);
            return { ok: true, result: result === undefined ? null : cloneJson(result) };
        } catch (error) {
            emitLog(modId, 'error', `rpc ${name} failed`, error);
            return { ok: false, error: serializeError(error) };
        }
    };

    // folium.net.fetch: a request a mod asks for, made here in Node (netFetch.cjs).
    const { invokeModNetFetch } = createNetFetch({
        requireLoadedMod,
        serializeError,
        hasSourceExemptions,
        // A source mod's client request: Electron net, in a partition when it names one (the same rule as
        // api.net.session: a claimed one, or its own, ownPartitionOf).
        sourceFetch: (url, init, { runtime, session }) => {
            if (session === undefined) return sourceHost.netFetch(url, init);
            const claimed = (runtime.source?.sources ?? []).some((source) => source.legacy?.partitions.includes(session));
            if (!claimed && !PARTITION_NAME_PATTERN.test(session)) {
                return Promise.reject(new Error('net-invalid-session'));
            }
            const partition = claimed ? session : ownPartitionOf(runtime.manifest.id, session);
            if (!claimed) notePartition(runtime.manifest.id, partition);
            return sourceHost.sessionFromPartition(partition).fetch(url, init);
        },
    });

    // folium.ui.pickFile / restoreFile / releaseFile, and which URL stands for which file (pickedFiles.cjs).
    const { invokeModPickFile, invokeModRestoreFile, invokeModReleaseFile, resolvePickedFile } = createPickedFiles({
        requireLoadedMod, fileGrants, getMainWindowSafe,
    });

    const STORAGE_OPERATIONS = new Set(['get', 'set', 'has', 'delete', 'keys']);

    // folium.storage from the client: same data file and permission as api.storage (a source mod needs none).
    const invokeModStorage = async (modId, operation, key, value) => {
        const runtime = requireLoadedMod(modId);
        if (!hasSourceExemptions(runtime) && !runtime.manifest.permissions.includes(STORAGE_PERMISSION)) {
            return { ok: false, error: `permission-denied:${STORAGE_PERMISSION}` };
        }
        if (!STORAGE_OPERATIONS.has(operation)) {
            return { ok: false, error: `storage-unknown-operation:${operation}` };
        }
        const result = await runtime.dataStore[operation](key, value);
        return { ok: true, result: result === undefined ? null : result };
    };

    /*
     * folium.secrets from the client, and the settings form drawing a section's `secret` fields.
     * Like folium.storage, the mod is the one the window names, and only a loaded mod is served: its
     * map key is then its validated manifest id, which is all the store makes a path of. `declare`
     * passes the keys of a settings section's `secret` fields; `state` says which keys hold a value.
     */
    const SECRET_OPERATIONS = new Set(['get', 'has', 'set', 'declare', 'state']);

    const invokeModSecrets = async (modId, operation, key, value) => {
        requireLoadedMod(modId);
        if (!SECRET_OPERATIONS.has(operation)) {
            return { ok: false, error: `secrets-unknown-operation:${operation}` };
        }
        let result;
        if (operation === 'declare') {
            result = secrets.declare(modId, key);
        } else if (operation === 'state') {
            result = await secrets.state(modId);
        } else {
            result = await secrets[operation](modId, key, value);
        }
        return { ok: true, result: result === undefined ? null : result };
    };

    /*
     * The mods panel's file actions work on any mod the loader discovered, loaded or not (a
     * disabled mod's files still take space), but never on a broken entry: its map key is a
     * directory name, so only a validated manifest id that is also its own key becomes a path.
     */
    const requireDiscoveredMod = (modId) => {
        const runtime = typeof modId === 'string' ? mods.get(modId) : null;
        if (!runtime || runtime.broken || runtime.manifest?.id !== modId) {
            throw new Error('mod-not-found');
        }
        return resolveModStorageDirs(app.getPath('userData'), modId);
    };

    /*
     * Disk usage for the mods panel: all of mods-data/<id> (mod-data.json included) and mods-cache/<id>.
     * `cacheBroken` (only when true) marks a cache root that is a stray file or a dead link: it counts 0,
     * yet the mod's paths.cache throws on every read, so the panel still offers "clear cache", which
     * removes the entry and lets the next read create a real directory.
     */
    const getModStorageUsage = async (modId) => {
        const { dataDir, cacheDir } = requireDiscoveredMod(modId);
        try {
            const [data, cache, cacheBroken] = await Promise.all([
                measureDirectoryBytes(dataDir),
                measureDirectoryBytes(cacheDir),
                isBrokenDirectory(cacheDir),
            ]);
            return cacheBroken ? { ok: true, data, cache, cacheBroken: true } : { ok: true, data, cache };
        } catch {
            return { ok: false, error: 'storage-usage-failed' };
        }
    };

    /*
     * Empties mods-cache/<id>, keeping the directory itself; api.storage.paths.cache re-creates
     * it on its next read anyway. A root that is a stray file or a link goes as one entry. A running
     * mod may hold files open, so some can fail (EBUSY on Windows): the rest still go, and the result
     * says the clear was partial.
     */
    const clearModCache = async (modId) => {
        const { cacheDir } = requireDiscoveredMod(modId);
        try {
            const { cleared, failed } = await clearDirectoryContents(cacheDir);
            return failed > 0
                ? { ok: false, error: 'cache-clear-partial', cleared }
                : { ok: true, cleared };
        } catch {
            return { ok: false, error: 'cache-clear-failed' };
        }
    };

    const listMods = () => Array.from(mods.values())
        .map((runtime) => publicModState(runtime))
        .filter(Boolean)
        .sort((left, right) => left.id.localeCompare(right.id));

    // The user's own mods folder, and installing a .zip into it (zipInstall.cjs).
    const { getUserModsDirectory, pruneStagingDirectory, installModFromZip } = createZipInstall({
        app, isModSystemEnabled, loadAll: () => reloadChanged(), emitLog, serializeError,
    });

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

    const notifyStateChanged = () => sendToRenderer(IPC.fStateChanged, listMods());
    // Folium 1.6 only: a running mod used an old name, so its row has a new warning (deprecated.cjs).
    const stopOldNameWarnings = onOldNameWarning(notifyStateChanged);

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
    attachModProtocolHandler(protocol, resolveModDirectory, resolvePickedFile, {
        resolveModFolium: (modId) => mods.get(modId)?.manifest?.folium ?? 1,
        // A `_media` route answers only while its mod runs (its main entry registered the handler).
        resolveMediaHandler: (modId, name) => (mods.get(modId)?.status === 'loaded' ? mediaHandlers.get(modId)?.get(name) ?? null : null),
    });

    pruneStagingDirectory();

    const registerIpc = () => {
        const handle = (channel, handler) => {
            try {
                ipcMain.removeHandler(channel);
            } catch {
                // First registration has nothing to remove.
            }
            ipcMain.handle(channel, async (event, ...args) => {
                // Folium 2.0 (plan §2 item 1, §5.4): only the main window's main frame runs mod clients, so it
                // is the only page served; anything else is refused before anything is read or run.
                if (!isMainWindowFrame(event, getMainWindowSafe())) {
                    console.warn(`[Mods] ${channel}: refused a request from outside the main window`);
                    return { ok: false, error: 'untrusted-sender' };
                }
                try {
                    // While the start question is open nothing is loaded yet, and nothing may
                    // be: the answer comes first, whichever request this is. The window's
                    // request for the mod list waits here, so no client starts before it either.
                    // The source states are a table and run nothing: they answer at once.
                    if (channel !== IPC.sourceStates) await startDecision;
                    return await handler(event, ...args);
                } catch (error) {
                    return { ok: false, error: serializeError(error) };
                }
            });
        };

        handle(IPC.list, () => (
            {
                mods: listMods(),
                ffmpeg: ffmpegStatus,
                directories: getModsDirectories(),
                builtinDirectory: getBuiltinModsDirectory(),
                startSkipped: skippedThisRun,
                sourceStates: listSourceStates().states,
            }
        ));
        handle(IPC.setEnabled, (_event, modId, enabled) => setModEnabled(modId, enabled));
        // The panel's reload runs every ordinary mod again, as it always did; unchanged source mods stay.
        handle(IPC.reload, async () => ({ mods: await reloadChanged({ differential: false }) }));
        handle(IPC.exportCancel, () => ({ ok: exportService.cancelActiveExport() }));
        handle(IPC.rpc, (_event, modId, name, args) => invokeModRpc(modId, name, args));
        handle(IPC.storage, (_event, modId, operation, key, value) => invokeModStorage(modId, operation, key, value));
        handle(IPC.secrets, (_event, modId, operation, key, value) => invokeModSecrets(modId, operation, key, value));
        handle(IPC.netFetch, (_event, modId, url, init) => invokeModNetFetch(modId, url, init));
        handle(IPC.pickFile, (_event, modId, accept, persist) => invokeModPickFile(modId, accept, persist));
        handle(IPC.restoreFile, (_event, modId, grantId) => invokeModRestoreFile(modId, grantId));
        handle(IPC.releaseFile, (_event, modId, grantId) => invokeModReleaseFile(modId, grantId));
        handle(IPC.pushRuntimeSnapshot, (_event, snapshot) => {
            if (snapshot && typeof snapshot === 'object') {
                runtimeSnapshot = snapshot;
            }
            return { ok: true };
        });
        handle(IPC.ffmpegStatus, async () => ({ ffmpeg: await probeFfmpeg() }));
        handle(IPC.openDirectory, () => openModsDirectory());
        handle(IPC.installZip, (_event, zipPath) => installModFromZip(zipPath));
        handle(IPC.storageUsage, (_event, modId) => getModStorageUsage(modId));
        handle(IPC.clearCache, (_event, modId) => clearModCache(modId));
        // What the gate counted for each mod's Node entry, for the mod's row in Settings.
        handle(IPC.callStats, () => {
            const stats = {};
            mods.forEach((runtime, modId) => {
                const counted = guard.getStats(modId);
                if (counted) {
                    stats[modId] = counted;
                }
            });
            return { stats };
        });
        // Folium 2.0 (plan §5.3): the sources' states and switches, what clearing one removes, the override
        // confirmation and who holds a taken-over id. "Settings → Sources" (S8) is drawn on these.
        handle(IPC.sourceStates, () => ({ ok: true, ...listSourceStates(), hasSourceMods: hasSourceMods() }));
        handle(IPC.setSourceState, (_event, sourceId, state) => setSourceState(sourceId, state));
        handle(IPC.sourceData, (_event, sourceId) => describeSourceData(sourceId));
        handle(IPC.clearSourceData, (_event, sourceId) => clearSourceData(sourceId));
        handle(IPC.confirmOverride, (_event, modId) => confirmModOverride(modId));
        handle(IPC.assignSourceClaim, (_event, shortId, modId) => assignSourceClaim(shortId, modId));
        // Folium 2.0 (S3): the window says which of a source mod's declared sources its client registered;
        // none at all takes the exemptions back from this running copy (plan §5.2).
        // The report names the client copy it is of (its URL, which carries the content tag): one of a copy that
        // was replaced meanwhile (an update, a reload) is not the running copy's, and changes nothing.
        handle(IPC.sourcesRegistered, (_event, modId, registered, reportedClientUrl) => {
            const runtime = typeof modId === 'string' ? mods.get(modId) : undefined;
            if (!runtime?.source || !Array.isArray(registered)) return { ok: false, error: 'mod-not-a-source-mod' };
            if (typeof reportedClientUrl !== 'string' || reportedClientUrl !== clientUrl(runtime)) return { ok: false, error: 'stale-copy' };
            if (registered.length === 0 && !revokedSourceExemptions.has(runtime)) {
                revokedSourceExemptions.add(runtime);
                emitLog(runtime.manifest.id, 'warn', 'registered none of the sources its mod.json declares: the source exemptions are taken back');
            }
            return { ok: true, revoked: revokedSourceExemptions.has(runtime) };
        });
        // The window: every client has started and the first screen is up. A start without mods
        // says nothing about the note of a start with them: after "reopen without mods" that
        // note stays, so the next start asks.
        handle(IPC.startSettled, () => {
            if (!skippedThisRun) {
                safeStart.clearNote();
            }
            return { ok: true };
        });
        // The window, once a second while its start is under way: its page is answering.
        handle(IPC.startAlive, () => {
            safeStart.notePageAnswering();
            return { ok: true };
        });
    };

    /*
     * Development builds: dev/sources/build.mjs --watch (run by `npm run dev:electron`) rewrites dist-mods/, and the
     * build.json it writes last moves each rebuilt mod's version token; a differential reload then restarts that
     * mod alone (builtinBuildWatch.cjs). Started with the app's own start of the mods, so nothing loads early.
     */
    const builtinBuildWatch = app.isPackaged || !getBuiltinModsDirectory() ? null : createBuiltinBuildWatch({
        directory: getBuiltinModsDirectory(),
        onChange: () => {
            console.info('[Mods] dist-mods/ was rebuilt: reloading the built-in mods that changed');
            reloadChanged().catch((error) => console.error('[Mods] Reload after a rebuild of dist-mods/ failed', error));
        },
    });

    /*
     * Folium 2.0 (plan §5.2): the source mods start before the main window is made, their main entries one
     * after another without waiting for each other (an async activate runs on). The rest waits for `start`.
     */
    const startSources = () => {
        try {
            // The built-in tier only: a source mod from the user's folders is under the start question and the
            // master switch like any other (plan §5.2), and nothing of the user's folders is read or hashed yet.
            loadAll({ sourcesOnly: true, builtinOnly: true });
        } catch (error) {
            console.error('[Mods] Failed to start the source mods', error);
        }
    };

    /*
     * The app's own start of the mods, once per run. With the note of an earlier
     * start still there, that start never got to its end: the user is asked
     * first, and until the answer is in, no mod is loaded. The note is used up
     * by the question; a new one goes down if mods then do start. The question
     * is only asked when a load would run at least one mod from the mods folders: with none enabled
     * there is nothing to start without, and the note is just taken up. Without
     * a note this is `loadAll`, synchronous as before. Built-in mods never count.
     */
    const start = () => {
        builtinBuildWatch?.start();
        const firstLoad = () => {
            noteThisLoad = true;
            try {
                loadAll();
            } finally {
                noteThisLoad = false;
            }
        };
        if (!isModSystemEnabled()) {
            // Mods are off: nothing starts, and a note from before has nothing left to say.
            safeStart.clearNote();
            firstLoad();
            return;
        }
        if (!safeStart.isNoteLeft()) {
            firstLoad();
            return;
        }
        const { plan, prepared } = planMods();
        if (plan.order.filter((modId) => prepared.get(modId)?.tier !== 'builtin').length === 0) {
            safeStart.clearNote();
            firstLoad();
            return;
        }
        sourceModsAwaitAnswer = plan.order.some((modId) => Boolean(prepared.get(modId)?.source));
        startQuestionOpen = true;
        startDecision = safeStart.askStartWithoutMods()
            .then((without) => {
                skippedThisRun = without;
            }, (error) => {
                console.warn('[Mods] The start question could not be asked; starting as usual', error);
            })
            .then(() => {
                startQuestionOpen = false;
                safeStart.clearNote();
                firstLoad();
            })
            // Every request from a window waits on this promise: it must not stay rejected.
            .catch((error) => {
                console.error('[Mods] Failed to load the mods after the start question', error);
            });
    };

    /** "Reopen without mods": every running mod from the mods folders is stopped, and none runs again in this run. */
    const skipForThisRun = () => {
        skippedThisRun = true;
        // If this run's start note is still down, the start with mods never got to its end.
        safeStart.leaveNote();
        return loadAll();
    };

    /**
     * The app is being left the normal way. This run's start note is taken up, unless the page
     * has gone quiet in the middle of starting the mods (safeStart.cjs).
     */
    const noteNormalQuit = () => {
        if (!skippedThisRun) {
            safeStart.noteNormalQuit();
        }
    };

    /**
     * Whether any mod's code from the mods folders is running: the only case in which a stuck window is
     * asked about mods. Built-in mods do not count (plan §5.1).
     */
    const hasRunningMods = () => !skippedThisRun
        && Array.from(mods.values()).some((runtime) => runtime.status === 'loaded' && runtime.tier !== 'builtin');

    /*
     * The quit: a promise that settles once every running source mod's onBeforeQuit handlers have (3 seconds
     * at most), or null when none has any to wait for (plan §5.2). main.cjs holds the quit for it.
     */
    let quitting = null;
    const prepareQuit = () => {
        // Asked again when the held quit is asked for again: the handlers ran already.
        if (quitting) return quitting;
        const waiting = Array.from(mods.values())
            .filter((runtime) => runtime.status === 'loaded' && runtime.source && runtime.hasQuitHandlers?.())
            .map((runtime) => runtime.beforeQuit());
        if (waiting.length === 0) return null;
        quitting = Promise.all(waiting).then(() => undefined);
        return quitting;
    };

    /* The main window went and no window takes its playback over (main.cjs pauseExternalPlayersNobodyFollows). */
    const notePlayersOrphaned = (reason) => {
        mods.forEach((runtime) => {
            if (runtime.status === 'loaded') runtime.playersOrphaned?.(reason);
        });
    };

    /* The main window was made or went (api.windows.onMainWindowChanged). */
    const noteMainWindowChanged = () => {
        const present = isMainWindowPresent();
        mods.forEach((runtime) => {
            if (runtime.status === 'loaded') runtime.mainWindowChanged?.(present);
        });
    };

    /*
     * The sources' cache entries, for the host's cache budget (api.cache.provideEntries): list them all, remove
     * one, clear them. Each provider's failure is its own: logged, and the rest still answer.
     */
    const sourceCaches = {
        list: async () => {
            const lists = await Promise.all(Array.from(cacheProviders.entries()).map(async ([modId, provider]) => {
                try {
                    const entries = await provider.list();
                    return (Array.isArray(entries) ? entries : []).map((entry) => ({ ...entry, modId }));
                } catch (error) {
                    console.warn(`[Mods] ${modId}: listing its cache entries failed`, error);
                    return [];
                }
            }));
            return lists.flat();
        },
        remove: async (modId, entryId) => {
            const provider = cacheProviders.get(modId);
            if (!provider || typeof provider.remove !== 'function') return false;
            await provider.remove(entryId);
            return true;
        },
        clear: async () => {
            await Promise.all(Array.from(cacheProviders.entries()).map(async ([modId, provider]) => {
                try {
                    await provider.clear?.();
                } catch (error) {
                    console.warn(`[Mods] ${modId}: clearing its cache entries failed`, error);
                }
            }));
        },
    };

    // The manifest-declared host lists of the running source mods (plan §5.5): main.cjs's certificate and
    // lyric-relay checks ask these on top of their own.
    const declaredHosts = (field) => {
        const hosts = new Set();
        mods.forEach((runtime) => {
            if (runtime.status !== 'loaded' || !runtime.source) return;
            (runtime.manifest.sources ?? []).forEach((entry) => (entry[field] ?? []).forEach((host) => hosts.add(host)));
        });
        return hosts;
    };
    const isLyricRelayHost = (hostname) => declaredHosts('lyricRelayHosts').has(String(hostname));
    const allowsCertificateException = (hostname) => declaredHosts('certificateExceptions').has(String(hostname));

    const dispose = () => {
        builtinBuildWatch?.stop();
        exportService.cancelActiveExport();
        // Mods get their deactivate pass on the way out too, so anything they
        // hold (timers, handles, child processes) is released before quit. Ordinary mods first.
        unloadRuntimes(Array.from(mods.values()));
        mods.clear();
        stopOldNameWarnings();
    };

    return {
        start,
        startSources,
        loadAll,
        reloadChanged,
        listMods,
        listClientDescriptors,
        setModEnabled,
        setSourceState,
        listSourceStates,
        describeSourceData,
        clearSourceData,
        confirmModOverride,
        assignSourceClaim,
        probeFfmpeg,
        registerIpc,
        dispose,
        prepareQuit,
        skipForThisRun,
        hasRunningMods,
        noteNormalQuit,
        notePlayersOrphaned,
        noteMainWindowChanged,
        mediaRules,
        sourceCaches,
        isLyricRelayHost,
        allowsCertificateException,
        // The main window's page failed to load, or its process ended (safeStart.cjs).
        notePageFailed: safeStart.notePageFailed,
        askReopenWithoutMods: safeStart.askReopenWithoutMods,
        // Calls, time and failures the gate counted for one mod's Node entry.
        getModCallStats: guard.getStats,
        IPC,
    };
};

module.exports = { createModSystem, INSTALL_LIMITS, IPC, isMainWindowFrame };
