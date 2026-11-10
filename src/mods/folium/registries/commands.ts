import { create } from 'zustand';
import type { FoliumCommandDef, FoliumSetting } from '../contract';
import { mergeFoliumParamValues, sanitizeFoliumParams } from '../../params/params';
import { createFoliumRegistry, type FoliumRegistryEntry } from '../../runtime/registry';
import { timeFoliumMod } from '../../runtime/guard';
import { reportFoliumIssue } from '../../runtime/status';

// src/mods/folium/registries/commands.ts
// `folium.registries.commands`: actions a mod offers to the user. A command
// runs in the renderer (its `run` is client code); work that needs Node goes
// through `folium.rpc` to the mod's main entry. The mods panel renders each
// command as a card built from its param schema.

export interface StoredFoliumCommand {
    def: FoliumCommandDef;
    params: FoliumSetting[];
    /**
     * Offered to Settings → Global shortcuts (Folium 1.7): the mod set `globalShortcut: true` and the
     * command has no params. Read once at registration, like the params, so a mod cannot flip it later
     * by changing the object it handed over.
     */
    globalShortcut: boolean;
}

export const commandsRegistry = createFoliumRegistry<FoliumCommandDef, StoredFoliumCommand>('commands', {
    validate: (def, { modId, id }) => {
        if (typeof def.run !== 'function') {
            throw new Error('commands.register: run must be a function');
        }
        const params = sanitizeFoliumParams(def.params, modId);
        const wantsShortcut = def.globalShortcut === true;
        if (wantsShortcut && params.length > 0) {
            // Ignored rather than refused: the command still works from the palette and the panel.
            console.warn(`[Folium] commands.register: ${id} has params, so globalShortcut is ignored`);
        }
        return { def, params, globalShortcut: wantsShortcut && params.length === 0 };
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
        // Timed and counted by the gate; the card below is what shows a failure.
        const result = await timeFoliumMod(entry.modId, `command ${entry.id}`, () => entry.def.def.run({ values: merged }));
        setRunState(entry.id, { running: false, lastError: null, lastResult: summarizeResult(result) });
        return { ok: true, result };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        reportFoliumIssue(entry.modId, `command ${entry.id}`, error);
        setRunState(entry.id, { running: false, lastError: message, lastResult: null });
        return { ok: false, error: message };
    }
};
