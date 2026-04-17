import { useEffect, useMemo, useState } from 'react';
import type { HomeViewTab, NeteasePlaylist } from '../types';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';

type ViewState = 'home' | 'player';

export type HomeOverlay =
    | { type: 'playlist'; playlist: NeteasePlaylist; }
    | { type: 'album'; id: number; }
    | { type: 'artist'; id: number; };

type NavigationHistoryState = {
    view: ViewState;
    overlays: HomeOverlay[];
    overlayView: ViewState | null;
    search?: { query: string; sourceTab: HomeViewTab; } | null;
};

const LAST_APP_VIEW_KEY = 'last_app_view';
const NAV_DEBUG_ENABLED = true;

const buildHistoryState = (
    view: ViewState,
    overlays: HomeOverlay[],
    overlayView: ViewState | null,
    searchState: NavigationHistoryState['search'] = null
): NavigationHistoryState => ({
    view,
    overlays,
    overlayView,
    search: searchState,
});

export function useAppNavigation() {
    const [currentView, setCurrentView] = useState<ViewState>('home');
    const [overlayStack, setOverlayStack] = useState<HomeOverlay[]>([]);
    const [overlayView, setOverlayView] = useState<ViewState | null>(null);

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
        console.log('search', payload.search ?? getSearchSnapshot());
        console.log('replace', payload.replace ?? false);
        console.log('hash', payload.hash ?? window.location.hash);
        console.log('history.state', payload.historyState ?? window.history.state);
        console.trace();
        console.groupEnd();
    };

    const resetToHomeState = () => {
        localStorage.setItem(LAST_APP_VIEW_KEY, 'home');
        window.history.replaceState(
            buildHistoryState('home', [], null),
            '',
            window.location.pathname + window.location.search
        );
        setCurrentView('home');
        setOverlayStack([]);
        setOverlayView(null);
        useSearchNavigationStore.getState().hideSearchOverlay();
        logNavigation('resetToHomeState', {
            view: 'home',
            overlays: [],
            overlayView: null,
            search: null,
            replace: true,
            hash: window.location.pathname + window.location.search,
            historyState: buildHistoryState('home', [], null),
        });
    };

    useEffect(() => {
        console.log('[nav] debug-enabled', {
            location: window.location.href,
            historyState: window.history.state,
        });
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
            logNavigation('popstate:restore', {
                view: state.view,
                overlays: state.overlays || [],
                overlayView: state.overlayView ?? null,
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
        replace = false,
        hash,
        search,
    }: {
        view: ViewState;
        overlays: HomeOverlay[];
        overlayView: ViewState | null;
        replace?: boolean;
        hash?: string;
        search?: NavigationHistoryState['search'];
    }) => {
        const method = replace ? window.history.replaceState.bind(window.history) : window.history.pushState.bind(window.history);
        const nextState = buildHistoryState(view, overlays, overlayView, search ?? null);
        method(
            nextState,
            '',
            hash ?? window.location.hash
        );
        localStorage.setItem(LAST_APP_VIEW_KEY, view);
        setCurrentView(view);
        setOverlayStack(overlays);
        setOverlayView(overlayView);
        logNavigation(replace ? 'replaceNavigationState' : 'pushNavigationState', {
            view,
            overlays,
            overlayView,
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
            search: { query, sourceTab },
            replace,
            hash: `#search/${encodeURIComponent(query)}`,
        });
        pushNavigationState({
            view: 'home',
            overlays: overlayStack,
            overlayView,
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
            search: null,
            replace: true,
            hash: nextHash,
        });
        pushNavigationState({
            view: 'home',
            overlays: overlayStack,
            overlayView,
            replace: true,
            hash: nextHash,
            search: null,
        });
    };

    const navigateToHome = () => {
        if (overlayStack.length > 0) {
            const nextOverlays = overlayStack.slice(0, -1);
            const nextView = currentView === 'player' ? 'player' : 'home';
            logNavigation('navigateToHome:popOverlay', {
                view: nextView,
                overlays: nextOverlays,
                overlayView: nextOverlays.length > 0 ? overlayView : null,
                search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
                    ? {
                        query: useSearchNavigationStore.getState().searchQuery,
                        sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                    }
                    : null,
                replace: true,
                hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextView === 'player' ? '#player' : '#home'),
            });
            pushNavigationState({
                view: nextView,
                overlays: nextOverlays,
                overlayView: nextOverlays.length > 0 ? overlayView : null,
                replace: true,
                hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextView === 'player' ? '#player' : '#home'),
                search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
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
            });
            return;
        }

    };

    const navigateDirectHome = () => {
        logNavigation('navigateDirectHome');
        resetToHomeState();
    };

    const pushOverlay = (overlay: HomeOverlay) => {
        const nextOverlays = [...overlayStack, overlay];
        const nextView = currentView;
        logNavigation('pushOverlay', {
            view: nextView,
            overlays: nextOverlays,
            overlayView: nextView,
            search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
            hash: `#${overlay.type}`,
        });
        pushNavigationState({
            view: nextView,
            overlays: nextOverlays,
            overlayView: nextView,
            hash: `#${overlay.type}`,
            search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
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
        const nextView = currentView;
        logNavigation('popOverlay', {
            view: nextView,
            overlays: nextOverlays,
            overlayView: nextOverlays.length > 0 ? overlayView : null,
            search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
                ? {
                    query: useSearchNavigationStore.getState().searchQuery,
                    sourceTab: useSearchNavigationStore.getState().searchSourceTab,
                }
                : null,
            replace: true,
            hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextView === 'player' ? '#player' : '#home'),
        });
        pushNavigationState({
            view: nextView,
            overlays: nextOverlays,
            overlayView: nextOverlays.length > 0 ? overlayView : null,
            replace: true,
            hash: nextOverlays.length > 0 ? `#${nextOverlays[nextOverlays.length - 1].type}` : (nextView === 'player' ? '#player' : '#home'),
            search: nextView === 'home' && useSearchNavigationStore.getState().isSearchOpen
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
        console.log('[nav] state-change', {
            currentView,
            overlayStack: formatOverlayStack(overlayStack),
            overlayView,
            isOverlayVisible,
            search: getSearchSnapshot(),
            historyState: window.history.state,
            location: window.location.href,
        });
    }, [currentView, overlayStack, overlayView, isOverlayVisible]);

    return {
        currentView,
        overlayStack,
        overlayView,
        topOverlay,
        hasOverlay,
        isOverlayVisible,
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
