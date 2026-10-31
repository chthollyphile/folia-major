import { create } from 'zustand';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import type { HomeViewTab, LocalSong, SongResult, UnifiedSong } from '../types';
import { DEFAULT_ONLINE_PROVIDER_ID } from '../types/onlineMusic';
import type { OmniCollection, OmniSearchKind, OnlineProviderId } from '../types/onlineMusic';
import {
    applyLocalLibraryEntityDisplay,
    buildUnifiedLocalSong,
    type LocalLibraryDisplayCatalog,
} from '../services/playbackAdapters';
import { omni } from '../services/onlineMusic/omni';
import { isLocalPlaybackSong, isNavidromePlaybackSong } from '../utils/appPlaybackGuards';

const LAST_HOME_VIEW_TAB_KEY = 'last_home_view_tab';
const DEFAULT_SEARCH_LIMIT = 30;
export type SearchSource = OnlineProviderId | 'local' | 'navidrome';
export type SearchReturnView = 'home' | 'player';
/** 搜什么：单曲、专辑或歌单。专辑和歌单只有在线平台搜得到（omni.getProviderSearchKinds），本地与 Navidrome 只搜单曲。 */
export type SearchKind = OmniSearchKind;

type SearchExecutorDeps = {
    localSongs: LocalSong[];
    localLibraryCatalog?: LocalLibraryDisplayCatalog;
    t: (key: string, fallback?: string) => string;
};

type SearchExecutionResult = {
    /** 单曲搜索的结果；搜专辑、歌单时是空的。 */
    results: UnifiedSong[];
    /** 专辑、歌单搜索的结果；搜单曲时是空的。 */
    collections: OmniCollection[];
    hasMore: boolean;
    nextOffset: number;
    total?: number;
};

type SearchCacheEntry = {
    results: UnifiedSong[];
    collections: OmniCollection[];
    offset: number;
    hasMore: boolean;
    total: number | null;
    scrollTop: number;
};

interface SearchNavigationState {
    homeViewTab: HomeViewTab;
    searchQuery: string;
    /** 结果是按哪个词搜出来的（提交或恢复时定下）；searchQuery 是输入框里正在打的字。 */
    submittedQuery: string;
    searchSourceTab: SearchSource;
    searchKind: SearchKind;
    searchResults: UnifiedSong[] | null;
    /** 搜专辑、歌单时的结果（searchKind 不是 'song'）；还没搜过是 null。 */
    collectionResults: OmniCollection[] | null;
    /** 平台说一共有多少条；没说是 null。 */
    resultTotal: number | null;
    searchReturnView: SearchReturnView;
    isSearchOpen: boolean;
    isSearching: boolean;
    isLoadingMore: boolean;
    searchError: string | null;
    requestId: number;
    offset: number;
    limit: number;
    hasMore: boolean;
    scrollTop: number;
    searchCache: Record<string, SearchCacheEntry>;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setSearchQuery: (query: string) => void;
    setSearchScrollTop: (scrollTop: number) => void;
    restoreSearch: (payload: { query: string; sourceTab: SearchSource; kind?: SearchKind; returnView?: SearchReturnView; }) => void;
    hideSearchOverlay: () => void;
    resetRuntime: (onlineProviderId?: OnlineProviderId) => void;
    followOnlineProvider: (providerId: OnlineProviderId) => void;
    /** `kind` 不给就沿用当前的；来源搜不到这一种时退回单曲（resolveSearchKind）。 */
    submitSearch: (payload: { query?: string; sourceTab: SearchSource; kind?: SearchKind; deps: SearchExecutorDeps; returnView?: SearchReturnView; }) => Promise<boolean>;
    loadMoreSearchResults: (payload: { deps: SearchExecutorDeps; }) => Promise<void>;
}

const getSearchCacheKey = (query: string, sourceTab: SearchSource, kind: SearchKind) => (
    `${sourceTab}:${kind}:${query.trim().toLowerCase()}`
);

/** 这个来源能搜的种类：在线平台问 omni，本地与 Navidrome 只有单曲。单曲总在第一个。 */
export const getSearchKinds = (sourceTab: SearchSource): SearchKind[] => {
    if (sourceTab === 'local' || sourceTab === 'navidrome') return ['song'];
    const kinds = omni.getProviderSearchKinds(sourceTab);
    return kinds.includes('song') ? kinds : ['song', ...kinds];
};

/** 来源搜不到要的那一种（换到了没有专辑搜索的平台）就搜单曲。 */
export const resolveSearchKind = (sourceTab: SearchSource, kind: SearchKind): SearchKind => (
    getSearchKinds(sourceTab).includes(kind) ? kind : 'song'
);

export const resolveSearchSource = (tab: HomeViewTab | SearchSource): SearchSource => {
    if (tab === 'local' || tab === 'navidrome') {
        return tab;
    }
    if (tab !== 'playlist' && tab !== 'albums' && tab !== 'radio' && tab !== 'explore') return tab as OnlineProviderId;
    return DEFAULT_ONLINE_PROVIDER_ID;
};

export const resolveCommandPaletteSearchSource = (
    currentSong: SongResult | null,
    searchSourceTab: SearchSource,
    activeOnlineProviderId: OnlineProviderId,
): SearchSource => {
    if (currentSong && isLocalPlaybackSong(currentSong)) return 'local';
    if (currentSong && isNavidromePlaybackSong(currentSong)) return 'navidrome';
    if (currentSong || searchSourceTab === DEFAULT_ONLINE_PROVIDER_ID) return activeOnlineProviderId;
    return searchSourceTab;
};

const mapLocalSongToUnifiedSong = (
    song: LocalSong,
    catalog?: LocalLibraryDisplayCatalog,
): UnifiedSong => applyLocalLibraryEntityDisplay(buildUnifiedLocalSong({
        localSong: song,
        matchedSong: null,
        coverUrl: song.useOnlineCover ? song.onlineMetadata?.coverUrl || null : null,
        preferOnlineMetadata: false,
    }), catalog);

const searchLocalSongs = (
    deps: SearchExecutorDeps,
    query: string,
): SearchExecutionResult => {
    const lowerQuery = query.toLowerCase();
    const results = deps.localSongs
        .filter(song => {
            const title = song.title.toLowerCase();
            const artist = [
                ...song.importedMetadata.artistNames,
                ...song.onlineMetadata?.artists.map(item => item.name) || [],
            ].join(' ').toLowerCase();
            const album = [song.importedMetadata.albumName, song.onlineMetadata?.album?.name]
                .filter(Boolean).join(' ').toLowerCase();
            return title.includes(lowerQuery) || artist.includes(lowerQuery) || album.includes(lowerQuery);
        })
        .map(song => mapLocalSongToUnifiedSong(song, deps.localLibraryCatalog));

    return {
        results,
        collections: [],
        hasMore: false,
        nextOffset: results.length,
    };
};

const searchNavidromeSongs = async (query: string): Promise<SearchExecutionResult> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { results: [], collections: [], hasMore: false, nextOffset: 0 };
    }

    const response = await navidromeApi.search(config, query, 0, 0, DEFAULT_SEARCH_LIMIT);
    const results = (response.song || []).map(song => {
        const navidromeSong = navidromeApi.toNavidromeSong(config, song);
        return navidromeSong as UnifiedSong;
    });

    return {
        results,
        collections: [],
        hasMore: false,
        nextOffset: results.length,
    };
};

const searchOnlineProviderSongs = async (
    providerId: OnlineProviderId,
    query: string,
    limit: number,
    offset: number,
): Promise<SearchExecutionResult> => {
    const page = await omni.searchProviderSongs(providerId, query, { limit, offset });
    return { results: page.items, collections: [], hasMore: page.hasMore, nextOffset: page.nextOffset, total: page.total };
};

const searchOnlineProviderCollections = async (
    providerId: OnlineProviderId,
    kind: Exclude<SearchKind, 'song'>,
    query: string,
    limit: number,
    offset: number,
): Promise<SearchExecutionResult> => {
    const page = await omni.searchProviderCollections(providerId, kind, query, { limit, offset });
    return { results: [], collections: page.items, hasMore: page.hasMore, nextOffset: page.nextOffset, total: page.total };
};

const totalOf = (result: SearchExecutionResult): number | null => (
    typeof result.total === 'number' && Number.isFinite(result.total) && result.total >= 0 ? result.total : null
);

const executeSearch = async (
    query: string,
    sourceTab: SearchSource,
    kind: SearchKind,
    offset: number,
    limit: number,
    deps: SearchExecutorDeps
): Promise<SearchExecutionResult> => {
    if (sourceTab === 'local') {
        return searchLocalSongs(deps, query);
    }

    if (sourceTab === 'navidrome') {
        return searchNavidromeSongs(query);
    }

    return kind === 'song'
        ? searchOnlineProviderSongs(sourceTab, query, limit, offset)
        : searchOnlineProviderCollections(sourceTab, kind, query, limit, offset);
};

const getInitialHomeViewTab = (): HomeViewTab => {
    if (typeof window === 'undefined') {
        return 'playlist';
    }
    const savedTab = localStorage.getItem(LAST_HOME_VIEW_TAB_KEY);
    return savedTab === 'playlist' || savedTab === 'local' || savedTab === 'albums' || savedTab === 'navidrome' || savedTab === 'radio' || savedTab === 'explore'
        ? savedTab
        : 'playlist';
};

export const useSearchNavigationStore = create<SearchNavigationState>((set, get) => ({
    homeViewTab: getInitialHomeViewTab(),
    searchQuery: '',
    submittedQuery: '',
    searchSourceTab: DEFAULT_ONLINE_PROVIDER_ID,
    searchKind: 'song',
    searchResults: null,
    collectionResults: null,
    resultTotal: null,
    searchReturnView: 'home',
    isSearchOpen: false,
    isSearching: false,
    isLoadingMore: false,
    searchError: null,
    requestId: 0,
    offset: 0,
    limit: DEFAULT_SEARCH_LIMIT,
    hasMore: false,
    scrollTop: 0,
    searchCache: {},
    setHomeViewTab: (tab) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_HOME_VIEW_TAB_KEY, tab);
        }
        set({ homeViewTab: tab });
    },
    setSearchQuery: (query) => set({ searchQuery: query }),
    setSearchScrollTop: (scrollTop) => set(state => {
        // 滚的是按 submittedQuery 搜出来的那组结果；输入框里改了字也还是它。
        const cacheKey = getSearchCacheKey(state.submittedQuery, state.searchSourceTab, state.searchKind);
        const cached = state.searchCache[cacheKey];
        return {
            scrollTop,
            searchCache: cached
                ? {
                    ...state.searchCache,
                    [cacheKey]: { ...cached, scrollTop },
                }
                : state.searchCache,
        };
    }),
    // 旧的历史记录没有 kind：按当前的种类恢复。requestId 往前走一格：还在途的搜索或加载更多晚到时不再写进恢复出来的这一组。
    restoreSearch: ({ query, sourceTab, kind, returnView = 'home' }) => set(state => {
        const searchKind = resolveSearchKind(sourceTab, kind ?? state.searchKind);
        const cached = state.searchCache[getSearchCacheKey(query, sourceTab, searchKind)];
        return {
            requestId: state.requestId + 1,
            searchQuery: query,
            submittedQuery: query,
            searchSourceTab: sourceTab,
            searchKind,
            searchReturnView: returnView,
            searchResults: cached?.results ?? null,
            collectionResults: cached?.collections ?? null,
            resultTotal: cached?.total ?? null,
            offset: cached?.offset ?? 0,
            hasMore: cached?.hasMore ?? false,
            scrollTop: cached?.scrollTop ?? 0,
            searchError: null,
            isSearching: false,
            isLoadingMore: false,
            isSearchOpen: true,
        };
    }),
    hideSearchOverlay: () => set({ isSearchOpen: false, searchReturnView: 'home' }),
    resetRuntime: (onlineProviderId) => set(state => ({
        searchQuery: '',
        submittedQuery: '',
        searchSourceTab: onlineProviderId ?? state.searchSourceTab,
        searchResults: null,
        collectionResults: null,
        resultTotal: null,
        searchReturnView: 'home',
        isSearchOpen: false,
        isSearching: false,
        isLoadingMore: false,
        searchError: null,
        requestId: state.requestId + 1,
        offset: 0,
        hasMore: false,
        scrollTop: 0,
    })),
    // The overlay's online source is the active provider. A switch moves it through resetRuntime, but
    // the active provider also changes without one (startup, session restore, a Folium mod source going
    // away), so this keeps it in step. Local and Navidrome are left alone, and the results stay: clearing
    // them is the switch's job.
    followOnlineProvider: (providerId) => set(state => (
        state.searchSourceTab === 'local' || state.searchSourceTab === 'navidrome' || state.searchSourceTab === providerId
            ? state
            : { searchSourceTab: providerId }
    )),
    submitSearch: async ({ query, sourceTab, kind, deps, returnView = 'home' }) => {
        const trimmedQuery = (query ?? get().searchQuery).trim();
        if (!trimmedQuery) {
            return false;
        }

        const searchKind = resolveSearchKind(sourceTab, kind ?? get().searchKind);
        const requestId = get().requestId + 1;
        set({
            searchQuery: trimmedQuery,
            submittedQuery: trimmedQuery,
            searchSourceTab: sourceTab,
            searchKind,
            searchReturnView: returnView,
            isSearchOpen: true,
            isSearching: true,
            isLoadingMore: false,
            searchError: null,
            requestId,
            searchResults: null,
            collectionResults: null,
            resultTotal: null,
            offset: 0,
            hasMore: false,
            scrollTop: 0,
        });

        try {
            const result = await executeSearch(trimmedQuery, sourceTab, searchKind, 0, get().limit, deps);
            // 被另一次提交或一次历史恢复作废了：回 false，调用方不再拿它压历史。作废它的那一次自己会导航；
            // 恢复时历史已经是恢复后的样子，再压一条就会把人拉回一个没有结果的搜索页。
            if (get().requestId !== requestId) {
                return false;
            }
            const total = totalOf(result);
            set(state => ({
                searchResults: result.results,
                collectionResults: result.collections,
                resultTotal: total,
                hasMore: result.hasMore,
                offset: result.nextOffset,
                isSearching: false,
                // 上一组结果的列表卸载时会把它的滚动位置写回来（SearchResultsList 的 cleanup）：新结果从顶上开始。
                scrollTop: 0,
                searchCache: {
                    ...state.searchCache,
                    [getSearchCacheKey(trimmedQuery, sourceTab, searchKind)]: {
                        results: result.results,
                        collections: result.collections,
                        hasMore: result.hasMore,
                        offset: result.nextOffset,
                        total,
                        scrollTop: 0,
                    },
                },
            }));
            return true;
        } catch (error) {
            console.error('[SearchStore] submitSearch failed:', error);
            if (get().requestId !== requestId) {
                return false;
            }
            set({
                searchResults: [],
                collectionResults: [],
                resultTotal: null,
                hasMore: false,
                offset: 0,
                isSearching: false,
                scrollTop: 0,
                searchError: error instanceof Error ? error.message : 'search_failed',
            });
            return true;
        }
    },
    loadMoreSearchResults: async ({ deps }) => {
        // 接着翻的是已经显示的那组结果，按搜出它的词翻，不按输入框里改到一半的字。
        const {
            submittedQuery: searchQuery,
            searchSourceTab,
            searchKind,
            searchResults,
            collectionResults,
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

        const requestId = get().requestId;
        set({ isLoadingMore: true, searchError: null });

        try {
            const result = await executeSearch(searchQuery, searchSourceTab, searchKind, offset, limit, deps);
            if (get().requestId !== requestId) {
                return;
            }
            set(state => {
                const results = [...(searchResults || []), ...result.results];
                const collections = [...(collectionResults || []), ...result.collections];
                const total = totalOf(result) ?? state.resultTotal;
                return {
                    searchResults: results,
                    collectionResults: collections,
                    resultTotal: total,
                    hasMore: result.hasMore,
                    offset: result.nextOffset,
                    isLoadingMore: false,
                    searchCache: {
                        ...state.searchCache,
                        [getSearchCacheKey(searchQuery, searchSourceTab, searchKind)]: {
                            results,
                            collections,
                            hasMore: result.hasMore,
                            offset: result.nextOffset,
                            total,
                            scrollTop: state.scrollTop,
                        },
                    },
                };
            });
        } catch (error) {
            console.error('[SearchStore] loadMoreSearchResults failed:', error);
            if (get().requestId === requestId) {
                set({
                    isLoadingMore: false,
                    searchError: error instanceof Error ? error.message : 'search_failed',
                });
            }
        }
    },
}));
