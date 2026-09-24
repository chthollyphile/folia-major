import { create } from 'zustand';

// src/mods/folium/status.ts
// Renderer-side runtime problems of each mod: client activation failures, a
// mount that threw, a rejected registration. The mods panel shows these next
// to the loader's own status, so a broken client is visible instead of silent.

const MAX_ISSUES_PER_MOD = 20;

export interface FoliumIssue {
    at: number;
    where: string;
    message: string;
}

interface FoliumStatusState {
    issues: Record<string, FoliumIssue[]>;
    clear: (modId: string) => void;
}

export const useFoliumStatusStore = create<FoliumStatusState>((set) => ({
    issues: {},
    clear: (modId) => set((state) => {
        if (!(modId in state.issues)) return state;
        const issues = { ...state.issues };
        delete issues[modId];
        return { issues };
    }),
}));

const describeError = (error: unknown): string => {
    if (error instanceof Error) return error.message || error.name;
    if (typeof error === 'string') return error;
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

/** Records a problem for a mod and mirrors it to the console with the mod id. */
export const reportFoliumIssue = (modId: string, where: string, error: unknown) => {
    const message = describeError(error);
    console.warn(`[Folium:${modId}] ${where}: ${message}`, error);
    useFoliumStatusStore.setState((state) => ({
        issues: {
            ...state.issues,
            [modId]: [...(state.issues[modId] ?? []), { at: Date.now(), where, message }].slice(-MAX_ISSUES_PER_MOD),
        },
    }));
};

export const clearFoliumIssues = (modId: string) => useFoliumStatusStore.getState().clear(modId);
