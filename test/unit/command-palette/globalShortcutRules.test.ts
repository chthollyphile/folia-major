import { describe, expect, it } from 'vitest';
import { COMMAND_PALETTE_COMMANDS } from '../../../src/components/command-palette/commandRegistry';
import {
    commandForGlobalShortcut,
    formatGlobalShortcutPart,
    GLOBAL_SHORTCUT_COMMAND_IDS,
    globalShortcutKeyLabels,
    globalShortcutWarning,
    isDefaultGlobalShortcutCombination,
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
// Which system-wide shortcuts the desktop app registers: playback commands only, modifiers of the
// listener's choice but never none, Shift alone, one modifier with anything but a function key, the sets
// that type characters, or a combination a desktop holds; letters, digits, F1–F24, Space and the
// navigation keys; never one combination twice. Mod commands (Folium 1.7 `globalShortcut`) come in as
// the set of ids registered right now.

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
    it('takes two or more modifiers, or one modifier with a function key', () => {
        expect(refuseGlobalShortcutChord('p', ['control', 'shift'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('space', TRIO, 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('space', ['control', 'shift'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('up', ['control', 'alt', 'shift'], 0, empty(), 'windows')).toBeNull();
        expect(refuseGlobalShortcutChord('space', ['control', 'alt'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('p', ['control', 'alt', 'meta'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('f9', ['control'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('f9', ['alt'], 0, empty())).toBeNull();
    });

    it('asks for a modifier and names keys that cannot carry one', () => {
        expect(refuseGlobalShortcutChord('p', [], 0, empty())).toBe('needs-modifier');
        expect(refuseGlobalShortcutChord('space', [], 0, empty())).toBe('needs-modifier');
        expect(refuseGlobalShortcutChord('escape', TRIO, 0, empty())).toBe('unsupported-key');
    });

    it('refuses Shift alone with any key: that is typing and selecting', () => {
        for (const key of ['a', '1', 'up', 'space', 'f10']) {
            expect(refuseGlobalShortcutChord(key, ['shift'], 0, empty()), key).toBe('shift-only');
        }
    });

    it('refuses one modifier with anything but a function key: copy, paste, Alt+Tab, Win+L, Cmd+Space', () => {
        expect(refuseGlobalShortcutChord('c', ['control'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('v', ['meta'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('tab', ['alt'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('l', ['meta'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('space', ['meta'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('space', ['control'], 0, empty())).toBe('single-modifier');
        expect(refuseGlobalShortcutChord('left', ['alt'], 0, empty())).toBe('single-modifier');
    });

    it('refuses the modifier sets that type characters with a letter or digit, and only with those', () => {
        // Option and Option+Shift on macOS.
        expect(refuseGlobalShortcutChord('k', ['alt', 'shift'], 0, empty())).toBe('types-character');
        expect(refuseGlobalShortcutChord('2', ['alt', 'shift'], 0, empty())).toBe('types-character');
        // A named key types nothing with them.
        expect(refuseGlobalShortcutChord('space', ['alt', 'shift'], 0, empty())).toBeNull();
        // Other pairs, and the trio, keep their letters.
        expect(refuseGlobalShortcutChord('e', ['control', 'shift'], 0, empty())).toBeNull();
        expect(refuseGlobalShortcutChord('e', TRIO, 0, empty())).toBeNull();
    });

    it('takes Ctrl+Alt with a letter or digit, the music players’ default (Ctrl+Alt+P)', () => {
        for (const system of ['windows', 'mac', 'linux'] as const) {
            expect(refuseGlobalShortcutChord('p', ['control', 'alt'], 0, empty(), system), system).toBeNull();
            expect(refuseGlobalShortcutChord('2', ['control', 'alt'], 0, empty(), system), system).toBeNull();
        }
        // Except what a Linux desktop holds: Ubuntu's terminal and lock screen.
        expect(refuseGlobalShortcutChord('t', ['control', 'alt'], 0, empty(), 'linux')).toBe('reserved');
        expect(refuseGlobalShortcutChord('t', ['control', 'alt'], 0, empty(), 'windows')).toBeNull();
    });

    it('refuses Shift and Ctrl or Command with a caret key: selecting and deleting text', () => {
        expect(refuseGlobalShortcutChord('left', ['control', 'shift'], 0, empty())).toBe('edits-text');
        expect(refuseGlobalShortcutChord('end', ['control', 'shift'], 0, empty())).toBe('edits-text');
        expect(refuseGlobalShortcutChord('delete', ['control', 'shift'], 0, empty())).toBe('edits-text');
        expect(refuseGlobalShortcutChord('left', ['meta', 'shift'], 0, empty(), 'mac')).toBe('edits-text');
        // Alt+Shift+光标键不是多数程序里的编辑组合，留给想绑它的人。
        expect(refuseGlobalShortcutChord('down', ['alt', 'shift'], 0, empty(), 'windows')).toBeNull();
        expect(refuseGlobalShortcutChord('left', ['alt', 'shift'], 0, empty(), 'linux')).toBeNull();
        // macOS: Option+Shift selects by word and paragraph in every text field.
        expect(refuseGlobalShortcutChord('left', ['alt', 'shift'], 0, empty(), 'mac')).toBe('edits-text');
        expect(refuseGlobalShortcutChord('down', ['alt', 'shift'], 0, empty(), 'mac')).toBe('edits-text');
        expect(refuseGlobalShortcutChord('delete', ['alt', 'shift'], 0, empty(), 'mac')).toBe('edits-text');
        expect(refuseGlobalShortcutChord('left', TRIO, 0, empty(), 'windows')).toBeNull();
    });

    it('refuses Tab with fewer than three modifiers: window, app and tab switching', () => {
        expect(refuseGlobalShortcutChord('tab', ['alt', 'shift'], 0, empty())).toBe('reserved');
        expect(refuseGlobalShortcutChord('tab', ['control', 'alt'], 0, empty())).toBe('reserved');
        expect(refuseGlobalShortcutChord('tab', ['control', 'shift'], 0, empty())).toBe('reserved');
        expect(refuseGlobalShortcutChord('tab', TRIO, 0, empty())).toBeNull();
    });

    it('asks for three modifiers with Win/Command', () => {
        // Windows: snipping, virtual desktops, Game Bar, moving windows; macOS: screenshots, Dock, lock.
        expect(refuseGlobalShortcutChord('s', ['shift', 'meta'], 0, empty())).toBe('meta-needs-more');
        expect(refuseGlobalShortcutChord('right', ['control', 'meta'], 0, empty())).toBe('meta-needs-more');
        expect(refuseGlobalShortcutChord('r', ['alt', 'meta'], 0, empty())).toBe('meta-needs-more');
        expect(refuseGlobalShortcutChord('4', ['shift', 'meta'], 0, empty())).toBe('meta-needs-more');
        expect(refuseGlobalShortcutChord('tab', ['shift', 'meta'], 0, empty())).toBe('reserved');
        expect(refuseGlobalShortcutChord('f9', ['meta'], 0, empty())).toBe('meta-needs-more');
        expect(refuseGlobalShortcutChord('p', ['control', 'alt', 'meta'], 0, empty())).toBeNull();
    });

    it('refuses the combinations every system holds, and the editing keys programs share', () => {
        for (const system of ['windows', 'mac', 'linux'] as const) {
            expect(refuseGlobalShortcutChord('f4', ['alt'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('f4', ['control'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('delete', ['control', 'alt'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('c', ['control', 'shift'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('v', ['control', 'shift'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('z', ['control', 'shift'], 0, empty(), system), system).toBe('reserved');
            expect(refuseGlobalShortcutChord('p', ['control', 'shift'], 0, empty(), system), system).toBeNull();
            expect(refuseGlobalShortcutChord('p', TRIO, 0, empty(), system), system).toBeNull();
        }
    });

    it('refuses the Linux desktops’ combinations on Linux only', () => {
        const linux = (key: string, modifiers: GlobalShortcutModifier[]) => refuseGlobalShortcutChord(key, modifiers, 0, empty(), 'linux');
        const windows = (key: string, modifiers: GlobalShortcutModifier[]) => refuseGlobalShortcutChord(key, modifiers, 0, empty(), 'windows');
        for (const [key, modifiers] of [
            ['r', TRIO], // GNOME screencast
            ['f2', ['alt']], // run dialog
            ['right', ['control', 'alt']], // switch workspace
            ['left', TRIO], // move the window to the next workspace
            ['f1', ['control', 'alt']], // text console
            ['f12', ['control', 'alt']],
        ] as Array<[string, GlobalShortcutModifier[]]>) {
            expect(linux(key, modifiers), `${modifiers.join('+')}+${key}`).toBe('reserved');
            expect(windows(key, modifiers), `${modifiers.join('+')}+${key}`).toBeNull();
        }
        expect(linux('l', ['control', 'alt'])).toBe('reserved');
        expect(windows('l', ['control', 'alt'])).toBeNull();
        // The console keys end at F12.
        expect(linux('f13', ['control', 'alt'])).toBeNull();
        expect(linux('p', ['control', 'alt', 'meta'])).toBeNull();
    });

    it('refuses the macOS and Windows combinations on their own system only', () => {
        expect(refuseGlobalShortcutChord('f2', ['control'], 0, empty(), 'mac')).toBe('reserved');
        expect(refuseGlobalShortcutChord('f2', ['control'], 0, empty(), 'windows')).toBeNull();
        expect(refuseGlobalShortcutChord('3', ['control', 'shift', 'meta'], 0, empty(), 'mac')).toBe('reserved');
        expect(refuseGlobalShortcutChord('3', ['control', 'shift', 'meta'], 0, empty(), 'windows')).toBeNull();
        expect(refuseGlobalShortcutChord('b', ['control', 'shift', 'meta'], 0, empty(), 'windows')).toBe('reserved');
        expect(refuseGlobalShortcutChord('b', ['control', 'shift', 'meta'], 0, empty(), 'mac')).toBeNull();
    });

    it('tells the default trio with a letter or digit from anything else, whatever order it comes in', () => {
        expect(isDefaultGlobalShortcutCombination('p', ['shift', 'alt', 'control'])).toBe(true);
        expect(isDefaultGlobalShortcutCombination('7', TRIO)).toBe(true);
        expect(isDefaultGlobalShortcutCombination('p', ['control', 'shift'])).toBe(false);
        expect(isDefaultGlobalShortcutCombination('p', ['control', 'alt', 'shift', 'meta'])).toBe(false);
        // The trio with an arrow is how some desktops move windows between workspaces.
        expect(isDefaultGlobalShortcutCombination('right', TRIO)).toBe(false);
        expect(isDefaultGlobalShortcutCombination('f5', TRIO)).toBe(false);
    });

    it('warns about AltGr for Ctrl+Alt with a letter or digit on Windows, and about other programs otherwise', () => {
        expect(globalShortcutWarning('p', ['control', 'alt'], 'windows')).toBe('altgr');
        expect(globalShortcutWarning('7', ['alt', 'control'], 'windows')).toBe('altgr');
        // AltGr is its own key on macOS and Linux; a named key types nothing.
        expect(globalShortcutWarning('p', ['control', 'alt'], 'mac')).toBe('custom');
        expect(globalShortcutWarning('p', ['control', 'alt'], 'linux')).toBe('custom');
        expect(globalShortcutWarning('right', ['control', 'alt'], 'windows')).toBe('custom');
        expect(globalShortcutWarning('p', ['control', 'shift'], 'windows')).toBe('custom');
        // The default trio with a letter or digit says nothing.
        expect(globalShortcutWarning('p', TRIO, 'windows')).toBeNull();
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
        bindings[3] = bind('2', 'playback-volume-up', ['control', 'alt', 'meta']);
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+Alt+Shift+P', commandId: 'playback-toggle' },
            { slot: 3, accelerator: 'Control+Alt+Super+2', commandId: 'playback-volume-up' },
        ]);
    });

    it('registers Space, arrows and function keys', () => {
        const bindings = empty();
        bindings[0] = bind('space', 'playback-toggle', ['control', 'shift']);
        bindings[1] = bind('up', 'playback-next', ['control', 'alt', 'meta']);
        bindings[2] = bind('f5', 'playback-mute', ['alt']);
        expect(resolveActiveGlobalShortcuts(bindings).map(shortcut => shortcut.accelerator)).toEqual([
            'Control+Shift+Space',
            'Control+Alt+Super+Up',
            'Alt+F5',
        ]);
    });

    it('does not register a stored combination the rows would now refuse', () => {
        const bindings = empty();
        bindings[0] = bind('c', 'playback-toggle', ['control']);
        bindings[1] = bind('a', 'playback-next', ['shift']);
        bindings[2] = bind('k', 'playback-prev', ['alt', 'shift']);
        bindings[3] = bind('f4', 'playback-mute', ['alt']);
        bindings[4] = bind('n', 'playback-loop');
        expect(resolveActiveGlobalShortcuts(bindings).map(shortcut => shortcut.accelerator)).toEqual([
            'Control+Alt+Shift+N',
        ]);
    });

    it('leaves out half-filled slots, a key with no modifier, a held combination, commands off the list, and a repeated combination', () => {
        const bindings = empty();
        bindings[0] = bind('p', '');
        bindings[1] = bind('space', 'playback-next', []);
        bindings[2] = bind('v', 'playback-prev', ['control', 'shift']);
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
        bindings[0] = bind('p', 'playback-toggle', ['control', 'shift']);
        bindings[1] = bind('p', 'playback-next', ['control', 'alt', 'meta']);
        expect(resolveActiveGlobalShortcuts(bindings)).toEqual([
            { slot: 0, accelerator: 'Control+Shift+P', commandId: 'playback-toggle' },
            { slot: 1, accelerator: 'Control+Alt+Super+P', commandId: 'playback-next' },
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
        expect(refuseGlobalShortcutChord('r', TRIO, 0, bindings, 'linux')).toBe('reserved');
        bindings[2] = bind('k', 'playback-next');
        bindings[3] = bind('r', MOD_EXPORT);
        expect(resolveActiveGlobalShortcuts(bindings, new Set([MOD_PING, MOD_EXPORT]), 'linux')).toEqual([
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
        bindings[0] = { key: 'p', modifiers: ['control', 'shift'], commandId: 'playback-toggle' };
        const active = resolveActiveGlobalShortcuts(bindings);
        expect(commandForGlobalShortcut(active, 'Control+Shift+P')).toBe('playback-toggle');
        expect(commandForGlobalShortcut(active, 'Control+Shift+N')).toBeNull();
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
