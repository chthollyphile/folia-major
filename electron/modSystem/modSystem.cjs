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
// This file keeps the table of mods and what changes it: the load cycle, enable
// and disable, the IPC handlers, the start of the app. The jobs around it each
// have a file of their own, set up here with the few things they need:
//   discovery.cjs    finding mods on disk and reading each mod.json
//   approval.cjs     the stored approval of a mod and the dialog that asks for it
//   nodeEntry.cjs    one mod's Node entry: its api object, loading, releasing
//   zipInstall.cjs   the user's mods folder and installing a .zip into it
//   netFetch.cjs     folium.net.fetch
//   pickedFiles.cjs  folium.ui.pickFile / restoreFile / releaseFile
//   modSecrets.cjs   the values of `secret` settings fields (folium.secrets / api.secrets)
//   safeStart.cjs    the start note and the two questions about starting without mods

'use strict';

const fs = require('fs');
const path = require('path');
const { dialog, ipcMain, protocol, safeStorage, shell } = require('electron');
const Store = require('electron-store').default || require('electron-store');

const { FOLIUM_VERSION, resolveLoadPlan, satisfiesHostRange, parseDependency, permissionGuarding } = require('./manifest.cjs');
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
const { createZipInstall, INSTALL_LIMITS } = require('./zipInstall.cjs');
const { createNetFetch } = require('./netFetch.cjs');
const { createPickedFiles } = require('./pickedFiles.cjs');
const { createModApproval } = require('./approval.cjs');
const { createNodeEntryRuntime } = require('./nodeEntry.cjs');
const { createModSecrets } = require('./modSecrets.cjs');
const { oldNameWarnings, onOldNameWarning } = require('./deprecated.cjs');

const SETTINGS_NAMESPACE = 'mods';

// folium.storage over IPC is the same data file as api.storage, behind the permission that
// guards it in foliumShared.json.
const STORAGE_PERMISSION = permissionGuarding('folium.storage');

// The channel names are written once, in foliumShared.json. The preload script cannot read a
// file (it runs sandboxed), so it has its own copy: test/unit/mod-system/foliumShared.test.ts
// holds that copy to this one.
const IPC = { ...require('./foliumShared.json').channels };

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
 * unsigned.
 */
const publicSignatureState = (signature) => ({
    status: signature?.status ?? 'unsigned',
    reason: signature?.reason ?? null,
    keyId: signature?.keyId ?? null,
    keyLabel: signature?.keyLabel ?? null,
    signedAt: signature?.signedAt ?? null,
});

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
    const fileGrantsKey = (modId) => `${SETTINGS_NAMESPACE}.fileGrants.${modId}`;
    const fileGrants = createFileGrantStore({
        readGrants: (modId) => store.get(fileGrantsKey(modId)),
        writeGrants: (modId, grants) => store.set(fileGrantsKey(modId), grants),
    });

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

    // The values of `secret` settings fields (modSecrets.cjs). A change, whoever made it, reaches
    // the main window as the key alone; the main entry's subscribers hear it in the store.
    const secrets = createModSecrets({
        userDataDir: app.getPath('userData'),
        safeStorage,
        onChange: (modId, key) => sendToRenderer(IPC.fSecretChanged, { modId, key }),
    });

    // One mod's Node entry: what it is given, loading it and releasing it (nodeEntry.cjs).
    // The export service is made further down and the snapshot changes while the app runs,
    // so both are asked for at the moment a mod's code needs them.
    const { buildModRuntime } = createNodeEntryRuntime({
        app, guard, RETHROW, emitLog, hostInfo, getPublicSnapshot, sendToRenderer, secrets,
        getExportService: () => exportService,
        getRuntimeSnapshot: () => runtimeSnapshot,
    });

    // Whether a mod may run: the stored approval, bound to the mod's files, and the native
    // dialog that asks for it (approval.cjs).
    const { writeTrust, isDevSourceMod, resolveTrust, confirmEnableMod } = createModApproval({
        app, store, enabledKey, getMainWindowSafe, getLocaleKey,
    });

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
            signature: publicSignatureState(entry.signature),
            devSource: Boolean(entry.devSource),
            // Position in the dependency-resolved load plan; clients activate in this order.
            loadOrder: typeof entry.loadOrder === 'number' ? entry.loadOrder : null,
            // Folium 1.6 only: the old names the mod used (deprecated.cjs).
            warnings: oldNameWarnings(entry.manifest),
        };
    };

    /*
     * Client entries of every loaded mod, for the export window: it runs without
     * a preload, so it is handed these descriptors inside its render config and
     * activates the clients in its own ('export') context.
     */
    const listClientDescriptors = () => listMods().filter((mod) => mod.clientUrl);

    // Finding mods on disk: the folders, each mod's root in them, each mod.json (discovery.cjs).
    const { getModsDirectories, readManifestFiles, brokenManifest } = createModDiscovery({ app, serializeError });

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
     * What a load would do, without doing it: discover, validate, digest, and
     * resolve the dependency graph for the *enabled* mods only. `plan.order`
     * lists the mods whose code a load would run. Runs no mod code.
     */
    const planMods = () => {
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
            const devSource = isDevSourceMod(discovery.dirPath);
            const trust = resolveTrust(modId, digest, { devSource });
            manifestsById.set(modId, discovery.manifest);
            prepared.set(modId, {
                manifest: discovery.manifest,
                dirPath: discovery.dirPath,
                digest,
                signature: verifyModSignature(discovery.dirPath, discovery.manifest),
                devSource,
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
        return { prepared, broken, plan };
    };

    /*
     * Full load cycle: deactivate what is running, then plan (`planMods`) and
     * activate each entry in order inside per-mod error boundaries. Returns the
     * renderer-facing state list. Re-entrant: reloads replace previous state.
     */
    const loadAll = () => {
        // While the start question is open no mod may run, whoever asks for a load. The load
        // that follows the answer reads the settings as they are then, so nothing is lost.
        if (startQuestionOpen) {
            return listMods();
        }
        unloadAll();
        if (!isModSystemEnabled()) {
            mods.clear();
            notifyStateChanged();
            return listMods();
        }
        const { prepared, broken, plan } = planMods();

        const buildEntry = (entry, status, error) => ({
            manifest: entry.manifest,
            dirPath: entry.dirPath,
            digest: entry.digest,
            signature: entry.signature,
            devSource: entry.devSource,
            status,
            error,
            enabled: entry.enabled,
            trustStale: entry.trustStale,
            ...buildModRuntime(entry.manifest, entry),
        });

        // The app's own start, with mods about to run: the start note goes down
        // before the first of them does. A later load (a reload, a mod enabled
        // from the panel) writes none, because nothing would take it up again.
        if (noteThisLoad && !skippedThisRun && plan.order.length > 0) {
            safeStart.writeNote();
        }

        const nextMods = new Map();
        const hostVersion = typeof app.getVersion === 'function' ? app.getVersion() : null;
        plan.order.forEach((modId, loadOrder) => {
            const runtime = buildEntry(prepared.get(modId), 'disabled', null);
            runtime.loadOrder = loadOrder;
            if (skippedThisRun) {
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
            if (range && !satisfiesHostRange(hostVersion, range)) {
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
                });
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
                // Its key and placeholder id are a directory name, not a validated id (requireDiscoveredMod).
                broken: true,
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
        // Same moment as the digest: the label must describe the bytes being approved.
        const signature = verifyModSignature(runtime.dirPath, runtime.manifest);
        const confirmed = await confirmEnableMod(runtime, digest, signature);
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
            // Timed and counted by the gate; a failure stays this function's to answer.
            const result = await guard.call(modId, `rpc ${name}`, () => handler(...(Array.isArray(args) ? args : [])), RETHROW);
            return { ok: true, result: result === undefined ? null : cloneJson(result) };
        } catch (error) {
            emitLog(modId, 'error', `rpc ${name} failed`, error);
            return { ok: false, error: serializeError(error) };
        }
    };

    // folium.net.fetch: a request a mod asks for, made here in Node (netFetch.cjs).
    const { invokeModNetFetch } = createNetFetch({ requireLoadedMod, serializeError });

    // folium.ui.pickFile / restoreFile / releaseFile, and which URL stands for which file (pickedFiles.cjs).
    const { invokeModPickFile, invokeModRestoreFile, invokeModReleaseFile, resolvePickedFile } = createPickedFiles({
        requireLoadedMod, fileGrants, getMainWindowSafe,
    });

    const STORAGE_OPERATIONS = new Set(['get', 'set', 'has', 'delete', 'keys']);

    // folium.storage from the client: same data file and permission as api.storage.
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
        app, isModSystemEnabled, loadAll, emitLog, serializeError,
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
    attachModProtocolHandler(protocol, resolveModDirectory, resolvePickedFile);

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
                    // While the start question is open nothing is loaded yet, and nothing may
                    // be: the answer comes first, whichever request this is. The window's
                    // request for the mod list waits here, so no client starts before it either.
                    await startDecision;
                    return await handler(event, ...args);
                } catch (error) {
                    return { ok: false, error: serializeError(error) };
                }
            });
        };

        handle(IPC.list, () => (
            { mods: listMods(), ffmpeg: ffmpegStatus, directories: getModsDirectories(), startSkipped: skippedThisRun }
        ));
        handle(IPC.setEnabled, (_event, modId, enabled) => setModEnabled(modId, enabled));
        handle(IPC.reload, () => ({ mods: loadAll() }));
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
     * The app's own start of the mods, once per run. With the note of an earlier
     * start still there, that start never got to its end: the user is asked
     * first, and until the answer is in, no mod is loaded. The note is used up
     * by the question; a new one goes down if mods then do start. The question
     * is only asked when a load would run at least one mod: with none enabled
     * there is nothing to start without, and the note is just taken up. Without
     * a note this is `loadAll`, synchronous as before.
     */
    const start = () => {
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
        if (planMods().plan.order.length === 0) {
            safeStart.clearNote();
            firstLoad();
            return;
        }
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

    /** "Reopen without mods": every running mod is stopped, and none runs again in this run. */
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

    /** Whether any mod's code is running: the only case in which a stuck window is asked about mods. */
    const hasRunningMods = () => !skippedThisRun
        && Array.from(mods.values()).some((runtime) => runtime.status === 'loaded');

    const dispose = () => {
        exportService.cancelActiveExport();
        // Mods get their deactivate pass on the way out too, so anything they
        // hold (timers, handles, child processes) is released before quit.
        unloadAll();
        mods.clear();
        stopOldNameWarnings();
    };

    return {
        start,
        loadAll,
        listMods,
        listClientDescriptors,
        setModEnabled,
        probeFfmpeg,
        registerIpc,
        dispose,
        skipForThisRun,
        hasRunningMods,
        noteNormalQuit,
        // The main window's page failed to load, or its process ended (safeStart.cjs).
        notePageFailed: safeStart.notePageFailed,
        askReopenWithoutMods: safeStart.askReopenWithoutMods,
        // Calls, time and failures the gate counted for one mod's Node entry.
        getModCallStats: guard.getStats,
        IPC,
    };
};

module.exports = { createModSystem, INSTALL_LIMITS, IPC };
