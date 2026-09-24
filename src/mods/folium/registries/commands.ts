import { create } from 'zustand';
import type { FoliumCommandDef, FoliumParam } from '../contract';
import { mergeFoliumParamValues, sanitizeFoliumParams } from '../params';
import { createFoliumRegistry, type FoliumRegistryEntry } from '../registry';
import { reportFoliumIssue } from '../status';

// src/mods/folium/registries/commands.ts
// `folium.registries.commands`: actions a mod offers to the user. A command
// runs in the renderer (its `run` is client code); work that needs Node goes
// through `folium.rpc` to the mod's main entry. The mods panel renders each
// command as a card built from its param schema.

export interface StoredFoliumCommand {
    def: FoliumCommandDef;
    params: FoliumParam[];
}

export const commandsRegistry = createFoliumRegistry<FoliumCommandDef, StoredFoliumCommand>('commands', {
    validate: (def) => {
        if (typeof def.run !== 'function') {
            throw new Error('commands.register: run must be a function');
        }
        return { def, params: sanitizeFoliumParams(def.params) };
    },
});

export interface FoliumCommandRunState {
    running: boolean;
    lastError: string | null;
    lastResult: { summary: string | null; warnings: string[] } | null;
}

interface FoliumCommandStateStore {
    byId: Record<string, FoliumCommandRunState>;
}

export const useFoliumCommandState = create<FoliumCommandStateStore>(() => ({ byId: {} }));

const setRunState = (id: string, state: FoliumCommandRunState) => {
    useFoliumCommandState.setState((current) => ({ byId: { ...current.byId, [id]: state } }));
};

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
    try {
        return { summary: JSON.stringify(result).slice(0, 240), warnings };
    } catch {
        return { summary: String(result), warnings };
    }
};

/*
 * Runs a registered command with values validated against its schema. The
 * outcome lands in useFoliumCommandState for the card to show; a throwing
 * command is also reported against its mod.
 */
export const runFoliumCommand = async (
    entry: FoliumRegistryEntry<StoredFoliumCommand>,
    values: Record<string, unknown>,
): Promise<{ ok: boolean; result?: unknown; error?: string }> => {
    setRunState(entry.id, { running: true, lastError: null, lastResult: null });
    try {
        const merged = Object.freeze(mergeFoliumParamValues(entry.def.params, values));
        const result = await entry.def.def.run({ values: merged });
        setRunState(entry.id, { running: false, lastError: null, lastResult: summarizeResult(result) });
        return { ok: true, result };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportFoliumIssue(entry.modId, `command ${entry.id}`, error);
        setRunState(entry.id, { running: false, lastError: message, lastResult: null });
        return { ok: false, error: message };
    }
};
