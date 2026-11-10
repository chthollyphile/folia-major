import { useAppViewStore } from '@/stores/useAppViewStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';
import { closeFoliumHomeTab, useFoliumHomeTabStore } from '../folium/registries/homeTabs';

// src/mods/runtime/hostBack.ts
// `folium.ui.back()` (Folium 1.9): one level back, for a mod that binds a mouse button or a gesture to it.
//
// The host already has one rule for "one level back": the Escape key. Every dialog, the command palette, the
// settings window and each suite's own ladder (a focused card, a list panel, a filter) answer it themselves,
// the topmost first, and keep the key from what lies under them: they mark it as taken (preventDefault) or
// stop it on its way up. A second list of "what is open, and how does it close" kept beside that would drift
// from it with every new window. So a step back is that key, sent as the user would press it, and what it
// reports is whether a layer took it: the key came back marked, or never reached the window.
//
// What a key press does not cover, which the step adds:
// - The key goes where the focus is, and a pointer leaves the focus where it was. A window or the wall whose
//   handler sits on its own element hears the key only with the focus inside. So when no layer took the key
//   from where the focus is, it is sent once more to what the pointer is over: the top window, or the wall.
// - A window that has the keyboard (data-folia-keyboard-window) takes the step whatever it did with the key:
//   a dialog busy with work that refuses to close, and a window that does not answer Escape at all, stay
//   open, and nothing under them steps back.
// - A page answers Escape only while the key reaches it, not from a text field. With no layer taking the key
//   the page itself steps back through the App's navigation, the same actions its back button calls.
//
// The first key goes to the focus and not straight to the top window: a pick list of that window is drawn
// outside it (a portal) and answers from where the focus is. What lies under a window leaves its keys alone
// while the window is open (utils/keyboardTargets.ts hasBlockingWindow), so the focus being there is no harm.
// - A mod's home page keeps every key pressed inside it for the mod. Those are not the host's to send: with
//   the focus in such a page the step goes straight to the page, which closes.

/** The App's in-app back actions (hooks/useAppNavigation.ts). */
export interface FoliumBackNavigation {
    backFromPlayer: () => void;
    backFromWall: () => void;
    backCollection: () => void;
    closeSearch: () => void;
}

// A mod's home page marks itself too, to keep the wall's keys off it, but it is a page: it steps back below.
const MOD_HOME_PAGE_SELECTOR = '[data-folium-home-page]';
const KEYBOARD_WINDOW_SELECTOR = `[data-folia-keyboard-window="true"]:not(${MOD_HOME_PAGE_SELECTOR})`;

/* The window drawn last: the one over the others. */
const topKeyboardWindow = (): Element | null => {
    const windows = document.querySelectorAll(KEYBOARD_WINDOW_SELECTOR);
    return windows.length > 0 ? windows[windows.length - 1] : null;
};

// The queue wall's own field (components/app/lattice/PosterWall.tsx): its Escape ladder (an open card, the
// card focus, then back) is a handler on this element. The library wall shares the class and listens on the window.
const WALL_FIELD_SELECTOR = '.lattice-field:not(.bravais-field)';

/* One Escape on `target`; whether a layer took it: it came back marked, or was stopped before the window. */
const sendEscape = (target: Element): boolean => {
    const event = new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true, composed: true });
    // The last listener on the window: it hears the key only when no layer stopped it on the way.
    let reachedWindow = false;
    const hear = () => { reachedWindow = true; };
    window.addEventListener('keydown', hear);
    try {
        target.dispatchEvent(event);
    } finally {
        window.removeEventListener('keydown', hear);
    }
    return event.defaultPrevented || !reachedWindow;
};

/*
 * One press of Escape where the user's would land, the focused element; then, when no layer took it and the
 * focus is outside what the pointer is over (the top window, or the wall), once more there. Whether a layer
 * took it.
 */
const pressEscape = (): boolean => {
    const top = topKeyboardWindow();
    const focused = document.activeElement ?? document.body;
    if (!top && focused.closest(MOD_HOME_PAGE_SELECTOR)) return false;
    if (sendEscape(focused)) return true;
    const surface = top ?? (useAppViewStore.getState().view === 'lattice' ? document.querySelector(WALL_FIELD_SELECTOR) : null);
    if (surface && !surface.contains(focused) && sendEscape(surface)) return true;
    return top !== null;
};

/* The page on screen steps back, as its own back button does; false on the home page with nothing open. */
const stepPageBack = (navigation: FoliumBackNavigation): boolean => {
    const view = useAppViewStore.getState();
    if (view.view === 'player') {
        if (view.isPanelOpen) view.setIsPanelOpen(false);
        else navigation.backFromPlayer();
        return true;
    }
    if (view.view === 'lattice') {
        navigation.backFromWall();
        return true;
    }
    if (useFoliumHomeTabStore.getState().activeId !== null) {
        closeFoliumHomeTab();
        return true;
    }
    if (useCollectionNavigationStore.getState().snapshot) {
        navigation.backCollection();
        return true;
    }
    if (useSearchNavigationStore.getState().isSearchOpen) {
        navigation.closeSearch();
        return true;
    }
    return false;
};

// A mod that calls back() from its own Escape handler would be called again by the key this sends.
let stepping = false;

/** Steps one level back; whether the host took it. */
export const stepFoliumHostBack = (navigation: FoliumBackNavigation): boolean => {
    if (stepping) return false;
    stepping = true;
    try {
        return pressEscape() || stepPageBack(navigation);
    } finally {
        stepping = false;
    }
};
