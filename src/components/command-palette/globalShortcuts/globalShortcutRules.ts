import { GLOBAL_SHORTCUT_SLOTS, type GlobalShortcutBinding } from '../../../stores/useInteractionSettingsStore';
import { isMacPlatform } from '../../../utils/platform';

// src/components/command-palette/globalShortcuts/globalShortcutRules.ts
// What the system-wide shortcuts may be: which commands, which keys, and which stored bindings
// actually get registered. The settings rows and the registering hook both ask here, so a binding
// the rows would refuse cannot be registered from a value already in storage.
//
// The modifiers are fixed at Ctrl+Alt+Shift (Control+Option+Shift on macOS). No system binds that
// trio to a letter or a digit by default — GNOME's Ctrl+Alt+Shift+R screencast is the one
// exception, so R is refused. Alt+Shift switches the input language on Windows and types accented
// characters on macOS; Ctrl+Alt alone is taken by Linux desktops (terminal, lock, Ctrl+Alt+F1–F12
// virtual consoles). What this cannot see: layouts whose AltGr types characters with Shift (Polish
// Ą and the like), and keys other programs only listen for inside their own window.
//
// Besides the host's playback commands, mods may offer commands (Folium 1.7 `globalShortcut`). Which
// of those exist right now is handed in by the caller as a set of ids, so this file stays pure and
// does not read the mod registry: a binding to a mod command that is not registered at the moment
// (mod disabled, stopped, or still starting) is kept in storage and simply not registered.

/** The fixed modifiers in Electron's accelerator syntax: `Control` is Ctrl on every system, `Alt` is Option on macOS. */
const ACCELERATOR_PREFIX = 'Control+Alt+Shift+';

/** The fixed modifiers as the keyboard labels them here. */
export const GLOBAL_SHORTCUT_MODIFIER_LABELS: ReadonlyArray<string> = isMacPlatform
    ? ['Control', 'Option', 'Shift']
    : ['Ctrl', 'Alt', 'Shift'];

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

/** Keys a desktop already gives this modifier trio: GNOME starts a screencast on Ctrl+Alt+Shift+R. */
const RESERVED_KEYS = new Set(['r']);

const isLetterOrDigit = (key: string) => /^[a-z0-9]$/.test(key);

export type GlobalShortcutKeyRefusal = 'not-letter-or-digit' | 'reserved' | 'duplicate';

/** Why `key` cannot go in `slot`, or null when it can. */
export const refuseGlobalShortcutKey = (
    key: string,
    slot: number,
    bindings: ReadonlyArray<GlobalShortcutBinding>,
): GlobalShortcutKeyRefusal | null => {
    if (!isLetterOrDigit(key)) {
        return 'not-letter-or-digit';
    }
    if (RESERVED_KEYS.has(key)) {
        return 'reserved';
    }
    return bindings.some((binding, index) => index !== slot && binding.key === key) ? 'duplicate' : null;
};

/**
 * The key a press means, read so the held modifiers cannot change it: with Shift down a digit
 * arrives as `!` or `@`, so a key that is not a letter or digit falls back to its physical position.
 * Letters keep the layout's meaning (AZERTY's A is `a`), which is what the accelerator matches on
 * Windows (virtual keys) and X11 (keysyms).
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
    const physical = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
    return physical ? (physical[1] ?? physical[2]).toLowerCase() : key;
};

export const toGlobalShortcutAccelerator = (key: string): string => `${ACCELERATOR_PREFIX}${key.toUpperCase()}`;

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
 * The bindings that get registered: both halves set, a key the rows would take, a command on the
 * list (the host's, or a mod command in `modCommandIds`). A slot whose key repeats an earlier slot's
 * stays quiet rather than fighting it. A slot whose mod command is not registered now stays quiet
 * too, and comes back by itself once the command is registered again.
 */
export const resolveActiveGlobalShortcuts = (
    bindings: ReadonlyArray<GlobalShortcutBinding>,
    modCommandIds: ReadonlySet<string> = NO_MOD_GLOBAL_SHORTCUT_COMMANDS,
): ActiveGlobalShortcut[] => {
    const active: ActiveGlobalShortcut[] = [];
    const seen = new Set<string>();
    bindings.slice(0, GLOBAL_SHORTCUT_SLOTS).forEach((binding, slot) => {
        const { key, commandId } = binding;
        if (!key || !commandId || seen.has(key) || !isLetterOrDigit(key) || RESERVED_KEYS.has(key)) {
            return;
        }
        if (!isGlobalShortcutCommand(commandId, modCommandIds)) {
            return;
        }
        seen.add(key);
        active.push({ slot, accelerator: toGlobalShortcutAccelerator(key), commandId });
    });
    return active;
};
