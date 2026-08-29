import type {
    ModFfmpegStatus,
    ModLogEntry,
    ModRuntimeInfo,
    ModRuntimeSnapshot,
    ModSetEnabledResult,
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
        };
    } catch {
        return EMPTY_PAYLOAD;
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

export const invokeModCommand = async (
    modId: string,
    commandId: string,
    params: Record<string, unknown>
): Promise<{ ok: boolean; result?: unknown; error?: string }> =>
    bridge()?.invokeModCommand(modId, commandId, params) ?? { ok: false, error: 'no-electron-bridge' };

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

export const subscribeModsState = (callback: (mods: ModRuntimeInfo[]) => void): (() => void) =>
    bridge()?.onModsStateChanged(callback) ?? (() => {});

export const subscribeExportProgress = (callback: (progress: ModExportProgress) => void): (() => void) =>
    bridge()?.onExportProgress(callback) ?? (() => {});

export const subscribeModLogs = (callback: (entry: ModLogEntry) => void): (() => void) =>
    bridge()?.onModLog(callback) ?? (() => {});

