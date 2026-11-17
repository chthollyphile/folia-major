import type { CommandPaletteCommand } from './types';

// src/components/command-palette/pinnedCommandPreferences.ts
// Normalizes and persists the three positional command palette shortcuts.

export type PinnedCommandIds = [
    string | null,
    string | null,
    string | null,
];

export const PINNED_COMMANDS_STORAGE_KEY = 'command_palette_pinned_commands_v1';
export const DEFAULT_PINNED_COMMAND_IDS: PinnedCommandIds = [
    'playback-prev',
    'playback-next',
    'panel-queue',
];

const cloneDefaults = (): PinnedCommandIds => [...DEFAULT_PINNED_COMMAND_IDS];

export const normalizePinnedCommandIds = (
    value: unknown,
    fallback: PinnedCommandIds = [null, null, null],
): PinnedCommandIds => {
    if (!Array.isArray(value)) {
        return [...fallback];
    }

    const seen = new Set<string>();
    const normalized = Array.from({ length: 3 }, (_, index) => {
        const commandId = value[index];
        if (typeof commandId !== 'string' || commandId.length === 0 || seen.has(commandId)) {
            return null;
        }
        seen.add(commandId);
        return commandId;
    });

    return normalized as PinnedCommandIds;
};

export const readPinnedCommandIds = (): PinnedCommandIds => {
    if (typeof window === 'undefined') {
        return cloneDefaults();
    }

    const storedValue = window.localStorage.getItem(PINNED_COMMANDS_STORAGE_KEY);
    if (storedValue === null) {
        return cloneDefaults();
    }

    try {
        return normalizePinnedCommandIds(JSON.parse(storedValue), cloneDefaults());
    } catch {
        return cloneDefaults();
    }
};

export const writePinnedCommandIds = (commandIds: PinnedCommandIds) => {
    if (typeof window === 'undefined') {
        return;
    }
    window.localStorage.setItem(
        PINNED_COMMANDS_STORAGE_KEY,
        JSON.stringify(normalizePinnedCommandIds(commandIds)),
    );
};

export const resolvePinnedCommandSlots = (
    commandIds: PinnedCommandIds,
    availableCommands: CommandPaletteCommand[],
) => commandIds.map(commandId => (
    commandId
        ? availableCommands.find(command => command.id === commandId) ?? null
        : null
));
