import { create } from 'zustand';
import {
    cancelExport,
    getFfmpegStatus,
    installModFromZip,
    invokeModCommand,
    isModsBridgeAvailable,
    listMods,
    openModsDirectory,
    reloadMods,
    setModEnabled,
    subscribeExportProgress,
    subscribeModLogs,
    subscribeModsState,
} from './ipc';
import type { ModCommandParam, ModExportProgress, ModFfmpegStatus, ModLabelMap, ModLogEntry, ModRuntimeInfo, ModSetEnabledResult } from './types';
import { initModVisualizers, reloadModVisualizers } from './modVisualizers';

// src/mods/useModsStore.ts
// Renderer-side state for the mod system panel. All mutations flow through the
// typed ipc helpers; the store only mirrors main-process state and keeps the
// panel components free of bridge wiring.

const MAX_LOG_ENTRIES = 50;

interface CommandState {
    runningCommandId: string | null;
    lastError: string | null;
    lastResult: { summary: string | null; warnings: string[] } | null;
}

interface ModsStoreState {
    bridgeAvailable: boolean;
    mods: ModRuntimeInfo[];
    ffmpeg: ModFfmpegStatus;
    directories: string[];
    selectedModId: string | null;
    exportProgress: ModExportProgress | null;
    logs: ModLogEntry[];
    commandState: Record<string, CommandState>;
    eventsBound: boolean;
    refresh: () => Promise<void>;
    refreshFfmpeg: () => Promise<void>;
    reloadAll: () => Promise<void>;
    toggleMod: (modId: string, enabled: boolean) => Promise<ModSetEnabledResult>;
    selectMod: (modId: string | null) => void;
    runCommand: (modId: string, commandId: string, params: Record<string, unknown>) => Promise<
        { ok: boolean; result?: unknown; error?: string } | undefined
    >;
    cancelActiveExport: () => Promise<void>;
    openModsDirectory: () => Promise<{ ok: boolean; directory?: string; error?: string }>;
    installModFromZip: (zipPath: string) => Promise<{ ok: boolean; id?: string; error?: string }>;
    bindEvents: () => void;
}

const emptyCommandState = (): CommandState => ({ runningCommandId: null, lastError: null, lastResult: null });

export const useModsStore = create<ModsStoreState>((set, get) => ({
    bridgeAvailable: isModsBridgeAvailable(),
    mods: [],
    ffmpeg: { available: false, path: null, version: null, candidates: [] },
    directories: [],
    selectedModId: null,
    exportProgress: null,
    logs: [],
    commandState: {},
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

    runCommand: async (modId, commandId, params) => {
        const stateKey = `${modId}/${commandId}`;
        set((state) => ({
            commandState: {
                ...state.commandState,
                [stateKey]: { ...emptyCommandState(), runningCommandId: commandId },
            },
        }));
        const response = await invokeModCommand(modId, commandId, params);
        set((state) => ({
            commandState: {
                ...state.commandState,
                [stateKey]: {
                    runningCommandId: null,
                    lastError: response?.ok ? null : (response?.error ?? 'mods.commandFailed'),
                    lastResult: response?.ok ? summarizeResult(response.result) : null,
                },
            },
        }));
        return response;
    },

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

const summarizeResult = (result: unknown): { summary: string | null; warnings: string[] } => {
    const payload = result && typeof result === 'object' ? (result as Record<string, unknown>) : null;
    const warnings = Array.isArray(payload?.warnings) ? payload.warnings.filter((item): item is string => typeof item === 'string') : [];
    if (result === undefined || result === null) {
        return { summary: null, warnings };
    }
    if (typeof result === 'string') {
        return { summary: result, warnings };
    }
    if (payload && typeof payload.outputPath === 'string') {
        return { summary: payload.outputPath, warnings };
    }
    if (payload && typeof payload.message === 'string') {
        return { summary: payload.message, warnings };
    }
    return { summary: JSON.stringify(result).slice(0, 240), warnings };
};

/*
 * Resolves the label visible to the user from a mod-declared label map using
 * the active i18n language, with a deterministic fallback chain.
 */
export const resolveModLabel = (
    label: ModLabelMap | undefined,
    language: string,
    fallback: string
): string => {
    if (!label) {
        return fallback;
    }
    return label[language] ?? label['zh-CN'] ?? label.en ?? fallback;
};

/*
 * Builds the initial form values for a command from its declared params.
 * Selects fall back to the first option so the form is always submittable.
 */
export const buildDefaultCommandParams = (params: ModCommandParam[]): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    params.forEach((param) => {
        if (param.defaultValue !== undefined) {
            values[param.key] = param.defaultValue;
            return;
        }
        if (param.type === 'boolean') {
            values[param.key] = false;
            return;
        }
        if (param.type === 'select' && param.options?.length) {
            values[param.key] = param.options[0].value;
            return;
        }
        values[param.key] = '';
    });
    return values;
};

/*
 * Keep the visualizer registry in lockstep with the mod list: any change to the
 * list (refresh / reload / enable / disable / install / main-process state push)
 * re-runs the contributor reconciliation, so contributed modes appear the moment
 * their mod is enabled and disappear when it is disabled or removed.
 */
useModsStore.subscribe((state, previous) => {
    if (state.mods !== previous.mods) {
        reloadModVisualizers();
        void initModVisualizers();
    }
});