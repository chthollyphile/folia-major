import { create } from 'zustand';
import type React from 'react';
import type { PanelTab } from '../components/UnifiedPanel';

// src/stores/useAppViewStore.ts
// Which surface the app is showing, and the unified panel's own open/tab state.
//
// `view` was a useState inside useAppNavigation and reached ~25 places in App.tsx; the panel state
// was two more useStates in App.tsx handed down through the player-panel model. Both are read far
// from where they were declared, which is exactly what a store is for.
//
// The navigation *actions* deliberately stay in useAppNavigation: they drive window.history and
// carry refs, and nothing outside that hook should be able to move the view without going through
// them. This store is the readable truth about where the app is, not a second way to navigate.

export type AppView = 'home' | 'player' | 'lattice';

/**
 * A surface that reads typed characters as filter input — today the three home grids. It hands the
 * palette everything needed to stand in as its filter box, so there is one input, one command and
 * one place that knows what typing means, instead of a keydown listener and an `<input>` copied
 * into every grid.
 *
 * `getAnchor` is the element the palette portals its inline shell into. Each grid already places
 * its own box, and the palette borrowing that position is what keeps the box exactly where it was.
 */
/** What a surface can ask the palette for. See `commandPaletteRequest`. */
export type CommandPaletteRequest =
    | { seq: number; kind: 'filter' | 'dismiss-filter' | 'root' }
    // A button pointed at one specific command, so the palette opens straight into its surface.
    // Carrying the id here rather than threading a callback keeps buttons deep in the panel tree
    // from needing a prop chain back to the palette hook.
    | { seq: number; kind: 'command'; commandId: string };

export type CommandFilterHandle = {
    getQuery: () => string;
    setQuery: (query: string) => void;
    getAnchor: () => HTMLElement | null;
};

type AppViewState = {
    view: AppView;
    isPanelOpen: boolean;
    panelTab: PanelTab;
    /** The home surface has finished animating out, so it can stop rendering entirely. */
    isHomeFullyHidden: boolean;

    /** The surface that currently owns typed characters, or null when nothing does. */
    commandFilter: CommandFilterHandle | null;
    /** True while the palette is standing in as that surface's filter box. */
    isCommandFilterOpen: boolean;
    /**
     * A surface asking the palette to do something, without knowing anything about it: put this
     * surface's filter box up, take it down, or open the ordinary command list. The counter is
     * what makes two identical requests in a row both land.
     */
    commandPaletteRequest: CommandPaletteRequest;

    /** Written only by useAppNavigation, which owns the history transitions. */
    setView: (view: AppView) => void;
    setIsPanelOpen: React.Dispatch<React.SetStateAction<boolean>>;
    setPanelTab: React.Dispatch<React.SetStateAction<PanelTab>>;
    setIsHomeFullyHidden: React.Dispatch<React.SetStateAction<boolean>>;
    /** Returns the unregister function. Registering replaces whoever held it. */
    registerCommandFilter: (handle: CommandFilterHandle) => () => void;
    setIsCommandFilterOpen: (isOpen: boolean) => void;
    requestCommandPalette: (kind: 'filter' | 'dismiss-filter' | 'root') => void;
    requestCommandPaletteCommand: (commandId: string) => void;
};

const resolve = <T,>(next: React.SetStateAction<T>, previous: T): T => (
    typeof next === 'function' ? (next as (prev: T) => T)(previous) : next
);

export const useAppViewStore = create<AppViewState>((set, get) => ({
    view: 'home',
    isPanelOpen: false,
    panelTab: 'cover',
    isHomeFullyHidden: false,
    commandFilter: null,
    isCommandFilterOpen: false,
    commandPaletteRequest: { seq: 0, kind: 'filter' },

    setView: (view) => set({ view }),
    setIsPanelOpen: (next) => set({ isPanelOpen: resolve(next, get().isPanelOpen) }),
    setPanelTab: (next) => set({ panelTab: resolve(next, get().panelTab) }),
    setIsHomeFullyHidden: (next) => set({ isHomeFullyHidden: resolve(next, get().isHomeFullyHidden) }),
    registerCommandFilter: (handle) => {
        set({ commandFilter: handle });
        // Grids unmount in either order during a view change, so a late teardown from an owner
        // that has already been replaced must not clear the new one.
        return () => {
            if (get().commandFilter === handle) {
                set({ commandFilter: null, isCommandFilterOpen: false });
            }
        };
    },
    setIsCommandFilterOpen: (isOpen) => set({ isCommandFilterOpen: isOpen }),
    requestCommandPalette: (kind) => set({ commandPaletteRequest: { seq: get().commandPaletteRequest.seq + 1, kind } }),
    requestCommandPaletteCommand: (commandId) => set({
        commandPaletteRequest: { seq: get().commandPaletteRequest.seq + 1, kind: 'command', commandId },
    }),
}));

// Module-level handles for the assembly layer: these are actions, so they need no subscription.
// Importing them where they are used keeps App.tsx out of the chain (see setStatusMessage).
export const setIsPanelOpen: AppViewState['setIsPanelOpen'] = (next) => useAppViewStore.getState().setIsPanelOpen(next);
export const setPanelTab: AppViewState['setPanelTab'] = (next) => useAppViewStore.getState().setPanelTab(next);
export const registerCommandFilter: AppViewState['registerCommandFilter'] = (handle) => useAppViewStore.getState().registerCommandFilter(handle);
export const setIsCommandFilterOpen: AppViewState['setIsCommandFilterOpen'] = (isOpen) => useAppViewStore.getState().setIsCommandFilterOpen(isOpen);
/** Put this surface's filter box back up — it is already filtered, or a button asked for it. */
export const openCommandFilter = () => useAppViewStore.getState().requestCommandPalette('filter');
/** Take it down again, for the clicks that used to dismiss a grid's own box. */
export const closeCommandFilter = () => useAppViewStore.getState().requestCommandPalette('dismiss-filter');
/** Open the ordinary command list, for the affordances that can be pointed at it instead. */
export const openCommandPalette = () => useAppViewStore.getState().requestCommandPalette('root');
/** Open the palette straight into one command's surface, for buttons that stand in for it. */
export const openCommandPaletteCommand = (commandId: string) => (
    useAppViewStore.getState().requestCommandPaletteCommand(commandId)
);
