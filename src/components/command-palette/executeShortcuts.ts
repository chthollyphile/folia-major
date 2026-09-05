import type { CommandPaletteCommand } from './types';

// src/components/command-palette/executeShortcuts.ts
// Resolution for execute mode's vim-style keys. Shortcuts available in the same surface must be
// prefix-free so "typed enough to be unambiguous" is decidable without a disambiguation timer.

export type ExecuteShortcutIndex = Map<string, CommandPaletteCommand>;

export type ExecuteShortcutResolution =
    | { status: 'exact'; command: CommandPaletteCommand }
    | { status: 'prefix'; candidates: CommandPaletteCommand[] }
    | { status: 'none' };

export const normalizeExecuteShortcut = (value: string) => value.trim().toLowerCase();

// These scopes cannot exist in the same view, so their commands may intentionally share a key.
const scopesAreDisjoint = (first: CommandPaletteCommand, second: CommandPaletteCommand) => (
    (first.scope === 'lattice' && second.scope === 'player-surface')
    || (first.scope === 'player-surface' && second.scope === 'lattice')
);

/** Validates every pair that can be offered together in one execute-mode surface. */
export const assertExecuteShortcutsArePrefixFree = (commands: CommandPaletteCommand[]) => {
    const claims = commands.flatMap(command => {
        if (!command.executeShortcut) return [];
        const shortcut = normalizeExecuteShortcut(command.executeShortcut);
        if (!shortcut) {
            throw new Error(`[CommandPalette] Command "${command.id}" declares an empty executeShortcut`);
        }
        return [{ command, shortcut }];
    });

    for (let firstIndex = 0; firstIndex < claims.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < claims.length; secondIndex += 1) {
            const first = claims[firstIndex];
            const second = claims[secondIndex];
            if (scopesAreDisjoint(first.command, second.command)) continue;
            if (first.shortcut === second.shortcut) {
                throw new Error(`[CommandPalette] Commands "${first.command.id}" and "${second.command.id}" both use execute shortcut "${first.shortcut}"`);
            }
            if (second.shortcut.startsWith(first.shortcut)) {
                throw new Error(`[CommandPalette] Execute shortcut "${first.shortcut}" (${first.command.id}) is a prefix of "${second.shortcut}" (${second.command.id})`);
            }
            if (first.shortcut.startsWith(second.shortcut)) {
                throw new Error(`[CommandPalette] Execute shortcut "${second.shortcut}" (${second.command.id}) is a prefix of "${first.shortcut}" (${first.command.id})`);
            }
        }
    }

    return commands;
};

export const buildExecuteShortcutIndex = (commands: CommandPaletteCommand[]): ExecuteShortcutIndex => {
    const index: ExecuteShortcutIndex = new Map();
    commands.forEach(command => {
        if (command.executeShortcut) {
            index.set(normalizeExecuteShortcut(command.executeShortcut), command);
        }
    });
    return index;
};

export const resolveExecuteShortcut = (
    index: ExecuteShortcutIndex,
    buffer: string,
): ExecuteShortcutResolution => {
    const normalized = normalizeExecuteShortcut(buffer);
    if (!normalized) {
        return { status: 'prefix', candidates: [...index.values()] };
    }

    const exact = index.get(normalized);
    if (exact) {
        return { status: 'exact', command: exact };
    }

    const candidates = [...index.entries()]
        .filter(([shortcut]) => shortcut.startsWith(normalized))
        .map(([, command]) => command);

    return candidates.length > 0 ? { status: 'prefix', candidates } : { status: 'none' };
};
