import {
    DEFAULT_GLOBAL_SHORTCUT_MODIFIERS,
    GLOBAL_SHORTCUT_MODIFIER_IDS,
    GLOBAL_SHORTCUT_SLOTS,
    type GlobalShortcutBinding,
    type GlobalShortcutModifier,
} from '../../../stores/useInteractionSettingsStore';
import { isMacPlatform } from '../../../utils/platform';

// src/components/command-palette/globalShortcuts/globalShortcutRules.ts
// What the system-wide shortcuts may be: which commands, which combinations, and which stored
// bindings actually get registered. The settings rows and the registering hook both ask here, so a
// binding the rows would refuse cannot be registered from a value already in storage.
//
// The combination is the listener's: any modifiers, at least one, and any key on the list below.
// A press with no modifier is refused because a bare key registered system-wide takes that key from
// every program — the ones other programs only listen for inside their own window cannot be seen
// beforehand, so the refusal is the only warning there is. GNOME's Ctrl+Alt+Shift+R screencast is
// the one combination a desktop already holds, so that one is refused by name. What this cannot
// see: layouts whose AltGr types characters with Shift (Polish Ą and the like).
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

/** Keys a desktop already gives this modifier trio: GNOME starts a screencast on Ctrl+Alt+Shift+R. */
const isReservedCombination = (key: string, modifiers: ReadonlyArray<GlobalShortcutModifier>): boolean => (
    key === 'r' && modifiers.length === 3 && !modifiers.includes('meta')
);

/**
 * Whether the combination may be held system-wide at all: a key on the list, at least one modifier,
 * and not the combination a desktop already holds.
 */
const isUsableCombination = (key: string, modifiers: ReadonlyArray<GlobalShortcutModifier>): boolean => (
    isGlobalShortcutKey(key) && modifiers.length > 0 && !isReservedCombination(key, modifiers)
);

export type GlobalShortcutKeyRefusal = 'needs-modifier' | 'unsupported-key' | 'reserved' | 'duplicate';

/** Why `key` with `modifiers` cannot go in `slot`, or null when it can. */
export const refuseGlobalShortcutChord = (
    key: string,
    modifiers: ReadonlyArray<GlobalShortcutModifier>,
    slot: number,
    bindings: ReadonlyArray<GlobalShortcutBinding>,
): GlobalShortcutKeyRefusal | null => {
    if (!isGlobalShortcutKey(key)) {
        return 'unsupported-key';
    }
    if (modifiers.length === 0) {
        return 'needs-modifier';
    }
    if (isReservedCombination(key, modifiers)) {
        return 'reserved';
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
 * stays quiet too, and comes back by itself once the command is registered again.
 */
export const resolveActiveGlobalShortcuts = (
    bindings: ReadonlyArray<GlobalShortcutBinding>,
    modCommandIds: ReadonlySet<string> = NO_MOD_GLOBAL_SHORTCUT_COMMANDS,
): ActiveGlobalShortcut[] => {
    const active: ActiveGlobalShortcut[] = [];
    const seen = new Set<string>();
    bindings.slice(0, GLOBAL_SHORTCUT_SLOTS).forEach((binding, slot) => {
        const { key, commandId } = binding;
        if (!key || !commandId || !isUsableCombination(key, binding.modifiers)) {
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
