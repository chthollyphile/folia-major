import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LocalPlaylist, LocalSong } from '../../../src/types';
import type { ProviderCollection } from '../../../src/types/onlineMusic';
import type { HomeSurfaceProps } from '../../../src/components/app/home/homeSurfaceTypes';
import {
    createLocalGridViewCollection,
    createNavidromeGridViewCollection,
    createOnlineGridViewCollection,
    type GridViewCollectionDescriptor,
} from '../../../src/components/app/home/gridViewCollectionAdapters';
import { buildLocalHomeGroups } from '../../../src/library/core/home/localHomeModel';
import { getLocalCoverAssetUrl } from '../../../src/services/localCoverAssetUrl';
import { useLocalLibraryCatalog, type LocalLibraryCatalogSnapshot } from '../../../src/hooks/useLocalLibraryCatalog';
import {
    notifyCollectionPop,
    useCollectionNavigationStore,
    type CollectionNavigationSnapshot,
} from '../../../src/stores/useCollectionNavigationStore';
import { resolveCollectionPopTo } from '../../../src/library/core/collection/collectionNavigation';
import type { CollectionNavigationOrigin } from '../../../src/library/core/collection/collection.contract';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';
import { useLibrarySuiteStore } from '../../../src/library/core/suite/useLibrarySuiteStore';
import { DEFAULT_LIBRARY_SUITE_ID } from '../../../src/library/core/suite/librarySuites';
import { useLibraryBrowseSessionStore } from '../../../src/library/core/shared/useLibraryBrowseSessionStore';
import { unregisterOnlineMusicProvider } from '../../../src/services/onlineMusic/providerRegistry';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import {
    LOCAL_PLAYLIST_NAME,
    NAVIDROME_ALBUM_ID,
    NAVIDROME_ALBUM_SONGS,
    NAVIDROME_DUPES_PLAYLIST_ID,
    NAVIDROME_DUPES_PLAYLIST_SONGS,
    NAVIDROME_PLAYLIST_ID,
    NAVIDROME_PLAYLIST_SONGS,
    NAVIDROME_HOME_ARTISTS,
    ONLINE_ARTISTS,
    ONLINE_FIXTURES,
    PROBE_PROVIDER_A,
    PROBE_PROVIDER_B,
    type ArtistFixtureId,
    type OnlineFixtureId,
    type ProbeFixtureId,
} from './fixtureRules';
import { describeOnlineFixture, registerFakeProviders, resetFakeProviders } from './fakeProviders';
import { IN_MEMORY_LOCAL_PLAYLIST, LOCAL_FIXTURE_SONGS, readLocalLibrary, seedLocalLibrary } from './localFixtures';
import { installNavidromeShim, NAVIDROME_PROBE_CONFIG } from './navidromeShim';
import { recordProbeCall } from './probeLog';
import { PROBE_SURFACE_CALLBACKS, resetProbeQueue } from './probeSurfaceCallbacks';
import { useStatusMessageStore } from '../../../src/stores/useStatusMessageStore';
import { probeRefreshGate, releaseAllProbeRefreshGates } from './probeGates';
import { installLibraryProbeApi } from './libraryProbeApi';

// dev/probes/libraryBehavior/useLibraryProbeHarness.ts
// 探针的「假 App」：装配 GridViewOverlayHost 需要的 surfaceProps（回调全部记账）、导航回调
// （去掉 history 的 useAppNavigation），以及把 fixture id 换成首页同款集合描述的入口。

const NAVIDROME_CONFIG_KEY = 'navidrome_config';
const ALL_FIXTURES = [
    ...Object.keys(ONLINE_FIXTURES),
    'local-all',
    'local-folder',
    'local-playlist',
    'local-album',
    'navi-album',
    'navi-playlist',
    'navi-playlist-dupes',
] as ProbeFixtureId[];
const SANDBOX_ONLY: ReadonlySet<ProbeFixtureId> = new Set([
    'local-playlist',
    'local-album',
    'navi-album',
    'navi-playlist',
    'navi-playlist-dupes',
]);

export const isProbeSandbox = (): boolean => (
    Boolean(navigator.webdriver) || new URLSearchParams(window.location.search).has('sandbox')
);

const STATIC_CATALOG: LocalLibraryCatalogSnapshot = {
    entities: [],
    assignments: [],
    ready: true,
    failed: false,
    reload: async () => {},
};

// 首页「歌单」页签里能看到的那几张：每日推荐在真实首页属于电台页签，不在歌单列表里。
const buildPlaylistList = (): ProviderCollection[] => (
    (Object.keys(ONLINE_FIXTURES) as OnlineFixtureId[])
        .filter(id => ONLINE_FIXTURES[id].type === 'playlist')
        .map(describeOnlineFixture)
);

// 等价于浏览器后退（popstate）：先发「将要弹栈」的通知（宿主据此让 suite 跑 beforeBack），再改 store。
// 应用内返回（返回按钮、Escape）也落到这里，和真实应用里 backCollection 走 history.back() 一样。
const popNavigation = () => {
    const store = useCollectionNavigationStore.getState();
    const snapshot = store.snapshot;
    if (!snapshot || snapshot.stack.length <= 1) {
        notifyCollectionPop(null);
        store.clear();
        return;
    }
    const next = { ...snapshot, stack: snapshot.stack.slice(0, -1) };
    notifyCollectionPop(next);
    store.restore(next);
};

// 弹到 to（更浅的一层；null 是整个关掉）：和浏览器后退同一个顺序，先通知再改 store。真实应用里面包屑跳层
// 走 history.go(-k)，落地后的 popstate 也是这个顺序（见 useAppNavigation 的 traverseCollectionTo）。
const popNavigationTo = (to: CollectionNavigationSnapshot | null) => {
    notifyCollectionPop(to);
    useCollectionNavigationStore.getState().restore(to);
};

// 压栈（N1 折叠紧邻往返）：要进入的正好是上一层时当作一次返回，与真实应用一致（那里走 backCollection）。
const pushNavigation = (collection: GridViewCollectionDescriptor) => {
    const decision = useCollectionNavigationStore.getState().push(collection);
    if (decision.kind === 'back') popNavigation();
};

// 面包屑跳层：depth 是保留的层数，0 为整个关掉。
const popNavigationToDepth = (depth: number) => {
    const to = resolveCollectionPopTo(useCollectionNavigationStore.getState().snapshot, depth);
    if (to !== undefined) popNavigationTo(to);
};

export type LibraryProbeHarness = {
    sandbox: boolean;
    ready: boolean;
    fixtures: ProbeFixtureId[];
    surfaceProps: HomeSurfaceProps;
    open: (fixtureId: ProbeFixtureId) => void;
    back: () => void;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
};

export const useLibraryProbeHarness = (): LibraryProbeHarness => {
    const { t } = useTranslation();
    const sandbox = useMemo(isProbeSandbox, []);
    const [ready, setReady] = useState(false);
    const [localSongs, setLocalSongs] = useState<LocalSong[]>(sandbox ? [] : LOCAL_FIXTURE_SONGS);
    const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>(sandbox ? [] : [IN_MEMORY_LOCAL_PLAYLIST]);
    const [playlists, setPlaylists] = useState<ProviderCollection[]>([]);
    const liveCatalog = useLocalLibraryCatalog(sandbox ? localSongs : null);
    const localLibraryCatalog = sandbox ? liveCatalog : STATIC_CATALOG;

    // 假 provider、Navidrome 垫片和种子数据都在挂载时装、卸载时拆：gallery 会 eager import 全部探针，
    // 模块顶层的副作用会污染别的探针。
    useEffect(() => {
        registerFakeProviders();
        resetFakeProviders();
        resetProbeQueue();
        releaseAllProbeRefreshGates();
        // 全局 toast 通道上的每一条都记账（歌手页的入队提示走它，不经过 onStatusMessage）。
        useStatusMessageStore.getState().setMessage(null);
        const unsubscribeToasts = useStatusMessageStore.subscribe((state, previous) => {
            if (!state.message || state.message === previous.message) return;
            recordProbeCall({ kind: 'toast', ids: [], text: state.message.text, status: state.message.type });
        });
        setPlaylists(buildPlaylistList());
        const previousProviderId = useOnlineProviderAccountStore.getState().activeProviderId;
        // 直接 setState，不走 setActiveProviderId：后者会写 localStorage，手动打开探针会改掉开发者自己的选择。
        useOnlineProviderAccountStore.setState({ activeProviderId: PROBE_PROVIDER_A });
        useCollectionNavigationStore.getState().clear();
        // 每次挂载都从默认 suite（网格）、空会话开始；用例需要 TUI 时自己切。
        useLibrarySuiteStore.setState({ suite: DEFAULT_LIBRARY_SUITE_ID });
        useLibraryBrowseSessionStore.setState({ sessions: {}, order: [] });

        let cancelled = false;
        let uninstallShim: (() => void) | undefined;
        const previousNavidromeConfig = localStorage.getItem(NAVIDROME_CONFIG_KEY);
        if (sandbox) {
            localStorage.setItem(NAVIDROME_CONFIG_KEY, JSON.stringify(NAVIDROME_PROBE_CONFIG));
            uninstallShim = installNavidromeShim();
            void seedLocalLibrary().then(({ songs, playlists: seededPlaylists }) => {
                if (cancelled) return;
                setLocalSongs(songs);
                setLocalPlaylists(seededPlaylists);
                setReady(true);
            });
        } else {
            setReady(true);
        }

        return () => {
            cancelled = true;
            unsubscribeToasts();
            uninstallShim?.();
            if (sandbox) {
                if (previousNavidromeConfig === null) localStorage.removeItem(NAVIDROME_CONFIG_KEY);
                else localStorage.setItem(NAVIDROME_CONFIG_KEY, previousNavidromeConfig);
            }
            useCollectionNavigationStore.getState().clear();
            useOnlineProviderAccountStore.setState({ activeProviderId: previousProviderId });
            unregisterOnlineMusicProvider(PROBE_PROVIDER_A);
            unregisterOnlineMusicProvider(PROBE_PROVIDER_B);
        };
    }, [sandbox]);

    const refreshLocal = useCallback(async () => {
        recordProbeCall({ kind: 'refreshLocalSongs', ids: [] });
        await probeRefreshGate('refreshLocalSongs').wait();
        if (!sandbox) return;
        const { songs, playlists: storedPlaylists } = await readLocalLibrary();
        setLocalSongs(songs);
        setLocalPlaylists(storedPlaylists);
    }, [sandbox]);

    const surfaceProps = useMemo<HomeSurfaceProps>(() => ({
        ...PROBE_SURFACE_CALLBACKS,
        onRefreshUser: async () => {
            recordProbeCall({ kind: 'refreshUser', ids: [] });
            await probeRefreshGate('refreshUser').wait();
            setPlaylists(buildPlaylistList());
        },
        onRefreshLocalSongs: refreshLocal,
        user: { id: 'probe-user', nickname: 'Probe User' },
        playlists,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        localMusicState: {
            activeRow: 0,
            selectedGroup: null,
            detailStack: [],
            detailOriginView: null,
            focusedFolderIndex: 0,
            focusedAlbumIndex: 0,
            focusedArtistIndex: 0,
            focusedPlaylistIndex: 0,
        },
        setLocalMusicState: () => {},
        onSearchCommitted: () => {},
        theme: DEFAULT_THEME,
    }), [localLibraryCatalog, localPlaylists, localSongs, playlists, refreshLocal]);

    const onOpenCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        useCollectionNavigationStore.getState().openRoot(collection, 'home');
    }, []);
    const onPushCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        pushNavigation(collection);
    }, []);

    // 把 fixture id 换成首页同款的集合描述：在线走 createOnlineGridViewCollection，本地走 Grid3D 的分组。
    const resolveFixture = useCallback((fixtureId: ProbeFixtureId): GridViewCollectionDescriptor | null => {
        if (fixtureId in ONLINE_FIXTURES) {
            const id = fixtureId as OnlineFixtureId;
            return createOnlineGridViewCollection(describeOnlineFixture(id), ONLINE_FIXTURES[id].providerId);
        }
        if (fixtureId === 'navi-album') {
            return createNavidromeGridViewCollection({ id: NAVIDROME_ALBUM_ID, name: 'Navi Album', trackCount: NAVIDROME_ALBUM_SONGS.length }, 'album');
        }
        if (fixtureId === 'navi-playlist') {
            return createNavidromeGridViewCollection({
                id: NAVIDROME_PLAYLIST_ID,
                name: 'Navi Playlist',
                trackCount: NAVIDROME_PLAYLIST_SONGS.length,
                editable: true,
            } as Parameters<typeof createNavidromeGridViewCollection>[0], 'playlist');
        }
        if (fixtureId === 'navi-playlist-dupes') {
            return createNavidromeGridViewCollection({
                id: NAVIDROME_DUPES_PLAYLIST_ID,
                name: 'Navi Duplicates',
                trackCount: NAVIDROME_DUPES_PLAYLIST_SONGS.length,
                editable: true,
            } as Parameters<typeof createNavidromeGridViewCollection>[0], 'playlist');
        }
        const groups = buildLocalHomeGroups(localSongs, localPlaylists, t, localLibraryCatalog.ready ? localLibraryCatalog : undefined, getLocalCoverAssetUrl);
        const group = fixtureId === 'local-all'
            ? groups.folders.find(candidate => candidate.isVirtual)
            : fixtureId === 'local-folder'
                ? groups.folders.find(candidate => candidate.id === 'folder-Folder A')
                : fixtureId === 'local-playlist'
                    ? groups.playlists.find(candidate => candidate.name === LOCAL_PLAYLIST_NAME)
                    : groups.albums.find(candidate => candidate.name === 'Alpha Album' && candidate.entityId);
        return group ? createLocalGridViewCollection(group) : null;
    }, [localLibraryCatalog, localPlaylists, localSongs, t]);

    const open = useCallback((fixtureId: ProbeFixtureId, origin: CollectionNavigationOrigin = 'home') => {
        if (SANDBOX_ONLY.has(fixtureId) && !sandbox) {
            console.warn(`[libraryBehavior] ${fixtureId} needs sandbox mode (?probe=libraryBehavior&sandbox)`);
            return;
        }
        const collection = resolveFixture(fixtureId);
        if (!collection) {
            console.warn(`[libraryBehavior] fixture ${fixtureId} is not available yet`);
            return;
        }
        if (origin === 'home') onOpenCollection(collection);
        else useCollectionNavigationStore.getState().openRoot(collection, origin);
    }, [onOpenCollection, resolveFixture, sandbox]);

    // 从当前集合压入一个 fixture 集合（经 onPushCollection，N1 的规则与真实宿主一致）。
    const push = useCallback((fixtureId: ProbeFixtureId): boolean => {
        if (SANDBOX_ONLY.has(fixtureId) && !sandbox) return false;
        const collection = resolveFixture(fixtureId);
        if (!collection || !useCollectionNavigationStore.getState().snapshot) return false;
        onPushCollection(collection);
        return true;
    }, [onPushCollection, resolveFixture, sandbox]);

    // 从当前集合压入一个本地歌手页（首页同款的分组描述）。用来验证没实现歌手页的 suite 回退到网格；
    // 直接写导航 store，与真实界面里点歌手名之后宿主做的压栈是同一个动作（只是没有转场）。
    const pushArtist = useCallback((): boolean => {
        if (!sandbox) return false;
        const groups = buildLocalHomeGroups(localSongs, localPlaylists, t, localLibraryCatalog.ready ? localLibraryCatalog : undefined, getLocalCoverAssetUrl);
        const artist = groups.artists.find(candidate => candidate.entityId) ?? groups.artists[0];
        if (!artist || !useCollectionNavigationStore.getState().snapshot) return false;
        onPushCollection(createLocalGridViewCollection(artist));
        return true;
    }, [localLibraryCatalog, localPlaylists, localSongs, onPushCollection, sandbox, t]);

    // 以根层打开一个歌手页。在线用搜索结果同款的描述（createSearchArtistCollection 解析出的形状），
    // Navidrome 与本地用首页同款（本地走 Grid3D 的歌手分组）。
    const openArtist = useCallback((fixtureId: ArtistFixtureId): boolean => {
        if (fixtureId === 'artist-main' || fixtureId === 'artist-guest') {
            const rule = ONLINE_ARTISTS[fixtureId];
            onOpenCollection({ source: 'online', providerId: rule.providerId, id: rule.artistId, name: rule.name, type: 'artist' });
            return true;
        }
        if (!sandbox) return false;
        if (fixtureId === 'navi-artist' || fixtureId === 'navi-artist-2') {
            const artist = NAVIDROME_HOME_ARTISTS[fixtureId === 'navi-artist' ? 0 : 1];
            onOpenCollection({ source: 'navidrome', id: artist.id, name: artist.name, type: 'artist' });
            return true;
        }
        const groups = buildLocalHomeGroups(localSongs, localPlaylists, t, localLibraryCatalog.ready ? localLibraryCatalog : undefined, getLocalCoverAssetUrl);
        const artist = groups.artists.find(candidate => candidate.entityId);
        if (!artist) return false;
        onOpenCollection(createLocalGridViewCollection(artist));
        return true;
    }, [localLibraryCatalog, localPlaylists, localSongs, onOpenCollection, sandbox, t]);

    const latestRef = useRef({ open, ready, push, pushArtist, openArtist, refreshLocal });
    latestRef.current = { open, ready, push, pushArtist, openArtist, refreshLocal };
    useEffect(() => installLibraryProbeApi({
        sandbox,
        fixtures: () => ALL_FIXTURES,
        ready: () => latestRef.current.ready,
        open: (fixtureId, origin) => latestRef.current.open(fixtureId, origin),
        back: popNavigation,
        push: fixtureId => latestRef.current.push(fixtureId),
        pushArtist: () => latestRef.current.pushArtist(),
        openArtist: fixtureId => latestRef.current.openArtist(fixtureId),
        refreshLocal: () => latestRef.current.refreshLocal(),
    }), [sandbox]);

    return {
        sandbox,
        ready,
        fixtures: ALL_FIXTURES,
        surfaceProps,
        open,
        back: popNavigation,
        onOpenCollection,
        onPushCollection,
    };
};

export {
    popNavigation as onProbeBackCollection,
    pushNavigation as onProbePushCollection,
    popNavigationToDepth as onProbePopCollectionTo,
};
