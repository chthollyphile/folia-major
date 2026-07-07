import { create } from 'zustand';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { neteaseApi } from '../services/netease';
import type { HomeViewTab, LocalSong, UnifiedSong } from '../types';

const LAST_HOME_VIEW_TAB_KEY = 'last_home_view_tab';
const DEFAULT_SEARCH_LIMIT = 30;
export type SearchReturnView = 'home' | 'player';

type SearchExecutorDeps = {
    localSongs: LocalSong[];
    t: (key: string, fallback?: string) => string;
};

type SearchExecutionResult = {
    results: UnifiedSong[];
    hasMore: boolean;
    nextOffset: number;
};

interface SearchNavigationState {
    homeViewTab: HomeViewTab;
    searchQuery: string;
    searchSourceTab: HomeViewTab;
    searchResults: UnifiedSong[] | null;
    searchReturnView: SearchReturnView;
    isSearchOpen: boolean;
    isSearching: boolean;
    isLoadingMore: boolean;
    offset: number;
    limit: number;
    hasMore: boolean;
    scrollTop: number;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setSearchQuery: (query: string) => void;
    setSearchScrollTop: (scrollTop: number) => void;
    restoreSearch: (payload: { query: string; sourceTab: HomeViewTab; returnView?: SearchReturnView; }) => void;
    hideSearchOverlay: () => void;
    submitSearch: (payload: { query?: string; sourceTab: HomeViewTab; deps: SearchExecutorDeps; returnView?: SearchReturnView; }) => Promise<boolean>;
    loadMoreSearchResults: (payload: { deps: SearchExecutorDeps; }) => Promise<void>;
}

const mapLocalSongToUnifiedSong = (
    song: LocalSong,
    index: number,
    t: SearchExecutorDeps['t']
): UnifiedSong => ({
    id: -(Date.now() + index),
    name: song.title || song.embeddedTitle || song.fileName,
    artists: [{ id: 0, name: song.artist || song.embeddedArtist || t('player.unknownArtist') }],
    album: {
        id: 0,
        name: song.album || song.embeddedAlbum || t('player.unknownAlbum'),
        picUrl: song.matchedCoverUrl || undefined,
    },
    duration: song.duration,
    al: {
        id: 0,
        name: song.album || song.embeddedAlbum || t('player.unknownAlbum'),
        picUrl: song.matchedCoverUrl || undefined,
    },
    ar: [{ id: 0, name: song.artist || song.embeddedArtist || t('player.unknownArtist') }],
    dt: song.duration,
    isLocal: true,
    localData: song,
});

const searchLocalSongs = (
    localSongs: LocalSong[],
    query: string,
    t: SearchExecutorDeps['t']
): SearchExecutionResult => {
    const lowerQuery = query.toLowerCase();
    const results = localSongs
        .filter(song => {
            const title = (song.title || song.embeddedTitle || song.fileName || '').toLowerCase();
            const artist = (song.artist || song.embeddedArtist || '').toLowerCase();
            const album = (song.album || song.embeddedAlbum || '').toLowerCase();
            return title.includes(lowerQuery) || artist.includes(lowerQuery) || album.includes(lowerQuery);
        })
        .map((song, index) => mapLocalSongToUnifiedSong(song, index, t));

    return {
        results,
        hasMore: false,
        nextOffset: results.length,
    };
};

const searchNavidromeSongs = async (query: string): Promise<SearchExecutionResult> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { results: [], hasMore: false, nextOffset: 0 };
    }

    const response = await navidromeApi.search(config, query, 0, 0, DEFAULT_SEARCH_LIMIT);
    const results = (response.song || []).map(song => {
        const navidromeSong = navidromeApi.toNavidromeSong(config, song);
        return {
            ...navidromeSong,
            ar: navidromeSong.artists,
            al: navidromeSong.album,
            dt: navidromeSong.duration,
        } as UnifiedSong;
    });

    return {
        results,
        hasMore: false,
        nextOffset: results.length,
    };
};

const searchNeteaseSongs = async (query: string, limit: number, offset: number): Promise<SearchExecutionResult> => {
    const response = await neteaseApi.cloudSearch(query, limit, offset);
    const results = (response.result?.songs || []) as UnifiedSong[];
    const totalCount = response.result?.songCount || 0;

    return {
        results,
        hasMore: offset + results.length < totalCount,
        nextOffset: offset + results.length,
    };
};

const executeSearch = async (
    query: string,
    sourceTab: HomeViewTab,
    offset: number,
    limit: number,
    deps: SearchExecutorDeps
): Promise<SearchExecutionResult> => {
    if (sourceTab === 'local') {
        return searchLocalSongs(deps.localSongs, query, deps.t);
    }

    if (sourceTab === 'navidrome') {
        return searchNavidromeSongs(query);
    }

    return searchNeteaseSongs(query, limit, offset);
};

const getInitialHomeViewTab = (): HomeViewTab => {
    if (typeof window === 'undefined') {
        return 'playlist';
    }
    const savedTab = localStorage.getItem(LAST_HOME_VIEW_TAB_KEY);
    return savedTab === 'playlist' || savedTab === 'local' || savedTab === 'albums' || savedTab === 'navidrome' || savedTab === 'radio'
        ? savedTab
        : 'playlist';
};

export const useSearchNavigationStore = create<SearchNavigationState>((set, get) => ({
    homeViewTab: getInitialHomeViewTab(),
    searchQuery: '',
    searchSourceTab: 'playlist',
    searchResults: null,
    searchReturnView: 'home',
    isSearchOpen: false,
    isSearching: false,
    isLoadingMore: false,
    offset: 0,
    limit: DEFAULT_SEARCH_LIMIT,
    hasMore: false,
    scrollTop: 0,
    setHomeViewTab: (tab) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_HOME_VIEW_TAB_KEY, tab);
        }
        set({ homeViewTab: tab });
    },
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSearchScrollTop: (scrollTop) => set({ scrollTop }),
    restoreSearch: ({ query, sourceTab, returnView = 'home' }) => set({
        searchQuery: query,
        searchSourceTab: sourceTab,
        searchReturnView: returnView,
        isSearchOpen: true,
    }),
    hideSearchOverlay: () => set({ isSearchOpen: false, searchReturnView: 'home' }),
    submitSearch: async ({ query, sourceTab, deps, returnView = 'home' }) => {
        const trimmedQuery = (query ?? get().searchQuery).trim();
        if (!trimmedQuery) {
            return false;
        }

        set({
            searchQuery: trimmedQuery,
            searchSourceTab: sourceTab,
            searchReturnView: returnView,
            isSearchOpen: true,
            isSearching: true,
            isLoadingMore: false,
            searchResults: null,
            offset: 0,
            hasMore: false,
            scrollTop: 0,
        });

        try {
            const result = await executeSearch(trimmedQuery, sourceTab, 0, get().limit, deps);
            set({
                searchResults: result.results,
                hasMore: result.hasMore,
                offset: result.nextOffset,
                isSearching: false,
            });
            return true;
        } catch (error) {
            console.error('[SearchStore] submitSearch failed:', error);
            set({
                searchResults: [],
                hasMore: false,
                offset: 0,
                isSearching: false,
            });
            return true;
        }
    },
    loadMoreSearchResults: async ({ deps }) => {
        const {
            searchQuery,
            searchSourceTab,
            searchResults,
            hasMore,
            isSearching,
            isLoadingMore,
            offset,
            limit,
        } = get();

        if (
            searchSourceTab === 'local'
            || searchSourceTab === 'navidrome'
            || !hasMore
            || isSearching
            || isLoadingMore
            || !searchQuery.trim()
        ) {
            return;
        }

        set({ isLoadingMore: true });

        try {
            const result = await executeSearch(searchQuery, searchSourceTab, offset, limit, deps);
            set({
                searchResults: [...(searchResults || []), ...result.results],
                hasMore: result.hasMore,
                offset: result.nextOffset,
                isLoadingMore: false,
            });
        } catch (error) {
            console.error('[SearchStore] loadMoreSearchResults failed:', error);
            set({ isLoadingMore: false });
        }
    },
}));
