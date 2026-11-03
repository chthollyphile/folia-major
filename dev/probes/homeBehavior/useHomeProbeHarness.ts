import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LocalPlaylist, LocalSong } from '../../../src/types';
import type { ProviderCollection } from '../../../src/types/onlineMusic';
import type { HomeViewModel } from '../../../src/components/app/home/buildHomeModel';
import type { HomeLocalMusicState, HomeSurfaceProps } from '../../../src/components/app/home/homeSurfaceTypes';
import type { GridViewCollectionDescriptor } from '../../../src/components/app/home/gridViewCollectionAdapters';
import { useLocalLibraryCatalog } from '../../../src/hooks/useLocalLibraryCatalog';
import type { LibraryAccountController } from '../../../src/library/core/account/account.contract';
import { useLibraryAccountController, type LibraryAccountHostTables } from '../../../src/library/app/useLibraryAccountController';
import { useLibraryAccountProviders } from '../../../src/library/core/account/useLibraryAccount';
import { resolveActiveProviderSummary } from '../../../src/library/core/account/accountRules';
import { useCollectionNavigationStore } from '../../../src/stores/useCollectionNavigationStore';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';
import { useLibrarySuiteStore } from '../../../src/library/core/suite/useLibrarySuiteStore';
import { useLibraryBrowseSessionStore } from '../../../src/library/core/shared/useLibraryBrowseSessionStore';
import { DEFAULT_LIBRARY_SUITE_ID } from '../../../src/library/core/suite/librarySuites';
import { collectionKey } from '../../../src/library/core/collection/collectionIdentity';
import { omni } from '../../../src/services/onlineMusic/omni';
import { unregisterOnlineMusicProvider } from '../../../src/services/onlineMusic/providerRegistry';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { homeUserId, homeUserName, PROBE_PROVIDER_A, PROBE_PROVIDER_B } from '../libraryBehavior/fixtureRules';
import { registerFakeProviders, resetFakeProviders } from '../libraryBehavior/fakeProviders';
import { installNavidromeShim, NAVIDROME_PROBE_CONFIG } from '../libraryBehavior/navidromeShim';
import { recordProbeCall } from '../libraryBehavior/probeLog';
import { probeRefreshGate, releaseAllProbeRefreshGates } from '../libraryBehavior/probeGates';
import { PROBE_SURFACE_CALLBACKS } from '../libraryBehavior/probeSurfaceCallbacks';
import {
    isProbeSandbox,
    onProbeBackCollection,
    onProbePopCollectionTo,
    onProbePushCollection,
} from '../libraryBehavior/useLibraryProbeHarness';
import { readHomeLibrary, seedHomeLibrary } from './homeLocalFixtures';
import { installHomeServiceHook } from './serviceStubs';
import { installHomeProbeApi } from './homeProbeApi';
import type { HomeProbeDescriptor } from './probeApi';

// dev/probes/homeBehavior/useHomeProbeHarness.ts
// 首页探针的「假 App」，分两段：
// - useHomeProbeEnvironment：挂载时装好假 provider（首页档）、两个已登录账户、Navidrome 配置与垫片、
//   本地曲库种子和服务钩子，卸载时全部拆掉；就绪前不渲染首页（平台 hook 要在 provider 注册之后才第一次跑，
//   否则它会把选中的 provider 回退成 netease 并写进 localStorage）。
// - useHomeProbeModel：按 App 的方式装出 HomeViewModel（真实的账户 controller、本地曲库状态、
//   只记账的播放回调），交给真实的 Home 组件；同时安装 window.__homeProbe。

const NAVIDROME_CONFIG_KEY = 'navidrome_config';
const ACTIVE_PROVIDER_STORAGE_KEY = 'active_online_provider_id';
const PROBE_PROVIDERS = [PROBE_PROVIDER_A, PROBE_PROVIDER_B];
const PAGE_LIMIT = 50;

export type HomeProbeLibrary = { songs: LocalSong[]; playlists: LocalPlaylist[] };

// 一个 provider 的账户：按 App 刷新歌单的方式翻页取用户歌单，再取云盘；请求都经假 provider 记账。
const loadProbeAccount = async (providerId: string): Promise<void> => {
    const user = { id: homeUserId(providerId), nickname: homeUserName(providerId) };
    const store = useOnlineProviderAccountStore.getState();
    if (!store.accounts[providerId]?.user) {
        store.updateAccount(providerId, {
            status: 'authenticated',
            user,
            collections: [],
            hydration: 'ready',
            freshness: 'fresh',
        });
    }
    // The app's own account read: the fake provider's playlists and cloud collection land in the store.
    await omni.readAccount(providerId, 'sync');
};

const loadProbeAccounts = () => Promise.all(PROBE_PROVIDERS.map(loadProbeAccount));

/** 装好探针环境；返回就绪后的本地曲库（未就绪为 null）。 */
export const useHomeProbeEnvironment = (sandbox: boolean): HomeProbeLibrary | null => {
    const [library, setLibrary] = useState<HomeProbeLibrary | null>(null);

    useEffect(() => {
        if (!sandbox) return undefined;
        registerFakeProviders('home');
        resetFakeProviders();
        releaseAllProbeRefreshGates();
        const accountStore = useOnlineProviderAccountStore.getState();
        const previousProviderId = accountStore.activeProviderId;
        const previousStoredProviderId = localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
        const previousAccounts = accountStore.accounts;
        // 直接 setState，不走 setActiveProviderId：后者写 localStorage（切换 provider 时平台照常会写，卸载时还原）。
        useOnlineProviderAccountStore.setState({ activeProviderId: PROBE_PROVIDER_A });
        useCollectionNavigationStore.getState().clear();
        useLibrarySuiteStore.setState({ suite: DEFAULT_LIBRARY_SUITE_ID });
        useLibraryBrowseSessionStore.setState({ sessions: {}, order: [] });

        const previousNavidromeConfig = localStorage.getItem(NAVIDROME_CONFIG_KEY);
        localStorage.setItem(NAVIDROME_CONFIG_KEY, JSON.stringify(NAVIDROME_PROBE_CONFIG));
        const uninstallShim = installNavidromeShim();
        const uninstallServiceHook = installHomeServiceHook();

        let cancelled = false;
        void Promise.all([seedHomeLibrary(), loadProbeAccounts()]).then(([seeded]) => {
            if (!cancelled) setLibrary(seeded);
        });

        return () => {
            cancelled = true;
            setLibrary(null);
            uninstallServiceHook();
            uninstallShim();
            if (previousNavidromeConfig === null) localStorage.removeItem(NAVIDROME_CONFIG_KEY);
            else localStorage.setItem(NAVIDROME_CONFIG_KEY, previousNavidromeConfig);
            if (previousStoredProviderId === null) localStorage.removeItem(ACTIVE_PROVIDER_STORAGE_KEY);
            else localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, previousStoredProviderId);
            useCollectionNavigationStore.getState().clear();
            useOnlineProviderAccountStore.setState({ activeProviderId: previousProviderId, accounts: previousAccounts });
            PROBE_PROVIDERS.forEach(unregisterOnlineMusicProvider);
        };
    }, [sandbox]);

    return library;
};

const INITIAL_LOCAL_STATE: HomeLocalMusicState = {
    activeRow: 0,
    selectedGroup: null,
    detailStack: [],
    detailOriginView: null,
    focusedFolderIndex: 0,
    focusedAlbumIndex: 0,
    focusedArtistIndex: 0,
    focusedPlaylistIndex: 0,
};

// 账户 controller 的宿主表：探针不登出，切换时也不清播放、不问（与原先不带 prepare 的平台一样），
// 常量保证身份稳定。
const PROBE_ACCOUNT_TABLES: LibraryAccountHostTables = {
    logout: async () => {},
    confirmLogout: async () => true,
    switchCleanup: { leaveProvider: () => {}, holdsSongsOf: () => false, dropSongsOf: () => {} },
};

/** 切换平台并当场确认（首页用例只关心切换之后的数据，不经确认框）；返回是否切了过去。 */
const switchAndConfirm = async (account: LibraryAccountController, providerId: string): Promise<boolean> => {
    const request = account.requestSwitch(providerId);
    const pending = account.getSnapshot().pendingSwitch;
    if (pending?.to === providerId) void account.confirmSwitch(pending.id);
    return (await request).status === 'switched';
};

// 宿主收到的集合描述，只留可序列化、用例要断言的字段。
const summarizeDescriptor = (collection: GridViewCollectionDescriptor): HomeProbeDescriptor => {
    const raw = collection as unknown as Record<string, unknown>;
    return {
        key: collectionKey(collection),
        source: collection.source,
        ...(collection.source === 'online' ? { providerId: collection.providerId } : {}),
        type: String(collection.type),
        id: String(collection.id),
        name: String(collection.name),
        ...(Array.isArray(raw.songIds) ? { songIds: raw.songIds as string[] } : {}),
        ...(raw.isVirtual !== undefined ? { isVirtual: Boolean(raw.isVirtual) } : {}),
        ...(raw.editable !== undefined ? { editable: Boolean(raw.editable) } : {}),
        ...(typeof raw.entityId === 'string' ? { entityId: raw.entityId } : {}),
    };
};

/** 首页模型（交给真实的 Home）与 Home 的挂载 key（remount 时变）。 */
export const useHomeProbeModel = (initial: HomeProbeLibrary): { model: HomeViewModel; mountKey: number } => {
    const [localSongs, setLocalSongs] = useState<LocalSong[]>(initial.songs);
    const [localPlaylists, setLocalPlaylists] = useState<LocalPlaylist[]>(initial.playlists);
    const [localMusicState, setLocalMusicState] = useState<HomeLocalMusicState>(INITIAL_LOCAL_STATE);
    const [navidromeFocusedAlbumIndex, setNavidromeFocusedAlbumIndex] = useState(0);
    const [mountKey, setMountKey] = useState(0);
    const [stage, setStage] = useState<{ enabled: boolean; active?: boolean }>({ enabled: false });
    const localLibraryCatalog = useLocalLibraryCatalog(localSongs);
    const account = useLibraryAccountController(PROBE_ACCOUNT_TABLES);
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const activeProvider = resolveActiveProviderSummary(providers, activeProviderId);

    const refreshLocal = useCallback(async () => {
        recordProbeCall({ kind: 'refreshLocalSongs', ids: [] });
        await probeRefreshGate('refreshLocalSongs').wait();
        const { songs, playlists } = await readHomeLibrary();
        setLocalSongs(songs);
        setLocalPlaylists(playlists);
    }, []);

    const refreshUser = useCallback(async () => {
        recordProbeCall({ kind: 'refreshUser', ids: [] });
        await probeRefreshGate('refreshUser').wait();
        await loadProbeAccounts();
    }, []);

    const onOpenCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        const summary = summarizeDescriptor(collection);
        recordProbeCall({ kind: 'openCollection', ids: summary.songIds ?? [], key: summary.key, detail: summary });
        useCollectionNavigationStore.getState().openRoot(collection, 'home');
    }, []);
    const onPushCollection = useCallback((collection: GridViewCollectionDescriptor) => {
        onProbePushCollection(collection);
    }, []);

    const activeCollections = activeProvider?.collections;
    // 前往 Lattice（首页工具格「队列拼贴」、bravais 工具面板）：只记账。缺省不给（首页工具格与原来一样），用例经 setLattice 打开。
    const [latticeEnabled, setLatticeEnabled] = useState(false);
    const openLattice = useCallback(() => recordProbeCall({ kind: 'openLattice', ids: [] }), []);
    const surfaceProps = useMemo<HomeSurfaceProps>(() => ({
        ...PROBE_SURFACE_CALLBACKS,
        onRefreshUser: () => void refreshUser(),
        onRefreshLocalSongs: refreshLocal,
        user: activeProvider?.user ?? null,
        playlists: activeCollections?.filter(collection => collection.type !== 'cloud') ?? [],
        cloudPlaylist: activeCollections?.find(collection => collection.type === 'cloud') ?? null,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        localMusicState,
        setLocalMusicState,
        navidromeEnabled: true,
        navidromeFocusedAlbumIndex,
        setNavidromeFocusedAlbumIndex,
        onSearchCommitted: (query, sourceTab) => recordProbeCall({ kind: 'searchCommitted', ids: [], text: query, key: String(sourceTab) }),
        onOpenSettings: () => {},
        stageEnabled: stage.enabled,
        stageIsActive: Boolean(stage.active),
        onOpenStagePlayer: stage.enabled ? () => recordProbeCall({ kind: 'openStagePlayer', ids: [] }) : undefined,
        onOpenLattice: latticeEnabled ? openLattice : undefined,
        theme: DEFAULT_THEME,
    }), [
        stage,
        activeCollections,
        localLibraryCatalog,
        localMusicState,
        localPlaylists,
        localSongs,
        navidromeFocusedAlbumIndex,
        activeProvider?.user,
        refreshLocal,
        refreshUser,
        openLattice,
        latticeEnabled,
    ]);

    const model = useMemo<HomeViewModel>(() => ({
        surfaceProps,
        account,
        onOpenCollection,
        onPushCollection,
        onPopCollectionTo: onProbePopCollectionTo,
        onBackCollection: onProbeBackCollection,
    }), [account, onOpenCollection, onPushCollection, surfaceProps]);

    const latestRef = useRef({ account, localSongs, localPlaylists });
    latestRef.current = { account, localSongs, localPlaylists };
    useEffect(() => installHomeProbeApi({
        sandbox: true,
        ready: () => true,
        remount: () => setMountKey(key => key + 1),
        localSongIds: () => latestRef.current.localSongs.map(song => song.id),
        localPlaylists: () => latestRef.current.localPlaylists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            songIds: [...playlist.songIds],
        })),
        providers: () => latestRef.current.account.getSnapshot().providers.map(provider => provider.providerId),
        activeProvider: () => latestRef.current.account.getSnapshot().activeProviderId,
        switchProvider: providerId => switchAndConfirm(latestRef.current.account, providerId),
        signOut: providerId => useOnlineProviderAccountStore.getState().clearAccount(providerId),
        setStage,
        setLattice: setLatticeEnabled,
    }), []);

    return { model, mountKey };
};

export { isProbeSandbox };
