// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Stores read localStorage at import time; see foliumUiRegistries.test.ts.
vi.hoisted(() => {
    const items = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: {
            getItem: (key: string) => items.get(key) ?? null,
            setItem: (key: string, value: string) => { items.set(key, String(value)); },
            removeItem: (key: string) => { items.delete(key); },
            clear: () => items.clear(),
        },
    });
});

import type { CollectionNavigationSnapshot } from '@/library/core/collection/collection.contract';
import { useFoliumHomeTabStore } from '@/mods/folium/registries/homeTabs';
import { createFoliumUiService, registerFoliumHostActions, type FoliumHostActions } from '@/mods/folium/services';
import { stepFoliumHostBack, type FoliumBackNavigation } from '@/mods/runtime/hostBack';
import type { ModRuntimeInfo } from '@/mods/types';
import { useAppViewStore } from '@/stores/useAppViewStore';
import { useCollectionNavigationStore } from '@/stores/useCollectionNavigationStore';
import { useSearchNavigationStore } from '@/stores/useSearchNavigationStore';

// test/unit/mod-system/foliumHostBack.test.ts
// Folium 1.9 `folium.ui.back()`: one level back is the host's Escape, sent where the user's would land; a
// layer that takes the key (marks it, or stops it on its way up), or a window that has the keyboard, ends the
// step; with no layer taking it the page on screen steps back through the App's navigation; and the home page
// with nothing open reports false.

const navigation = (): { [Name in keyof FoliumBackNavigation]: ReturnType<typeof vi.fn<() => void>> } => ({
    backFromPlayer: vi.fn<() => void>(),
    backFromWall: vi.fn<() => void>(),
    backCollection: vi.fn<() => void>(),
    closeSearch: vi.fn<() => void>(),
});

const noneCalled = (nav: ReturnType<typeof navigation>) => Object.values(nav).every((action) => action.mock.calls.length === 0);

/** Listens on the window as the host's own Escape handlers do; the keys heard, with where each landed. */
const hearEscape = (onKey?: (event: KeyboardEvent) => void) => {
    const heard: Array<EventTarget | null> = [];
    const listener = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        heard.push(event.target);
        onKey?.(event);
    };
    window.addEventListener('keydown', listener);
    cleanups.push(() => window.removeEventListener('keydown', listener));
    return heard;
};

const cleanups: Array<() => void> = [];
const initialView = useAppViewStore.getState();
const initialCollection = useCollectionNavigationStore.getState();
const initialSearch = useSearchNavigationStore.getState();

const keyboardWindow = () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('data-folia-keyboard-window', 'true');
    const button = document.createElement('button');
    dialog.appendChild(button);
    document.body.appendChild(dialog);
    return { dialog, button };
};

beforeEach(() => {
    useAppViewStore.setState(initialView, true);
    useCollectionNavigationStore.setState(initialCollection, true);
    useSearchNavigationStore.setState(initialSearch, true);
    useFoliumHomeTabStore.setState({ activeId: null });
});

afterEach(() => {
    cleanups.splice(0).forEach((cleanup) => cleanup());
    document.body.replaceChildren();
    registerFoliumHostActions(null);
});

describe('one level back is the host\'s Escape', () => {
    it('reports false on the home page with nothing open, after one Escape no one took', () => {
        const heard = hearEscape();
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(false);
        expect(heard).toHaveLength(1);
        expect(noneCalled(nav)).toBe(true);
    });

    it('ends at the layer that takes the key: the page under it stays', () => {
        useAppViewStore.setState({ view: 'player', isPanelOpen: true });
        hearEscape((event) => event.preventDefault());
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(useAppViewStore.getState().isPanelOpen).toBe(true);
        expect(noneCalled(nav)).toBe(true);
    });

    it('ends at a layer that stops the key on its way up, as a pick list does', () => {
        useAppViewStore.setState({ view: 'player', isPanelOpen: true });
        const list = document.createElement('button');
        list.addEventListener('keydown', (event) => event.stopPropagation());
        document.body.appendChild(list);
        list.focus();
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(useAppViewStore.getState().isPanelOpen).toBe(true);
        expect(noneCalled(nav)).toBe(true);
    });

    it('sends the key to the focused element', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();
        const heard = hearEscape();
        stepFoliumHostBack(navigation());
        expect(heard).toEqual([input]);
    });

    it('does not answer a call made from a handler of the key it sent', () => {
        const nav = navigation();
        const nested: boolean[] = [];
        hearEscape(() => { nested.push(stepFoliumHostBack(nav)); });
        useAppViewStore.setState({ view: 'lattice' });
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(nested).toEqual([false]);
        expect(nav.backFromWall).toHaveBeenCalledTimes(1);
    });
});

describe('a window that has the keyboard', () => {
    it('takes the step even when it leaves the key unmarked, and the page under it stays', () => {
        useAppViewStore.setState({ view: 'player', isPanelOpen: true });
        keyboardWindow();
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(useAppViewStore.getState().isPanelOpen).toBe(true);
        expect(noneCalled(nav)).toBe(true);
    });

    it('hears the key where the focus is first, then on itself when no layer took it there', () => {
        const { dialog, button } = keyboardWindow();
        const heard = hearEscape();
        stepFoliumHostBack(navigation());
        expect(heard).toEqual([document.body, dialog]);
        heard.length = 0;
        button.focus();
        stepFoliumHostBack(navigation());
        expect(heard).toEqual([button]);
    });

    it('closes through a handler on its own element, which a key pressed with the focus elsewhere never reaches', () => {
        const { dialog } = keyboardWindow();
        const closed = vi.fn();
        dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') closed(); });
        expect(stepFoliumHostBack(navigation())).toBe(true);
        expect(closed).toHaveBeenCalledTimes(1);
    });

    it('leaves the key to a layer that answers it only from where the focus is, as a picker over a work window does', () => {
        const { dialog } = keyboardWindow();
        const closedWindow = vi.fn();
        dialog.addEventListener('keydown', closedWindow);
        // As StudioWindow's layer: with the focus on nothing it takes the key on the document and stops it.
        const closedLayer = vi.fn();
        const onDocument = (event: KeyboardEvent) => {
            if (event.target !== document.body) return;
            closedLayer();
            event.preventDefault();
            event.stopPropagation();
        };
        document.addEventListener('keydown', onDocument);
        cleanups.push(() => document.removeEventListener('keydown', onDocument));
        expect(stepFoliumHostBack(navigation())).toBe(true);
        expect(closedLayer).toHaveBeenCalledTimes(1);
        expect(closedWindow).not.toHaveBeenCalled();
    });

    it('is the one drawn last when several are open', () => {
        keyboardWindow();
        const { dialog } = keyboardWindow();
        const heard = hearEscape();
        stepFoliumHostBack(navigation());
        expect(heard).toEqual([document.body, dialog]);
    });

    it('takes the step and stays when it does not answer Escape at all', () => {
        const { dialog } = keyboardWindow();
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(dialog.isConnected).toBe(true);
        expect(noneCalled(nav)).toBe(true);
    });

    it('is not a mod\'s home page, which steps back as a page', () => {
        const page = document.createElement('section');
        page.setAttribute('data-folia-keyboard-window', 'true');
        page.setAttribute('data-folium-home-page', 'mod-a:console');
        document.body.appendChild(page);
        useFoliumHomeTabStore.setState({ activeId: 'mod-a:console' });
        expect(stepFoliumHostBack(navigation())).toBe(true);
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
        expect(stepFoliumHostBack(navigation())).toBe(false);
    });

    it('sends no key into a mod\'s home page, which keeps its keys for the mod, and closes the page', () => {
        const page = document.createElement('section');
        page.setAttribute('data-folia-keyboard-window', 'true');
        page.setAttribute('data-folium-home-page', 'mod-a:console');
        // As FoliumHomePage does: every key pressed inside stays inside.
        const kept: string[] = [];
        page.addEventListener('keydown', (event) => { kept.push(event.key); event.stopPropagation(); });
        const field = document.createElement('input');
        page.appendChild(field);
        document.body.appendChild(page);
        field.focus();
        useFoliumHomeTabStore.setState({ activeId: 'mod-a:console' });
        expect(stepFoliumHostBack(navigation())).toBe(true);
        expect(kept).toEqual([]);
        expect(useFoliumHomeTabStore.getState().activeId).toBeNull();
    });
});

describe('the page on screen', () => {
    it('closes the player panel first, then leaves the player', () => {
        useAppViewStore.setState({ view: 'player', isPanelOpen: true });
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(useAppViewStore.getState().isPanelOpen).toBe(false);
        expect(nav.backFromPlayer).not.toHaveBeenCalled();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(nav.backFromPlayer).toHaveBeenCalledTimes(1);
    });

    it('leaves the wall', () => {
        useAppViewStore.setState({ view: 'lattice' });
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(nav.backFromWall).toHaveBeenCalledTimes(1);
    });

    it('lets the wall answer first with the focus outside it: an open card closes before the wall is left', () => {
        useAppViewStore.setState({ view: 'lattice' });
        // As the wall's field: its ladder is a handler on the element, and always takes the key.
        const field = document.createElement('div');
        field.className = 'lattice-field';
        let cardOpen = true;
        const left = vi.fn();
        field.addEventListener('keydown', (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            if (cardOpen) cardOpen = false;
            else left();
        });
        const outside = document.createElement('button');
        document.body.append(field, outside);
        outside.focus();
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(cardOpen).toBe(false);
        expect(left).not.toHaveBeenCalled();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(left).toHaveBeenCalledTimes(1);
        // The wall left through its own handler: the step did not leave it a second time.
        expect(nav.backFromWall).not.toHaveBeenCalled();
    });

    it('does not take the library wall under another view for the queue wall', () => {
        useAppViewStore.setState({ view: 'lattice' });
        const library = document.createElement('div');
        library.className = 'lattice-field bravais-field';
        const heard = vi.fn();
        library.addEventListener('keydown', heard);
        document.body.appendChild(library);
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(heard).not.toHaveBeenCalled();
        expect(nav.backFromWall).toHaveBeenCalledTimes(1);
    });

    it('goes back from a collection page before closing the search page under it', () => {
        useCollectionNavigationStore.setState({ snapshot: { origin: 'search', stack: [] } as unknown as CollectionNavigationSnapshot });
        useSearchNavigationStore.setState({ isSearchOpen: true });
        const nav = navigation();
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(nav.backCollection).toHaveBeenCalledTimes(1);
        expect(nav.closeSearch).not.toHaveBeenCalled();

        useCollectionNavigationStore.setState({ snapshot: null });
        expect(stepFoliumHostBack(nav)).toBe(true);
        expect(nav.closeSearch).toHaveBeenCalledTimes(1);
    });
});

describe('folium.ui.back', () => {
    const mod = { id: 'mod-a', permissions: [] } as unknown as ModRuntimeInfo;

    it('asks the App and hands back its answer, with no permission', () => {
        const back = vi.fn(() => true);
        registerFoliumHostActions({ back } as unknown as FoliumHostActions);
        expect(createFoliumUiService(mod, 'main').back()).toBe(true);
        back.mockReturnValue(false);
        expect(createFoliumUiService(mod, 'main').back()).toBe(false);
        expect(back).toHaveBeenCalledTimes(2);
    });

    it('is unavailable outside the main window', () => {
        registerFoliumHostActions({ back: () => true } as unknown as FoliumHostActions);
        expect(() => createFoliumUiService(mod, 'export').back()).toThrow('ui-unavailable-in-export-context');
    });
});
