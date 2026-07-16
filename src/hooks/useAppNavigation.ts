import { useEffect, useState } from 'react';
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

// src/hooks/useAppNavigation.ts

type ViewState = 'home' | 'player';

type LocalMusicNavigationState = {
    activeRow: 0 | 1 | 2 | 3;
    selectedGroup: LocalLibraryGroup | null;
    detailStack: LocalLibraryGroup[];
    detailOriginView: ViewState | null;
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

const getCollectionHash = (collection: GridViewCollectionDescriptor) => (
    `#collection/${collection.source}/${collection.type}/${encodeURIComponent(String(collection.id))}`
);

export function useAppNavigation() {
    const [currentView, setCurrentView] = useState<ViewState>('home');
    const [focusedPlaylistIndex, setFocusedPlaylistIndex] = useState(0);
    const [focusedFavoriteAlbumIndex, setFocusedFavoriteAlbumIndex] = useState(0);
    const [focusedRadioIndex, setFocusedRadioIndex] = useState(0);
    const [navidromeFocusedAlbumIndex, setNavidromeFocusedAlbumIndex] = useState(0);
    const [pendingNavidromeSelection, setPendingNavidromeSelection] = useState<NavidromeViewSelection | null>(null);
    const [localMusicState, setLocalMusicState] = useState<LocalMusicNavigationState>({
        activeRow: 0,
        selectedGroup: null,
        detailStack: [],
        detailOriginView: null,
        focusedFolderIndex: 0,
        focusedAlbumIndex: 0,
        focusedArtistIndex: 0,
        focusedPlaylistIndex: 0,
    });

    const restoreHistoryState = (state: NavigationHistoryState) => {
        localStorage.setItem(LAST_APP_VIEW_KEY, state.view);
        setCurrentView(state.view);
        useCollectionNavigationStore.getState().restore(state.collection ?? null);
        if (state.search) {
            useSearchNavigationStore.getState().restoreSearch(state.search);
        } else {
            useSearchNavigationStore.getState().hideSearchOverlay();
        }
    };

    const pushNavigationState = ({
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
    };

    const getStartupView = (): ViewState => (
        localStorage.getItem(OPEN_PLAYER_ON_LAUNCH_KEY) === 'true' ? 'player' : 'home'
    );

    const resetLocalNavigationContext = () => {
        setPendingNavidromeSelection(null);
        setLocalMusicState(prev => ({
            ...prev,
            activeRow: 0,
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
        }));
    };

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

    const navigateToPlayer = () => {
        const collection = useCollectionNavigationStore.getState().snapshot;
        const search = getSearchHistorySnapshot();
        pushNavigationState({
            view: 'player',
            hash: '#player',
            search,
            collection,
        });
    };

    const navigateToHome = () => {
        if (currentView === 'home') {
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
    };

    const navigateDirectHome = (options?: { clearContext?: boolean; }) => {
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
    };

    const navigateBackFromPlayer = () => {
        const historyState = window.history.state as NavigationHistoryState | null;
        if (shouldNavigatePlayerBackThroughHistory(historyState)) {
            window.history.back();
            return;
        }
        navigateDirectHome();
    };

    const navigateToSearch = ({
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
    };

    const closeSearchView = () => {
        const searchReturnView = useSearchNavigationStore.getState().searchReturnView;
        useSearchNavigationStore.getState().hideSearchOverlay();
        pushNavigationState({
            view: searchReturnView,
            replace: true,
            hash: searchReturnView === 'player'
                ? '#player'
                : window.location.pathname + window.location.search,
        });
    };

    const navigateToCollection = (
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
    };

    const pushCollection = (collection: GridViewCollectionDescriptor) => {
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
    };

    const backCollection = () => {
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
    };

    return {
        currentView,
        focusedPlaylistIndex,
        setFocusedPlaylistIndex,
        focusedFavoriteAlbumIndex,
        setFocusedFavoriteAlbumIndex,
        focusedRadioIndex,
        setFocusedRadioIndex,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection,
        setPendingNavidromeSelection,
        localMusicState,
        setLocalMusicState,
        navigateToPlayer,
        navigateToHome,
        navigateBackFromPlayer,
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        navigateToCollection,
        pushCollection,
        backCollection,
    };
}
