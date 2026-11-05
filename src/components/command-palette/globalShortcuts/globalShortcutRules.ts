import {
    DEFAULT_GLOBAL_SHORTCUT_MODIFIERS,
    GLOBAL_SHORTCUT_MODIFIER_IDS,
    GLOBAL_SHORTCUT_SLOTS,
    type GlobalShortcutBinding,
    type GlobalShortcutModifier,
} from '../../../stores/useInteractionSettingsStore';
import { isMacPlatform, runsOnWindows } from '../../../utils/platform';

// src/components/command-palette/globalShortcuts/globalShortcutRules.ts
// What the system-wide shortcuts may be: which commands, which combinations, and which stored
// bindings actually get registered. The settings rows and the registering hook both ask here, so a
// binding the rows would refuse cannot be registered from a value already in storage.
//
// The combination is the listener's: modifiers of their choice and any key on the list below. A
// combination registered system-wide is taken from every program, and the ones other programs only
// listen for inside their own window cannot be seen beforehand, so the families that are surely
// someone's (no modifier, Shift alone, one modifier, the sets that type characters, Ctrl or Command
// with Shift on a caret key, Tab and Win/Command with too few modifiers, and the combinations desktops
// hold by name) are refused here; see refuseCombination. What is left may still be some program's own
// key, which the settings say next to any combination other than the default trio with a letter or
// digit. What this cannot see: layouts whose AltGr types characters with Shift (Polish Ą and the like).
//
// Besides the host's playback commands, mods may offer commands (Folium 1.7 `globalShortcut`). Which
// of those exist right now is handed in by the caller as a set of ids, so this file stays pure and
// does not read the mod registry: a binding to a mod command that is not registered at the moment
// (mod disabled, stopped, or still starting) is kept in storage and simply not registered.

/** The modifiers in Electron's accelerator syntax: `Control` is Ctrl on every system, `Alt` is Option on macOS. */
const MODIFIER_ACCELERATORS: Record<GlobalShortcutModifier, string> = {
    control: 'Control',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Super',
};

/** The modifiers as the keyboard labels them here. */
const MODIFIER_LABELS: Record<GlobalShortcutModifier, string> = isMacPlatform
    ? { control: 'Control', alt: 'Option', shift: 'Shift', meta: 'Command' }
    : { control: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

/** The keys with a name of their own, and the name Electron knows them by. */
const NAMED_KEYS: Record<string, string> = {
    space: 'Space',
    tab: 'Tab',
    enter: 'Return',
    backspace: 'Backspace',
    delete: 'Delete',
    insert: 'Insert',
    up: 'Up',
    down: 'Down',
    left: 'Left',
    right: 'Right',
    home: 'Home',
    end: 'End',
    pageup: 'PageUp',
    pagedown: 'PageDown',
};

const NAMED_KEY_IDS = new Set(Object.keys(NAMED_KEYS));

/** The same keys by their physical code, for modifiers and layouts that change what `event.key` says:
 * Option+Space is a no-break space on macOS, AltGr types characters with Ctrl+Alt on Windows. */
const CODE_KEYS: Record<string, string> = {
    Space: 'space',
    Tab: 'tab',
    Enter: 'enter',
    NumpadEnter: 'enter',
    Backspace: 'backspace',
    Delete: 'delete',
    Insert: 'insert',
    Home: 'home',
    End: 'end',
    PageUp: 'pageup',
    PageDown: 'pagedown',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right',
};

/** How the caps write a key, where the accelerator's own name would read oddly: Electron calls Enter `Return`. */
const KEY_LABELS: Record<string, string> = { ...NAMED_KEYS, enter: 'Enter' };

const FUNCTION_KEY_PATTERN = /^f(?:[1-9]|1[0-9]|2[0-4])$/;

/**
 * Only playback controls: a system-wide key is pressed while another program has the screen, so it
 * may only do what makes sense without looking at Folia. Like is left out on purpose: it toggles,
 * and its result is shown only inside the window, so a press in the background could quietly take
 * a song back out of the favourites.
 */
export const GLOBAL_SHORTCUT_COMMAND_IDS: ReadonlyArray<string> = [
    'playback-toggle',
    'playback-prev',
    'playback-next',
    'playback-volume-up',
    'playback-volume-down',
    'playback-mute',
    'playback-loop',
    'playback-shuffle',
];

/** No mod commands: the default for callers that only deal with the host's list. */
export const NO_MOD_GLOBAL_SHORTCUT_COMMANDS: ReadonlySet<string> = new Set();

/**
 * Whether a command may be bound and run by a system-wide key: one of the host's playback commands,
 * or one of the mod commands registered right now with `globalShortcut` and no params
 * (`modCommandIds`, the command palette ids of those commands).
 */
export const isGlobalShortcutCommand = (commandId: string, modCommandIds: ReadonlySet<string>): boolean => (
    GLOBAL_SHORTCUT_COMMAND_IDS.includes(commandId) || modCommandIds.has(commandId)
);

/** Whether a key may carry a system-wide shortcut: a letter, a digit, F1–F24, or one of the named keys. */
export const isGlobalShortcutKey = (key: string): boolean => (
    /^[a-z0-9]$/.test(key) || FUNCTION_KEY_PATTERN.test(key) || NAMED_KEY_IDS.has(key)
);

const isLetterOrDigit = (key: string) => /^[a-z0-9]$/.test(key);

/** The accelerator's own name for a key id. */
const toAcceleratorKey = (key: string): string => {
    if (isLetterOrDigit(key)) {
        return key.toUpperCase();
    }
    if (FUNCTION_KEY_PATTERN.test(key)) {
        return key.toUpperCase();
    }
    return NAMED_KEYS[key] ?? key.toUpperCase();
};

/** The key a press means, read so the held modifiers cannot change it: with Shift down a digit
 * arrives as `!` or `@`, and Option turns Space into a no-break space on macOS, so a key that is not
 * a letter or digit falls back to its physical position. Letters keep the layout's meaning (AZERTY's
 * A is `a`), which is what the accelerator matches on Windows (virtual keys) and X11 (keysyms).
 *
 * Unverified on macOS: Chromium may register a Mac hot key by its ANSI physical key code, in which
 * case an AZERTY Mac set to A answers on the key printed Q. And Option there changes `event.key`
 * (å), so a key recorded with the modifiers held falls back to its position while one recorded
 * alone keeps its meaning. Check both on a non-QWERTY Mac before changing this.
 */
export const readGlobalShortcutKey = (event: Pick<KeyboardEvent, 'key' | 'code'>): string => {
    const key = event.key.toLowerCase();
    if (isLetterOrDigit(key)) {
        return key;
    }
    if (event.key === ' ') {
        return 'space';
    }
    const named = event.key.startsWith('Arrow') ? event.key.slice(5).toLowerCase() : key;
    if (NAMED_KEY_IDS.has(named)) {
        return named;
    }
    if (FUNCTION_KEY_PATTERN.test(key)) {
        return key;
    }
    if (CODE_KEYS[event.code]) {
        return CODE_KEYS[event.code];
    }
    const fnCode = /^F(?:[1-9]|1[0-9]|2[0-4])$/.exec(event.code);
    if (fnCode) {
        return event.code.toLowerCase();
    }
    const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    return physical ? (physical[1] ?? physical[2]).toLowerCase() : key;
};

/** The modifiers a press holds, in the order they are shown. */
export const readGlobalShortcutModifiers = (
    event: Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): GlobalShortcutModifier[] => [
    ...(event.ctrlKey ? ['control'] as const : []),
    ...(event.altKey ? ['alt'] as const : []),
    ...(event.shiftKey ? ['shift'] as const : []),
    ...(event.metaKey ? ['meta'] as const : []),
];

/** The whole combination a press means, as the settings field shows and stores it: `control+shift+p`. */
export const readGlobalShortcutChord = (
    event: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
): string => [...readGlobalShortcutModifiers(event), readGlobalShortcutKey(event)].join('+');

/** Splits `control+shift+space` into the modifiers it holds and its key. */
export const parseGlobalShortcutChord = (chord: string): { modifiers: GlobalShortcutModifier[]; key: string } => {
    const parts = chord.toLowerCase().split('+');
    const key = parts.pop() ?? '';
    const held = new Set(parts);
    return {
        modifiers: GLOBAL_SHORTCUT_MODIFIER_IDS.filter(modifier => held.has(modifier)),
        key,
    };
};

/** How one part of a combination is written on the key caps: `Ctrl`, `Space`, `F4`, `P`. Takes both the
 * key ids the settings keep and the names an accelerator carries. */
export const formatGlobalShortcutPart = (part: string): string => {
    const id = part.toLowerCase();
    const label = (MODIFIER_LABELS as Record<string, string>)[id];
    if (label) {
        return label;
    }
    if (KEY_LABELS[id]) {
        return KEY_LABELS[id];
    }
    if (isLetterOrDigit(id) || FUNCTION_KEY_PATTERN.test(id)) {
        return id.toUpperCase();
    }
    return part.charAt(0).toUpperCase() + part.slice(1);
};

/** The caps of one accelerator, in the order they are held. */
export const globalShortcutKeyLabels = (accelerator: string): string[] => accelerator.split('+').map(formatGlobalShortcutPart);

/** The accelerator for a key and its modifiers, the modifiers in the shown order; the default trio when
 * none is given. Modifiers are put in order here, so two bindings holding the same combination always
 * write the same string. */
export const toGlobalShortcutAccelerator = (
    key: string,
    modifiers: ReadonlyArray<GlobalShortcutModifier> = DEFAULT_GLOBAL_SHORTCUT_MODIFIERS,
): string => [
    ...GLOBAL_SHORTCUT_MODIFIER_IDS.filter(modifier => modifiers.includes(modifier)).map(modifier => MODIFIER_ACCELERATORS[modifier]),
    toAcceleratorKey(key),
].join('+');

/** Which system's reserved combinations apply: the rules are asked on the system they register on. */
export type GlobalShortcutSystem = 'windows' | 'mac' | 'linux';

/** The system this renderer runs on. */
export const CURRENT_GLOBAL_SHORTCUT_SYSTEM: GlobalShortcutSystem = isMacPlatform ? 'mac' : runsOnWindows() ? 'windows' : 'linux';

/**
 * Combinations a system or desktop keeps for itself even with the modifiers the rules below let
 * through, on every system and on each one. Registering may not reveal these: Windows and the X11
 * desktops grab some of them in a keyboard hook rather than as hot keys, and programs listen for the
 * editing ones only inside their own window, so Electron's register would succeed and quietly take
 * them. Accelerator spelling, modifiers in the shown order (`Super` is Win on Windows, Command on macOS).
 */
const RESERVED_EVERYWHERE: ReadonlyArray<string> = [
    'Alt+F4', // Windows and the Linux desktops: close the window
    'Control+F4', // close the tab or document
    'Control+Alt+Delete', // Windows: secure attention; Linux: log out
    'Control+Shift+C', 'Control+Shift+V', 'Control+Shift+Z', // Linux terminals: copy, paste; everywhere: redo, paste as plain text
];

const RESERVED_ON: Record<GlobalShortcutSystem, ReadonlySet<string>> = {
    windows: new Set([
        ...RESERVED_EVERYWHERE,
        'Control+Shift+Super+B', // restart the graphics driver
    ]),
    mac: new Set([
        ...RESERVED_EVERYWHERE,
        'Control+F1', 'Control+F2', 'Control+F3', 'Control+F5', 'Control+F6', 'Control+F7', 'Control+F8', // keyboard navigation
        'Control+Shift+Super+3', 'Control+Shift+Super+4', // screenshot to the clipboard
    ]),
    linux: new Set([
        ...RESERVED_EVERYWHERE,
        'Control+Alt+Shift+R', // GNOME: screencast
        'Alt+F1', 'Alt+F2', 'Alt+F3', // GNOME/KDE: overview or menu, run, window menu
        'Control+Alt+T', 'Control+Alt+L', // Ubuntu: terminal, lock screen
        'Control+Alt+Left', 'Control+Alt+Right', 'Control+Alt+Up', 'Control+Alt+Down', // GNOME/Xfce: switch workspace
        'Control+Alt+Shift+Left', 'Control+Alt+Shift+Right', 'Control+Alt+Shift+Up', 'Control+Alt+Shift+Down', // move the window there
    ]),
};

/** Linux switches to a text console on Ctrl+Alt+F1 to F12, below every desktop. */
const CONSOLE_SWITCH_PATTERN = /^Control\+Alt\+F(?:[1-9]|1[0-2])$/;

/** The keys that move the caret: with Shift and Ctrl or Command they select (Ctrl+Shift+←). On Windows
 * and Linux Alt+Shift+← selects nothing in an ordinary text field, so it is let through there with the
 * usual warning, although editors and terminals use it for their own (column selection, moving lines,
 * resizing panes); on macOS Option+Shift selects by word and paragraph in every text field, so it is
 * refused there too. */
const CARET_KEYS: ReadonlySet<string> = new Set(['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'backspace', 'delete']);

/** Modifier sets that type a character with a letter or digit instead of being a shortcut: Option and
 * Option+Shift on macOS. Ctrl+Alt, which Windows reads as AltGr (@ and € on German, ą on Polish), types
 * nothing on the US and Chinese layouts and is what music players bind by default (Ctrl+Alt+P), so it
 * is let through with its own warning instead (globalShortcutWarning). */
const TYPING_MODIFIER_SETS: ReadonlyArray<string> = ['alt', 'alt+shift'];

export type GlobalShortcutKeyRefusal =
    | 'needs-modifier'
    | 'shift-only'
    | 'single-modifier'
    | 'types-character'
    | 'edits-text'
    | 'meta-needs-more'
    | 'unsupported-key'
    | 'reserved'
    | 'duplicate';

/**
 * Why the combination may not be held system-wide at all, or null when it may. A registered combination
 * is taken from every program, and the ones programs only listen for inside their own window cannot be
 * seen from here, so whole families are refused up front:
 * - no modifier, or Shift alone: that is typing and selecting text;
 * - one modifier with anything but F1–F24: copy, paste, undo, menu letters, Alt+Tab, Win+L, Cmd+Space,
 *   Ctrl+Space and the arrows' word and history moves all live there;
 * - the modifier sets that type characters with a letter or digit (TYPING_MODIFIER_SETS);
 * - Shift with Ctrl or Command on a caret key, and on macOS with Option too: selecting and deleting text;
 * - Tab with fewer than three modifiers: window, app and tab switching (Alt+Shift+Tab, Cmd+Shift+Tab,
 *   Ctrl+Alt+Tab, Ctrl+Shift+Tab);
 * - Win/Command with fewer than three modifiers: Windows keeps nearly all of those (virtual desktops,
 *   moving windows, Game Bar, snipping), and on macOS they are the apps' own (Cmd+Shift+…, Cmd+Option+…)
 *   or the system's (Dock, screenshots, Finder search);
 * - the combinations held by name on `system` (RESERVED_ON, and on Linux the console switch keys).
 * What is left may still be some program's own shortcut; the settings say so.
 */
const refuseCombination = (
    key: string,
    modifiers: ReadonlyArray<GlobalShortcutModifier>,
    system: GlobalShortcutSystem,
): Exclude<GlobalShortcutKeyRefusal, 'duplicate'> | null => {
    if (!isGlobalShortcutKey(key)) {
        return 'unsupported-key';
    }
    if (modifiers.length === 0) {
        return 'needs-modifier';
    }
    const held = GLOBAL_SHORTCUT_MODIFIER_IDS.filter(modifier => modifiers.includes(modifier));
    if (held.length === 1 && held[0] === 'shift') {
        return 'shift-only';
    }
    if (held.length === 1 && !FUNCTION_KEY_PATTERN.test(key)) {
        return 'single-modifier';
    }
    if (isLetterOrDigit(key) && TYPING_MODIFIER_SETS.includes(held.join('+'))) {
        return 'types-character';
    }
    if (CARET_KEYS.has(key) && held.length === 2 && held.includes('shift')
        && (held.includes('control') || held.includes('meta') || system === 'mac')) {
        return 'edits-text';
    }
    if (key === 'tab' && held.length < 3) {
        return 'reserved';
    }
    if (held.includes('meta') && held.length < 3) {
        return 'meta-needs-more';
    }
    const accelerator = toGlobalShortcutAccelerator(key, held);
    if (RESERVED_ON[system].has(accelerator) || (system === 'linux' && CONSOLE_SWITCH_PATTERN.test(accelerator))) {
        return 'reserved';
    }
    return null;
};

/** Whether the combination is what older versions could only bind, the one the note recommends: the
 * default trio with a letter or digit. With anything else (other modifiers, or the trio with an arrow,
 * Tab or a function key, which some desktops move windows with) the settings warn. */
export const isDefaultGlobalShortcutCombination = (key: string, modifiers: ReadonlyArray<GlobalShortcutModifier>): boolean => (
    isLetterOrDigit(key)
    && modifiers.length === DEFAULT_GLOBAL_SHORTCUT_MODIFIERS.length
    && DEFAULT_GLOBAL_SHORTCUT_MODIFIERS.every(modifier => modifiers.includes(modifier))
);

export type GlobalShortcutWarning = 'altgr' | 'custom';

/**
 * What the settings say under a combination the rules let through, or null for the default trio with a
 * letter or digit: `altgr` for Ctrl+Alt with a letter or digit on Windows, where layouts with AltGr type
 * a character on it and the registered key would take that character away; `custom` for anything else,
 * which may be some program's own key.
 */
export const globalShortcutWarning = (
    key: string,
    modifiers: ReadonlyArray<GlobalShortcutModifier>,
    system: GlobalShortcutSystem = CURRENT_GLOBAL_SHORTCUT_SYSTEM,
): GlobalShortcutWarning | null => {
    if (isDefaultGlobalShortcutCombination(key, modifiers)) {
        return null;
    }
    const held = GLOBAL_SHORTCUT_MODIFIER_IDS.filter(modifier => modifiers.includes(modifier));
    return system === 'windows' && isLetterOrDigit(key) && held.join('+') === 'control+alt' ? 'altgr' : 'custom';
};

/** Why `key` with `modifiers` cannot go in `slot` on `system`, or null when it can. */
export const refuseGlobalShortcutChord = (
    key: string,
    modifiers: ReadonlyArray<GlobalShortcutModifier>,
    slot: number,
    bindings: ReadonlyArray<GlobalShortcutBinding>,
    system: GlobalShortcutSystem = CURRENT_GLOBAL_SHORTCUT_SYSTEM,
): GlobalShortcutKeyRefusal | null => {
    const refusal = refuseCombination(key, modifiers, system);
    if (refusal) {
        return refusal;
    }
    const accelerator = toGlobalShortcutAccelerator(key, modifiers);
    return bindings.some((binding, index) => index !== slot && binding.key
        && toGlobalShortcutAccelerator(binding.key, binding.modifiers) === accelerator) ? 'duplicate' : null;
};

export type ActiveGlobalShortcut = {
    slot: number;
    accelerator: string;
    commandId: string;
};

/**
 * What goes to the desktop portal on native Wayland: every command on the list, each with a fixed
 * key. The desktop decides the real keys, so the key here is only the suggestion it may show, and
 * the name the shortcut carries there (Hyprland lists it as `…-Ctrl+Alt+Shift+P`). The settings
 * show this table, so the listener can tell which entry is which.
 */
export const PORTAL_GLOBAL_SHORTCUTS: ReadonlyArray<ActiveGlobalShortcut> = ([
    ['p', 'playback-toggle'],
    ['b', 'playback-prev'],
    ['n', 'playback-next'],
    ['u', 'playback-volume-up'],
    ['d', 'playback-volume-down'],
    ['m', 'playback-mute'],
    ['l', 'playback-loop'],
    ['s', 'playback-shuffle'],
] as const).map(([key, commandId], slot) => ({ slot, accelerator: toGlobalShortcutAccelerator(key), commandId }));

/**
 * The command a pressed accelerator runs, or null when no current binding has it. The command is
 * checked again against `modCommandIds` as of the press: a mod command unregistered since the
 * bindings were last resolved (its mod just stopped) does not run.
 */
export const commandForGlobalShortcut = (
    active: ReadonlyArray<ActiveGlobalShortcut>,
    accelerator: string,
    modCommandIds: ReadonlySet<string> = NO_MOD_GLOBAL_SHORTCUT_COMMANDS,
): string | null => {
    const commandId = active.find(shortcut => shortcut.accelerator === accelerator)?.commandId ?? null;
    return commandId && isGlobalShortcutCommand(commandId, modCommandIds) ? commandId : null;
};

/**
 * The bindings that get registered: both halves set, a combination the rows would take, a command on
 * the list (the host's, or a mod command in `modCommandIds`). A slot whose combination repeats an
 * earlier slot's stays quiet rather than fighting it. A slot whose mod command is not registered now
 * stays quiet too, and comes back by itself once the command is registered again. The combination
 * rules are `system`'s, so a binding brought over from another system that this one holds is not
 * registered here.
 */
export const resolveActiveGlobalShortcuts = (
    bindings: ReadonlyArray<GlobalShortcutBinding>,
    modCommandIds: ReadonlySet<string> = NO_MOD_GLOBAL_SHORTCUT_COMMANDS,
    system: GlobalShortcutSystem = CURRENT_GLOBAL_SHORTCUT_SYSTEM,
): ActiveGlobalShortcut[] => {
    const active: ActiveGlobalShortcut[] = [];
    const seen = new Set<string>();
    bindings.slice(0, GLOBAL_SHORTCUT_SLOTS).forEach((binding, slot) => {
        const { key, commandId } = binding;
        if (!key || !commandId || refuseCombination(key, binding.modifiers, system)) {
            return;
        }
        if (!isGlobalShortcutCommand(commandId, modCommandIds)) {
            return;
        }
        const accelerator = toGlobalShortcutAccelerator(key, binding.modifiers);
        if (seen.has(accelerator)) {
            return;
        }
        seen.add(accelerator);
        active.push({ slot, accelerator, commandId });
    });
    return active;
};
