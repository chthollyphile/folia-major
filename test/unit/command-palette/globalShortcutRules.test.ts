import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import {
    commandForGlobalShortcut,
    GLOBAL_SHORTCUT_COMMAND_IDS,
    isGlobalShortcutCommand,
    PORTAL_GLOBAL_SHORTCUTS,
    readGlobalShortcutKey,
    refuseGlobalShortcutKey,
    resolveActiveGlobalShortcuts,
    toGlobalShortcutAccelerator,
} from '../../../src/components/command-palette/globalShortcuts/globalShortcutRules';

// test/unit/command-palette/globalShortcutRules.test.ts
// Which system-wide shortcuts the desktop app registers: playback commands only, Ctrl+Alt+Shift
// plus a letter or digit, never GNOME's R, never one key twice. Mod commands (Folium 1.7
// `globalShortcut`) come in as the set of ids registered right now.

const empty = () => Array.from({ length: 5 }, () => ({ key: null as string | null, commandId: null as string | null }));

const MOD_PING = 'folium:sample:ping';
const MOD_EXPORT = 'folium:sample:export';

describe('GLOBAL_SHORTCUT_COMMAND_IDS', () => {
    it('names only registered playback commands that run without input or a surface', () => {
        for (const id of GLOBAL_SHORTCUT_COMMAND_IDS) {
            const command = COMMAND_PALETTE_COMMANDS.find(entry => entry.id === id);
            expect(command, id).toBeDefined();
            expect(command?.group, id).toBe('playback');
            expect(command?.scope, id).toBeUndefined();
            expect(command?.requiresInput, id).toBeFalsy();
            expect(command?.surface, id).toBeUndefined();
        }
    });

    it('leaves out like, which toggles where a background press cannot see the result', () => {
        expect(GLOBAL_SHORTCUT_COMMAND_IDS).not.toContain('playback-like');
    });
});

describe('refuseGlobalShortcutKey', () => {
    it('takes letters and digits', () => {
        expect(refuseGlobalShortcutKey('p', 0, empty())).toBeNull();
        expect(refuseGlobalShortcutKey('7', 0, empty())).toBeNull();
    });

    it('refuses anything else, R, and a key another slot holds', () => {
        const bindings = empty();
        bindings[1] = { key: 'p', commandId: 'playback-toggle' };
        expect(refuseGlobalShortcutKey('f4', 0, bindings)).toBe('not-letter-or-digit');
        expect(refuseGlobalShortcutKey(' ', 0, bindings)).toBe('not-letter-or-digit');
        expect(refuseGlobalShortcutKey('r', 0, bindings)).toBe('reserved');
        expect(refuseGlobalShortcutKey('p', 0, bindings)).toBe('duplicate');
        // Its own slot is not a duplicate of itself.
        expect(refuseGlobalShortcutKey('p', 1, bindings)).toBeNull();
    });
});

describe('readGlobalShortcutKey', () => {
    it('keeps a letter as the layout means it', () => {
        expect(readGlobalShortcutKey({ key: 'A', code: 'KeyQ' })).toBe('a');
    });

    it('reads a shifted digit by its position', () => {
        expect(readGlobalShortcutKey({ key: '!', code: 'Digit1' })).toBe('1');
    });

    it('passes other keys through for the refusal to name', () => {
        expect(readGlobalShortcutKey({ key: 'F4', code: 'F4' })).toBe('f4');
    });
});

describe('resolveActiveGlobalShortcuts', () => {
    it('registers complete, legal bindings with their slot', () => {
        const bindings = empty();
        bindings[0] = { key: 'p', commandId: 'playback-toggle' };
        bindings[3] = { key: '2', commandId: 'playback-volume-up' };
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+P', commandId: 'playback-toggle' },
            { slot: 3, accelerator: 'Control+Alt+Shift+2', commandId: 'playback-volume-up' },
        ]);
    });

    it('leaves out half-filled slots, R, commands off the list, and a repeated key', () => {
        const bindings = empty();
        bindings[0] = { key: 'p', commandId: null };
        bindings[1] = { key: 'r', commandId: 'playback-next' };
        bindings[2] = { key: 'n', commandId: 'settings-open' };
        bindings[3] = { key: 'm', commandId: 'playback-mute' };
        bindings[4] = { key: 'm', commandId: 'playback-loop' };
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 3, accelerator: toGlobalShortcutAccelerator('m'), commandId: 'playback-mute' },
        ]);
    });
});

describe('mod commands', () => {
    it('counts a mod command only while its id is in the registered set', () => {
        expect(isGlobalShortcutCommand(MOD_PING, new Set([MOD_PING]))).toBe(true);
        expect(isGlobalShortcutCommand(MOD_PING, new Set())).toBe(false);
        expect(isGlobalShortcutCommand('playback-next', new Set())).toBe(true);
    });

    it('registers a bound mod command that is registered, and not one that is not', () => {
        const bindings = empty();
        bindings[0] = { key: 'k', commandId: MOD_PING };
        // Unregistered, or registered with params or without the flag: not in the set either way.
        bindings[1] = { key: 'j', commandId: MOD_EXPORT };
        bindings[2] = { key: 'p', commandId: 'playback-toggle' };
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]))).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
            { slot: 2, accelerator: 'Control+Alt+Shift+P', commandId: 'playback-toggle' },
        ]);
        // Without the set (a caller that knows no mods) the mod slots stay quiet.
        expect(resolveActiveGlobalShortcuts(bindings).map(shortcut => shortcut.commandId)).toEqual(['playback-toggle']);
    });

    it('keeps the binding while the mod is off and registers it again when it is back', () => {
        const bindings = empty();
        bindings[0] = { key: 'k', commandId: MOD_PING };
        const before = JSON.stringify(bindings);
        expect(resolveActiveGlobalShortcuts(bindings, new Set())).toEqual([]);
        expect(JSON.stringify(bindings)).toBe(before);
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]))).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
        ]);
    });

    it('applies the key rules to mod commands the same way', () => {
        const bindings = empty();
        bindings[1] = { key: 'k', commandId: MOD_PING };
        expect(refuseGlobalShortcutKey('k', 0, bindings)).toBe('duplicate');
        expect(refuseGlobalShortcutKey('r', 0, bindings)).toBe('reserved');
        bindings[2] = { key: 'k', commandId: 'playback-next' };
        bindings[3] = { key: 'r', commandId: MOD_EXPORT };
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING, MOD_EXPORT]))).toEqual([
            { slot: 1, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
        ]);
    });

    it('does not run a mod command that was unregistered after the keys were resolved', () => {
        const bindings = empty();
        bindings[0] = { key: 'k', commandId: MOD_PING };
        const active = resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]));
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+K', new Set([MOD_PING]))).toBe(MOD_PING);
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+K', new Set())).toBeNull();
    });
});

describe('commandForGlobalShortcut', () => {
    it('maps a pressed accelerator back to its command, or to nothing', () => {
        const bindings = empty();
        bindings[0] = { key: 'p', commandId: 'playback-toggle' };
        const active = resolveActiveGlobalShortcuts(bindings);
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+P')).toBe('playback-toggle');
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+N')).toBeNull();
    });
});

describe('PORTAL_GLOBAL_SHORTCUTS', () => {
    it('offers every bindable command once, each on its own legal key', () => {
        expect(PORTAL_GLOBAL_SHORTCUTS.map(shortcut => shortcut.commandId).sort()).toEqual([...GLOBAL_SHORTCUT_COMMAND_IDS].sort());
        const keys = PORTAL_GLOBAL_SHORTCUTS.map(shortcut => shortcut.accelerator.slice(-1).toLowerCase());
        expect(new Set(keys).size).toBe(keys.length);
        keys.forEach((key, slot) => expect(refuseGlobalShortcutKey(key, slot, []), key).toBeNull());
    });
});
