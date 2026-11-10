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
// - A window that has the keyboard (data-folia-keyboard-window) takes the step whatever its handler did with
//   the key, a dialog busy with work that refuses to close included: nothing under a window steps back.
// - A page answers Escape only while the key reaches it: not from a text field, and the wall not without the
//   focus in it. A pointer has no such condition, so with no layer taking the key the page itself steps back
//   through the App's navigation, the same actions its back button calls.
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

/*
 * One press of Escape where the user's would land: on the focused element, or on the top window when the
 * focus is not inside it (a pointer leaves it where it was). Whether a layer took it.
 */
const pressEscape = (): boolean => {
    const top = topKeyboardWindow();
    const focused = document.activeElement;
    if (!top && focused?.closest(MOD_HOME_PAGE_SELECTOR)) return false;
    const target = top && !(focused && top.contains(focused)) ? top : focused ?? document.body;
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
    return top !== null || event.defaultPrevented || !reachedWindow;
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
