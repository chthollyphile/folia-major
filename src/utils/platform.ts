// src/utils/platform.ts
// One place to answer "is this a Mac" and "is this Windows", so keyboard handling, the shortcut
// hints the user reads and the places that offer a setting for one system can never disagree about
// it. Detection is by user agent because the renderer runs both in a browser and in Electron, and
// `window.electron?.platform` only exists in the latter.
export const isMacPlatform = typeof navigator !== 'undefined'
    && navigator.userAgent.toLowerCase().includes('mac');

// Linux desktop, not Android. Android's user agent also contains "Linux" (e.g. "Linux; Android 14"),
// so a bare `includes('linux')` misreports phones and tablets as desktop Linux — which would hide
// the player-page native blur toggle there for a renderer problem it does not have.
export const isLinuxPlatform = typeof navigator !== 'undefined'
    && navigator.userAgent.toLowerCase().includes('linux')
    && !navigator.userAgent.toLowerCase().includes('android');

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


export const isWindowsPlatform = typeof navigator !== 'undefined'
    && navigator.userAgent.toLowerCase().includes('windows')

/**
 * Whether this is an Apple device (macOS, iPhone, iPad, iPod). Detection is by user agent for the
 * same reason as the rest of this file: the renderer runs both in a browser and in Electron.
 */
export const isApplePlatform = typeof navigator !== 'undefined'
    && /mac|iphone|ipad|ipod/i.test(navigator.userAgent);

/**
 * Whether the renderer is Chromium-based (Electron, Chrome, Edge, Brave and the rest).
 *
 * The glass's edge distortion is `backdrop-filter: url(#svg-filter)` with an SVG displacement
 * map: Chromium draws it, WebKit does not — that is Safari on macOS and, on iOS, every browser
 * (they are all WebKit under the hood, whatever they call themselves). So the Apple platforms
 * are not a single answer: the desktop app and the Chromium browsers there can distort, Safari
 * and the iOS browsers cannot.
 */
export const isChromiumRenderer = (): boolean => {
    if (typeof navigator === 'undefined') return false;
    const agent = navigator.userAgent.toLowerCase();
    // Chrome on iOS (CriOS) and Firefox on iOS (FxiOS) are WebKit under the hood.
    if (agent.includes('crios') || agent.includes('fxios')) return false;
    return agent.includes('chrome') || agent.includes('chromium') || agent.includes('electron');
};
