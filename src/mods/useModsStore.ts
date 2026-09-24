import { create } from 'zustand';
import {
    cancelExport,
    getFfmpegStatus,
    installModFromZip,
    isModsBridgeAvailable,
    listMods,
    openModsDirectory,
    reloadMods,
    setModEnabled,
    subscribeExportProgress,
    subscribeModLogs,
    subscribeModsState,
} from './ipc';
import type { ModExportProgress, ModFfmpegStatus, ModLogEntry, ModRuntimeInfo, ModSetEnabledResult } from './types';
import { reconcileFoliumClients } from './folium/clientLoader';
import { restoreSavedFoliumSelections } from './folium/missingEntries';

// src/mods/useModsStore.ts
// Renderer-side state for the mod system panel. All mutations flow through the
// typed ipc helpers; the store only mirrors main-process state and keeps the
// panel components free of bridge wiring.

const MAX_LOG_ENTRIES = 50;

interface ModsStoreState {
    bridgeAvailable: boolean;
    mods: ModRuntimeInfo[];
    ffmpeg: ModFfmpegStatus;
    directories: string[];
    selectedModId: string | null;
    exportProgress: ModExportProgress | null;
    logs: ModLogEntry[];
    eventsBound: boolean;
    refresh: () => Promise<void>;
    refreshFfmpeg: () => Promise<void>;
    reloadAll: () => Promise<void>;
    toggleMod: (modId: string, enabled: boolean) => Promise<ModSetEnabledResult>;
    selectMod: (modId: string | null) => void;
    cancelActiveExport: () => Promise<void>;
    openModsDirectory: () => Promise<{ ok: boolean; directory?: string; error?: string }>;
    installModFromZip: (zipPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
    bindEvents: () => void;
}

export const useModsStore = create<ModsStoreState>((set, get) => ({
    bridgeAvailable: isModsBridgeAvailable(),
    mods: [],
    ffmpeg: { available: false, path: null, version: null, candidates: [] },
    directories: [],
    selectedModId: null,
    exportProgress: null,
    logs: [],
    eventsBound: false,

    refresh: async () => {
        const payload = await listMods();
        set((state) => {
            const selectedModId = state.selectedModId ?? payload.mods[0]?.id ?? null;
            return {
                mods: payload.mods,
                ffmpeg: payload.ffmpeg,
                directories: payload.directories,
                selectedModId: payload.mods.some((mod) => mod.id === selectedModId)
                    ? selectedModId
                    : payload.mods[0]?.id ?? null,
            };
        });
    },

    refreshFfmpeg: async () => {
        const ffmpeg = await getFfmpegStatus();
        set({ ffmpeg });
    },

    reloadAll: async () => {
        const mods = await reloadMods();
        set({ mods });
        await get().refreshFfmpeg();
    },

    // Enabling is confirmed in a main-process dialog, so the result carries an
    // outcome the panel surfaces; the mod list is only replaced when the call
    // actually returned one (a declined confirmation returns the current list).
    toggleMod: async (modId, enabled) => {
        const result = await setModEnabled(modId, enabled);
        if (result.mods.length > 0 || result.ok) {
            set({ mods: result.mods });
        }
        return result;
    },

    selectMod: (modId) => set({ selectedModId: modId }),

    cancelActiveExport: async () => {
        await cancelExport();
        set({ exportProgress: null });
    },

    openModsDirectory: () => openModsDirectory(),

    installModFromZip: async (zipPath) => {
        const result = await installModFromZip(zipPath);
        if (result.ok) {
            await get().refresh();
        }
        return result;
    },

    bindEvents: () => {
        if (get().eventsBound) {
            return;
        }
        set({ eventsBound: true });
        subscribeModsState((mods) => set({ mods }));
        subscribeExportProgress((exportProgress) => set({ exportProgress }));
        subscribeModLogs((entry) => set((state) => ({
            logs: [...state.logs, entry].slice(-MAX_LOG_ENTRIES),
        })));
    },
}));

/*
 * Keep the Folium clients in lockstep with the mod list: any change to the list
 * (refresh / reload / enable / disable / install / main-process state push)
 * re-runs the client reconciliation, so a mod's registrations appear the moment
 * it is enabled and disappear when it is disabled or removed.
 */
useModsStore.subscribe((state, previous) => {
    if (state.mods !== previous.mods) {
        void reconcileFoliumClients(state.mods, 'main').then(restoreSavedFoliumSelections);
    }
});
