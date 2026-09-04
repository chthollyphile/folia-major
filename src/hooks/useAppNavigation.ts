import { useCallback, useEffect, useState } from 'react';
import type { LocalLibraryGroup } from '../types';
import type { NavidromeViewSelection } from '../types/navidrome';
import {
    type SearchReturnView,
    type SearchSource,
    useSearchNavigationStore,
} from '../stores/useSearchNavigationStore';
import {
    type CollectionNavigationOrigin,
    type CollectionNavigationSnapshot,
    useCollectionNavigationStore,
} from '../stores/useCollectionNavigationStore';
import type { GridViewCollectionDescriptor } from '../components/app/home/gridViewCollectionAdapters';
import { useAppViewStore } from '../stores/useAppViewStore';
import type { AppView } from '../stores/useAppViewStore';

// src/hooks/useAppNavigation.ts

type ViewState = AppView;

type LocalMusicNavigationState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: 'home' | 'player' | null;
    focusedFolderIndex: number;
    focusedAlbumIndex: number;
    focusedArtistIndex: number;
    focusedPlaylistIndex: number;
};

export type NavigationHistoryState = {
    view: ViewState;
    search?: { query: string; sourceTab: SearchSource; returnView?: SearchReturnView; } | null;
    collection?: CollectionNavigationSnapshot | null;
    appHistoryIndex: number;
};

const LAST_APP_VIEW_KEY = 'last_app_view';
const OPEN_PLAYER_ON_LAUNCH_KEY = 'open_player_on_launch';

const buildHistoryState = (
    view: ViewState,
    search: NavigationHistoryState['search'] = null,
    collection: NavigationHistoryState['collection'] = null,
    appHistoryIndex = 0,
): NavigationHistoryState => ({
    view,
    search,
    collection,
    appHistoryIndex,
});

const getAppHistoryIndex = (state: unknown): number => {
    if (!state || typeof state !== 'object') return 0;
    const index = (state as Partial<NavigationHistoryState>).appHistoryIndex;
    return typeof index === 'number' && Number.isFinite(index) && index >= 0 ? index : 0;
};

export const shouldNavigatePlayerBackThroughHistory = (
    state: NavigationHistoryState | null,
): boolean => state?.view === 'player' && getAppHistoryIndex(state) > 0;

export const shouldReplacePlayerNavigation = (
    state: NavigationHistoryState | null,
): boolean => state?.view === 'player';

const getSearchHistorySnapshot = (): NavigationHistoryState['search'] => {
    const searchState = useSearchNavigationStore.getState();
    return searchState.isSearchOpen
        ? {
            query: searchState.searchQuery,
            sourceTab: searchState.searchSourceTab,
            returnView: searchState.searchReturnView,
        }
        : null;
};

const getStartupView = (): ViewState => (
    localStorage.getItem(OPEN_PLAYER_ON_LAUNCH_KEY) === 'true' ? 'player' : 'home'
);

const getCollectionHash = (collection: GridViewCollectionDescriptor) => (
    `#collection/${collection.source}/${collection.type}/${encodeURIComponent(String(collection.id))}`
);

const LOCAL_MUSIC_LAST_ROW_KEY = 'folia_local_music_last_row';

export function useAppNavigation() {
    // The view itself lives in useAppViewStore so that consumers far from here can read it
    // without being handed it; this hook stays the only writer.
    const currentView = useAppViewStore(state => state.view);
    const setCurrentView = useAppViewStore(state => state.setView);
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [navidromeFocusedAlbumIndex, setNavidromeFocusedAlbumIndex] = useState(0);
    const [pendingNavidromeSelection, setPendingNavidromeSelection] = useState<NavidromeViewSelection | null>(null);
    const [localMusicState, setLocalMusicState] = useState<LocalMusicNavigationState>(() => {
        let savedRow = 0;
        try {
            const saved = localStorage.getItem(LOCAL_MUSIC_LAST_ROW_KEY);
            if (saved !== null) {
                const parsed = parseInt(saved, 10);
                if (!isNaN(parsed) && parsed >= 0 && parsed <= 3) {
                    savedRow = parsed;
                }
            }
        } catch (e) {
            console.warn('[useAppNavigation] Failed to restore local music last row:', e);
        }
        return {
            activeRow: savedRow as LocalMusicNavigationState['activeRow'],
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
            focusedFolderIndex: 0,
            focusedAlbumIndex: 0,
            focusedArtistIndex: 0,
            focusedPlaylistIndex: 0,
        };
    });

    useEffect(() => {
        try {
            localStorage.setItem(LOCAL_MUSIC_LAST_ROW_KEY, localMusicState.activeRow.toString());
        } catch (e) {
            console.warn('[useAppNavigation] Failed to save local music last row:', e);
        }
    }, [localMusicState.activeRow]);

    const restoreHistoryState = useCallback((state: NavigationHistoryState) => {
        localStorage.setItem(LAST_APP_VIEW_KEY, state.view);
        setCurrentView(state.view);
        useCollectionNavigationStore.getState().restore(state.collection ?? null);
        if (state.search) {
            useSearchNavigationStore.getState().restoreSearch(state.search);
        } else {
            useSearchNavigationStore.getState().hideSearchOverlay();
        }
    }, [setCurrentView]);

    const pushNavigationState = useCallback(({
        view,
        replace = false,
        hash,
        search = null,
        collection = null,
    }: {
        view: ViewState;
        replace?: boolean;
        hash?: string;
        search?: NavigationHistoryState['search'];
        collection?: NavigationHistoryState['collection'];
    }) => {
        const currentHistoryIndex = getAppHistoryIndex(window.history.state);
        const nextState = buildHistoryState(
            view,
            search,
            collection,
            replace ? currentHistoryIndex : currentHistoryIndex + 1,
        );
        const method = replace ? window.history.replaceState.bind(window.history) : window.history.pushState.bind(window.history);
        method(nextState, '', hash ?? window.location.hash);
        restoreHistoryState(nextState);
    }, [restoreHistoryState]);

    const resetLocalNavigationContext = useCallback(() => {
        setPendingNavidromeSelection(null);
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: 0,
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
        }));
    }, []);

    useEffect(() => {
        const initialView = getStartupView();
        const initialState = buildHistoryState(initialView);
        window.history.replaceState(
            initialState,
            '',
            initialView === 'player' ? '#player' : (window.location.pathname + window.location.search),
        );
        restoreHistoryState(initialState);
        resetLocalNavigationContext();

        const handlePopState = (event: PopStateEvent) => {
            const state = event.state as NavigationHistoryState | null;
            if (!state) {
                const fallbackState = buildHistoryState(getStartupView());
                window.history.replaceState(fallbackState, '', fallbackState.view === 'player' ? '#player' : '#home');
                restoreHistoryState(fallbackState);
                return;
            }
            restoreHistoryState(state);
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const navigateToPlayer = useCallback(() => {
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        const historyState = window.history.state as NavigationHistoryState | null;
        pushNavigationState({
            view: 'player',
            replace: shouldReplacePlayerNavigation(historyState),
            hash: '#player',
            search,
            collection,
        });
    }, [pushNavigationState]);

    const navigateToHome = useCallback(() => {
        if (useAppViewStore.getState().view === 'home') {
            return;
        }
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        pushNavigationState({
            view: 'home',
            hash: collection?.stack.length
                ? getCollectionHash(collection.stack[collection.stack.length - 1])
                : '#home',
            search,
            collection,
        });
    }, [pushNavigationState]);

    const navigateToLattice = useCallback(() => {
        if (useAppViewStore.getState().view === 'lattice') return;
        useSearchNavigationStore.getState().hideSearchOverlay();
        pushNavigationState({
            view: 'lattice',
            hash: '#lattice',
        });
    }, [pushNavigationState]);

    const navigateBackFromLattice = useCallback(() => {
        const state = window.history.state as NavigationHistoryState | null;
        if (state?.view === 'lattice' && getAppHistoryIndex(state) > 0) {
            window.history.back();
            return;
        }
        navigateToHome();
    }, [navigateToHome]);

    const navigateDirectHome = useCallback((options?: { clearContext?: boolean; }) => {
        const clearContext = options?.clearContext ?? true;
        if (clearContext) {
            resetLocalNavigationContext();
        }
        useSearchNavigationStore.getState().hideSearchOverlay();
        useCollectionNavigationStore.getState().clear();
        pushNavigationState({
            view: 'home',
            replace: true,
            hash: window.location.pathname + window.location.search,
        });
    }, [pushNavigationState, resetLocalNavigationContext]);

    const navigateBackFromPlayer = useCallback(() => {
        const historyState = window.history.state as NavigationHistoryState | null;
        if (shouldNavigatePlayerBackThroughHistory(historyState)) {
            window.history.back();
            return;
        }
        navigateDirectHome();
    }, [navigateDirectHome]);

    const navigateToSearch = useCallback(({
        query,
        sourceTab,
        replace = false,
        returnView = 'home',
    }: {
        query: string;
        sourceTab: SearchSource;
        replace?: boolean;
        returnView?: SearchReturnView;
    }) => {
        useCollectionNavigationStore.getState().clear();
        const search = { query, sourceTab, returnView };
        pushNavigationState({
            view: 'home',
            replace,
            hash: `#search/${encodeURIComponent(query)}`,
            search,
        });
    }, [pushNavigationState]);

    const closeSearchView = useCallback(() => {
        const searchReturnView = useSearchNavigationStore.getState().searchReturnView;
        useSearchNavigationStore.getState().hideSearchOverlay();
        pushNavigationState({
            view: searchReturnView,
            replace: true,
            hash: searchReturnView === 'player'
                ? '#player'
                : window.location.pathname + window.location.search,
        });
    }, [pushNavigationState]);

    const navigateToCollection = useCallback((
        collection: GridViewCollectionDescriptor,
        origin: CollectionNavigationOrigin,
    ) => {
        const snapshot = useCollectionNavigationStore.getState().openRoot(collection, origin);
        const search = origin === 'search' ? getSearchHistorySnapshot() : null;
        pushNavigationState({
            view: 'home',
            hash: getCollectionHash(collection),
            search,
            collection: snapshot,
        });
    }, [pushNavigationState]);

    const pushCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        const snapshot = useCollectionNavigationStore.getState().push(collection);
        if (!snapshot) {
            return;
        }
        pushNavigationState({
            view: 'home',
            hash: getCollectionHash(collection),
            search: snapshot.origin === 'search' ? getSearchHistorySnapshot() : null,
            collection: snapshot,
        });
    }, [pushNavigationState]);

    const backCollection = useCallback(() => {
        const snapshot = useCollectionNavigationStore.getState().snapshot;
        if (!snapshot) {
            return;
        }
        if (window.history.state?.collection) {
            window.history.back();
            return;
        }

        const nextStack = snapshot.stack.slice(0, -1);
        if (nextStack.length > 0) {
            useCollectionNavigationStore.getState().restore({ ...snapshot, stack: nextStack });
            return;
        }
        useCollectionNavigationStore.getState().clear();
        if (snapshot.origin === 'player') {
            setCurrentView('player');
        }
    }, [setCurrentView]);

    return {
        currentView,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        localMusicState,
        setLocalMusicState,
        navigateToPlayer,
        navigateToHome,
        navigateToLattice,
        navigateBackFromLattice,
        navigateBackFromPlayer,
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        navigateToCollection,
        pushCollection,
        backCollection,
    };
}
