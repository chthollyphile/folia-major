import { assertExecuteShortcutsArePrefixFree } from '../executeShortcuts';
import type { CommandPaletteCommand } from '../types';
import { searchCommands } from './searchCommands';
import { playbackCommands } from './playbackCommands';
import { settingsCommands } from './settingsCommands';
import { navigationCommands } from './navigationCommands';
import { panelCommands } from './panelCommands';
import { modsCommands } from './modsCommands';
import { visualizerCommands } from './visualizerCommands';

// src/components/command-palette/commands/index.ts
// The one place that decides cross-group ordering; each group file owns its internal order.

const assertUniqueCommandIds = (commands: CommandPaletteCommand[]) => {
    const seen = new Set<string>();
    commands.forEach(command => {
        if (seen.has(command.id)) {
            throw new Error(`[CommandPalette] Duplicate command id "${command.id}"`);
        }
        seen.add(command.id);
    });
    return commands;
};

const assertUniqueOpenHotkeys = (commands: CommandPaletteCommand[]) => {
    const seen = new Map<string, string>();
    commands.forEach(command => {
        if (!command.openHotkey) {
            return;
        }
        const stroke = `${command.openHotkey.ctrl ? 'ctrl+' : ''}${command.openHotkey.key.toLowerCase()}`;
        // `s` opens the palette itself; anything colliding with it would never fire.
        if (stroke === 's') {
            throw new Error(`[CommandPalette] Command "${command.id}" claims the palette's own open key`);
        }
        const owner = seen.get(stroke);
        if (owner) {
            throw new Error(`[CommandPalette] Commands "${owner}" and "${command.id}" both claim ${stroke}`);
        }
        seen.set(stroke, command.id);
    });
    return commands;
};

export const ALL_COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = assertExecuteShortcutsArePrefixFree(assertUniqueOpenHotkeys(assertUniqueCommandIds([
    ...searchCommands,
    ...playbackCommands,
    ...settingsCommands,
    ...navigationCommands,
    ...panelCommands,
    ...modsCommands,
    ...visualizerCommands,
])));

// What the palette shows before anything is typed, after recently used commands. Declared so
// that inserting a command into a group file cannot silently change the opening screen.
// Play and Pause are deliberately absent: each is a no-op in the other state, so the opening
// screen would always show one dead entry.
export const DEFAULT_LANDING_COMMAND_IDS = [
    'queue',
    'search-current',
    'playback-volume',
    'playback-next',
    'playback-prev',
    'playback-shuffle',
    'playback-loop',
    'panel-queue',
    'settings-options',
    'settings-appearance',
];
