import { useEffect, useMemo, useState } from 'react';
import type { HomeViewTab, LocalLibraryGroup, NeteasePlaylist } from '../types';
import type { NavidromeViewSelection } from '../types/navidrome';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';

type ViewState = 'home' | 'player';

export type HomeOverlay =
    | { type: 'playlist'; playlist: NeteasePlaylist; }
    | { type: 'album'; id: number; }
    | { type: 'artist'; id: number; };

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

type NavigationHistoryState = {
    view: ViewState;
    overlays: HomeOverlay[];
    overlayView: ViewState | null;
    overlayOriginView: ViewState | null;
    search?: { query: string; sourceTab: HomeViewTab; } | null;
};

type OverlayDisplayState = {
    view: ViewState;
    overlayView: ViewState | null;
    overlayOriginView: ViewState | null;
};

const LAST_APP_VIEW_KEY = 'last_app_view';
const NAV_DEBUG_ENABLED = false;

const buildHistoryState = (
    view: ViewState,
    overlays: HomeOverlay[],
    overlayView: ViewState | null,
    overlayOriginView: ViewState | null,
    searchState: NavigationHistoryState['search'] = null
): NavigationHistoryState => ({
    view,
    overlays,
    overlayView,
    overlayOriginView,
    search: searchState,
});

export const resolveOverlayPushState = (
    currentView: ViewState,
    overlayStackLength: number,
    overlayOriginView: ViewState | null
): OverlayDisplayState => ({
    view: 'home',
    overlayView: 'home',
    overlayOriginView: overlayStackLength > 0 ? overlayOriginView : currentView,
});

export const resolveOverlayPopState = (
    nextOverlayCount: number,
    overlayOriginView: ViewState | null
): OverlayDisplayState => ({
    view: nextOverlayCount > 0 ? 'home' : (overlayOriginView ?? 'home'),
    overlayView: nextOverlayCount > 0 ? 'home' : null,
    overlayOriginView: nextOverlayCount > 0 ? overlayOriginView : null,
});

export function useAppNavigation() {
    const [currentView, setCurrentView] = useState<ViewState>('home');
    const [overlayStack, setOverlayStack] = useState<HomeOverlay[]>([]);
    const [overlayView, setOverlayView] = useState<ViewState | null>(null);
    const [overlayOriginView, setOverlayOriginView] = useState<ViewState | null>(null);
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

    const formatOverlayStack = (overlays: HomeOverlay[]) => overlays.map((overlay, index) => {
        if (overlay.type === 'playlist') {
            return `${index}:${overlay.type}:${overlay.playlist.id}:${overlay.playlist.name}`;
        }
        return `${index}:${overlay.type}:${overlay.id}`;
    });

    const getSearchSnapshot = () => {
        const searchState = useSearchNavigationStore.getState();
        return {
            isOpen: searchState.isSearchOpen,
            query: searchState.searchQuery,
            sourceTab: searchState.searchSourceTab,
            resultCount: searchState.searchResults?.length ?? 0,
        };
    };

    const logNavigation = (
        label: string,
        payload: {
            view?: ViewState;
            overlays?: HomeOverlay[];
            overlayView?: ViewState | null;
            overlayOriginView?: ViewState | null;
            search?: NavigationHistoryState['search'] | ReturnType<typeof getSearchSnapshot> | null;
            replace?: boolean;
            hash?: string;
            historyState?: unknown;
        } = {}
    ) => {
        if (!NAV_DEBUG_ENABLED) {
            return;
        }

        console.groupCollapsed(`[nav] ${label}`);
        console.log('currentView', payload.view ?? currentView);
        console.log('overlayStack', formatOverlayStack(payload.overlays ?? overlayStack));
        console.log('overlayView', payload.overlayView ?? overlayView);
        console.log('overlayOriginView', payload.overlayOriginView ?? overlayOriginView);
        console.log('search', payload.search ?? getSearchSnapshot());
        console.log('replace', payload.replace ?? false);
        console.log('hash', payload.hash ?? window.location.hash);
        console.log('history.state', payload.historyState ?? window.history.state);
        console.trace();
        console.groupEnd();
    };

    const resetToHomeState = (options?: { clearContext?: boolean; }) => {
        const clearContext = options?.clearContext ?? true;
        localStorage.setItem(LAST_APP_VIEW_KEY, 'home');
        window.history.replaceState(
            buildHistoryState('home', [], null, null),
            '',
            window.location.pathname + window.location.search
        );
        setCurrentView('home');
        setOverlayStack([]);
        setOverlayView(null);
        setOverlayOriginView(null);
        if (clearContext) {
            setPendingNavidromeSelection(null);
            setLocalMusicState(prev => ({
                ...prev,
                activeRow: 0,
                selectedGroup: null,
                detailStack: [],
                detailOriginView: null,
            }));
        }
        useSearchNavigationStore.getState().hideSearchOverlay();
        logNavigation('resetToHomeState', {
            view: 'home',
            overlays: [],
            overlayView: null,
            overlayOriginView: null,
            search: null,
            replace: true,
            hash: window.location.pathname + window.location.search,
            historyState: buildHistoryState('home', [], null, null),
        });
    };

    useEffect(() => {
        resetToHomeState();

        const handlePopState = (event: PopStateEvent) => {
            const state = event.state as NavigationHistoryState | null;

            if (!state) {
                logNavigation('popstate:null-state', {
                    historyState: state,
                });
                resetToHomeState();
                return;
            }

            localStorage.setItem(LAST_APP_VIEW_KEY, state.view);
            setCurrentView(state.view);
            setOverlayStack(state.overlays || []);
            setOverlayView(state.overlayView ?? null);
            setOverlayOriginView(state.overlayOriginView ?? null);
            logNavigation('popstate:restore', {
                view: state.view,
                overlays: state.overlays || [],
                overlayView: state.overlayView ?? null,
                overlayOriginView: state.overlayOriginView ?? null,
                search: state.search ?? null,
                historyState: state,
            });

            if (state.search) {
                useSearchNavigationStore.getState().restoreSearch(state.search);
            } else {
                useSearchNavigationStore.getState().hideSearchOverlay();
            }
        };

        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);

    const pushNavigationState = ({
        view,
        overlays,
        overlayView,
        overlayOriginView,
        replace = false,
        hash,
        search,
    }: {
        view: ViewState;
        overlays: HomeOverlay[];
        overlayView: ViewState | null;
        overlayOriginView: ViewState | null;
        replace?: boolean;
        hash?: string;
        search?: NavigationHistoryState['search'];
    }) => {
        const method = replace ? window.history.replaceState.bind(window.history) : window.history.pushState.bind(window.history);
        const nextState = buildHistoryState(view, overlays, overlayView, overlayOriginView, search ?? null);
        method(
            nextState,
            '',
            hash ?? window.location.hash
        );
        localStorage.setItem(LAST_APP_VIEW_KEY, view);
        setCurrentView(view);
        setOverlayStack(overlays);
        setOverlayView(overlayView);
        setOverlayOriginView(overlayOriginView);
        logNavigation(replace ? 'replaceNavigationState' : 'pushNavigationState', {
            view,
            overlays,
            overlayView,
            overlayOriginView,
            search: search ?? null,
            replace,
            hash,
            historyState: nextState,
        });
    };

    const navigateToPlayer = () => {
        const currentSearch = useSearchNavigationStore.getState();
        const search = currentSearch.isSearchOpen
            ? { query: currentSearch.searchQuery, sourceTab: currentSearch.searchSourceTab }
            : null;

        if (overlayStack.length > 0 && overlayView !== null) {
            pushNavigationState({
                view: 'player',
                overlays: overlayStack,
                overlayView: null,
                overlayOriginView,
                replace: true,
                hash: '#player',
                search,
            });
            return;
        }

        if (window.history.state?.view !== 'player') {
            logNavigation('navigateToPlayer:push', {
                view: 'player',
                overlays: overlayStack,
                search,
                hash: '#player',
            });
            pushNavigationState({
                view: 'player',
                overlays: overlayStack,
                overlayView,
                overlayOriginView,
                hash: '#player',
                search,
            });
            return;
        }

        setCurrentView('player');
        logNavigation('navigateToPlayer:setViewOnly', {
            view: 'player',
            overlays: overlayStack,
            overlayView,
            overlayOriginView,
            search,
        });
    };

    const navigateToSearch = ({
        query,
        sourceTab,
        replace = false,
    }: {
        query: string;
        sourceTab: HomeViewTab;
        replace?: boolean;
    }) => {
        logNavigation('navigateToSearch', {
            view: 'home',
            overlays: overlayStack,
            overlayView,
            overlayOriginView,
            search: { query, sourceTab },
            replace,
            hash: `#search/${encodeURIComponent(query)}`,
        });
        pushNavigationState({
            view: 'home',
            overlays: overlayStack,
            overlayView,
            overlayOriginView,
            replace,
            hash: `#search/${encodeURIComponent(query)}`,
            search: { query, sourceTab },
        });
        useSearchNavigationStore.getState().restoreSearch({ query, sourceTab });
    };

    const closeSearchView = () => {
        useSearchNavigationStore.getState().hideSearchOverlay();

        const nextHash = overlayStack.length > 0
            ? `#${overlayStack[overlayStack.length - 1].type}`
            : window.location.pathname + window.location.search;

        logNavigation('closeSearchView', {
            view: 'home',
            overlays: overlayStack,
            overlayView,
            overlayOriginView,
            search: null,
            replace: true,
            hash: nextHash,
        });
        pushNavigationState({
            view: 'home',
            overlays: overlayStack,
            overlayView,
            overlayOriginView,
            replace: true,
            hash: nextHash,
            search: null,
        });
    };

    const navigateToHome = () => {
        if (overlayStack.length > 0) {
            if (currentView === 'player' && overlayView === null) {
                const overlayState = resolveOverlayPushState(
                    overlayOriginView ?? 'home',
                    overlayStack.length - 1,
                    overlayOriginView
                );
                pushNavigationState({
                    view: overlayState.view,
                    overlays: overlayStack,
                    overlayView: overlayState.overlayView,
                    overlayOriginView: overlayState.overlayOriginView,
                    replace: true,
                    hash: `#${overlayStack[overlayStack.length - 1].type}`,
                    search: overlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                        ? {
                            query: useSearchNavigationStore.getState().searchQuery,
                            sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                        }
                        : null,
                });
                return;
            }

            const nextOverlays = overlayStack.slice(0, -1);
            const nextOverlayState = resolveOverlayPopState(nextOverlays.length, overlayOriginView);
            logNavigation('navigateToHome:popOverlay', {
                view: nextOverlayState.view,
                overlays: nextOverlays,
                overlayView: nextOverlayState.overlayView,
                overlayOriginView: nextOverlayState.overlayOriginView,
                search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                    ? {
                        query: useSearchNavigationStore.getState().searchQuery,
                        sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                    }
                    : null,
                replace: true,
                hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextOverlayState.view === 'player' ? '#player' : '#home'),
            });
            pushNavigationState({
                view: nextOverlayState.view,
                overlays: nextOverlays,
                overlayView: nextOverlayState.overlayView,
                overlayOriginView: nextOverlayState.overlayOriginView,
                replace: true,
                hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextOverlayState.view === 'player' ? '#player' : '#home'),
                search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                    ? {
                        query: useSearchNavigationStore.getState().searchQuery,
                        sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                    }
                    : null,
            });
            return;
        }

        if (currentView === 'player') {
            setCurrentView('home');
            localStorage.setItem(LAST_APP_VIEW_KEY, 'home');
            logNavigation('navigateToHome:player->home', {
                view: 'home',
                overlays: overlayStack,
                overlayView,
                overlayOriginView,
            });
            return;
        }

    };

    const navigateDirectHome = (options?: { clearContext?: boolean; }) => {
        logNavigation('navigateDirectHome', {
            historyState: { clearContext: options?.clearContext ?? true },
        });
        resetToHomeState(options);
    };

    const pushOverlay = (overlay: HomeOverlay) => {
        const nextOverlays = [...overlayStack, overlay];
        const nextOverlayState = resolveOverlayPushState(currentView, overlayStack.length, overlayOriginView);
        logNavigation('pushOverlay', {
            view: nextOverlayState.view,
            overlays: nextOverlays,
            overlayView: nextOverlayState.overlayView,
            overlayOriginView: nextOverlayState.overlayOriginView,
            search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
            hash: `#${overlay.type}`,
        });
        pushNavigationState({
            view: nextOverlayState.view,
            overlays: nextOverlays,
            overlayView: nextOverlayState.overlayView,
            overlayOriginView: nextOverlayState.overlayOriginView,
            hash: `#${overlay.type}`,
            search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
        });
    };

    const handlePlaylistSelect = (playlist: NeteasePlaylist) => {
        pushOverlay({ type: 'playlist', playlist });
    };

    const handleAlbumSelect = (id: number) => {
        pushOverlay({ type: 'album', id });
    };

    const handleArtistSelect = (id: number) => {
        pushOverlay({ type: 'artist', id });
    };

    const popOverlay = () => {
        if (overlayStack.length === 0) {
            logNavigation('popOverlay:empty');
            return;
        }

        const nextOverlays = overlayStack.slice(0, -1);
        const nextOverlayState = resolveOverlayPopState(nextOverlays.length, overlayOriginView);
        logNavigation('popOverlay', {
            view: nextOverlayState.view,
            overlays: nextOverlays,
            overlayView: nextOverlayState.overlayView,
            overlayOriginView: nextOverlayState.overlayOriginView,
            search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
            replace: true,
            hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextOverlayState.view === 'player' ? '#player' : '#home'),
        });
        pushNavigationState({
            view: nextOverlayState.view,
            overlays: nextOverlays,
            overlayView: nextOverlayState.overlayView,
            overlayOriginView: nextOverlayState.overlayOriginView,
            replace: true,
            hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextOverlayState.view === 'player' ? '#player' : '#home'),
            search: nextOverlayState.view === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
        });
    };

    const topOverlay = useMemo(() => overlayStack[overlayStack.length - 1] ?? null, [overlayStack]);
    const hasOverlay = overlayStack.length > 0;
    const isOverlayVisible = hasOverlay && overlayView === currentView;

    useEffect(() => {
        if (!NAV_DEBUG_ENABLED) {
            return;
        }

        console.log('[nav] state-change', {
            currentView,
            overlayStack: formatOverlayStack(overlayStack),
            overlayView,
            overlayOriginView,
            isOverlayVisible,
            search: getSearchSnapshot(),
            historyState: window.history.state,
            location: window.location.href,
        });
    }, [currentView, overlayStack, overlayView, overlayOriginView, isOverlayVisible]);

    return {
        currentView,
        overlayStack,
        overlayView,
        overlayOriginView,
        topOverlay,
        hasOverlay,
        isOverlayVisible,
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
        navigateDirectHome,
        navigateToSearch,
        closeSearchView,
        handlePlaylistSelect,
        handleAlbumSelect,
        handleArtistSelect,
        popOverlay,
    };
}
