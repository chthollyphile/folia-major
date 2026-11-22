import { create } from 'zustand';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import type { HomeOnlineViewTab, HomeViewTab, LocalSong, SongResult, UnifiedSong } from '../types';
import type { OmniCollection, OmniSearchKind, OnlineProviderId } from '../types/onlineMusic';
import {
    applyLocalLibraryEntityDisplay,
    buildUnifiedLocalSong,
    type LocalLibraryDisplayCatalog,
} from '../services/playbackAdapters';
import { omni } from '../services/onlineMusic/omni';
import type { SubsonicAlbum, SubsonicPlaylist } from '../types/navidrome';
import type {
    LocalGridViewCollectionDescriptor,
    NavidromeGridViewCollectionDescriptor,
} from '../library/core/collection/collection.contract';
import { isLocalPlaybackSong, isNavidromePlaybackSong } from '../utils/appPlaybackGuards';
import { sanitizeSearchHistory, withSearchHistoryQuery, withoutSearchHistoryQuery } from '../utils/searchHistory';
import { getStoredString, readStoredString, setStoredString } from './storagePrimitives';

const LAST_HOME_VIEW_TAB_KEY = 'last_home_view_tab';
/** 在线组上次停在哪一页（首页两级页签：从别的组回到在线组时回到它）。 */
const LAST_HOME_ONLINE_TAB_KEY = 'last_home_online_tab';
/** 搜索历史：字符串数组的 JSON，最近的在前。列表的规则（去重、淘汰）在 utils/searchHistory.ts。 */
const SEARCH_HISTORY_KEY = 'folia_search_history_v1';
const DEFAULT_SEARCH_LIMIT = 30;
export type SearchSource = OnlineProviderId | 'local' | 'navidrome';
export type SearchReturnView = 'home' | 'player';
/** 搜什么：单曲、专辑或歌单。在线平台搜得到几种问 omni.getProviderSearchKinds，本地与 Navidrome 三种都有。 */
export type SearchKind = OmniSearchKind;

/**
 * 专辑、歌单搜索的一条结果：在线平台的是 omni 的集合（打开时再转成集合描述）；本地与 Navidrome 的
 * 直接就是集合描述（带 source），打开时原样交给集合导航。
 */
export type SearchCollectionResult =
    | OmniCollection
    | LocalGridViewCollectionDescriptor
    | NavidromeGridViewCollectionDescriptor;

/** 这条结果是不是本地或 Navidrome 的集合描述（在线平台的 omni 集合没有 source）。 */
export const isLibrarySearchCollection = (
    collection: SearchCollectionResult,
): collection is LocalGridViewCollectionDescriptor | NavidromeGridViewCollectionDescriptor => 'source' in collection;

export type SearchExecutorDeps = {
    localSongs: LocalSong[];
    localLibraryCatalog?: LocalLibraryDisplayCatalog;
    t: (key: string, fallback?: string) => string;
};

/** 读本地曲库的专辑或歌单（与首页本地页签同一套分组）。 */
export type LocalSearchCollectionsReader = (kind: 'album' | 'playlist') => LocalGridViewCollectionDescriptor[];

// 搜本地专辑、歌单时从哪读：由应用登记（usePlaybackQueueController），而不是放进每次的 deps——
// 首页、命令面板、搜索页各自拼 deps，放进 deps 就得每个入口都记得带上。没登记时搜不到。
let localSearchCollectionsReader: LocalSearchCollectionsReader | null = null;

/** 登记（或用 null 撤下）本地专辑、歌单的读取函数。 */
export const setLocalSearchCollectionsReader = (reader: LocalSearchCollectionsReader | null) => {
    localSearchCollectionsReader = reader;
};

type SearchExecutionResult = {
    /** 单曲搜索的结果；搜专辑、歌单时是空的。 */
    results: UnifiedSong[];
    /** 专辑、歌单搜索的结果；搜单曲时是空的。 */
    collections: SearchCollectionResult[];
    hasMore: boolean;
    nextOffset: number;
    total?: number;
};

type SearchCacheEntry = {
    results: UnifiedSong[];
    collections: SearchCollectionResult[];
    offset: number;
    hasMore: boolean;
    total: number | null;
    scrollTop: number;
};

interface SearchNavigationState {
    homeViewTab: HomeViewTab;
    /** 在线组上次停在哪一页；homeViewTab 是在线页时与它相同。 */
    homeOnlineTab: HomeOnlineViewTab;
    searchQuery: string;
    /** 结果是按哪个词搜出来的（提交或恢复时定下）；searchQuery 是输入框里正在打的字。 */
    submittedQuery: string;
    searchSourceTab: SearchSource;
    searchKind: SearchKind;
    searchResults: UnifiedSong[] | null;
    /** 搜专辑、歌单时的结果（searchKind 不是 'song'）；还没搜过是 null。 */
    collectionResults: SearchCollectionResult[] | null;
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
    /**
     * 搜过的词，最近的在前（跨会话保留）。只由 submitSearch 记：所有搜索入口都经过它，
     * 所以这里不提供「记一条」的动作，界面只能读、删一条或清空。
     */
    searchHistory: string[];
    forgetSearchHistoryQuery: (query: string) => void;
    clearSearchHistory: () => void;
    setHomeViewTab: (tab: HomeViewTab) => void;
    setSearchQuery: (query: string) => void;
    setSearchScrollTop: (scrollTop: number) => void;
    restoreSearch: (payload: { query: string; sourceTab: SearchSource; kind?: SearchKind; returnView?: SearchReturnView; }) => void;
    hideSearchOverlay: () => void;
    /**
     * 选着的来源不在 `sources` 里了（退出了那个平台的登录、mod 源被关掉、本地曲库清空）：换成 `fallback`，那个来源的
     * 结果与在途的搜索一起作废。还在里面就什么都不动（切换当前平台不重置搜索）。
     */
    keepSearchSourceWithin: (sources: readonly SearchSource[], fallback: SearchSource) => boolean;
    /** `kind` 不给就沿用当前的；来源搜不到这一种时退回单曲（resolveSearchKind）。 */
    submitSearch: (payload: { query?: string; sourceTab: SearchSource; kind?: SearchKind; deps: SearchExecutorDeps; returnView?: SearchReturnView; }) => Promise<boolean>;
    loadMoreSearchResults: (payload: { deps: SearchExecutorDeps; }) => Promise<void>;
}

const getSearchCacheKey = (query: string, sourceTab: SearchSource, kind: SearchKind) => (
    `${sourceTab}:${kind}:${query.trim().toLowerCase()}`
);

/** 这个来源能搜的种类：在线平台问 omni，本地与 Navidrome 单曲、专辑、歌单都有。单曲总在第一个。 */
export const getSearchKinds = (sourceTab: SearchSource): SearchKind[] => {
    if (sourceTab === 'local' || sourceTab === 'navidrome') return ['song', 'album', 'playlist'];
    const kinds = omni.getProviderSearchKinds(sourceTab);
    return kinds.includes('song') ? kinds : ['song', ...kinds];
};

/** 来源搜不到要的那一种（换到了没有专辑搜索的平台）就搜单曲。 */
export const resolveSearchKind = (sourceTab: SearchSource, kind: SearchKind): SearchKind => (
    getSearchKinds(sourceTab).includes(kind) ? kind : 'song'
);

/** No search has picked a source yet: a search then goes to the platform in effect. There is no default platform. */
export const UNSET_SEARCH_SOURCE: SearchSource = '';

/** The platform in effect, read when a search is about to go out ('' when no platform is registered). */
const activeSearchProvider = (): OnlineProviderId => omni.getActiveProviderSummary()?.providerId ?? '';

/** The source a home tab searches: its own for local and Navidrome, else the platform in effect (`activeProviderId`); the Folia tab searches that platform too. */
export const resolveSearchSource = (
    tab: HomeViewTab | SearchSource,
    activeProviderId: OnlineProviderId = activeSearchProvider(),
): SearchSource => {
    if (tab === 'local' || tab === 'navidrome') {
        return tab;
    }
    if (tab === UNSET_SEARCH_SOURCE) return activeProviderId;
    if (tab !== 'playlist' && tab !== 'albums' && tab !== 'radio' && tab !== 'explore' && tab !== 'folia') return tab as OnlineProviderId;
    return activeProviderId;
};

export const resolveCommandPaletteSearchSource = (
    currentSong: SongResult | null,
    searchSourceTab: SearchSource,
    activeOnlineProviderId: OnlineProviderId,
): SearchSource => {
    if (currentSong && isLocalPlaybackSong(currentSong)) return 'local';
    if (currentSong && isNavidromePlaybackSong(currentSong)) return 'navidrome';
    if (currentSong || searchSourceTab === UNSET_SEARCH_SOURCE) return activeOnlineProviderId;
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

// 本地曲库一次全筛完（总数就有了），但和在线一样一页一页交出去：只给这一页做展示映射，翻页从 offset 接着切。
const searchLocalSongs = (
    deps: SearchExecutorDeps,
    query: string,
    limit: number,
    offset: number,
): SearchExecutionResult => {
    const lowerQuery = query.toLowerCase();
    const matches = deps.localSongs.filter(song => {
        const title = song.title.toLowerCase();
        const artist = [
            ...song.importedMetadata.artistNames,
            ...song.onlineMetadata?.artists.map(item => item.name) || [],
        ].join(' ').toLowerCase();
        const album = [song.importedMetadata.albumName, song.onlineMetadata?.album?.name]
            .filter(Boolean).join(' ').toLowerCase();
        return title.includes(lowerQuery) || artist.includes(lowerQuery) || album.includes(lowerQuery);
    });
    const nextOffset = Math.min(offset + limit, matches.length);
    const results = matches
        .slice(offset, nextOffset)
        .map(song => mapLocalSongToUnifiedSong(song, deps.localLibraryCatalog));

    return {
        results,
        collections: [],
        hasMore: nextOffset < matches.length,
        nextOffset,
        total: matches.length,
    };
};

// Navidrome 的 search3 用 songCount / songOffset 分页、不答总数：这一页装满了就当后面还有。
const searchNavidromeSongs = async (query: string, limit: number, offset: number): Promise<SearchExecutionResult> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { results: [], collections: [], hasMore: false, nextOffset: offset };
    }

    const response = await navidromeApi.search(config, query, 0, 0, limit, offset);
    const songs = response.song || [];
    const results = songs.map(song => {
        const navidromeSong = navidromeApi.toNavidromeSong(config, song);
        return navidromeSong as UnifiedSong;
    });

    return {
        results,
        collections: [],
        hasMore: songs.length >= limit,
        nextOffset: offset + songs.length,
    };
};

/** 一组已经在手里的结果按 offset / limit 切出一页（本地的分组与 Navidrome 的歌单是整份读来的）。 */
const pageOf = <T,>(items: readonly T[], limit: number, offset: number) => {
    const nextOffset = Math.min(offset + limit, items.length);
    return { page: items.slice(offset, nextOffset), nextOffset, hasMore: nextOffset < items.length, total: items.length };
};

const nameMatches = (lowerQuery: string, names: Array<string | undefined>) => (
    names.some(name => name?.toLowerCase().includes(lowerQuery))
);

// 本地专辑、歌单：从首页本地页签的那套分组里按名字（专辑也按专辑歌手）筛，再切页。
const searchLocalCollections = (
    kind: Exclude<SearchKind, 'song'>,
    query: string,
    limit: number,
    offset: number,
): SearchExecutionResult => {
    const lowerQuery = query.toLowerCase();
    const matches = (localSearchCollectionsReader?.(kind) ?? []).filter(collection => nameMatches(
        lowerQuery,
        [collection.name, ...(collection.artists ?? []).map(artist => artist.name)],
    ));
    const { page, nextOffset, hasMore, total } = pageOf(matches, limit, offset);
    return { results: [], collections: page, hasMore, nextOffset, total };
};

const toNavidromeAlbumCollection = (
    album: SubsonicAlbum,
    coverArtUrl: (coverArtId: string) => string,
): NavidromeGridViewCollectionDescriptor => ({
    source: 'navidrome',
    type: 'album',
    id: album.id,
    name: album.name,
    coverUrl: album.coverArt ? coverArtUrl(album.coverArt) : undefined,
    description: album.artist,
    trackCount: album.songCount,
    artists: album.artists?.length
        ? album.artists.map(artist => ({ id: artist.id, name: artist.name }))
        : album.artist ? [{ id: album.artistId, name: album.artist }] : undefined,
    albumArtist: album.artist,
    albumYear: album.year,
    albumGenre: album.genre,
    albumDuration: album.duration,
    publishedAt: album.year ? new Date(album.year, 0, 1).getTime() : undefined,
    editable: false,
});

const toNavidromePlaylistCollection = (
    playlist: SubsonicPlaylist,
    coverArtUrl: (coverArtId: string) => string,
): NavidromeGridViewCollectionDescriptor => ({
    source: 'navidrome',
    type: 'playlist',
    id: playlist.id,
    name: playlist.name,
    coverUrl: playlist.coverArt ? coverArtUrl(playlist.coverArt) : undefined,
    description: playlist.comment || playlist.owner,
    trackCount: playlist.songCount,
    creator: playlist.owner ? { id: playlist.owner, nickname: playlist.owner } : undefined,
    editable: true,
});

// Navidrome 专辑走 search3 的 albumCount / albumOffset（不答总数，这一页装满就当还有）；
// search3 不搜歌单：歌单整份读来按名字筛，再切页。
const searchNavidromeCollections = async (
    kind: Exclude<SearchKind, 'song'>,
    query: string,
    limit: number,
    offset: number,
): Promise<SearchExecutionResult> => {
    const config = getNavidromeConfig();
    if (!config) {
        return { results: [], collections: [], hasMore: false, nextOffset: offset };
    }
    const coverArtUrl = (coverArtId: string) => navidromeApi.getCoverArtUrl(config, coverArtId, 300);

    if (kind === 'album') {
        const response = await navidromeApi.search(config, query, 0, limit, 0, 0, offset);
        const albums = response.album || [];
        return {
            results: [],
            collections: albums.map(album => toNavidromeAlbumCollection(album, coverArtUrl)),
            hasMore: albums.length >= limit,
            nextOffset: offset + albums.length,
        };
    }

    const lowerQuery = query.toLowerCase();
    const playlists = (await navidromeApi.getPlaylists(config))
        .filter(playlist => nameMatches(lowerQuery, [playlist.name, playlist.comment]));
    const { page, nextOffset, hasMore, total } = pageOf(playlists, limit, offset);
    return {
        results: [],
        collections: page.map(playlist => toNavidromePlaylistCollection(playlist, coverArtUrl)),
        hasMore,
        nextOffset,
        total,
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
        return kind === 'song'
            ? searchLocalSongs(deps, query, limit, offset)
            : searchLocalCollections(kind, query, limit, offset);
    }

    if (sourceTab === 'navidrome') {
        return kind === 'song'
            ? searchNavidromeSongs(query, limit, offset)
            : searchNavidromeCollections(kind, query, limit, offset);
    }

    return kind === 'song'
        ? searchOnlineProviderSongs(sourceTab, query, limit, offset)
        : searchOnlineProviderCollections(sourceTab, kind, query, limit, offset);
};

const isHomeOnlineViewTab = (tab: unknown): tab is HomeOnlineViewTab => (
    tab === 'playlist' || tab === 'albums' || tab === 'radio' || tab === 'explore'
);

/**
 * 上次停在哪一页。旧版本（首页还是一排平铺的页签）存的六个值原样有效：它们就是现在的「页」，组由页推出，
 * 不需要改写存下的值。
 */
const getInitialHomeViewTab = (): HomeViewTab => {
    if (typeof window === 'undefined') {
        return 'playlist';
    }
    const savedTab = localStorage.getItem(LAST_HOME_VIEW_TAB_KEY);
    return isHomeOnlineViewTab(savedTab) || savedTab === 'local' || savedTab === 'navidrome' || savedTab === 'folia'
        ? savedTab
        : 'playlist';
};

/** 在线组上次停在哪一页：没存过（旧版本升级上来）时，上次停的那一页是在线页就是它，否则是歌单。 */
const getInitialHomeOnlineTab = (homeViewTab: HomeViewTab): HomeOnlineViewTab => {
    const savedTab = readStoredString(LAST_HOME_ONLINE_TAB_KEY);
    if (isHomeOnlineViewTab(savedTab)) return savedTab;
    return isHomeOnlineViewTab(homeViewTab) ? homeViewTab : 'playlist';
};

const readSearchHistory = (): string[] => {
    try {
        const raw = getStoredString(SEARCH_HISTORY_KEY, '');
        return raw ? sanitizeSearchHistory(JSON.parse(raw)) : [];
    } catch (error) {
        console.warn('[SearchStore] Failed to restore search history:', error);
        return [];
    }
};

const writeSearchHistory = (history: string[]) => {
    try {
        setStoredString(SEARCH_HISTORY_KEY, JSON.stringify(history));
    } catch (error) {
        console.warn('[SearchStore] Failed to save search history:', error);
    }
};

export const useSearchNavigationStore = create<SearchNavigationState>((set, get) => ({
    homeViewTab: getInitialHomeViewTab(),
    homeOnlineTab: getInitialHomeOnlineTab(getInitialHomeViewTab()),
    searchQuery: '',
    submittedQuery: '',
    searchSourceTab: UNSET_SEARCH_SOURCE,
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
    searchHistory: readSearchHistory(),
    forgetSearchHistoryQuery: (query) => {
        const current = get().searchHistory;
        const next = withoutSearchHistoryQuery(current, query);
        if (next.length === current.length) return;
        writeSearchHistory(next);
        set({ searchHistory: next });
    },
    clearSearchHistory: () => {
        if (get().searchHistory.length === 0) return;
        writeSearchHistory([]);
        set({ searchHistory: [] });
    },
    setHomeViewTab: (tab) => {
        if (typeof window !== 'undefined') {
            localStorage.setItem(LAST_HOME_VIEW_TAB_KEY, tab);
        }
        if (isHomeOnlineViewTab(tab)) setStoredString(LAST_HOME_ONLINE_TAB_KEY, tab);
        set(isHomeOnlineViewTab(tab) ? { homeViewTab: tab, homeOnlineTab: tab } : { homeViewTab: tab });
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
    keepSearchSourceWithin: (sources, fallback) => {
        const state = get();
        if (sources.includes(state.searchSourceTab)) return false;
        set({
            searchSourceTab: fallback,
            searchKind: resolveSearchKind(fallback, state.searchKind),
            searchResults: null,
            collectionResults: null,
            resultTotal: null,
            isSearching: false,
            isLoadingMore: false,
            searchError: null,
            requestId: state.requestId + 1,
            offset: 0,
            hasMore: false,
            scrollTop: 0,
        });
        return true;
    },
    submitSearch: async ({ query, sourceTab: givenSourceTab, kind, deps, returnView = 'home' }) => {
        const trimmedQuery = (query ?? get().searchQuery).trim();
        if (!trimmedQuery) {
            return false;
        }
        // Before any search picked a source, the platform in effect is searched.
        const sourceTab = resolveSearchSource(givenSourceTab);
        if (!sourceTab) return false;
        // An online source that is not registered (no platform at all, or the chosen one missing for now) is not
        // searched: there is nothing to ask, and nothing to show but the empty state (Folium 2.0 plan §7).
        if (sourceTab !== 'local' && sourceTab !== 'navidrome' && !omni.getProviderSummaries().some(provider => provider.providerId === sourceTab)) {
            console.info(`[SearchStore] ${sourceTab} is not registered; the search is not sent`);
            return false;
        }

        const searchKind = resolveSearchKind(sourceTab, kind ?? get().searchKind);
        const requestId = get().requestId + 1;
        // 提交的那一刻就记进历史：首页、命令面板、搜索页都从这里过，结果回来之前历史已经是新的。
        const searchHistory = withSearchHistoryQuery(get().searchHistory, trimmedQuery);
        writeSearchHistory(searchHistory);
        set({
            searchHistory,
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
            !hasMore
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
                // 平台说还有、这一页却是空的（或游标没往前走）：当作到头了。滚到底会自动接着要，
                // 不在这里停下，就会对着同一个 offset 一直要下去。
                const advanced = result.results.length + result.collections.length > 0 && result.nextOffset > offset;
                const hasMore = result.hasMore && advanced;
                return {
                    searchResults: results,
                    collectionResults: collections,
                    resultTotal: total,
                    hasMore,
                    offset: result.nextOffset,
                    isLoadingMore: false,
                    searchCache: {
                        ...state.searchCache,
                        [getSearchCacheKey(searchQuery, searchSourceTab, searchKind)]: {
                            results,
                            collections,
                            hasMore,
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
