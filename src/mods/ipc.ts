import type {
    ModClearCacheResult,
    ModFfmpegStatus,
    ModLogEntry,
    ModMainCallStats,
    ModRpcMessage,
    ModRuntimeInfo,
    ModRuntimeSnapshot,
    ModSecretChange,
    ModSetEnabledResult,
    ModStorageUsageResult,
    ModsListPayload,
    ModExportProgress,
} from './types';

// src/mods/ipc.ts
// Typed access to the preload bridge under window.electron.mods. Every call
// degrades to a safe fallback on the web build so the panel stays renderable
// even when no Electron bridge exists (the UI then shows a desktop-only hint).

const bridge = (): NonNullable<typeof window.electron>['mods'] => window.electron?.mods;

export const isModsBridgeAvailable = (): boolean => Boolean(window.electron?.mods);

const EMPTY_PAYLOAD: ModsListPayload = {
    mods: [],
    ffmpeg: { available: false, path: null, version: null, candidates: [] },
    directories: [],
    startSkipped: false,
};

export const listMods = async (): Promise<ModsListPayload> => {
    const api = bridge();
    if (!api) {
        return EMPTY_PAYLOAD;
    }
    try {
        const payload = await api.listMods();
        return {
            mods: Array.isArray(payload?.mods) ? payload.mods : [],
            ffmpeg: payload?.ffmpeg ?? EMPTY_PAYLOAD.ffmpeg,
            directories: Array.isArray(payload?.directories) ? payload.directories : [],
            startSkipped: payload?.startSkipped === true,
        };
    } catch {
        return EMPTY_PAYLOAD;
    }
};

/** What the main-process gate counted for each mod's Node entry, by mod id; empty without the bridge. */
export const getModCallStats = async (): Promise<Record<string, ModMainCallStats>> => {
    try {
        const response = await bridge()?.getModCallStats?.();
        return response?.stats ?? {};
    } catch {
        return {};
    }
};

/**
 * Tells the main process that this window's start has ended: every client's start has returned
 * and the first screen is up. The start note is taken up on it (electron/modSystem/safeStart.cjs).
 */
export const reportModsStartSettled = async (): Promise<void> => {
    try {
        await bridge()?.reportModsStartSettled?.();
    } catch {
        // The note then stays, and the next start asks once: the safe side.
    }
};

/**
 * Tells the main process that this window's page is answering while its start is under way. If
 * the app is left the normal way before the start has ended, the start note is taken up only when
 * this was heard a moment before: a page stuck on a mod cannot say it.
 */
export const reportModsStartAlive = async (): Promise<void> => {
    try {
        await bridge()?.reportModsStartAlive?.();
    } catch {
        // Nothing to do here: the main process goes by what it heard last.
    }
};

export const setModEnabled = async (modId: string, enabled: boolean): Promise<ModSetEnabledResult> => {
    const api = bridge();
    if (!api) {
        return { ok: false, error: 'no-electron-bridge', mods: [] };
    }
    const response = await api.setModEnabled(modId, enabled);
    return {
        ok: Boolean(response?.ok),
        error: response?.error,
        mods: Array.isArray(response?.mods) ? response.mods : [],
    };
};

export const reloadMods = async (): Promise<ModRuntimeInfo[]> => {
    const api = bridge();
    if (!api) {
        return [];
    }
    const response = await api.reloadMods();
    return Array.isArray(response?.mods) ? response.mods : [];
};

export const cancelExport = async (): Promise<void> => {
    await bridge()?.cancelExport();
};

/** client → main call to a handler the mod registered with `api.rpc.handle`. */
export const invokeModRpc = async (
    modId: string,
    name: string,
    args: unknown[],
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModRpc(modId, name, args) ?? { ok: false, error: 'no-electron-bridge' };

/** folium.storage: the mod's data file in the main process (same one `api.storage.data` uses). */
export const invokeModStorage = async (
    modId: string,
    operation: 'get' | 'set' | 'has' | 'delete' | 'keys',
    key?: string,
    value?: unknown,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModStorage(modId, operation, key, value) ?? { ok: false, error: 'no-electron-bridge' };

/**
 * Folium 1.7: a mod's `secret` settings values, kept in the main process (electron/modSystem/modSecrets.cjs).
 * `declare` passes the `secret` keys of a settings section the mod registered (`key` is the list);
 * `state` answers a ModSecretsState.
 */
export const invokeModSecrets = async (
    modId: string,
    operation: 'get' | 'has' | 'set' | 'declare' | 'state',
    key?: string | readonly string[],
    value?: string | null,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModSecrets(modId, operation, key, value) ?? { ok: false, error: 'no-electron-bridge' };

/** folium.net.fetch: runs in the main process (permission `net.fetch`). */
export const invokeModNetFetch = async (
    modId: string,
    url: string,
    init: unknown,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModNetFetch(modId, url, init) ?? { ok: false, error: 'no-electron-bridge' };

/** folium.ui.pickFile: native open dialog; resolves to a session folia-mod:// URL or null. */
export const invokeModPickFile = async (
    modId: string,
    accept: string,
    persist: boolean,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModPickFile(modId, accept, persist) ?? { ok: false, error: 'no-electron-bridge' };

/** folium.ui.restoreFile: a persisted file grant back as a session URL, or null. */
export const invokeModRestoreFile = async (
    modId: string,
    grantId: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModRestoreFile(modId, grantId) ?? { ok: false, error: 'no-electron-bridge' };

/** folium.ui.releaseFile: forgets a persisted file grant. */
export const invokeModReleaseFile = async (
    modId: string,
    grantId: string,
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModReleaseFile(modId, grantId) ?? { ok: false, error: 'no-electron-bridge' };

export const pushRuntimeSnapshot = async (snapshot: ModRuntimeSnapshot): Promise<void> => {
    await bridge()?.pushRuntimeSnapshot(snapshot);
};

export const getFfmpegStatus = async (): Promise<ModFfmpegStatus> => {
    const api = bridge();
    if (!api) {
        return EMPTY_PAYLOAD.ffmpeg;
    }
    try {
        const response = await api.getFfmpegStatus();
        return response?.ffmpeg ?? EMPTY_PAYLOAD.ffmpeg;
    } catch {
        return EMPTY_PAYLOAD.ffmpeg;
    }
};

/** Opens the per-user mods directory in the OS file manager. */
export const openModsDirectory = async (): Promise<{ ok: boolean; directory?: string; error?: string }> => {
    const response = await bridge()?.openModsDirectory();
    return response ?? { ok: false, error: 'no-electron-bridge' };
};

/**
 * Installs a mod from a local .zip path. The main process validates the
 * manifest, guards against path traversal, and reloads the loader on success.
 */
export const installModFromZip = async (
    zipPath: string,
): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const response = await bridge()?.installModFromZip(zipPath);
    return response ?? { ok: false, error: 'no-electron-bridge' };
};

/** Bytes a mod keeps on disk (data and cache); disabled mods included, broken entries refused. */
export const getModStorageUsage = async (modId: string): Promise<ModStorageUsageResult> => {
    const response = await bridge()?.getModStorageUsage(modId);
    return response ?? { ok: false, error: 'no-electron-bridge' };
};

/** Empties a mod's cache directory (`api.storage.paths.cache`); the directory itself stays. */
export const clearModCache = async (modId: string): Promise<ModClearCacheResult> => {
    const response = await bridge()?.clearModCache(modId);
    return response ?? { ok: false, error: 'no-electron-bridge' };
};

export const subscribeModsState = (callback: (mods: ModRuntimeInfo[]) => void): (() => void) =>
    bridge()?.onModsStateChanged(callback) ?? (() => {});

export const subscribeExportProgress = (callback: (progress: ModExportProgress) => void): (() => void) =>
    bridge()?.onExportProgress(callback) ?? (() => {});

export const subscribeModLogs = (callback: (entry: ModLogEntry) => void): (() => void) =>
    bridge()?.onModLog(callback) ?? (() => {});

/** Messages main entries push with `api.rpc.send`; folium/rpcMessages.ts hands each to its own mod. */
export const subscribeModRpcMessages = (callback: (message: ModRpcMessage) => void): (() => void) =>
    bridge()?.onModRpcMessage?.(callback) ?? (() => {});

/** Folium 1.7: a mod's `secret` value was saved or cleared, by anyone; the key only. */
export const subscribeModSecretChanges = (callback: (change: ModSecretChange) => void): (() => void) =>
    bridge()?.onModSecretChanged?.(callback) ?? (() => {});
