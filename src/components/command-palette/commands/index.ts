import { assertExecuteShortcutsArePrefixFree } from '../executeShortcuts';
import type { CommandPaletteCommand } from '../types';
import { filterViewCommand } from './filterViewCommand';
import { gridCommands } from './gridCommands';
import { directoryCommands } from './directoryCommands';
import { artistCommands } from './artistCommands';
import { searchCommands } from './searchCommands';
import { playbackCommands } from './playbackCommands';
import { settingsCommands } from './settingsCommands';
import { hifiCommands } from './hifiCommands';
import { navigationCommands } from './navigationCommands';
import { panelCommands } from './panelCommands';
import { scratchpadCommands } from './scratchpadCommands';
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
        // These two open the palette itself; anything colliding with them would never fire.
        if (stroke === 's' || stroke === 'ctrl+k') {
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

/**
 * The stroke a keydown event has to produce to reach a command, spelled the way the global
 * listener spells it. `ctrl` means the platform's primary modifier, so the caller resolves that
 * before looking up.
 *
 * `assertUniqueOpenHotkeys` above builds its own key deliberately without `alt` — that is the
 * collision rule, and it stays as strict as it is. This one is the *lookup* key and does include
 * `alt`, because the listener matches on it.
 */
export const openHotkeyStroke = (stroke: { key: string; ctrl?: boolean; alt?: boolean }) => (
    `${stroke.ctrl ? 'ctrl+' : ''}${stroke.alt ? 'alt+' : ''}${stroke.key.toLowerCase()}`
);

/**
 * Replaces a `COMMAND_PALETTE_COMMANDS.find(...)` that ran on **every keystroke anywhere in the
 * app** and called `isCommandPaletteCommandEnabled` once per command to do it. The set of declared
 * hotkeys is fixed at module load, so the scan was pure waste; only the availability check has to
 * stay dynamic, and now it runs once on the single candidate instead of 125 times.
 */
const buildOpenHotkeyIndex = (commands: CommandPaletteCommand[]) => {
    const index = new Map<string, CommandPaletteCommand>();
    commands.forEach(command => {
        if (command.openHotkey) {
            index.set(openHotkeyStroke(command.openHotkey), command);
        }
    });
    return index;
};

export const ALL_COMMAND_PALETTE_COMMANDS: CommandPaletteCommand[] = assertExecuteShortcutsArePrefixFree(assertUniqueOpenHotkeys(assertUniqueCommandIds([
    filterViewCommand,
    ...gridCommands,
    ...directoryCommands,
    ...artistCommands,
    ...searchCommands,
    ...playbackCommands,
    ...settingsCommands,
    ...hifiCommands,
    ...navigationCommands,
    ...panelCommands,
    ...scratchpadCommands,
    ...modsCommands,
    ...visualizerCommands,
])));

export const OPEN_HOTKEY_INDEX = buildOpenHotkeyIndex(ALL_COMMAND_PALETTE_COMMANDS);


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
