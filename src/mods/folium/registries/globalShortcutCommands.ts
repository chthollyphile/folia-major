import { useCallback, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { resolveFoliumLabel } from '../../params/params';
import { foliumModName, getFoliumClientStart, onFoliumClientStarted } from '../../runtime/clientLoader';
import { useFoliumRegistryEntries, type FoliumRegistryEntry } from '../../runtime/registry';
import { commandsRegistry, type StoredFoliumCommand } from './commands';
import { FOLIUM_COMMAND_PREFIX } from './commandPaletteSync';

// src/mods/folium/registries/globalShortcutCommands.ts
// Mod commands offered to Settings → Global shortcuts (Folium 1.7 `globalShortcut`). The host's
// shortcut code reads them here: which ids may be bound right now (the registering hook in
// components/command-palette/globalShortcuts), and how to name them or say why a bound one does
// nothing at the moment (the settings group). The ids are the command palette's ids for the same
// commands (`folium:<modId>:<name>`, see commandPaletteSync), and a press runs the palette's copy
// of the command, the same path as choosing it in the palette.

/** One mod command the listener can bind, as the settings list names it. */
export interface FoliumGlobalShortcutCommand {
    /** The command palette id, which is also what a binding stores. */
    id: string;
    modId: string;
    /** The name the mod was started under, named after the command in the list's labels. */
    modName: string;
    /** The command's label in the UI language. */
    title: string;
}

/**
 * Why a bound mod command cannot be pressed right now. `mod-inactive`: the mod is disabled, stopped,
 * not installed, or still starting. `command-missing`: the mod is running, but does not offer this
 * command for global shortcuts (removed, renamed, flag dropped, or params added).
 */
export type FoliumGlobalShortcutAbsence = 'mod-inactive' | 'command-missing';

/** What the settings row shows for a binding whose mod command is not offered now. */
export interface MissingFoliumGlobalShortcut {
    modId: string;
    modName: string;
    /** The command's local id: its label is not known while it is not registered. */
    name: string;
    reason: FoliumGlobalShortcutAbsence;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

const isOffered = (entry: FoliumRegistryEntry<StoredFoliumCommand>) => entry.def.globalShortcut;

let idsFor: readonly FoliumRegistryEntry<StoredFoliumCommand>[] | null = null;
let ids: ReadonlySet<string> = new Set();

/**
 * The palette ids of the mod commands that may be bound right now: registered, flagged, without
 * params. The same Set until those ids change, so it can feed a memo or useSyncExternalStore.
 */
export const getFoliumGlobalShortcutCommandIds = (): ReadonlySet<string> => {
    const list = commandsRegistry.list();
    if (list !== idsFor) {
        idsFor = list;
        const next = list.filter(isOffered).map((entry) => `${FOLIUM_COMMAND_PREFIX}${entry.id}`);
        // Keep the old Set when the bindable ids are the same: the hook that registers the keys
        // sits in App, and an unflagged command coming or going must not re-render it.
        if (next.length !== ids.size || next.some((id) => !ids.has(id))) {
            ids = new Set(next);
        }
    }
    return ids;
};

/** React view of getFoliumGlobalShortcutCommandIds; re-renders when a mod command comes or goes. */
export const useFoliumGlobalShortcutCommandIds = (): ReadonlySet<string> => useSyncExternalStore(
    commandsRegistry.subscribe,
    getFoliumGlobalShortcutCommandIds,
    getFoliumGlobalShortcutCommandIds,
);

/** `folium:<modId>:<name>` taken apart; null for any other id (a host command). */
const parseFoliumCommandId = (commandId: string): { modId: string; name: string } | null => {
    if (!commandId.startsWith(FOLIUM_COMMAND_PREFIX)) return null;
    const [modId, name, ...rest] = commandId.slice(FOLIUM_COMMAND_PREFIX.length).split(':');
    if (rest.length > 0 || !modId || !name || !NAME_PATTERN.test(modId) || !NAME_PATTERN.test(name)) return null;
    return { modId, name };
};

/**
 * For the settings group: the bindable mod commands in the UI language, grouped by mod (mods by
 * name, each mod's commands in registration order), and `describeMissing` for a bound id that is
 * not among them. The answer follows registrations and the end of each mod's start, so a mod that
 * finished starting without the command turns from "not enabled" to "not offered".
 */
export const useFoliumGlobalShortcutCommands = (language: string): {
    commands: FoliumGlobalShortcutCommand[];
    describeMissing: (commandId: string) => MissingFoliumGlobalShortcut | null;
} => {
    const entries = useFoliumRegistryEntries(commandsRegistry);
    const [starts, noteStart] = useReducer((count: number) => count + 1, 0);
    useEffect(() => onFoliumClientStarted(noteStart), []);

    const commands = useMemo(() => entries
        .filter(isOffered)
        .map((entry) => ({
            id: `${FOLIUM_COMMAND_PREFIX}${entry.id}`,
            modId: entry.modId,
            modName: foliumModName(entry.modId),
            title: resolveFoliumLabel(entry.def.def.label, language, entry.name),
        }))
        // Stable: within one mod the registration order stays.
        .sort((left, right) => left.modName.localeCompare(right.modName) || left.modId.localeCompare(right.modId)),
    // `starts` only invalidates: a mod's name is read when its start ends.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, language, starts]);

    const describeMissing = useCallback((commandId: string): MissingFoliumGlobalShortcut | null => {
        const parsed = parseFoliumCommandId(commandId);
        if (!parsed || commands.some((command) => command.id === commandId)) return null;
        const start = getFoliumClientStart(parsed.modId);
        return {
            ...parsed,
            modName: foliumModName(parsed.modId),
            reason: start && start.state !== 'starting' ? 'command-missing' : 'mod-inactive',
        };
    }, [commands]);

    return { commands, describeMissing };
};
