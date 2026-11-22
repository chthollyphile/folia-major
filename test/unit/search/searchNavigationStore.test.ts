// @builtin-sources
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    UNSET_SEARCH_SOURCE,
    getSearchKinds,
    isLibrarySearchCollection,
    resolveCommandPaletteSearchSource,
    setLocalSearchCollectionsReader,
    useSearchNavigationStore,
} from '@/stores/useSearchNavigationStore';
import { neteaseApi } from '../../../sources/netease/core/netease';
import { getNavidromeConfig, navidromeApi } from '@/services/navidromeService';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '@/types/localLibrary';

// The module's own pure helpers stay real (the source reads songs through them); the search is mocked.
vi.mock('../../../sources/netease/core/netease', async (importOriginal) => {
    const original = await importOriginal<{ neteaseApi: object }>();
    return { ...original, neteaseApi: { ...original.neteaseApi, cloudSearch: vi.fn() } };
});

vi.mock('@/services/navidromeService', () => ({
    getNavidromeConfig: vi.fn(() => null),
    navidromeApi: {
        search: vi.fn(),
        toNavidromeSong: vi.fn(),
        getPlaylists: vi.fn(),
        getCoverArtUrl: vi.fn((_config: unknown, id: string) => `cover:${id}`),
    },
}));

describe('useSearchNavigationStore', () => {
    const cloudSearchMock = vi.mocked(neteaseApi.cloudSearch);
    const getNavidromeConfigMock = vi.mocked(getNavidromeConfig);
    const navidromeSearchMock = vi.mocked(navidromeApi.search);
    const toNavidromeSongMock = vi.mocked(navidromeApi.toNavidromeSong);
    const navidromePlaylistsMock = vi.mocked(navidromeApi.getPlaylists);
    const deps = {
        localSongs: [],
        t: (_key: string, fallback?: string) => fallback || '',
    };

    beforeEach(() => {
        cloudSearchMock.mockReset();
        getNavidromeConfigMock.mockReset();
        getNavidromeConfigMock.mockReturnValue(null);
        navidromeSearchMock.mockReset();
        toNavidromeSongMock.mockReset();
        navidromePlaylistsMock.mockReset();
        useSearchNavigationStore.setState({
            homeViewTab: 'playlist',
            searchQuery: '',
            searchSourceTab: 'netease',
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
            limit: 30,
            hasMore: false,
            scrollTop: 0,
            searchCache: {},
            searchHistory: [],
        });
    });

    it('uses the active online provider for command palette searches', () => {
        expect(resolveCommandPaletteSearchSource({
            id: 1,
            name: 'NetEase track still playing',
            artists: [],
            album: { id: 1, name: '' },
            durationMs: 1,
        }, 'netease', 'kugou')).toBe('kugou');
        // No search has picked a source yet: the platform in effect (there is no default platform).
        expect(resolveCommandPaletteSearchSource(null, UNSET_SEARCH_SOURCE, 'kugou')).toBe('kugou');
        // A source a search picked stays the palette's, NetEase like any other.
        expect(resolveCommandPaletteSearchSource(null, 'netease', 'kugou')).toBe('netease');
        expect(resolveCommandPaletteSearchSource(null, 'qq', 'kugou')).toBe('qq');
    });

    // Folium 2.0 方案 §7：零音源（或存着的平台此刻不在）时不去搜，走空状态，不报错。
    it('sends no search to an online source that is not registered', async () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const didSearch = await useSearchNavigationStore.getState().submitSearch({ query: 'test', sourceTab: 'not-registered-source', deps });
        expect(didSearch).toBe(false);
        expect(cloudSearchMock).not.toHaveBeenCalled();
        expect(useSearchNavigationStore.getState().isSearchOpen).toBe(false);
        expect(useSearchNavigationStore.getState().searchError).toBeNull();
        info.mockRestore();
    });

    it('searches albums through omni, keeps the kind and caches the page apart from the songs', async () => {
        cloudSearchMock.mockResolvedValueOnce({
            result: { albums: [{ id: 18909, name: 'Partners', size: 13, artists: [{ id: 6452, name: 'Jay' }] }], albumCount: 40 },
        } as any);

        await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', kind: 'album', deps });

        let state = useSearchNavigationStore.getState();
        expect(cloudSearchMock).toHaveBeenLastCalledWith('jay', 30, 0, 10);
        expect(state.searchKind).toBe('album');
        expect(state.searchResults).toEqual([]);
        expect(state.collectionResults).toEqual([expect.objectContaining({ providerId: 'netease', id: '18909', type: 'album' })]);
        expect(state).toMatchObject({ resultTotal: 40, hasMore: true, offset: 1 });

        // Songs of the same query are another search; going back to the albums restores them from the cache.
        cloudSearchMock.mockResolvedValueOnce({ result: { songs: [], songCount: 0 } } as any);
        await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', kind: 'song', deps });
        expect(useSearchNavigationStore.getState().collectionResults).toEqual([]);

        useSearchNavigationStore.getState().restoreSearch({ query: 'jay', sourceTab: 'netease', kind: 'album' });
        state = useSearchNavigationStore.getState();
        expect(state.searchKind).toBe('album');
        expect(state.collectionResults).toEqual([expect.objectContaining({ id: '18909' })]);
        expect(state.resultTotal).toBe(40);
    });

    it('starts the results of a new search at the top, whatever the list before wrote back while it unmounted', async () => {
        cloudSearchMock.mockImplementationOnce(async () => {
            // The list of the previous results unmounts once the search starts, and writes its scroll position back.
            useSearchNavigationStore.getState().setSearchScrollTop(2000);
            return { result: { albums: [], albumCount: 0 } } as any;
        });

        await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', kind: 'album', deps });

        expect(useSearchNavigationStore.getState().scrollTop).toBe(0);
        expect(useSearchNavigationStore.getState().submittedQuery).toBe('jay');
    });

    it('loads more of the results on screen by the query that found them, not the one still being typed', async () => {
        cloudSearchMock
            .mockResolvedValueOnce({ result: { songs: [{ id: 1, name: 'A', artists: [], album: { id: 1, name: '' }, durationMs: 1 }], songCount: 2 } } as any)
            .mockResolvedValueOnce({ result: { songs: [{ id: 2, name: 'B', artists: [], album: { id: 2, name: '' }, durationMs: 1 }], songCount: 2 } } as any);
        await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', kind: 'song', deps });

        useSearchNavigationStore.getState().setSearchQuery('jay cho');
        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });
        useSearchNavigationStore.getState().setSearchScrollTop(120);

        const state = useSearchNavigationStore.getState();
        expect(cloudSearchMock).toHaveBeenLastCalledWith('jay', 30, 1);
        expect(state.searchResults).toHaveLength(2);
        expect(state.searchQuery).toBe('jay cho');
        expect(state.searchCache['netease:song:jay']).toMatchObject({ offset: 2, scrollTop: 120 });
        expect(state.searchCache['netease:song:jay cho']).toBeUndefined();
    });

    it('drops a search answer that arrives after another search was restored from history', async () => {
        let answer: (value: unknown) => void = () => undefined;
        cloudSearchMock.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }) as any);
        const pending = useSearchNavigationStore.getState().submitSearch({ query: 'late', sourceTab: 'netease', kind: 'song', deps });

        useSearchNavigationStore.getState().restoreSearch({ query: 'earlier', sourceTab: 'netease', kind: 'song' });
        answer({ result: { songs: [{ id: 9, name: 'Late', artists: [], album: { id: 9, name: '' }, durationMs: 1 }], songCount: 1 } });
        // The caller must not push the dropped search onto the history: that would bring back a search page without results.
        await expect(pending).resolves.toBe(false);

        const state = useSearchNavigationStore.getState();
        expect(state.submittedQuery).toBe('earlier');
        expect(state.searchResults).toBeNull();
        expect(state.isSearching).toBe(false);
    });

    it('offers songs, albums and playlists for local and Navidrome', () => {
        expect(getSearchKinds('local')).toEqual(['song', 'album', 'playlist']);
        expect(getSearchKinds('navidrome')).toEqual(['song', 'album', 'playlist']);
    });

    it('pages local song results like online ones', async () => {
        const localSongs = Array.from({ length: 70 }, (_, index) => ({
            id: `local-${index}`,
            fileName: `track-${index}.mp3`,
            filePath: `/track-${index}.mp3`,
            title: `Track ${index}`,
            importedMetadata: { artistNames: ['Artist'], albumName: 'Album' },
        })) as any;
        const localDeps = { ...deps, localSongs };

        await useSearchNavigationStore.getState().submitSearch({ query: 'track', sourceTab: 'local', deps: localDeps });
        expect(useSearchNavigationStore.getState()).toMatchObject({ hasMore: true, offset: 30, resultTotal: 70 });
        expect(useSearchNavigationStore.getState().searchResults).toHaveLength(30);

        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps: localDeps });
        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps: localDeps });
        const state = useSearchNavigationStore.getState();
        expect(state.searchResults).toHaveLength(70);
        expect(state.searchResults?.[69]?.localRef?.songId).toBe('local-69');
        expect(state).toMatchObject({ hasMore: false, offset: 70 });
    });

    it('stops paging when a page says there is more but brings nothing', async () => {
        cloudSearchMock
            .mockResolvedValueOnce({ result: { songs: [{ id: 1, name: 'A', artists: [], album: { id: 1, name: '' }, durationMs: 1 }], songCount: 999 } } as any)
            .mockResolvedValueOnce({ result: { songs: [], songCount: 999 } } as any);
        await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', kind: 'song', deps });
        const { offset } = useSearchNavigationStore.getState();
        expect(useSearchNavigationStore.getState().hasMore).toBe(true);

        // Asked again for the same offset forever otherwise: scrolling to the end loads the next page by itself.
        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });
        expect(useSearchNavigationStore.getState()).toMatchObject({ hasMore: false, offset });
    });

    it('searches local playlists by name from the library groups', async () => {
        const getLocalCollections = vi.fn((kind: 'album' | 'playlist') => kind === 'playlist'
            ? [
                { source: 'local', type: 'playlist', id: 'playlist-1', name: 'Night Drive', songIds: [] },
                { source: 'local', type: 'playlist', id: 'playlist-2', name: 'Morning', songIds: [] },
            ] as any
            : []);

        setLocalSearchCollectionsReader(getLocalCollections);
        await useSearchNavigationStore.getState().submitSearch({
            query: 'night',
            sourceTab: 'local',
            kind: 'playlist',
            deps,
        });
        setLocalSearchCollectionsReader(null);

        const state = useSearchNavigationStore.getState();
        expect(getLocalCollections).toHaveBeenCalledWith('playlist');
        expect(state.searchKind).toBe('playlist');
        expect(state.collectionResults?.map(item => item.id)).toEqual(['playlist-1']);
        expect(isLibrarySearchCollection(state.collectionResults![0])).toBe(true);
        expect(state).toMatchObject({ hasMore: false, resultTotal: 1 });
    });

    it('submits a local search and opens the overlay', async () => {
        const didSearch = await useSearchNavigationStore.getState().submitSearch({
            query: 'world',
            sourceTab: 'local',
            deps: {
                ...deps,
                localSongs: [
                    {
                        id: '1',
                        fileName: 'hello.mp3',
                        filePath: '/tmp/hello.mp3',
                        duration: 120000,
                        fileSize: 10,
                        mimeType: 'audio/mpeg',
                        addedAt: 1,
                        title: 'Hello World',
                        titleOrigin: 'import',
                        importedMetadata: { title: 'Hello World', titleSource: 'filename', artistNames: ['Singer'], albumName: 'Album' },
                    },
                ],
            },
        });

        const state = useSearchNavigationStore.getState();

        expect(didSearch).toBe(true);
        expect(state.isSearchOpen).toBe(true);
        expect(state.searchQuery).toBe('world');
        expect(state.searchSourceTab).toBe('local');
        expect(state.searchResults).toHaveLength(1);
        expect(state.hasMore).toBe(false);
    });

    it('appends more netease results when loading the next page', async () => {
        cloudSearchMock
            .mockResolvedValueOnce({
                result: {
                    songs: [
                        { id: 1, name: 'Track 1', artists: [], album: { id: 1, name: 'Album 1' }, durationMs: 1000 },
                        { id: 2, name: 'Track 2', artists: [], album: { id: 2, name: 'Album 2' }, durationMs: 1000 },
                    ],
                    songCount: 4,
                },
            } as any)
            .mockResolvedValueOnce({
                result: {
                    songs: [
                        { id: 3, name: 'Track 3', artists: [], album: { id: 3, name: 'Album 3' }, durationMs: 1000 },
                        { id: 4, name: 'Track 4', artists: [], album: { id: 4, name: 'Album 4' }, durationMs: 1000 },
                    ],
                    songCount: 4,
                },
            } as any);

        await useSearchNavigationStore.getState().submitSearch({
            query: 'folio',
            sourceTab: 'netease',
            deps,
        });

        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });

        const state = useSearchNavigationStore.getState();

        expect(cloudSearchMock).toHaveBeenNthCalledWith(1, 'folio', 30, 0);
        expect(cloudSearchMock).toHaveBeenNthCalledWith(2, 'folio', 30, 2);
        expect(state.searchResults).toHaveLength(4);
        expect(state.hasMore).toBe(false);
        expect(state.offset).toBe(4);
    });

    it('restores the matching cached search results and scroll position', async () => {
        cloudSearchMock.mockResolvedValueOnce({
            result: {
                songs: [{ id: 9, name: 'Cached', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000 }],
                songCount: 1,
            },
        } as any);
        await useSearchNavigationStore.getState().submitSearch({
            query: 'cached',
            sourceTab: 'netease',
            deps,
        });
        useSearchNavigationStore.getState().setSearchScrollTop(240);
        useSearchNavigationStore.setState({ isSearchOpen: false, searchResults: null, scrollTop: 0 });

        useSearchNavigationStore.getState().restoreSearch({
            query: 'cached',
            sourceTab: 'netease',
        });

        const state = useSearchNavigationStore.getState();
        expect(state.isSearchOpen).toBe(true);
        expect(state.searchQuery).toBe('cached');
        expect(state.searchResults).toHaveLength(1);
        expect(state.scrollTop).toBe(240);
    });

    it('does not reuse cached results from a different query', async () => {
        cloudSearchMock.mockResolvedValueOnce({
            result: {
                songs: [{ id: 9, name: 'Cached', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000 }],
                songCount: 1,
            },
        } as any);
        await useSearchNavigationStore.getState().submitSearch({
            query: 'cached',
            sourceTab: 'netease',
            deps,
        });

        useSearchNavigationStore.getState().restoreSearch({
            query: 'different',
            sourceTab: 'netease',
        });

        expect(useSearchNavigationStore.getState().searchResults).toBeNull();
    });

    it('searches Navidrome songs through the configured source adapter', async () => {
        getNavidromeConfigMock.mockReturnValue({ baseUrl: 'https://navi.test' } as any);
        navidromeSearchMock.mockResolvedValue({
            song: [{ id: 'song-1', title: 'Navidrome Track' }],
        } as any);
        toNavidromeSongMock.mockReturnValue({
            id: 'song-1',
            name: 'Navidrome Track',
            artists: [{ id: 0, name: 'Artist' }],
            album: { id: 0, name: 'Album' },
            durationMs: 1000,
            isNavidrome: true,
        } as any);

        await useSearchNavigationStore.getState().submitSearch({
            query: 'navi',
            sourceTab: 'navidrome',
            deps,
        });

        expect(navidromeSearchMock).toHaveBeenCalled();
        expect(useSearchNavigationStore.getState().searchResults?.[0]).toEqual(expect.objectContaining({
            name: 'Navidrome Track',
            isNavidrome: true,
        }));
    });

    it('pages Navidrome songs with songOffset until a page comes back short', async () => {
        getNavidromeConfigMock.mockReturnValue({ baseUrl: 'https://navi.test' } as any);
        const page = (from: number, count: number) => ({
            song: Array.from({ length: count }, (_, index) => ({ id: `song-${from + index}` })),
        }) as any;
        navidromeSearchMock.mockResolvedValueOnce(page(0, 30)).mockResolvedValueOnce(page(30, 5));
        toNavidromeSongMock.mockImplementation((_config, song: any) => ({ id: song.id, isNavidrome: true }) as any);

        await useSearchNavigationStore.getState().submitSearch({ query: 'navi', sourceTab: 'navidrome', deps });
        expect(useSearchNavigationStore.getState()).toMatchObject({ hasMore: true, offset: 30 });

        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });
        expect(navidromeSearchMock).toHaveBeenLastCalledWith(expect.anything(), 'navi', 0, 0, 30, 30);
        const state = useSearchNavigationStore.getState();
        expect(state.searchResults).toHaveLength(35);
        expect(state).toMatchObject({ hasMore: false, offset: 35 });
    });

    it('searches Navidrome albums through search3 and playlists by name', async () => {
        getNavidromeConfigMock.mockReturnValue({ baseUrl: 'https://navi.test' } as any);
        navidromeSearchMock.mockResolvedValue({
            album: [{ id: 'al-1', name: 'Blue', artist: 'Band', artistId: 'ar-1', coverArt: 'c1', songCount: 9, duration: 1, created: '', year: 2001 }],
        } as any);

        await useSearchNavigationStore.getState().submitSearch({ query: 'blue', sourceTab: 'navidrome', kind: 'album', deps });
        expect(navidromeSearchMock).toHaveBeenLastCalledWith(expect.anything(), 'blue', 0, 30, 0, 0, 0);
        expect(useSearchNavigationStore.getState().collectionResults?.[0]).toMatchObject({
            source: 'navidrome',
            type: 'album',
            id: 'al-1',
            coverUrl: 'cover:c1',
            artists: [{ id: 'ar-1', name: 'Band' }],
            albumYear: 2001,
        });
        expect(useSearchNavigationStore.getState().hasMore).toBe(false);

        navidromePlaylistsMock.mockResolvedValue([
            { id: 'pl-1', name: 'Blue Monday', songCount: 3, duration: 1, owner: 'me' },
            { id: 'pl-2', name: 'Red', songCount: 3, duration: 1 },
        ] as any);
        await useSearchNavigationStore.getState().submitSearch({ query: 'blue', sourceTab: 'navidrome', kind: 'playlist', deps });
        const state = useSearchNavigationStore.getState();
        expect(state.collectionResults?.map(item => item.id)).toEqual(['pl-1']);
        expect(state.collectionResults?.[0]).toMatchObject({ source: 'navidrome', type: 'playlist', editable: true });
    });

    it('attaches stable local artist and album entity ids to local results', async () => {
        const entities: LocalLibraryEntity[] = [
            {
                id: 'artist-1',
                kind: 'artist',
                displayName: 'Singer',
                aliases: ['Singer'],
                normalizedAliases: ['singer'],
                createdAt: 1,
                updatedAt: 1,
            },
            {
                id: 'album-1',
                kind: 'album',
                displayName: 'Album',
                aliases: ['Album'],
                normalizedAliases: ['album'],
                createdAt: 1,
                updatedAt: 1,
            },
        ];
        const assignments: LocalLibraryAssignment[] = [{
            songId: 'local-1',
            artistEntityIds: ['artist-1'],
            albumEntityId: 'album-1',
            artistOrigin: 'import',
            albumOrigin: 'import',
            updatedAt: 1,
        }];

        await useSearchNavigationStore.getState().submitSearch({
            query: 'local',
            sourceTab: 'local',
            deps: {
                ...deps,
                localSongs: [{
                    id: 'local-1',
                    fileName: 'local.mp3',
                    filePath: '/local.mp3',
                    duration: 1000,
                    fileSize: 1,
                    mimeType: 'audio/mpeg',
                    addedAt: 1,
                    title: 'Local',
                    titleOrigin: 'import',
                    importedMetadata: { title: 'Local', titleSource: 'filename', artistNames: ['Singer'], albumName: 'Album' },
                }],
                localLibraryCatalog: { entities, assignments },
            },
        });

        const [result] = useSearchNavigationStore.getState().searchResults || [];
        expect(result.artists[0]).toEqual(expect.objectContaining({ entityId: 'artist-1' }));
        expect(result.album).toEqual(expect.objectContaining({ entityId: 'album-1' }));
    });

    it('keeps the newest result when an older request resolves later', async () => {
        let resolveFirst: ((value: any) => void) | undefined;
        cloudSearchMock
            .mockImplementationOnce(() => new Promise(resolve => {
                resolveFirst = resolve;
            }))
            .mockResolvedValueOnce({
                result: {
                    songs: [{ id: 2, name: 'Newest', artists: [], album: { id: 2, name: 'Album' }, durationMs: 1000 }],
                    songCount: 1,
                },
            } as any);

        const firstRequest = useSearchNavigationStore.getState().submitSearch({
            query: 'old',
            sourceTab: 'netease',
            deps,
        });
        await useSearchNavigationStore.getState().submitSearch({
            query: 'new',
            sourceTab: 'netease',
            deps,
        });
        resolveFirst?.({
            result: {
                songs: [{ id: 1, name: 'Old', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000 }],
                songCount: 1,
            },
        });
        await firstRequest;

        expect(useSearchNavigationStore.getState().searchQuery).toBe('new');
        expect(useSearchNavigationStore.getState().searchResults?.[0]?.name).toBe('Newest');
    });

    it('exposes a recoverable error state after a failed search', async () => {
        cloudSearchMock.mockRejectedValueOnce(new Error('network'));

        await useSearchNavigationStore.getState().submitSearch({
            query: 'failure',
            sourceTab: 'netease',
            deps,
        });

        expect(useSearchNavigationStore.getState()).toMatchObject({
            isSearching: false,
            searchResults: [],
            searchError: 'network',
        });
    });

    it('retains paged results and can retry after a load-more error', async () => {
        cloudSearchMock
            .mockResolvedValueOnce({
                result: {
                    songs: [{ id: 1, name: 'First', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000 }],
                    songCount: 2,
                },
            } as any)
            .mockRejectedValueOnce(new Error('page failed'))
            .mockResolvedValueOnce({
                result: {
                    songs: [{ id: 2, name: 'Second', artists: [], album: { id: 1, name: 'Album' }, durationMs: 1000 }],
                    songCount: 2,
                },
            } as any);

        await useSearchNavigationStore.getState().submitSearch({
            query: 'paged',
            sourceTab: 'netease',
            deps,
        });
        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });

        expect(useSearchNavigationStore.getState()).toMatchObject({
            searchError: 'page failed',
            hasMore: true,
        });
        expect(useSearchNavigationStore.getState().searchResults).toHaveLength(1);

        await useSearchNavigationStore.getState().loadMoreSearchResults({ deps });

        expect(useSearchNavigationStore.getState().searchError).toBeNull();
        expect(useSearchNavigationStore.getState().searchResults).toHaveLength(2);
        expect(useSearchNavigationStore.getState().hasMore).toBe(false);
    });

    it('keeps the chosen source and its results while it is still offered (a platform switch resets nothing)', () => {
        const results = [{ id: 1, name: 'Kept' }] as any;
        useSearchNavigationStore.setState({ searchSourceTab: 'qq', searchResults: results, searchQuery: 'q', requestId: 3 });

        expect(useSearchNavigationStore.getState().keepSearchSourceWithin(['netease', 'qq', 'local'], 'netease')).toBe(false);

        expect(useSearchNavigationStore.getState()).toMatchObject({
            searchSourceTab: 'qq',
            searchResults: results,
            searchQuery: 'q',
            requestId: 3,
        });
    });

    it('falls back when the chosen source is no longer offered, dropping its results and any search on its way', () => {
        const results = [{ id: 1, name: 'Gone' }] as any;
        useSearchNavigationStore.setState({
            searchSourceTab: 'qq',
            searchKind: 'album',
            searchResults: results,
            collectionResults: [] as any,
            searchQuery: 'q',
            submittedQuery: 'q',
            isSearching: true,
            hasMore: true,
            offset: 30,
            requestId: 3,
        });

        expect(useSearchNavigationStore.getState().keepSearchSourceWithin(['netease', 'local'], 'netease')).toBe(true);

        expect(useSearchNavigationStore.getState()).toMatchObject({
            searchSourceTab: 'netease',
            searchResults: null,
            collectionResults: null,
            searchQuery: 'q',
            submittedQuery: 'q',
            isSearching: false,
            hasMore: false,
            offset: 0,
            requestId: 4,
        });
    });

    it('falls back from a local or Navidrome source that is no longer offered, to songs', () => {
        useSearchNavigationStore.setState({ searchSourceTab: 'navidrome', searchKind: 'song' });
        useSearchNavigationStore.getState().keepSearchSourceWithin(['netease', 'local'], 'netease');
        expect(useSearchNavigationStore.getState().searchSourceTab).toBe('netease');

        useSearchNavigationStore.setState({ searchSourceTab: 'local' });
        useSearchNavigationStore.getState().keepSearchSourceWithin(['netease'], 'netease');
        expect(useSearchNavigationStore.getState()).toMatchObject({ searchSourceTab: 'netease', searchKind: 'song' });
    });

    describe('search history', () => {
        const submitLocal = (query: string) => useSearchNavigationStore.getState().submitSearch({ query, sourceTab: 'local', deps });

        it('records every submitted search, whichever entry point submitted it', async () => {
            await submitLocal('  first  ');
            // 命令面板走的也是 submitSearch（kind: 'song'、returnView: 'player'），不再需要各入口自己记。
            await useSearchNavigationStore.getState().submitSearch({ query: 'from palette', sourceTab: 'local', kind: 'song', deps, returnView: 'player' });
            expect(useSearchNavigationStore.getState().searchHistory).toEqual(['from palette', 'first']);
        });

        it('records a search whose request failed: the word was still searched', async () => {
            cloudSearchMock.mockRejectedValueOnce(new Error('offline'));
            const didSearch = await useSearchNavigationStore.getState().submitSearch({ query: 'jay', sourceTab: 'netease', deps });
            expect(didSearch).toBe(true);
            expect(useSearchNavigationStore.getState().searchHistory).toEqual(['jay']);
        });

        it('does not record an empty search', async () => {
            expect(await submitLocal('   ')).toBe(false);
            expect(useSearchNavigationStore.getState().searchHistory).toEqual([]);
        });

        it('forgets one word and clears the rest', async () => {
            await submitLocal('a');
            await submitLocal('b');
            useSearchNavigationStore.getState().forgetSearchHistoryQuery('A');
            expect(useSearchNavigationStore.getState().searchHistory).toEqual(['b']);
            useSearchNavigationStore.getState().clearSearchHistory();
            expect(useSearchNavigationStore.getState().searchHistory).toEqual([]);
        });
    });
});
