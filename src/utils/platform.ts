// src/utils/platform.ts
// One place to answer "is this a Mac" and "is this Windows", so keyboard handling, the shortcut
// hints the user reads and the places that offer a setting for one system can never disagree about
// it. Detection is by user agent because the renderer runs both in a browser and in Electron, and
// `window.electron?.platform` only exists in the latter.

export const isMacPlatform = typeof navigator !== 'undefined'
    && navigator.userAgent.toLowerCase().includes('mac');

/**
 * Whether this is Windows. Pausing for voice input is for the Windows desktop app only: the
 * settings window asks this before it offers the row, the settings search before it lists it, and
 * the command palette before it offers the command.
 */
export const runsOnWindows = (): boolean => (
    typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('win')
);

/**
 * The modifier a shortcut declared as `ctrl` actually uses here: Cmd on macOS, Ctrl elsewhere.
 * Shortcuts are declared once with `ctrl` and translated at the point of use, rather than each
 * declaration carrying a per-platform variant.
 */
export const isPrimaryModifierPressed = (event: KeyboardEvent): boolean => (
    isMacPlatform ? event.metaKey : event.ctrlKey
);

/** The modifier that must stay *up* for a primary-modifier shortcut to be unambiguous. */
export const isSecondaryModifierPressed = (event: KeyboardEvent): boolean => (
    isMacPlatform ? event.ctrlKey : event.metaKey
);

/** Label for the primary modifier, for shortcut hints shown in the UI. */
export const PRIMARY_MODIFIER_LABEL = isMacPlatform ? 'Cmd' : 'Ctrl';
