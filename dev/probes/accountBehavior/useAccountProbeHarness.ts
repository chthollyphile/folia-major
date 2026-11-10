import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OnlineMusicProvider, OnlineProviderId } from '../../../src/types/onlineMusic';
import type { HomeViewModel } from '../../../src/components/app/home/buildHomeModel';
import type { HomeLocalMusicState, HomeSurfaceProps } from '../../../src/components/app/home/homeSurfaceTypes';
import type { LocalLibraryCatalogSnapshot } from '../../../src/hooks/useLocalLibraryCatalog';
import type { LibraryAccountController } from '../../../src/library/core/account/account.contract';
import { useLibraryAccountController } from '../../../src/library/app/useLibraryAccountController';
import { useLibraryAccountProviders } from '../../../src/library/core/account/useLibraryAccount';
import { resolveActiveProviderSummary } from '../../../src/library/core/account/accountRules';
import { omni } from '../../../src/services/onlineMusic/omni';
import {
    listOnlineMusicProviders,
    registerOnlineMusicProvider,
    unregisterOnlineMusicProvider,
} from '../../../src/services/onlineMusic/providerRegistry';
import { useOnlineProviderAccountStore } from '../../../src/stores/useOnlineProviderAccountStore';
import { useNeteaseApiStatusStore } from '../../../src/services/onlineMusic/netease/useNeteaseApiStatusStore';
import { useCollectionNavigationStore } from '../../../src/stores/useCollectionNavigationStore';
import { useLibrarySuiteStore } from '../../../src/library/core/suite/useLibrarySuiteStore';
import { DEFAULT_LIBRARY_SUITE_ID } from '../../../src/library/core/suite/librarySuites';
import { DEFAULT_THEME } from '../../../src/services/baseThemes';
import { PROBE_SURFACE_CALLBACKS } from '../libraryBehavior/probeSurfaceCallbacks';
import {
    onProbeBackCollection,
    onProbePopCollectionTo,
    onProbePushCollection,
} from '../libraryBehavior/useLibraryProbeHarness';
import {
    ACCOUNT_INITIAL_ACTIVE,
    ACCOUNT_NETEASE,
    ACCOUNT_PROVIDERS,
    accountUser,
} from './accountFixtureRules';
import {
    clearAccountCalls,
    createFakeAuthProvider,
    failCreate,
    failRefresh,
    getAccountCalls,
    recordAccountCall,
    resetFakeAuth,
    scriptQrStates,
    setQrTtl,
    setSelfCheck,
    shouldFailRefresh,
} from './fakeAuthProviders';
import { probeSwitchCleanup } from './probeSwitchCleanup';
import type { AccountProbeApi } from './probeApi';

// dev/probes/accountBehavior/useAccountProbeHarness.ts
// 账户探针的「假 App」，分两段：
// - useAccountProbeEnvironment：挂载时把内置 provider 换成六个假 provider、种好账户与当前平台、接管网易后端的
//   状态与重启动作，卸载时全部还原；就绪前不渲染首页（平台 hook 第一次跑时 provider 必须已经注册，
//   否则它会把当前平台回退成 netease 并写进 localStorage）。
// - useAccountProbeModel：按 App 的方式装出 HomeViewModel——真实的账户 controller（useLibraryAccountController，
//   刷新器 / 登出表与 App 同形、只记账，切换清理是应用的端口外包一层记账），交给真实的 Home（registry 解析出的
//   网格首页 Grid3D；登录弹窗与切换确认框由 Home 里的账户宿主渲染）；同时安装 window.__accountProbe。

const ACTIVE_PROVIDER_STORAGE_KEY = 'active_online_provider_id';

const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

const seedAccount = (providerId: string, status: 'authenticated' | 'anonymous'): void => {
    const store = useOnlineProviderAccountStore.getState();
    if (status === 'anonymous') {
        store.clearAccount(providerId);
        return;
    }
    store.updateAccount(providerId, {
        status: 'authenticated',
        user: accountUser(providerId),
        collections: [],
        hydration: 'ready',
        freshness: 'fresh',
        error: undefined,
    });
};

// ---- 网易本地后端：接管 store 的 restart（真实实现走 Electron bridge，探针没有），流程与真实一致 ----
let restartPlan: { outcome: 'running' | 'error'; delayMs: number } = { outcome: 'running', delayMs: 300 };

const backendStatus = (status: 'starting' | 'running' | 'error', error: string | null = null): ElectronNeteaseApiStatus => ({
    status,
    port: status === 'running' ? 4173 : null,
    error,
    updatedAt: Date.now(),
});

const probeRestartNeteaseApi = async (): Promise<void> => {
    const store = useNeteaseApiStatusStore;
    recordAccountCall({ op: 'backend-restart', providerId: ACCOUNT_NETEASE });
    if (store.getState().restarting) return;
    store.setState({ restarting: true });
    try {
        await delay(restartPlan.delayMs);
        store.setState({
            status: backendStatus(restartPlan.outcome, restartPlan.outcome === 'error' ? 'probe: restart failed' : null),
        });
    } finally {
        store.setState({ restarting: false });
    }
};

/** 装好探针环境；返回是否就绪。 */
export const useAccountProbeEnvironment = (): boolean => {
    const [ready, setReady] = useState(false);

    useEffect(() => {
        const builtins: OnlineMusicProvider[] = listOnlineMusicProviders();
        builtins.forEach(provider => unregisterOnlineMusicProvider(provider.id));
        resetFakeAuth();
        restartPlan = { outcome: 'running', delayMs: 300 };
        ACCOUNT_PROVIDERS.forEach(rule => registerOnlineMusicProvider(createFakeAuthProvider(rule)));

        const accountStore = useOnlineProviderAccountStore.getState();
        const previousAccounts = accountStore.accounts;
        const previousProviderId = accountStore.activeProviderId;
        const previousStoredProviderId = localStorage.getItem(ACTIVE_PROVIDER_STORAGE_KEY);
        // 直接 setState，不走 setActiveProviderId：后者写 localStorage（切换时平台照常会写，卸载时还原）。
        useOnlineProviderAccountStore.setState({ accounts: {}, activeProviderId: ACCOUNT_INITIAL_ACTIVE });
        ACCOUNT_PROVIDERS.forEach(rule => {
            if (rule.initial) seedAccount(rule.id, rule.initial);
        });

        const previousNetease = useNeteaseApiStatusStore.getState();
        useNeteaseApiStatusStore.setState({ supported: false, status: null, restarting: false, restart: probeRestartNeteaseApi });
        useCollectionNavigationStore.getState().clear();
        useLibrarySuiteStore.setState({ suite: DEFAULT_LIBRARY_SUITE_ID });
        setReady(true);

        return () => {
            setReady(false);
            useNeteaseApiStatusStore.setState({
                supported: previousNetease.supported,
                status: previousNetease.status,
                restarting: previousNetease.restarting,
                restart: previousNetease.restart,
            });
            useCollectionNavigationStore.getState().clear();
            useOnlineProviderAccountStore.setState({ accounts: previousAccounts, activeProviderId: previousProviderId });
            if (previousStoredProviderId === null) localStorage.removeItem(ACTIVE_PROVIDER_STORAGE_KEY);
            else localStorage.setItem(ACTIVE_PROVIDER_STORAGE_KEY, previousStoredProviderId);
            ACCOUNT_PROVIDERS.forEach(rule => unregisterOnlineMusicProvider(rule.id));
            builtins.forEach(registerOnlineMusicProvider);
        };
    }, []);

    return ready;
};

// ---- 宿主注入给平台的两张表：与 App 的 onlineProviderRefreshers / onlineProviderLogouts 同形，只记账 ----

// 账户刷新：成功时把账户写成已登录（App 的刷新器从 provider 拉登录态再写 store），失败时回 false、不动账户。
const refreshProbeAccount = async (providerId: OnlineProviderId): Promise<boolean> => {
    await delay(30);
    if (shouldFailRefresh(providerId)) {
        recordAccountCall({ op: 'refresh', providerId, ok: false });
        return false;
    }
    seedAccount(providerId, 'authenticated');
    recordAccountCall({ op: 'refresh', providerId, ok: true });
    return true;
};

// 宿主登出：先记一笔，再走 omni.logout 和清账户（酷狗等 provider 的登出还会清自己的完整登录态）。
const logoutProbeAccount = async (providerId: OnlineProviderId): Promise<void> => {
    recordAccountCall({ op: 'host-logout', providerId });
    await omni.signOutAccount(providerId);
    useOnlineProviderAccountStore.getState().clearAccount(providerId);
};

const AUTH_PROVIDER_IDS = ACCOUNT_PROVIDERS.filter(rule => rule.auth).map(rule => rule.id);
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

const EMPTY_CATALOG: LocalLibraryCatalogSnapshot = {
    entities: [],
    assignments: [],
    ready: true,
    failed: false,
    reload: async () => {},
};

const NO_OP = () => {};

const PROBE_ACCOUNT_TABLES = { logout: logoutProbeAccount, confirmLogout: async () => true, switchCleanup: probeSwitchCleanup };

export type AccountProbeModel = {
    model: HomeViewModel;
    account: LibraryAccountController;
    accountTabVisible: boolean;
};

/** 首页模型（交给真实的 Home）、账户 controller 与账户面板开关；同时安装 window.__accountProbe。 */
export const useAccountProbeModel = (): AccountProbeModel => {
    const [localMusicState, setLocalMusicState] = useState<HomeLocalMusicState>(INITIAL_LOCAL_STATE);
    const [accountTabVisible, setAccountTabVisible] = useState(false);
    const account = useLibraryAccountController(PROBE_ACCOUNT_TABLES);
    const { providers, activeProviderId } = useLibraryAccountProviders(account);
    const activeProvider = resolveActiveProviderSummary(providers, activeProviderId);

    const onOpenCollection = useCallback<HomeViewModel['onOpenCollection']>(collection => {
        useCollectionNavigationStore.getState().openRoot(collection, 'home');
    }, []);
    const onPushCollection = useCallback<HomeViewModel['onPushCollection']>(collection => {
        onProbePushCollection(collection);
    }, []);

    const activeCollections = activeProvider?.collections;
    const surfaceProps = useMemo<HomeSurfaceProps>(() => ({
        ...PROBE_SURFACE_CALLBACKS,
        onRefreshUser: NO_OP,
        onRefreshLocalSongs: NO_OP,
        user: activeProvider?.user ?? null,
        playlists: activeCollections?.filter(collection => collection.type !== 'cloud') ?? [],
        cloudPlaylist: activeCollections?.find(collection => collection.type === 'cloud') ?? null,
        localSongs: [],
        localLibraryCatalog: EMPTY_CATALOG,
        localPlaylists: [],
        localMusicState,
        setLocalMusicState,
        navidromeEnabled: false,
        onSearchCommitted: NO_OP,
        onOpenSettings: NO_OP,
        theme: DEFAULT_THEME,
    }), [activeCollections, activeProvider?.user, localMusicState]);

    const model = useMemo<HomeViewModel>(() => ({
        surfaceProps,
        account,
        onOpenCollection,
        onPushCollection,
        onPopCollectionTo: onProbePopCollectionTo,
        onBackCollection: onProbeBackCollection,
    }), [account, onOpenCollection, onPushCollection, surfaceProps]);

    const accountRef = useRef(account);
    accountRef.current = account;
    useEffect(() => {
        let switchResult: string | null = null;
        const api: AccountProbeApi = {
            ready: () => true,
            providers: () => accountRef.current.getSnapshot().providers.map(provider => provider.providerId),
            activeProvider: () => useOnlineProviderAccountStore.getState().activeProviderId,
            accountStatus: providerId => useOnlineProviderAccountStore.getState().accounts[providerId]?.status ?? 'unknown',
            pendingSwitch: () => accountRef.current.getSnapshot().pendingSwitch?.to ?? null,
            requestGeneration: () => omni.getActiveRequestGeneration(),
            calls: () => getAccountCalls(),
            clearLog: clearAccountCalls,
            scriptQr: scriptQrStates,
            setQrTtl,
            failRefresh,
            failCreate,
            setSelfCheck,
            setAccount: seedAccount,
            setActive: providerId => useOnlineProviderAccountStore.setState({ activeProviderId: providerId }),
            setNeteaseBackend: ({ supported, status, error = null }) => {
                useNeteaseApiStatusStore.setState({ supported, status: backendStatus(status, error) });
            },
            setBackendRestart: (outcome, delayMs = 300) => {
                restartPlan = { outcome, delayMs };
            },
            suite: () => useLibrarySuiteStore.getState().suite,
            setSuite: suiteId => useLibrarySuiteStore.getState().setSuite(suiteId),
            startLogin: async providerId => (await accountRef.current.startLogin(providerId)).status,
            requestSwitch: providerId => {
                switchResult = null;
                void accountRef.current.requestSwitch(providerId).then(result => {
                    switchResult = result.status === 'declined' ? `declined:${result.reason}` : result.status;
                });
            },
            switchResult: () => switchResult,
            showAccountTab: setAccountTabVisible,
        };
        window.__accountProbe = api;
        return () => {
            if (window.__accountProbe === api) delete window.__accountProbe;
        };
    }, []);

    return { model, account, accountTabVisible };
};
