import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSong } from '@/types';
import type { ProviderCollection, ProviderPage } from '@/types/onlineMusic';
import type { LibraryHomeActionsController, LibraryHomeResources } from '@/library/core/contracts/homeModel';
import { createFavoriteAlbumsFeed, createRadioFeed } from '@/library/core/services/onlineHomeFeeds';
import { createDiscoverFeed } from '@/library/core/services/onlineHomeDiscoverFeed';
import { createNavidromeHomeLibrary, type NavidromeHomeLibraryDeps } from '@/library/core/services/navidromeHomeLibrary';
import { createLocalDirectoryTrees } from '@/library/core/services/localDirectoryTrees';
import { invalidateLeftHomeTab, releaseLibraryHomeResources } from '@/library/core/services/libraryHomeLifetime';
import { attachOnlineHomeFeeds } from '@/library/core/bindings/useLibraryHomeOnlineFeeds';
import {
    closeOpenLibraryDirectory,
    getLibraryDirectorySession,
    useLibraryDirectorySessionStore,
} from '@/library/core/state/useLibraryDirectorySessionStore';
import { hasDirectorySessionState } from '@/library/core/model/directorySession';

// test/unit/library/core/homeLifetime.test.ts
// 首页数据与目录会话的寿命跟着语义（P3.4）：换 suite 时旧的首页 surface 卸载、新的挂载，同一份首页资源被新 surface
// 认领 / ensure，不再请求；只有首页真的离开（releaseLibraryHomeResources）或离开某个页签（invalidateLeftHomeTab）
// 才作废。目录会话跟着「打开 / 关闭目录」：打开着的目录再打开一次（另一套 suite 接手）保留会话，关闭就丢掉。

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const navidromeDeps = (): NavidromeHomeLibraryDeps => ({
    getConfig: () => ({ serverUrl: 'http://navi', username: 'u', passwordHash: 'h' }),
    getAlbumList2: vi.fn(async () => []),
    getPlaylists: vi.fn(async () => []),
    getArtists: vi.fn(async () => []),
    getRandomSongs: vi.fn(async () => []),
    getStarred2: vi.fn(async () => []),
});

const createResources = () => {
    const getUserAlbums = vi.fn(async (): Promise<ProviderPage<ProviderCollection>> => ({ items: [], hasMore: false, nextOffset: 0 }));
    const getHomeFeed = vi.fn(async () => ({ personalFm: [], dailySongs: [], recommendedCollections: [] }));
    const navidrome = navidromeDeps();
    const loadTrees = vi.fn(async () => []);
    const resources: LibraryHomeResources = {
        favoriteAlbums: createFavoriteAlbumsFeed({ getUserAlbums }),
        radioFeed: createRadioFeed({ getHomeFeed, songCoverUrl: () => undefined }),
        discoverFeed: createDiscoverFeed({ getPersonalFm: async () => [], getRecommendationRowSongs: async () => [] }, () => [], () => undefined),
        actions: {} as LibraryHomeActionsController,
        navidromeOverview: createNavidromeHomeLibrary(navidrome),
        localDirectoryTrees: createLocalDirectoryTrees({ loadTrees }),
    };
    return { resources, getUserAlbums, getHomeFeed, navidromeAlbums: navidrome.getAlbumList2 as ReturnType<typeof vi.fn>, loadTrees };
};

const songs = [{ id: '1' }] as LocalSong[];
const ATTACH = { providerId: 'p', userId: 'u1', canUseAlbums: true, canUseRadio: true } as const;

/** 一个首页 surface 挂载时做的事（任何 suite 都一样）：认领在线数据、ensure 当前页签的数据。 */
const mountSurface = (resources: LibraryHomeResources, tab: 'albums' | 'radio') => {
    attachOnlineHomeFeeds(resources, { ...ATTACH, tab });
    void resources.navidromeOverview.ensure();
    void resources.localDirectoryTrees.ensure(songs);
};

describe('home resources across suites', () => {
    it('a second surface (another suite) claiming the same data requests nothing', async () => {
        const { resources, getUserAlbums, getHomeFeed, navidromeAlbums, loadTrees } = createResources();
        mountSurface(resources, 'albums');
        await flush();
        expect(getUserAlbums).toHaveBeenCalledTimes(1);
        expect(navidromeAlbums).toHaveBeenCalled();
        const navidromeCalls = navidromeAlbums.mock.calls.length;

        // 换 suite：旧 surface 卸载（不放掉任何东西），新 surface 挂载、认领同一份。
        mountSurface(resources, 'albums');
        await flush();
        expect(getUserAlbums).toHaveBeenCalledTimes(1);
        expect(getHomeFeed).not.toHaveBeenCalled();
        expect(navidromeAlbums).toHaveBeenCalledTimes(navidromeCalls);
        expect(loadTrees).toHaveBeenCalledTimes(1);
    });

    it('leaving the home releases everything: coming back reads again', async () => {
        const { resources, getUserAlbums, navidromeAlbums, loadTrees } = createResources();
        mountSurface(resources, 'albums');
        await flush();
        const navidromeCalls = navidromeAlbums.mock.calls.length;

        releaseLibraryHomeResources(resources);
        expect(resources.favoriteAlbums.getSnapshot()).toMatchObject({ owner: null, loaded: false, data: [] });
        mountSurface(resources, 'albums');
        await flush();
        expect(getUserAlbums).toHaveBeenCalledTimes(2);
        expect(navidromeAlbums.mock.calls.length).toBeGreaterThan(navidromeCalls);
        expect(loadTrees).toHaveBeenCalledTimes(2);
    });

    it('leaving the Navidrome or local tab makes that tab read again next time; online tabs stay', async () => {
        const { resources, getUserAlbums, navidromeAlbums, loadTrees } = createResources();
        mountSurface(resources, 'albums');
        await flush();
        const navidromeCalls = navidromeAlbums.mock.calls.length;

        invalidateLeftHomeTab(resources, 'albums', 'playlist');
        mountSurface(resources, 'albums');
        await flush();
        expect(getUserAlbums).toHaveBeenCalledTimes(1);
        expect(navidromeAlbums).toHaveBeenCalledTimes(navidromeCalls);

        invalidateLeftHomeTab(resources, 'navidrome', 'local');
        invalidateLeftHomeTab(resources, 'local', 'local');
        await resources.navidromeOverview.ensure();
        await resources.localDirectoryTrees.ensure(songs);
        expect(navidromeAlbums.mock.calls.length).toBeGreaterThan(navidromeCalls);
        expect(loadTrees).toHaveBeenCalledTimes(1);

        invalidateLeftHomeTab(resources, 'local', 'radio');
        await resources.localDirectoryTrees.ensure(songs);
        expect(loadTrees).toHaveBeenCalledTimes(2);
    });
});

describe('ensure on the page-scoped resources', () => {
    it('the Navidrome overview reads once until invalidated, and an explicit load always reads', async () => {
        const deps = navidromeDeps();
        const overview = createNavidromeHomeLibrary(deps);
        const calls = () => (deps.getPlaylists as ReturnType<typeof vi.fn>).mock.calls.length;
        await Promise.all([overview.ensure(), overview.ensure()]);
        expect(calls()).toBe(1);
        await overview.load();
        expect(calls()).toBe(2);
        await overview.ensure();
        expect(calls()).toBe(2);
        overview.invalidate();
        await overview.ensure();
        expect(calls()).toBe(3);
    });

    it('the folder trees read again only for a new library array or after invalidation', async () => {
        const loadTrees = vi.fn(async () => []);
        const trees = createLocalDirectoryTrees({ loadTrees });
        await Promise.all([trees.ensure(songs), trees.ensure(songs)]);
        expect(loadTrees).toHaveBeenCalledTimes(1);
        // 服务自己读曲库的重读（恢复忽略目录之后）不改变「按哪份曲库读过」。
        await trees.load();
        await trees.ensure(songs);
        expect(loadTrees).toHaveBeenCalledTimes(2);
        await trees.ensure([...songs]);
        expect(loadTrees).toHaveBeenCalledTimes(3);
        trees.invalidate();
        await trees.ensure(songs);
        expect(loadTrees).toHaveBeenCalledTimes(4);
    });
});

describe('directory open / close', () => {
    const store = () => useLibraryDirectorySessionStore.getState();
    beforeEach(() => useLibraryDirectorySessionStore.setState({ sessions: {}, openDirectoryKey: null }));

    it('opening the directory that is already open keeps its session (another suite takes over)', () => {
        store().openDirectory('home:local:folders');
        store().setQuery('home:local:folders', 'alpha');
        store().setSelected('home:local:folders', ['a', 'b'], true);
        store().setVisibilityMode('home:local:folders', 'manage');

        store().openDirectory('home:local:folders');
        expect(getLibraryDirectorySession('home:local:folders')).toEqual({
            query: 'alpha',
            selectedIds: ['a', 'b'],
            visibilityMode: 'manage',
        });
        expect(store().openDirectoryKey).toBe('home:local:folders');
    });

    it('opening a closed directory starts empty; opening another closes the previous one', () => {
        store().setQuery('home:local:albums', 'stale');
        store().openDirectory('home:local:albums');
        expect(getLibraryDirectorySession('home:local:albums').query).toBe('');

        store().setQuery('home:local:albums', 'beta');
        store().openDirectory('home:local:artists');
        expect(store().openDirectoryKey).toBe('home:local:artists');
        expect(store().sessions['home:local:albums']).toBeUndefined();
    });

    it('closing drops the whole session; closing a directory that is not open leaves the open one alone', () => {
        store().openDirectory('home:local:folders');
        store().setQuery('home:local:folders', 'alpha');
        store().setQuery('home:navidrome:albums', 'stale');
        store().closeDirectory('home:navidrome:albums');
        expect(store().openDirectoryKey).toBe('home:local:folders');
        expect(store().sessions['home:navidrome:albums']).toBeUndefined();

        store().closeDirectory('home:local:folders');
        expect(store().openDirectoryKey).toBeNull();
        expect(hasDirectorySessionState(getLibraryDirectorySession('home:local:folders'))).toBe(false);
    });

    it('leaving the home closes whatever directory is open', () => {
        closeOpenLibraryDirectory();
        expect(store().openDirectoryKey).toBeNull();
        store().openDirectory('home:online:p:playlists');
        store().setSelected('home:online:p:playlists', ['x'], true);
        closeOpenLibraryDirectory();
        expect(store().openDirectoryKey).toBeNull();
        expect(store().sessions).toEqual({});
    });

    it('a session carries state only with a query, a selection or a manage view', () => {
        const empty = { query: '', selectedIds: [], visibilityMode: 'browse' as const };
        expect(hasDirectorySessionState(empty)).toBe(false);
        expect(hasDirectorySessionState({ ...empty, query: 'a' })).toBe(true);
        expect(hasDirectorySessionState({ ...empty, selectedIds: ['a'] })).toBe(true);
        expect(hasDirectorySessionState({ ...empty, visibilityMode: 'manage-hidden-only' })).toBe(true);
    });
});
