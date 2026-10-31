import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import {
    commandForGlobalShortcut,
    formatGlobalShortcutPart,
    GLOBAL_SHORTCUT_COMMAND_IDS,
    globalShortcutKeyLabels,
    isGlobalShortcutCommand,
    isGlobalShortcutKey,
    parseGlobalShortcutChord,
    PORTAL_GLOBAL_SHORTCUTS,
    readGlobalShortcutChord,
    readGlobalShortcutKey,
    refuseGlobalShortcutChord,
    resolveActiveGlobalShortcuts,
    toGlobalShortcutAccelerator,
} from '../../../src/components/command-palette/globalShortcuts/globalShortcutRules';
import {
    DEFAULT_GLOBAL_SHORTCUT_MODIFIERS,
    type GlobalShortcutBinding,
    type GlobalShortcutModifier,
} from '../../../src/stores/useInteractionSettingsStore';
import { isMacPlatform } from '../../../src/utils/platform';

// test/unit/command-palette/globalShortcutRules.test.ts
// Which system-wide shortcuts the desktop app registers: playback commands only, any combination of
// modifiers with at least one held, letters, digits, F1–F24, Space and the navigation keys, never
// GNOME's Ctrl+Alt+Shift+R, never one combination twice. Mod commands (Folium 1.7 `globalShortcut`)
// come in as the set of ids registered right now.

const TRIO: GlobalShortcutModifier[] = [...DEFAULT_GLOBAL_SHORTCUT_MODIFIERS];

const empty = (): GlobalShortcutBinding[] => Array.from({ length: 5 }, () => ({ key: null, modifiers: [...TRIO], commandId: null }));

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

describe('isGlobalShortcutKey', () => {
    it('takes letters, digits, function keys, Space and the navigation keys', () => {
        for (const key of ['p', '7', 'f1', 'f12', 'f24', 'space', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'insert', 'delete', 'backspace', 'tab', 'enter']) {
            expect(isGlobalShortcutKey(key), key).toBe(true);
        }
    });

    it('leaves out anything else', () => {
        for (const key of ['f25', 'escape', '!', '', 'spacebar']) {
            expect(isGlobalShortcutKey(key), key).toBe(false);
        }
    });
});

describe('refuseGlobalShortcutChord', () => {
    it('takes a key held with at least one modifier', () => {
        expect(refuseGlobalShortcutChord('p', ['control'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('space', TRIO, 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('up', ['alt', 'shift'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('f4', ['meta'], 0, empty())).toBeNull();
    });

    it('asks for a modifier and names keys that cannot carry one', () => {
        expect(refuseGlobalShortcutChord('p', [], 0, empty())).toBe('needs-modifier');
        expect(refuseGlobalShortcutChord('space', [], 0, empty())).toBe('needs-modifier');
        expect(refuseGlobalShortcutChord('escape', TRIO, 0, empty())).toBe('unsupported-key');
    });

    it('refuses GNOME’s screencast combination only', () => {
        expect(refuseGlobalShortcutChord('r', TRIO, 0, empty())).toBe('reserved');
        expect(refuseGlobalShortcutChord('r', ['control', 'alt'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('r', ['control', 'alt', 'meta'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('p', TRIO, 0, empty())).toBeNull();
    });

    it('refuses a combination another slot holds, and only that one', () => {
        const bindings = empty();
        bindings[1] = { key: 'p', modifiers: ['control', 'shift'], commandId: 'playback-toggle' };
        expect(refuseGlobalShortcutChord('p', ['shift', 'control'], 0, bindings)).toBe('duplicate');
        expect(refuseGlobalShortcutChord('p', ['control', 'shift'], 1, bindings)).toBeNull();
        expect(refuseGlobalShortcutChord('p', TRIO, 0, bindings)).toBeNull();
    });
});

describe('readGlobalShortcutKey', () => {
    it('keeps a letter as the layout means it', () => {
        expect(readGlobalShortcutKey({ key: 'A', code: 'KeyQ' })).toBe('a');
    });

    it('reads a shifted digit by its position', () => {
        expect(readGlobalShortcutKey({ key: '!', code: 'Digit1' })).toBe('1');
    });

    it('names the keys that have a name of their own', () => {
        expect(readGlobalShortcutKey({ key: ' ', code: 'Space' })).toBe('space');
        expect(readGlobalShortcutKey({ key: 'ArrowUp', code: 'ArrowUp' })).toBe('up');
        expect(readGlobalShortcutKey({ key: 'PageDown', code: 'PageDown' })).toBe('pagedown');
        expect(readGlobalShortcutKey({ key: 'F4', code: 'F4' })).toBe('f4');
    });

    it('falls back to the physical key when a modifier changes what the press says', () => {
        // Option+Space arrives as a no-break space on macOS, Option+A as å.
        expect(readGlobalShortcutKey({ key: '\u00a0', code: 'Space' })).toBe('space');
        expect(readGlobalShortcutKey({ key: 'å', code: 'KeyA' })).toBe('a');
        expect(readGlobalShortcutKey({ key: 'Enter', code: 'NumpadEnter' })).toBe('enter');
    });
});

describe('readGlobalShortcutChord', () => {
    it('reads the held modifiers with the key, in the order they are shown', () => {
        const press = (held: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>>) => readGlobalShortcutChord({
            key: 'P', code: 'KeyP', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...held,
        });
        expect(press({})).toBe('p');
        expect(press({ ctrlKey: true, shiftKey: true })).toBe('control+shift+p');
        expect(press({ metaKey: true, ctrlKey: true })).toBe('control+meta+p');
    });

    it('reads a key with no modifiers as the key alone, for the field to refuse it', () => {
        expect(readGlobalShortcutChord({ key: ' ', code: 'Space', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false })).toBe('space');
    });
});

describe('parseGlobalShortcutChord', () => {
    it('splits a combination into its modifiers and its key', () => {
        expect(parseGlobalShortcutChord('control+shift+space')).toEqual({ modifiers: ['control', 'shift'], key: 'space' });
        expect(parseGlobalShortcutChord('p')).toEqual({ modifiers: [], key: 'p' });
    });

    it('puts the modifiers in the shown order and keeps only known ones', () => {
        expect(parseGlobalShortcutChord('meta+shift+control+up')).toEqual({ modifiers: ['control', 'shift', 'meta'], key: 'up' });
    });
});

describe('the caps the field shows', () => {
    it('writes every part the way the keyboard labels it', () => {
        expect(formatGlobalShortcutPart('shift')).toBe('Shift');
        expect(formatGlobalShortcutPart('control')).toBe(isMacPlatform ? 'Control' : 'Ctrl');
        expect(formatGlobalShortcutPart('space')).toBe('Space');
        expect(formatGlobalShortcutPart('pageup')).toBe('PageUp');
        expect(formatGlobalShortcutPart('enter')).toBe('Enter');
        expect(formatGlobalShortcutPart('f4')).toBe('F4');
        expect(formatGlobalShortcutPart('p')).toBe('P');
    });

    it('writes a whole accelerator as one cap per key', () => {
        expect(globalShortcutKeyLabels('Control+Alt+Space')).toEqual([isMacPlatform ? 'Control' : 'Ctrl', 'Alt', 'Space']);
    });
});

describe('toGlobalShortcutAccelerator', () => {
    it('keeps the trio it has always used when no modifiers are given', () => {
        expect(toGlobalShortcutAccelerator('p')).toBe('Control+Alt+Shift+P');
    });

    it('writes the chosen modifiers in Electron’s names', () => {
        expect(toGlobalShortcutAccelerator('space', ['control'])).toBe('Control+Space');
        expect(toGlobalShortcutAccelerator('up', ['alt', 'meta'])).toBe('Alt+Super+Up');
        expect(toGlobalShortcutAccelerator('f4', ['shift'])).toBe('Shift+F4');
        expect(toGlobalShortcutAccelerator('enter', ['control', 'alt'])).toBe('Control+Alt+Return');
    });
});

describe('resolveActiveGlobalShortcuts', () => {
    const bind = (key: string, commandId: string, modifiers: GlobalShortcutModifier[] = [...TRIO]): GlobalShortcutBinding => ({ key, modifiers, commandId });

    it('registers complete, legal bindings with their slot', () => {
        const bindings = empty();
        bindings[0] = bind('p', 'playback-toggle');
        bindings[3] = bind('2', 'playback-volume-up', ['control', 'meta']);
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+P', commandId: 'playback-toggle' },
            { slot: 3, accelerator: 'Control+Super+2', commandId: 'playback-volume-up' },
        ]);
    });

    it('registers Space, arrows and function keys', () => {
        const bindings = empty();
        bindings[0] = bind('space', 'playback-toggle', ['control']);
        bindings[1] = bind('up', 'playback-next', ['alt']);
        bindings[2] = bind('f5', 'playback-mute', ['shift']);
        expect(resolveActiveGlobalShortcuts(bindings).map(shortcut => shortcut.accelerator)).toEqual([
            'Control+Space',
            'Alt+Up',
            'Shift+F5',
        ]);
    });

    it('leaves out half-filled slots, a key with no modifier, R, commands off the list, and a repeated combination', () => {
        const bindings = empty();
        bindings[0] = bind('p', '');
        bindings[1] = bind('space', 'playback-next', []);
        bindings[2] = bind('r', 'playback-prev');
        bindings[3] = bind('n', 'settings-open');
        bindings[4] = bind('m', 'playback-mute');
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 4, accelerator: 'Control+Alt+Shift+M', commandId: 'playback-mute' },
        ]);

        // The earlier slot of two holding one combination is the one that stays.
        bindings[0] = bind('m', 'playback-loop');
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+M', commandId: 'playback-loop' },
        ]);
    });

    it('keeps two slots that hold the same key with different modifiers', () => {
        const bindings = empty();
        bindings[0] = bind('p', 'playback-toggle', ['control']);
        bindings[1] = bind('p', 'playback-next', ['alt']);
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+P', commandId: 'playback-toggle' },
            { slot: 1, accelerator: 'Alt+P', commandId: 'playback-next' },
        ]);
    });
});

describe('mod commands', () => {
    const bind = (key: string, commandId: string, modifiers: GlobalShortcutModifier[] = [...TRIO]): GlobalShortcutBinding => ({ key, modifiers, commandId });

    it('counts a mod command only while its id is in the registered set', () => {
        expect(isGlobalShortcutCommand(MOD_PING, new Set([MOD_PING]))).toBe(true);
        expect(isGlobalShortcutCommand(MOD_PING, new Set())).toBe(false);
        expect(isGlobalShortcutCommand('playback-next', new Set())).toBe(true);
    });

    it('registers a bound mod command that is registered, and not one that is not', () => {
        const bindings = empty();
        bindings[0] = bind('k', MOD_PING);
        // Unregistered, or registered with params or without the flag: not in the set either way.
        bindings[1] = bind('j', MOD_EXPORT);
        bindings[2] = bind('p', 'playback-toggle');
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]))).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
            { slot: 2, accelerator: 'Control+Alt+Shift+P', commandId: 'playback-toggle' },
        ]);
        // Without the set (a caller that knows no mods) the mod slots stay quiet.
        expect(resolveActiveGlobalShortcuts(bindings).map(shortcut => shortcut.commandId)).toEqual(['playback-toggle']);
    });

    it('keeps the binding while the mod is off and registers it again when it is back', () => {
        const bindings = empty();
        bindings[0] = bind('k', MOD_PING);
        const before = JSON.stringify(bindings);
        expect(resolveActiveGlobalShortcuts(bindings, new Set())).toEqual([]);
        expect(JSON.stringify(bindings)).toBe(before);
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]))).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
        ]);
    });

    it('applies the combination rules to mod commands the same way', () => {
        const bindings = empty();
        bindings[1] = bind('k', MOD_PING);
        expect(refuseGlobalShortcutChord('k', TRIO, 0, bindings)).toBe('duplicate');
        expect(refuseGlobalShortcutChord('r', TRIO, 0, bindings)).toBe('reserved');
        bindings[2] = bind('k', 'playback-next');
        bindings[3] = bind('r', MOD_EXPORT);
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING, MOD_EXPORT]))).toEqual([
            { slot: 1, accelerator: 'Control+Alt+Shift+K', commandId: MOD_PING },
        ]);
    });

    it('does not run a mod command that was unregistered after the keys were resolved', () => {
        const bindings = empty();
        bindings[0] = bind('k', MOD_PING);
        const active = resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING]));
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+K', new Set([MOD_PING]))).toBe(MOD_PING);
        expect(commandForGlobalShortcut(active, 'Control+Alt+Shift+K', new Set())).toBeNull();
    });
});

describe('commandForGlobalShortcut', () => {
    it('maps a pressed accelerator back to its command, or to nothing', () => {
        const bindings = empty();
        bindings[0] = { key: 'p', modifiers: ['control'], commandId: 'playback-toggle' };
        const active = resolveActiveGlobalShortcuts(bindings);
        expect(commandForGlobalShortcut(active, 'Control+P')).toBe('playback-toggle');
        expect(commandForGlobalShortcut(active, 'Control+N')).toBeNull();
    });
});

describe('PORTAL_GLOBAL_SHORTCUTS', () => {
    it('offers every bindable command once, each on its own legal combination', () => {
        expect(PORTAL_GLOBAL_SHORTCUTS.map(shortcut => shortcut.commandId).sort()).toEqual([...GLOBAL_SHORTCUT_COMMAND_IDS].sort());
        const accelerators = PORTAL_GLOBAL_SHORTCUTS.map(shortcut => shortcut.accelerator);
        expect(new Set(accelerators).size).toBe(accelerators.length);
        accelerators.forEach((accelerator, slot) => {
            const { key, modifiers } = parseGlobalShortcutChord(accelerator.toLowerCase());
            expect(refuseGlobalShortcutChord(key, modifiers, slot, []), accelerator).toBeNull();
        });
    });
});
