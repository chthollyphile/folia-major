import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Settings, PanelsTopLeft, RefreshCw, Music, User, ListFilter } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveSearchSource, useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import type { LocalLibraryCatalogSnapshot } from '../hooks/useLocalLibraryCatalog';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, PlayerState, type StatusMessage, type UnifiedSong } from '../types';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import LocalGrid3DView from './app/home/LocalGrid3DView';
import NavidromeGrid3DView from './app/home/NavidromeGrid3DView';
import DesktopGrid3DSurface, { type DesktopGrid3DAction } from './folia-grid/DesktopGrid3DSurface';
import {
    createOnlineGridViewCollection,
    getProviderCollectionArtistLabel,
} from './app/home/gridViewCollectionAdapters';
import { importFolder, resyncAllFolders, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../services/localMusicService';
import { getLocalLibraryAvailability } from '../services/localLibraryAvailability';
import { importLocalPlaylistFile } from '../services/localPlaylistFileService';
import { useOnlineProviderQrLogin } from '../hooks/useOnlineProviderQrLogin';
import type { OnlineProviderPlatformState } from '../hooks/useOnlineProviderPlatform';
import { omni } from '../services/onlineMusic/omni';
import { useHomeCardPositionStore } from '../stores/useHomeCardPositionStore';
import { CategoryFilterButton, CategoryFilterPanel, type CategorySelection } from './folia-grid/CategoryFilterPanel';
import type { ProviderSongListCategoryGroup } from '../types/onlineMusic';
import { getPersonalFmSelectionLabel } from '../services/onlineMusic/fmModes';
import { buildDiscoverSections, buildDiscoverSongCardId, dedupeDiscoverSongs, type DiscoverSection } from './app/home/buildDiscoverSections';
import { usePersonalFmModeStore } from '../stores/usePersonalFmModeStore';
import { useRecentPlaysStore } from '../stores/useRecentPlaysStore';
import { getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import OnlineProviderSwitcher from './app/home/OnlineProviderSwitcher';
import OnlineProviderConnectPanel from './app/home/OnlineProviderConnectPanel';
import OnlineProviderAccountlessPanel from './app/home/OnlineProviderAccountlessPanel';
import OnlineProviderLoginModal from './app/home/OnlineProviderLoginModal';
import { buildQrLoginDiagnosticsProps } from './app/home/buildQrLoginDiagnosticsProps';
import { canSwitchToProviderDirectly, resolveOnlineProviderAccountView } from './app/home/onlineProviderAccountView';
import type { MediaId, OnlineSearchSuggestion, OmniProviderCapabilities, ProviderAccountSummary, ProviderCollection, ProviderUser } from '../types/onlineMusic';
import qqIcon from '../assets/providers/qq.svg';
import wechatIcon from '../assets/providers/wechat.svg';
import { useHomeLayoutSettingsStore } from '../stores/useHomeLayoutSettingsStore';
import { useNeteaseApiStatusStore } from '../stores/useNeteaseApiStatusStore';
import { useThemeSettingsStore } from '../stores/useThemeSettingsStore';
import { countRender } from '../dev/renderCount';

// src/components/Grid3D.tsx
// Glassmorphic interactive desktop home view replacing the legacy 3D carousel.
// Supports cover sliding with auto-fading header controls and delegates GridView opening upward.

// Each provider scans from its own app, so the modal copy is keyed here instead of nested in the JSX.
const LOGIN_COPY_BY_PROVIDER: Record<string, { title: string; note: string }> = {
    kugou: { title: 'home.loginTitleKugou', note: 'home.loginNoteKugou' },
    qq: { title: 'home.loginTitleQq', note: 'home.loginNoteQq' },
};
const NETEASE_LOGIN_COPY = { title: 'home.loginTitle', note: 'home.loginNote' };

const NO_PROVIDER_CAPABILITIES: OmniProviderCapabilities = {
    search: false,
    playback: false,
    lyrics: false,
    auth: false,
    userLibrary: false,
    playlists: false,
    albums: false,
    artists: false,
    recommendations: false,
    mutations: false,
    wordByWordLyrics: false,
};

// The platform only hands out registered provider ids, but a Folium mod can remove its provider at any
// time; reading a provider that just went away must not throw during render and take the home view down.
const readProviderCapabilities = (providerId: string): OmniProviderCapabilities => {
    try {
        return omni.getProviderCapabilities(providerId);
    } catch {
        return NO_PROVIDER_CAPABILITIES;
    }
};

// provider 只声明 iconKey 字符串，静态资源的映射留在 UI 层，services 层不碰 .svg。
const LOGIN_METHOD_ICONS: Record<string, string> = {
    qq: qqIcon,
    wechat: wechatIcon,
};

interface Grid3DProps {
    onlineProviderPlatform?: OnlineProviderPlatformState;
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    currentTrack?: SongResult | null;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => Promise<void> | void;
    localMusicState: {
        activeRow: 0 | 1 | 2 | 3;
        selectedGroup: LocalLibraryGroup | null;
        detailStack: LocalLibraryGroup[];
        detailOriginView: 'home' | 'player' | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    };
    setLocalMusicState: React.Dispatch<React.SetStateAction<{
        activeRow: 0 | 1 | 2 | 3;
        selectedGroup: LocalLibraryGroup | null;
        detailStack: LocalLibraryGroup[];
        detailOriginView: 'home' | 'player' | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    }>>;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    pendingNavidromeSelection?: any;
    onPendingNavidromeSelectionHandled?: () => void;
    onSearchCommitted: (query: string, sourceTab: any, replace?: boolean) => void;
    theme: Theme;
    onOpenSettings?: (initialTab?: 'help' | 'options') => void;
    onOpenLattice?: () => void;
    navidromeEnabled?: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onStatusMessage?: (message: StatusMessage) => void;
    onOpenGridView?: (collection: any) => void;
    stageEnabled?: boolean;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
    isInteractive?: boolean;
}

export const Grid3D: React.FC<Grid3DProps> = (props) => {
    countRender('Grid3D');
    const {
        onPlaySong,
        onBackToPlayer,
        onRefreshUser,
        user,
        playlists,
        cloudPlaylist = null,
        currentTrack,
        localSongs,
        localLibraryCatalog,
        localPlaylists,
        onRefreshLocalSongs,
        localMusicState,
        setLocalMusicState,
        navidromeFocusedAlbumIndex = 0,
        setNavidromeFocusedAlbumIndex,
        pendingNavidromeSelection = null,
        onPendingNavidromeSelectionHandled,
        onSearchCommitted,
        theme,
        onOpenSettings,
        onOpenLattice,
        navidromeEnabled = false,
        onOpenGridView,
        onStatusMessage,
        onPlayAll,
        onAddAllToQueue,
        stageEnabled = false,
        stageIsActive = false,
        onOpenStagePlayer,
        onlineProviderPlatform,
        isInteractive = true,
    } = props;

    const { t } = useTranslation();
    const {
        isDaylight,
    } = useThemeSettingsStore(useShallow(state => ({
        isDaylight: state.isDaylight,
    })));
    const {
        showHomeTabPlaylist,
        showHomeTabRadio,
        showHomeTabDiscover,
        showHomeTabAlbums,
        showHomeTabLocal,
    } = useHomeLayoutSettingsStore(useShallow(state => ({
        showHomeTabPlaylist: state.showHomeTabPlaylist,
        showHomeTabRadio: state.showHomeTabRadio,
        showHomeTabDiscover: state.showHomeTabDiscover,
        showHomeTabAlbums: state.showHomeTabAlbums,
        showHomeTabLocal: state.showHomeTabLocal,
    })));
    const {
        homeViewTab,
        setHomeViewTab,
        searchQuery,
        setSearchQuery,
        isSearching,
        submitSearch,
    } = useSearchNavigationStore(useShallow(state => ({
        homeViewTab: state.homeViewTab,
        setHomeViewTab: state.setHomeViewTab,
        searchQuery: state.searchQuery,
        setSearchQuery: state.setSearchQuery,
        isSearching: state.isSearching,
        submitSearch: state.submitSearch,
    })));

    const isOnlineTab = homeViewTab === 'playlist' || homeViewTab === 'albums' || homeViewTab === 'radio' || homeViewTab === 'discover';
    const activeProviderId = onlineProviderPlatform?.activeProviderId || 'netease';
    const activeProviderSummary = onlineProviderPlatform?.activeProvider;
    const activeProviderCapabilities = readProviderCapabilities(activeProviderId);
    // The FM card doubles as the mode readout: the card is the only place the current mode shows
    // up outside the player, and the picker can change it while this grid stays mounted.
    const personalFmSelection = usePersonalFmModeStore(state => state.selection);
    const personalFmModeLabel = activeProviderCapabilities.personalFmModes
        ? getPersonalFmSelectionLabel(personalFmSelection, (key, fallback) => t(key, fallback ?? ''))
        : '';
    const activeProviderLabel = activeProviderSummary?.shortName
        || activeProviderSummary?.displayName
        || omni.getProviderLabel(activeProviderId);
    const canUseOnlinePlaylists = activeProviderCapabilities.userLibrary && activeProviderCapabilities.playlists;
    const canUseOnlineAlbums = activeProviderCapabilities.userLibrary && Boolean(activeProviderCapabilities.userAlbums);
    const canUseOnlineRadio = activeProviderCapabilities.recommendations;
    const playlistUnavailableReason = canUseOnlinePlaylists
        ? undefined
        : t('status.providerLibraryUnavailable', { provider: activeProviderLabel });
    const albumsUnavailableReason = canUseOnlineAlbums
        ? undefined
        : t('status.providerUserAlbumsUnavailable', { provider: activeProviderLabel });
    const radioUnavailableReason = canUseOnlineRadio
        ? undefined
        : t('status.providerRecommendationsUnavailable', { provider: activeProviderLabel });
    const activeUser = activeProviderSummary?.user
        || (activeProviderId === 'netease' ? user : null);
    const activeAccountView = resolveOnlineProviderAccountView({
        provider: activeProviderSummary,
        hasUser: Boolean(activeUser),
        platformAvailable: Boolean(onlineProviderPlatform),
    });
    const activeCollections: ProviderCollection[] = activeProviderSummary?.collections || (activeProviderId === 'netease'
        ? [
            ...playlists,
            ...(cloudPlaylist ? [cloudPlaylist] : []),
        ]
        : []);
    // 统一最近播放：订阅历史条目，决定「最近播放」卡出不出、有几首。
    const recentPlays = useRecentPlaysStore(state => state.entries);
    const activeProviderNeedsRelogin = activeProviderSummary?.error === 'auth-required';

    const [focusedIndex, setFocusedIndex] = useState(0);
    const gridRootRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [isLocalImporting, setIsLocalImporting] = useState(false);
    const [isLocalPlaylistImporting, setIsLocalPlaylistImporting] = useState(false);
    const [isLocalRefreshing, setIsLocalRefreshing] = useState(false);
    const [scanProgress, setScanProgress] = useState<{
        active: boolean;
        folderName: string;
        totalSongs: number;
        completedSongs: number;
    } | null>(null);
    const [scanDetailsExpanded, setScanDetailsExpanded] = useState(false);
    const scanProgressPercent = scanProgress?.totalSongs
        ? Math.min(100, Math.round((scanProgress.completedSongs / scanProgress.totalSongs) * 100))
        : 0;

    const [updateStatus, setUpdateStatus] = useState<any>(null);

    useEffect(() => {
        if (!window.electron?.getUpdateStatus) {
            return;
        }

        let disposed = false;

        window.electron.getUpdateStatus().then((status) => {
            if (!disposed) {
                setUpdateStatus(status);
            }
        }).catch(() => {
            if (!disposed) {
                setUpdateStatus(null);
            }
        });

        const unsubscribe = window.electron.onUpdateStatusChanged?.((status) => {
            setUpdateStatus(status);
        });

        return () => {
            disposed = true;
            unsubscribe?.();
        };
    }, []);

    const showUpdateIndicator = Boolean(
        updateStatus?.updateCheckEnabled &&
        updateStatus.availableVersion &&
        !updateStatus.updateSeen
    );

    // Reset focused index when switching tabs.
    useEffect(() => {
        setFocusedIndex(0);
    }, [homeViewTab]);

    useEffect(() => {
        const handleScanProgress = (event: Event) => {
            const customEvent = event as CustomEvent<{
                active: boolean;
                folderName: string;
                totalSongs: number;
                completedSongs: number;
            }>;
            setScanProgress(customEvent.detail.active ? customEvent.detail : null);
        };

        window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
        return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
    }, []);

    // Login QR State
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [loginProviderId, setLoginProviderId] = useState(activeProviderId);
    // 泛型：provider 声明了多种扫码登录方式才走两步式，没声明的回空数组、维持单步流程。
    const [selectedLoginMethodId, setSelectedLoginMethodId] = useState<string | null>(null);
    const [loginMethodOptions, setLoginMethodOptions] = useState(() => omni.getQrLoginMethods(activeProviderId));
    const loginAttemptIdRef = useRef(0);
    const {
        qrCodeImg,
        qrState,
        qrStatusText,
        failure: qrLoginFailure,
        buildDiagnosticReport: buildQrDiagnosticReport,
        start: startQrLogin,
        stop: stopQrLogin,
    } = useOnlineProviderQrLogin({
        providerId: loginProviderId,
        t,
        onConfirmed: async (confirmedProviderId) => {
            setShowLoginModal(false);
            if (!onlineProviderPlatform) {
                onRefreshUser();
                return true;
            }
            const outcome = await onlineProviderPlatform.completeLogin(confirmedProviderId);
            // 扫码确认了却没拿到登录态：把弹窗重新打开，让用户看到失败和诊断入口，而不是静默停在未登录。
            if (outcome === 'refresh-failed') {
                setShowLoginModal(true);
                return false;
            }
            return true;
        },
    });

    const initLogin = async (providerId = activeProviderId) => {
        const summary = onlineProviderPlatform?.providers.find(provider => provider.providerId === providerId);
        if (summary && !summary.availability.configured) return;
        const attemptId = ++loginAttemptIdRef.current;
        // 等待远端能力发现，并把同一份结果同时用于流程分支与弹窗，避免异步结果让两者错位。
        const methods = await omni.resolveQrLoginMethods(providerId);
        if (attemptId !== loginAttemptIdRef.current) return;
        setLoginProviderId(providerId);
        setLoginMethodOptions(methods);
        setShowLoginModal(true);
        setSelectedLoginMethodId(null);
        // 有多种登录方式时先停在步骤一，选定之前不向后端要二维码。
        if (methods.length > 0) return;
        await startQrLogin(providerId);
    };

    // Shared by the switcher and the connect panel: switch now when there is nothing to sign in to.
    const selectProvider = (provider: ProviderAccountSummary) => {
        if (canSwitchToProviderDirectly(provider)) {
            void onlineProviderPlatform?.switchProvider(provider.providerId);
        } else {
            void initLogin(provider.providerId);
        }
    };

    // 网易云的本地后端起不来时，二维码请求必然失败；弹窗改为直接暴露原因和重启入口。
    const neteaseApiSupported = useNeteaseApiStatusStore(state => state.supported);
    const neteaseApiStatus = useNeteaseApiStatusStore(state => state.status);
    const neteaseApiRestarting = useNeteaseApiStatusStore(state => state.restarting);
    const restartNeteaseApi = useNeteaseApiStatusStore(state => state.restart);
    const neteaseBackendFailed = neteaseApiSupported
        && loginProviderId === 'netease'
        && neteaseApiStatus?.status === 'error';

    const handleRestartNeteaseApi = async () => {
        await restartNeteaseApi();
        // 重启成功后直接把二维码要回来，省掉一次手动刷新。
        if (useNeteaseApiStatusStore.getState().status?.status === 'running') {
            await startQrLogin('netease');
        }
    };

    const selectLoginMethod = (methodId: string) => {
        setSelectedLoginMethodId(methodId);
        void startQrLogin(loginProviderId, methodId);
    };

    // Online provider collection details
    const [favoriteAlbums, setFavoriteAlbums] = useState<ProviderCollection[]>([]);
    const [loadingAlbums, setLoadingAlbums] = useState(false);
    // 「这个账号已经拉过一次收藏专辑了」：结果为空时 length 恒为 0，没有这个标记的话
    // 每次切到专辑 tab 都会再打一次请求，界面表现就是反复骨架闪一下又变空。
    const albumsLoadedScopeRef = useRef<string | null>(null);
    const [radioItems, setRadioItems] = useState<any[]>([]);
    const [loadingRadio, setLoadingRadio] = useState(false);
    // 「换一批」的批次偏移：只在 radio tab 的 actions 里递增，回首页不重置（保持这一轮的进度）。
    const [radioFrom, setRadioFrom] = useState(0);
    const [discoverSections, setDiscoverSections] = useState<DiscoverSection[]>([]);
    const [discoverError, setDiscoverError] = useState<string | null>(null);
    const [loadingDiscover, setLoadingDiscover] = useState(false);
    // 面板宽度跟着窗口走：窄窗收紧避免挤出屏幕，宽窗多给一些（一屏放得下更多胶囊，
    // 少换一行）。0.55/1 两档是分段而不是线性——留出稳定的中间带，避免拖动时宽度抖动。
    const [panelSizeScale, setPanelSizeScale] = useState(0.55);
    useEffect(() => {
        const compute = () => {
            const width = window.innerWidth;
            const next = width >= 1600 ? 1 : width >= 1100 ? 0.55 : 0.42;
            setPanelSizeScale(prev => (prev === next ? prev : next));
        };
        compute();
        window.addEventListener('resize', compute);
        return () => window.removeEventListener('resize', compute);
    }, []);

    // 与 DesktopGrid3DSurface 的 focusMemoryScope 字面保持一致：换一批要把这个 scope 的旧位置干掉。
    const homeCardFocusScope = JSON.stringify(['online', activeProviderId, activeUser?.id ?? null, homeViewTab]);
    // 歌单广场的分类筛选（语种/流派/主题/心情/场景）。provider 没实现时 groups 为空，入口自动不出。
    // 选中后广场的数据源从推荐切到该分类下的歌单，而不是另开一个页面。
    const [categoryGroups, setCategoryGroups] = useState<ProviderSongListCategoryGroup[]>([]);
    const [categorySelected, setCategorySelected] = useState<CategorySelection | null>(null);
    const [categoryPanelOpen, setCategoryPanelOpen] = useState(false);
    const [categorySongLists, setCategorySongLists] = useState<ProviderCollection[]>([]);
    const [loadingCategory, setLoadingCategory] = useState(false);
    // 已经拉过的分类（provider:categoryId）：切 tab 回来时据此复用，不重拉、不闪骨架。
    const categorySongListsScopeRef = useRef<string | null>(null);

    // 分类树：只在电台 tab 且该 provider 支持时拉（静态数据，不随选中变化）。
    // 失败要重试一次：上游偶发的出网抖动（实测见过 TLS socket 被断）会让这一趟空手而归，
    // 而空数组的后果是「分类」入口整场消失——用户以为没这个功能。所以宁可多打一次。
    useEffect(() => {
        if (homeViewTab !== 'radio' || !canUseOnlineRadio) return;
        if (!omni.canBrowseSongListCategories(activeProviderId)) return;
        let cancelled = false;
        let retryTimer = 0;

        const load = (isRetry: boolean) => {
            void omni.getSongListCategories(activeProviderId)
                .then(groups => { if (!cancelled) setCategoryGroups(groups); })
                .catch(error => {
                    console.warn(`[Grid3D] category tree failed${isRetry ? ' (after retry)' : ''}`, error);
                    if (cancelled) return;
                    if (!isRetry) {
                        retryTimer = window.setTimeout(() => load(true), 1500);
                        return;
                    }
                    setCategoryGroups([]);
                });
        };
        load(false);
        return () => {
            cancelled = true;
            if (retryTimer) window.clearTimeout(retryTimer);
        };
    }, [homeViewTab, canUseOnlineRadio, activeProviderId]);

    // 选中分类后拉该分类的歌单；取消选中（null）则回到推荐广场。
    useEffect(() => {
        if (homeViewTab !== "radio") return;
        if (!categorySelected) {
            setCategorySongLists([]);
            categorySongListsScopeRef.current = null;
            return;
        }
        // 切到别的 tab 再回来时，这个分类的数据可能已经拉过了。直接复用：
        // 不复用的话每次切走都清空、切回来重拉，用户看到的就是「闪一下骨架再出内容」，
        // 而且白白多打一次请求。拉过就记住是哪个分类。
        const scope = `${activeProviderId}:${categorySelected.itemId}`;
        if (categorySongListsScopeRef.current === scope && categorySongLists.length > 0) {
            setLoadingCategory(false);
            return;
        }
        let cancelled = false;
        setLoadingCategory(true);
        // 一屏的量就够：分类本身就是“逐层挑”，先给一屏，不做无限滚动。
        void omni.getCategorySongLists(activeProviderId, categorySelected.itemId, { limit: 35, offset: 0 })
            .then(page => {
                if (cancelled) return;
                setCategorySongLists(page.items);
                categorySongListsScopeRef.current = scope;
            })
            .catch(error => {
                console.warn('[Grid3D] category song lists failed', error);
                // 失败就不算拉过：记住的 scope 是上一个成功的分类，留着会让它挪到下一次
                // 切回来时误以为「这个已经有数据」，实际给的是刚过失败的那个空。
                if (!cancelled) {
                    setCategorySongLists([]);
                    categorySongListsScopeRef.current = null;
                }
            })
            .finally(() => { if (!cancelled) setLoadingCategory(false); });
        return () => { cancelled = true; };
    }, [homeViewTab, categorySelected, activeProviderId, categorySongLists.length]);

    const isLoading =
        (homeViewTab === 'playlist' && canUseOnlinePlaylists && activeCollections.length === 0 && activeUser !== null) ||
        (homeViewTab === 'albums' && canUseOnlineAlbums && loadingAlbums) ||
        (homeViewTab === 'radio' && canUseOnlineRadio && (loadingRadio || loadingCategory)) ||
        (homeViewTab === 'discover' && canUseOnlineRadio && loadingDiscover);

    // Load favorite albums and recommendations
    useEffect(() => {
        if (
            homeViewTab === 'albums'
            && canUseOnlineAlbums
            && favoriteAlbums.length === 0
            && activeUser
            // 同一账号拉过一次就不再拉：空结果不该让 tab 每次被点开都重打请求。
            && albumsLoadedScopeRef.current !== `${activeProviderId}:${activeUser.id}`
        ) {
            fetchFavoriteAlbums();
        }
        if (homeViewTab === 'radio' && canUseOnlineRadio && radioItems.length === 0 && activeUser) {
            fetchRadioItems();
        }
        if (homeViewTab === 'discover' && canUseOnlineRadio && discoverSections.length === 0 && activeUser) {
            fetchDiscoverItems();
        }
    }, [activeProviderId, activeUser, canUseOnlineAlbums, canUseOnlineRadio, homeViewTab]);

    // 启动预热：不等你点进发现页，登录后 2.5s 就在后台把数据备好（写入缓存）。
    // 会话内每个「音源+账号」只预热一次；用户若先一步进过发现页（已有内容）也不再预热，
    // 免得和进页拉取撞成双倍请求。
    const discoverCountRef = useRef(0);
    discoverCountRef.current = discoverSections.length;
    const prefetchedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (!canUseOnlineRadio || !activeUser) return;
        const prefetchKey = `${activeProviderId}:${activeUser?.id ?? ''}`;
        if (prefetchedKeyRef.current === prefetchKey) return;
        prefetchedKeyRef.current = prefetchKey;
        const timer = setTimeout(() => {
            if (discoverCountRef.current > 0) return;
            void fetchDiscoverItems();
        }, 2500);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canUseOnlineRadio, activeUser]);

    // 相似段不再自动补拉：之前「开始播放就补一段相似」会让发现页凭空多出一整排相似卡、
    // 轮播重排——用户的体感就是「点首歌退出来又刷新了」。列表的唯一变更入口是「换一批」：
    // 拉取那一刻在播歌，相似段就随批次进来；没在播就没有，绝不事后追加或替换。

    // 只在「真的切换了 provider/账号」时清空缓存态。挂载首跑不清；账号从「未就绪」水合
    // 成「已登录」也不算切换——否则它会把发现页刚同步填好的缓存批次抹掉，用户点歌退回
    // 来就是一片「暂无内容」（以前走异步网络没暴露：网络结果回来得晚，正好落在清空之后）。
    const prevAccountKeyRef = useRef<{ provider: string; user: MediaId | null } | null>(null);
    useEffect(() => {
        const current = { provider: activeProviderId, user: activeUser?.id ?? null };
        const prev = prevAccountKeyRef.current;
        prevAccountKeyRef.current = current;
        if (!prev) return;
        const providerChanged = prev.provider !== current.provider;
        const accountSwitched = prev.user !== null && current.user !== null && prev.user !== current.user;
        const loggedOut = prev.user !== null && current.user === null;
        if (!providerChanged && !accountSwitched && !loggedOut) return;
        setFavoriteAlbums([]);
        albumsLoadedScopeRef.current = null;
        setRadioItems([]);
        setDiscoverSections([]);
        setDiscoverError(null);
        setFocusedIndex(0);
    }, [activeProviderId, activeUser?.id]);

    const fetchFavoriteAlbums = async () => {
        if (!canUseOnlineAlbums) {
            setFavoriteAlbums([]);
            return;
        }
        albumsLoadedScopeRef.current = `${activeProviderId}:${activeUser?.id ?? 'anon'}`;
        setLoadingAlbums(true);
        try {
            let allAlbums: ProviderCollection[] = [];
            let offset = 0;
            const limit = 50;
            let hasMore = true;

            if (!activeUser) {
                setFavoriteAlbums([]);
                return;
            }
            while (hasMore) {
                const page = await omni.getUserAlbums(activeUser.id, { limit, offset });
                allAlbums = [...allAlbums, ...page.items];
                hasMore = page.hasMore && page.nextOffset > offset;
                offset = page.nextOffset;
            }
            setFavoriteAlbums(allAlbums);
        } catch (e) {
            console.error('[Grid3D] Failed to fetch favorite albums', e);
            // 失败要告诉用户：只写 console 的话，界面表现是「骨架闪一下、然后一片空白」，
            // 用户既不知道发生了什么，也无从重试。走全局单通道提示 + tab 的空态文案兜底。
            onStatusMessage?.({ type: 'error', text: t('home.loadFailedHint') });
        } finally {
            setLoadingAlbums(false);
        }
    };

    const fetchFavoriteAlbumsRef = useRef(fetchFavoriteAlbums);
    useEffect(() => {
        fetchFavoriteAlbumsRef.current = fetchFavoriteAlbums;
    });

    useEffect(() => {
        const handleRefreshAlbums = () => {
            void fetchFavoriteAlbumsRef.current();
        };
        window.addEventListener('folia-refresh-favorite-albums', handleRefreshAlbums);
        return () => window.removeEventListener('folia-refresh-favorite-albums', handleRefreshAlbums);
    }, []);

    // 广场一屏的批次量；「换一批」按这个步长推进偏移。
    const RADIO_PAGE_SIZE = 35;
    // `from` 是广场的批次偏移（「换一批」递增），首屏与预热都是 0。返回本次拿到的条数，
    // 换批的调用方要靠它判断上游是不是翻到头了（0 条就回卷到 0 再来一轮）。
    const fetchRadioItems = async (from = 0, isRetry = false): Promise<number> => {
        if (!canUseOnlineRadio) {
            setRadioItems([]);
            return 0;
        }
        // 先上缓存秒开，再拉新的覆盖（与发现页同一套 stale-while-revalidate）。
        if (radioItems.length === 0) {
            const cached = readRadioCache();
            if (cached && cached.length > 0) setRadioItems(cached);
        }
        setLoadingRadio(true);
        try {
            // 电台页要的是「大家都在听的」那一半；发现页要的是「给你的」那一半（见 fetchDiscoverItems）。
            const { personalFm: fmSongs, dailySongs, recommendedCollections } = await omni.getHomeFeed(RADIO_PAGE_SIZE, { scope: 'editorial', from });
            const fmCoverUrl = getSongCoverUrl(fmSongs[0], activeProviderId);


            const dailyItem = {
                id: 'daily_recommendations',
                name: t('home.dailyRecommendations'),
                coverUrl: getSongCoverUrl(dailySongs[0], activeProviderId) || '',
                trackCount: dailySongs.length,
                description: t('home.dailyRecommendationsDescription'),
                summary: t('home.dailyRecommendationsSummary'),
                isDailyRecommendations: true,
            };

            const recommendedItems = recommendedCollections.map(collection => {
                const description = collection.description || collection.creator?.nickname || '';
                return {
                    ...collection,
                    coverUrl: collection.coverUrl,
                    description,
                    summary: description,
                };
            });
            // 每日推荐只有部分 provider 实现（QQ 没有 getDailySongs）。无条件塞一张 0 首、空封面的卡，
            // 用户点进去只会看到一片空白，还以为是坏了 —— 没有歌就不出这张卡。
            // FM 卡只在发现页出现：那边是「点一下就持续放」的主入口，两边都放只会让人
            // 分不清两个 tab 的分工。电台页留给编辑选出来的歌单广场。
            const nextRadioItems = dailySongs.length > 0
                ? [dailyItem, ...recommendedItems]
                : recommendedItems;
            setRadioItems(nextRadioItems);
            writeRadioCache(nextRadioItems);
            return nextRadioItems.length;
        } catch (e) {
            console.error(`[Grid3D] Failed to fetch radio items${isRetry ? ' (after retry)' : ''}`, e);
            if (!isRetry) {
                await new Promise(resolve => setTimeout(resolve, 1200));
                return fetchRadioItems(from, true);
            }
            return 0;
        } finally {
            if (!isRetry) setLoadingRadio(false);
        }
    };

    // 「发现」与「电台」拿的是同一批上游数据，区别只在排序与去重：
    // 电台是 QQ/网易云/酷狗各自的推荐入口混排，发现把「猜你喜欢」提到第一位并去掉每日推荐卡
    // （每日推荐只有部分 provider 有，混进来会让同一个位置的含义随音源变化）。
    // FM 卡的 type/id 是有契约的：GridView 认 `type === 'radio' && id === 'personal_fm'` 才切 FM 模式。
    // 猜你喜欢聚合的拉取次数与目标首数。5 首不够「扫」，20 首差不多是一屏列表的量。
    const DISCOVER_FM_CALLS = 4;
    const DISCOVER_FM_TARGET = 20;

    // 上次的发现页/广场内容缓存（同 provider 隔离，24h 过期，localStorage 跨会话保留）。
    // 首次进入先渲染缓存再后台刷新（stale-while-revalidate）：重启应用后第一次点开也是秒开，
    // 而不是对着骨架屏等两秒。
    // UnifiedSong / ProviderCollection 都是 JSON-safe 的，播放链路只认 qqMid 与 sourceRef，
    // 序列化往返不丢关键字段。
    const DISCOVER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

    const readDiscoverCache = (): DiscoverSection[] | null => {
        try {
            const raw = localStorage.getItem(`folia.discoverCache.${activeProviderId}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as { savedAt: number; sections: DiscoverSection[] };
            if (Date.now() - parsed.savedAt > DISCOVER_CACHE_TTL_MS) return null;
            if (!Array.isArray(parsed.sections)) return null;
            return parsed.sections.filter(section => Array.isArray(section.songs));
        } catch {
            return null;
        }
    };

    const writeDiscoverCache = (sections: DiscoverSection[]): void => {
        try {
            localStorage.setItem(
                `folia.discoverCache.${activeProviderId}`,
                JSON.stringify({ savedAt: Date.now(), sections }),
            );
        } catch {
            // 存不进去就算了（隐私模式/配额），缓存只是加速不是正确性依赖
        }
    };

    const readRadioCache = (): any[] | null => {
        try {
            const raw = localStorage.getItem(`folia.radioCache.${activeProviderId}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw) as { savedAt: number; items: any[] };
            if (Date.now() - parsed.savedAt > DISCOVER_CACHE_TTL_MS) return null;
            if (!Array.isArray(parsed.items)) return null;
            return parsed.items;
        } catch {
            return null;
        }
    };

    const writeRadioCache = (items: any[]): void => {
        try {
            localStorage.setItem(
                `folia.radioCache.${activeProviderId}`,
                JSON.stringify({ savedAt: Date.now(), items }),
            );
        } catch {
            // 同上：失败静默
        }
    };

    const fetchDiscoverItems = async (force = false) => {
        if (!canUseOnlineRadio) {
            setDiscoverSections([]);
            return;
        }
        // 队列要稳定：有缓存就直接用这一批，绝不后台重拉——用户点进歌再退回来、
        // 或者听着听着切回来，看到的都该是同一批歌。只有「换一批」（force）才去
        // 上游取新批次并回写缓存。无缓存时照常拉一次。
        if (!force) {
            const cached = readDiscoverCache();
            if (cached && cached.length > 0) {
                setDiscoverSections(dedupeDiscoverSongs(cached));
                return;
            }
            if (discoverSections.length > 0) return;
        }
        setLoadingDiscover(true);
        setDiscoverError(null);
        // 相似歌曲跟着此刻在听的这首走；没有在播放就不请求，那一段整段不出。
        // 种子还必须与当前音源同源：QQ 歌的数字 id 拿去打网易的 /simi/song 只会问到无关的歌，
        // 跨源时宁可整段不出。
        const seedSongId = currentTrack
            && currentTrack.sourceRef?.kind === 'online'
            && currentTrack.sourceRef.providerId === activeProviderId
            ? String(currentTrack.id)
            : undefined;
        // 猜你喜欢单次上游硬顶 5 首，但每次调用返回的歌曲不同（实测 6 次 30 首零重复），
        // 所以并行拉 4 次按 mid 去重凑一份够「扫」的列表 —— 串行要 3.4s，并行只要一段往返。
        const collectFmSongs = async (): Promise<UnifiedSong[]> => {
            const calls = Array.from({ length: DISCOVER_FM_CALLS }, () =>
                omni.getPersonalFm().catch((error: unknown) => {
                    console.warn('[Grid3D] discover fm call failed', error);
                    return [] as UnifiedSong[];
                }),
            );
            const collected: UnifiedSong[] = [];
            const seen = new Set<string>();
            for (const batch of await Promise.all(calls)) {
                for (const song of batch) {
                    const key = String(song.sourceRef?.mediaId ?? song.id);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    collected.push(song);
                }
            }
            return collected;
        };
        try {
            const swallow = (label: string) => (error: unknown) => {
                console.warn(`[Grid3D] discover ${label} failed`, error);
                return [] as UnifiedSong[];
            };
            const [fmSongs, similarSongs, radarSongs, newSongs] = await Promise.all([
                collectFmSongs(),
                seedSongId
                    ? omni.getRecommendationRowSongs('similar', { seedSongId }).catch(swallow('similar'))
                    : Promise.resolve([] as UnifiedSong[]),
                omni.getRecommendationRowSongs('radar').catch(swallow('radar')),
                omni.getRecommendationRowSongs('new-songs').catch(swallow('new-songs')),
            ]);
            const sections = buildDiscoverSections({
                fmSongs,
                similarSongs,
                radarSongs,
                newSongs,
                hasSeed: Boolean(seedSongId),
                titles: {
                    personalFm: t('home.personalFm'),
                    similar: t('home.discoverSimilar'),
                    radar: t('home.discoverRadar'),
                    newSongs: t('home.discoverNewSongs'),
                },
                ...(currentTrack?.name ? {
                    similarSeedLabel: t('home.discoverSimilarSeed', { song: currentTrack.name }),
                } : {}),
            });
            // 空结果（上游全挂了）绝不覆盖已有内容、也绝不写缓存——否则一次 500 风暴就能
            // 把缓存污染成空，之后每次回来都绕开缓存重拉，列表永远在变、还越拉越卡。
            if (sections.length > 0) {
                const dedupedSections = dedupeDiscoverSongs(sections);
                setDiscoverSections(dedupedSections);
                writeDiscoverCache(dedupedSections);
            } else if (discoverSections.length === 0) {
                setDiscoverError(t('home.discoverUnavailable'));
            }
            setLoadingDiscover(false);
            return;
        } catch (e) {
            console.error(`[Grid3D] Failed to fetch discover items`, e);
        }
        // 拉取失败：有内容就留着让用户继续听同一批，彻底空白才给一句能看懂的原因。
        if (discoverSections.length === 0) {
            setDiscoverError(t('home.discoverUnavailable'));
        }
        setLoadingDiscover(false);
    };

    // Filter cloud and local playlists
    const playlistCards = useMemo(() => {
        const cards = activeCollections.map(p => ({
            id: p.id,
            name: p.name,
            coverUrl: p.coverUrl,
            trackCount: p.trackCount,
            description: p.creator?.nickname || t('home.playlists'),
            summary: p.description || '',
            type: p.type,
            raw: p
        }));
        // 统一最近播放：有历史才出这张卡，置顶。它是跨音源的虚拟集合，点开走 GridView 的 recent_plays 分支。
        if (recentPlays.length > 0) {
            cards.unshift({
                id: 'recent_plays',
                name: t('home.recentPlays'),
                coverUrl: recentPlays[0]?.song.album?.coverUrl,
                trackCount: recentPlays.length,
                description: t('home.recentPlays'),
                summary: '',
                type: 'recent_plays',
                raw: { id: 'recent_plays', name: t('home.recentPlays'), type: 'recent_plays' } as unknown as ProviderCollection,
            });
        }
        return cards;
    }, [activeCollections, recentPlays, t]);

    const albumCards = useMemo(() => {
        return favoriteAlbums.map(a => ({
            id: a.id,
            name: a.name,
            coverUrl: a.coverUrl,
            trackCount: a.trackCount,
            description: getProviderCollectionArtistLabel(a) || t('player.unknownArtist'),
            summary: a.description || '',
            type: 'album' as const,
            raw: a
        }));
    }, [favoriteAlbums, t]);

    const radioCards = useMemo(() => {
        // 选中分类时广场数据源换成该分类下的歌单（同样的拍立得卡，只换内容）。
        // 卡片仍可点进歌单详情，走现有的 collection -> GridView 链路。
        if (categorySelected) {
            return categorySongLists.map(collection => ({
                id: String(collection.id),
                name: collection.name,
                coverUrl: collection.coverUrl ?? "",
                trackCount: collection.trackCount,
                // description 是卡片上排给用户的副标题，用它原生的描述；「这是从哪个分类筛出来的」
                // 放到 summary 行——那行本来就是标注来源的（跟发现页各段一个语义）。
                description: collection.description || collection.creator?.nickname || '',
                summary: categorySelected.itemLabel,
                type: "playlist" as const,
                raw: collection,
            }));
        }
        return radioItems.map(r => ({
            id: r.id,
            name: r.name,
            coverUrl: r.coverUrl,
            trackCount: r.trackCount,
            description: (r.isFm && personalFmModeLabel) || r.description || t('home.radio'),
            summary: r.summary || '',
            type: r.isFm
                ? 'radio' as const
                : r.isDailyRecommendations
                    ? 'daily_recommendations' as const
                    : 'playlist' as const,
            raw: r
        }));
    }, [personalFmModeLabel, radioItems, t, categorySelected, categorySongLists]);

    // 各段拍平成歌曲拍立得卡。三行文字「歌名 / 歌手 / 来源」与集合卡同构：
    // 卡面直接标注这首歌来自哪一段（猜你喜欢/相似/雷达/新歌），这就是频道分类信息。
    const discoverSongCards = useMemo(() => {
        const labelBySection: Record<string, string> = {
            'personal-fm': t('home.personalFm'),
            similar: t('home.discoverSimilar'),
            radar: t('home.discoverRadar'),
            'new-songs': t('home.discoverNewSongs'),
        };
        return discoverSections.flatMap(section => section.songs.map(song => ({
            // id 与跨段去重都在 buildDiscoverSections 里（含为什么必须带段 id 的说明）
            id: buildDiscoverSongCardId(section.id, song),
            name: song.name,
            coverUrl: getSongCoverUrl(song, activeProviderId) || '',
            description: song.artists?.map(a => a.name).join(', ') || '',
            summary: labelBySection[section.id] || '',
            type: 'song' as const,
            raw: {
                song,
                queue: [...section.songs],
                isFmCall: section.id === 'personal-fm',
            },
        })));
    }, [discoverSections, activeProviderId, t]);

    // 换一批走 surface 原生 actions 槽（与本地库「刷新文件夹」同款位置与写法）
    const discoverActions = useMemo<DesktopGrid3DAction[]>(() => [
        {
            id: 'refresh-discover',
            label: loadingDiscover ? t('options.scanning') : t('home.discoverRefresh'),
            icon: loadingDiscover ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />,
            disabled: loadingDiscover,
            onClick: () => {
                // 换一批是整批内容替换；不清旧位置的话，用户停在第 30张时看到的仍然是“第 30 张”——而新批的
                // 第 30 张与旧批的完全不同，就会觉得“后面的歌不变、前面的变了”。回到头部才符合预期。
                useHomeCardPositionStore.getState().forget(homeCardFocusScope);
                setDiscoverSections([]);
                setDiscoverError(null);
                // force：换一批必须绕开缓存去上游取新批次，否则会被旧缓存原样填回。
                void fetchDiscoverItems(true);
            },
            title: t('home.discoverRefresh'),
        },
    ], [loadingDiscover, t]);

    // 广场的「换一批」：偏移按批次推进；拉到 0 条说明上游翻到头，回卷到 0 再来一轮，
    // 绝不让广场被换成空白。与发现页的刷新按钮同用 surface 原生 actions 槽。
    const radioActions = useMemo<DesktopGrid3DAction[]>(() => [
        // 分类入口：只在该 provider 真的有分类时出现（空数组时不告诉用户“没这个功能”）。
        // label 显示当前选中项，回到全部时恢复“分类”。
        ...(categoryGroups.length > 0 ? [{
            id: 'category-filter',
            label: categorySelected ? categorySelected.itemLabel : t('home.categoryTitle'),
            icon: <ListFilter size={13} />,
            active: categoryPanelOpen || Boolean(categorySelected),
            onClick: () => setCategoryPanelOpen(open => !open),
            title: t('home.categoryTitle'),
        }] : []),
        {
            id: 'swap-radio-batch',
            label: loadingRadio ? t('options.scanning') : t('home.swapBatch'),
            icon: loadingRadio ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />,
            disabled: loadingRadio,
            onClick: () => {
                void (async () => {
                    // 同上：换一批后回到第一张，否则停在后半段时看起来就像“没换成”。
                    useHomeCardPositionStore.getState().forget(homeCardFocusScope);
                    const nextFrom = radioFrom + RADIO_PAGE_SIZE;
                    const count = await fetchRadioItems(nextFrom);
                    if (count === 0) {
                        await fetchRadioItems(0);
                        setRadioFrom(0);
                    } else {
                        setRadioFrom(nextFrom);
                    }
                })();
            },
            title: t('home.swapBatch'),
        },
    ], [loadingRadio, radioFrom, t]);

    // Active tab list items mapping
    const currentDesktopItems = useMemo(() => {
        if (homeViewTab === 'playlist') return playlistCards;
        if (homeViewTab === 'albums') return albumCards;
        if (homeViewTab === 'radio') return radioCards;
        if (homeViewTab === 'discover') return discoverSongCards;
        return [];
    }, [homeViewTab, playlistCards, albumCards, radioCards, discoverSongCards]);
    const currentOnlineTabUnavailableReason = homeViewTab === 'playlist'
        ? playlistUnavailableReason
        : (homeViewTab === 'albums'
            ? albumsUnavailableReason
            : (homeViewTab === 'discover' ? (discoverError || radioUnavailableReason) : radioUnavailableReason));

    // 专辑 tab 的空态要跟失败分开：都落到「暂无内容」的话，真实失败（请求被 abort/超时）
    // 看起来也像「你本来就没有收藏专辑」，用户既不知道发生了什么也无从重试。
    // 拉过一轮（albumsLoadedScopeRef 已置位）且确实一条都没有，才敢断定是空而不是失败。
    const albumsEmptyMessage = (canUseOnlineAlbums && activeUser && albumsLoadedScopeRef.current !== null && favoriteAlbums.length === 0)
        ? t('home.albumsEmpty')
        : (currentOnlineTabUnavailableReason || t('home.loadingLibrary'));

    // Delegate GridView opening to the app-level host so Grid3D remains only the home surface.
    // If Personal FM is clicked, it plays Personal FM directly instead of opening GridView.
    const handleSelectCollectionCard = async (card: any) => {
        // 歌曲卡：点卡即播，队列用所在段的那一批；猜你喜欢段带 isFmCall 进 FM 模式连续放。
        if (card.type === 'song' && card.raw?.song) {
            onPlaySong(card.raw.song, card.raw.queue, card.raw.isFmCall);
            return;
        }
        if (card.id === 'personal_fm' || card.raw?.id === 'personal_fm') {
            try {
                const fmSongs = await omni.getPersonalFm();
                if (fmSongs.length > 0) {
                    onPlaySong(fmSongs[0], fmSongs, true);
                }
            } catch (e) {
                console.error('[Grid3D] Failed to fetch and play Personal FM:', e);
            }
            return;
        }

        const collection = card.raw
            ? { ...card.raw, type: card.type }
            : card;
        onOpenGridView?.(createOnlineGridViewCollection(collection, activeProviderId));
    };
    // 背景色晕：取当前聚焦那张卡的封面主色。滑过去才取，不在列表级预取（见 hook 内注释）。


    const handleFolderImport = async () => {
        if (isLocalImporting || isLocalPlaylistImporting || isLocalRefreshing || scanProgress?.active) return;

        const availability = getLocalLibraryAvailability();
        if (!availability.supported) {
            alert(t(availability.reason === 'insecure-http'
                ? 'localMusic.insecureHttpDisabled'
                : 'localMusic.importNotSupported'));
            return;
        }

        setIsLocalImporting(true);
        try {
            const importedSongs = await importFolder();
            if (importedSongs.length > 0) {
                onRefreshLocalSongs();
            }
        } catch (error) {
            console.error('[Grid3D] Failed to import local folder:', error);
            alert(t('localMusic.importNotSupported'));
        } finally {
            setIsLocalImporting(false);
        }
    };

    const handleRefreshFolders = async () => {
        if (isLocalImporting || isLocalPlaylistImporting || isLocalRefreshing || scanProgress?.active) return;

        setIsLocalRefreshing(true);
        try {
            const importedSongs = await resyncAllFolders();
            if (importedSongs && importedSongs.length > 0) {
                onRefreshLocalSongs();
            }
        } catch (error) {
            console.error('[Grid3D] Failed to resync local folders:', error);
        } finally {
            setIsLocalRefreshing(false);
        }
    };

    const handlePlaylistFileImport = async (file: File) => {
        if (isLocalPlaylistImporting) return;

        setIsLocalPlaylistImporting(true);
        try {
            const result = await importLocalPlaylistFile(file, localSongs);
            if (!result.playlist) {
                onStatusMessage?.({ type: 'error', text: t('localMusic.playlistImportNoMatches') });
                return;
            }

            await onRefreshLocalSongs();
            const skippedCount = result.unmatchedPaths.length + result.ambiguousPaths.length;
            onStatusMessage?.({
                type: skippedCount > 0 ? 'info' : 'success',
                text: skippedCount > 0
                    ? t('localMusic.playlistImportPartial', {
                        name: result.playlist.name,
                        count: result.matchedSongIds.length,
                        skipped: skippedCount,
                    })
                    : t('localMusic.playlistImportSuccess', {
                        name: result.playlist.name,
                        count: result.matchedSongIds.length,
                    }),
            });
        } catch (error) {
            console.error('[Grid3D] Failed to import local playlist:', error);
            onStatusMessage?.({ type: 'error', text: t('localMusic.playlistImportFailed') });
        } finally {
            setIsLocalPlaylistImporting(false);
        }
    };

    // Search committed callback
    const handleSearch = async (e?: React.FormEvent, overrideQuery?: string) => {
        e?.preventDefault();
        const query = (overrideQuery ?? searchQuery).trim();
        if (!query) return;

        // 提交搜索就把联想收掉：不关的话用户回车/点搜索之后，那排联想词还挂在输入框下面，
        // 盖住搜索结果入口，还得手动再点一下才消失。
        setHeaderSuggestOpen(false);
        setHeaderSuggestionIndex(-1);

        const searchSource = isOnlineTab ? activeProviderId : resolveSearchSource(homeViewTab);
        const didSearch = await submitSearch({
            query,
            sourceTab: searchSource,
            deps: {
                localSongs,
                localLibraryCatalog,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            onSearchCommitted(query, searchSource);
        }
    };

    const isSearchingActive = isSearching;

    // 顶部搜索框的 smartbox 联想：只在在线 tab、有输入、且框聚焦时拉。
    // 点单曲直接播（provider 已把联想正规化成可播歌曲），点歌手填词走搜索——
    // 这是用户要的路径：打字即联想，常用查询根本不用进搜索页。
    const suggestDismissTimerRef = useRef<number | null>(null);
    const [headerSuggestions, setHeaderSuggestions] = useState<OnlineSearchSuggestion[]>([]);
    const [headerSuggestionIndex, setHeaderSuggestionIndex] = useState(-1);
    const [headerSuggestOpen, setHeaderSuggestOpen] = useState(false);
    useEffect(() => {
        if (!headerSuggestOpen || !isOnlineTab || searchQuery.trim().length === 0) {
            setHeaderSuggestions([]);
            setHeaderSuggestionIndex(-1);
            return;
        }
        const timer = window.setTimeout(() => {
            void omni.searchSmartboxSuggestions(activeProviderId, searchQuery.trim())
                .then(items => {
                    // 请求飞行期间用户可能已经提交或者失焦：那时倒进数组就没意义了，
                    // 下次再聚焦会重新拉。不校验开关的话，附带效应就是“搜完回来联想又弹出来”。
                    if (!headerSuggestOpen) return;
                    setHeaderSuggestions(items);
                    setHeaderSuggestionIndex(-1);
                })
                .catch(() => {
                    // 失败路径同样要过开关：.then 校验了 headerSuggestOpen，这里不校验的话，
                    // 提交搜索/失焦后回来的空数组会把面板状态清成一帧空面板。
                    if (headerSuggestOpen) setHeaderSuggestions([]);
                });
        }, 250);
        return () => window.clearTimeout(timer);
    }, [activeProviderId, headerSuggestOpen, isOnlineTab, searchQuery]);

    const pickHeaderSuggestion = (suggestion: OnlineSearchSuggestion) => {
        setHeaderSuggestOpen(false);
        setHeaderSuggestions([]);
        setHeaderSuggestionIndex(-1);
        if (suggestion.kind === 'song' && suggestion.song) {
            onPlaySong(suggestion.song);
            return;
        }
        setSearchQuery(suggestion.value);
        void handleSearch(undefined, suggestion.value);
    };

    // 卸载时丢掉还没跑的「关闭联想」定时器：组件走了之后再去 setState 是白跑，还带着告警。
    useEffect(() => () => {
        if (suggestDismissTimerRef.current) {
            window.clearTimeout(suggestDismissTimerRef.current);
        }
    }, []);

    // Background style mappings
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    const activeTabBg = isDaylight ? 'text-black font-bold' : 'text-black';

    const bottomPadding = currentTrack ? 'pb-28 md:pb-32' : '';

    const focusActiveSlider = () => {
        requestAnimationFrame(() => {
            gridRootRef.current
                ?.querySelector<HTMLElement>('[data-grid3d-slider]')
                ?.focus({ preventScroll: true });
        });
    };

    return (
        <div
            ref={gridRootRef}
            data-ponder-page-scope="grid-page"
            className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm ${bottomPadding}`}
        >


            {/* Main Header Container (Fades out when sliding/interacting) */}
            <div className="transition-opacity duration-300 ease-in-out z-20 opacity-100 select-none">
                <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto p-4 md:p-8 gap-y-4 md:gap-y-0">
                    {/* Left title and settings */}
                    <div className="flex items-center justify-start order-1 md:order-none">
                        <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                            Folia
                        </h1>
                        <button
                            onClick={() => onOpenSettings?.('help')}
                            className={`relative flex items-center gap-1.5 p-2 rounded-full hover:bg-white/10 transition-all ml-4 ${showUpdateIndicator
                                    ? 'opacity-90 hover:opacity-100'
                                    : 'opacity-40 hover:opacity-100'
                                }`}
                            title={t('ui.options')}
                        >
                            <Settings size={20} style={{ color: 'var(--text-primary)' }} />
                            {showUpdateIndicator && (
                                <span className="text-[10px] font-medium text-zinc-800 dark:text-zinc-200 opacity-80 whitespace-nowrap bg-zinc-200/50 dark:bg-white/10 px-2 py-0.5 rounded-md">
                                    {t('options.updateAvailable')}
                                </span>
                            )}
                        </button>
                        {scanProgress?.active && (
                            <div
                                className="relative ml-3"
                                onMouseEnter={() => setScanDetailsExpanded(true)}
                                onMouseLeave={() => setScanDetailsExpanded(false)}
                            >
                                <button
                                    onClick={() => setScanDetailsExpanded(prev => !prev)}
                                    className="relative rounded-full p-px transition-all"
                                    style={{
                                        background: `conic-gradient(from -90deg, ${isDaylight ? (theme?.accentColor || 'rgba(17,24,39,0.92)') : 'rgba(255,255,255,0.98)'} 0deg ${scanProgressPercent * 3.6}deg, ${isDaylight ? 'rgba(24,24,27,0.16)' : 'rgba(255,255,255,0.14)'} ${scanProgressPercent * 3.6}deg 360deg)`,
                                        borderRadius: '999px'
                                    }}
                                    title={t('options.scanProgress')}
                                >
                                    <div
                                        className={`relative flex items-center justify-center min-w-[56px] h-7 px-2.5 rounded-full backdrop-blur-md ${isDaylight ? 'bg-white/95 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-zinc-950/92 text-zinc-100'
                                            }`}
                                    >
                                        <span className="relative z-10 text-[10px] font-semibold tabular-nums leading-none">
                                            {scanProgressPercent}%
                                        </span>
                                    </div>
                                </button>
                                <AnimatePresence>
                                    {scanDetailsExpanded && (
                                        <motion.div
                                            initial={{ opacity: 0, y: -6 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            exit={{ opacity: 0, y: -6 }}
                                            className={`absolute left-0 top-full mt-2 w-72 p-4 rounded-2xl border backdrop-blur-xl shadow-xl ${isDaylight ? 'bg-white/85 border-black/10 text-zinc-800' : 'bg-black/60 border-white/10 text-zinc-100'
                                                }`}
                                        >
                                            <div className="text-sm font-semibold truncate">
                                                {t('options.scanningFolder', { folderName: scanProgress.folderName })}
                                            </div>
                                            <div className={`text-xs mt-1 ${isDaylight ? 'text-zinc-600' : 'text-zinc-300/70'}`}>
                                                {t('options.scanProgressDesc')}
                                            </div>
                                            <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                                <span>{t('ui.progress')}</span>
                                                <span>{Math.min(scanProgress.completedSongs, scanProgress.totalSongs)} / {scanProgress.totalSongs}</span>
                                            </div>
                                            <div className={`mt-2 w-full h-2 rounded-full overflow-hidden ${isDaylight ? 'bg-black/10' : 'bg-white/10'}`}>
                                                <div
                                                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                                                    style={{
                                                        width: `${scanProgress.totalSongs > 0 ? (scanProgress.completedSongs / scanProgress.totalSongs) * 100 : 0}%`,
                                                        backgroundColor: theme?.accentColor || 'var(--text-primary)'
                                                    }}
                                                />
                                            </div>
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        )}
                    </div>

                    {/* Center Tab Switcher */}
                    <div className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1">
                        <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-full scale-90 md:scale-100 origin-center`}>
                            <div className="inline-flex items-center gap-0">
                                {[
                                    ...(showHomeTabPlaylist ? [{ key: 'playlist', label: t('home.playlists'), disabledReason: playlistUnavailableReason }] : []),
                                    ...(showHomeTabRadio ? [{ key: 'radio', label: t('home.radio'), disabledReason: radioUnavailableReason }] : []),
                                    ...(showHomeTabDiscover ? [{ key: 'discover', label: t('home.discover'), disabledReason: radioUnavailableReason }] : []),
                                    ...(showHomeTabAlbums ? [{ key: 'albums', label: t('home.albums'), disabledReason: albumsUnavailableReason }] : []),
                                    ...(showHomeTabLocal ? [{
                                        key: 'local',
                                        label: t('localMusic.folder'),
                                        disabledReason: getLocalLibraryAvailability().supported
                                            ? undefined
                                            : t(getLocalLibraryAvailability().reason === 'insecure-http'
                                                ? 'localMusic.insecureHttpDisabled'
                                                : 'localMusic.importNotSupported'),
                                    }] : []),
                                    ...(navidromeEnabled ? [{ key: 'navidrome', label: t('navidrome.title') || 'Navidrome', disabledReason: undefined }] : []),
                                ].map((tab) => {
                                    const isActive = homeViewTab === tab.key;
                                    return (
                                        <span
                                            key={tab.key}
                                            title={tab.disabledReason || tab.label}
                                            className="inline-flex"
                                        >
                                            <button
                                                disabled={Boolean(tab.disabledReason)}
                                                aria-label={tab.disabledReason || tab.label}
                                                onClick={() => {
                                                    setHomeViewTab(tab.key as any);
                                                    // 分类筛选跨 tab 保留：用户切到别的 tab 干完事回来，看到的还是
                                                    // 自己筛的那一批。曾经切走就重置，用户反馈「点发现再回来就变回
                                                    // 默认的了」——筛出来的结果不该因为路过别的 tab 就丢。
                                                    // 「会不会不知道自己在看筛过的内容」不会：工具栏那颗分类按钮的
                                                    // 文字就是当前分类名（categorySelected.itemLabel）并处于点亮态。
                                                    setCategoryPanelOpen(false);
                                                    focusActiveSlider();
                                                }}
                                                className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-35 ${isActive ? activeTabBg : navPillInactiveText}`}
                                            >
                                                {isActive && (
                                                    <motion.span
                                                        layoutId="home-active-tab-pill-desktop"
                                                        className="absolute inset-0 rounded-full bg-white shadow-sm"
                                                        transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.9 }}
                                                    />
                                                )}
                                                <span className="relative z-10">{tab.label}</span>
                                            </button>
                                        </span>
                                    );
                                })}
                                {stageEnabled && (
                                    <button
                                        onClick={() => onOpenStagePlayer?.()}
                                        data-stage-active={stageIsActive ? 'true' : 'false'}
                                        className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                    >
                                        <span className="relative z-10">{t('home.stage')}</span>
                                    </button>
                                )}
                                {/* 播放队列的海报视图和 Stage 一样属于「去哪儿」，所以它在这一排，
                                    而不是标题旁的工具图标。没有在播歌曲时队列也是空的，直接不出现。
                                    平时只占一个图标的宽度，指针悬停或键盘聚焦时才展开文字——这一排
                                    已经有五个内容 tab，多一个常驻文字就把胶囊撑得太长。点击始终直达。 */}
                                {onOpenLattice && currentTrack && (
                                    <button
                                        onClick={onOpenLattice}
                                        data-testid="home-lattice-pill"
                                        title={t('home.lattice')}
                                        aria-label={t('home.lattice')}
                                        className={`group relative inline-flex items-center justify-center px-3 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                    >
                                        <PanelsTopLeft size={14} className="relative z-10 shrink-0" />
                                        <span
                                            aria-hidden="true"
                                            className="relative z-10 max-w-0 overflow-hidden opacity-0 transition-all duration-300 ease-out group-hover:ml-1.5 group-hover:max-w-28 group-hover:opacity-100 group-focus-visible:ml-1.5 group-focus-visible:max-w-28 group-focus-visible:opacity-100"
                                        >
                                            {t('home.latticeLabel')}
                                        </span>
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Right Search Bar */}
                    <div className="flex justify-end order-2 md:order-none">
                        <form onSubmit={handleSearch} className="relative w-full md:w-56 transition-all focus-within:md:w-72">
                            {isSearchingActive ? (
                                <Loader2 className="absolute left-3 top-1/2 w-4 h-4 animate-spin opacity-40 -mt-2" />
                            ) : (
                                <Search
                                    className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                                    onClick={() => handleSearch()}
                                />
                            )}
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder={homeViewTab === 'local' ? t('home.searchLocal') : homeViewTab === 'navidrome' ? t('home.searchNavidrome') : t('home.searchDatabase')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (headerSuggestions.length === 0) return;
                                    if (e.key === 'ArrowDown') {
                                        e.preventDefault();
                                        setHeaderSuggestionIndex(prev => (prev + 1) % headerSuggestions.length);
                                        return;
                                    }
                                    if (e.key === 'ArrowUp') {
                                        e.preventDefault();
                                        setHeaderSuggestionIndex(prev => (prev <= 0 ? headerSuggestions.length - 1 : prev - 1));
                                        return;
                                    }
                                    if (e.key === 'Enter' && headerSuggestionIndex >= 0) {
                                        e.preventDefault();
                                        pickHeaderSuggestion(headerSuggestions[headerSuggestionIndex]);
                                    }
                                }}
                                onFocus={() => setHeaderSuggestOpen(true)}
                                onBlur={() => {
                                    // 延迟一点关：鼠标按下列表项时浏览器会先 blur，立刻关就点不到了。
                                    // 句柄存 ref 里，卸载时清掉，别让定时器在组件走了以后还去 setState。
                                    if (suggestDismissTimerRef.current) {
                                        window.clearTimeout(suggestDismissTimerRef.current);
                                    }
                                    suggestDismissTimerRef.current = window.setTimeout(
                                        () => setHeaderSuggestOpen(false),
                                        120,
                                    );
                                }}
                                className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40 select-text`}
                                style={{ color: 'var(--text-primary)' }}
                            />

                            {/* 必须参与 headerSuggestOpen 判断：只看数组非空的话，提交搜索时把开关关了也缓不掉那个 250ms 防抖里还在飞的请求——它回来一填数组，面板又弹出来了，必须点别处才消失。 */}
                            {headerSuggestOpen && isOnlineTab && headerSuggestions.length > 0 && (
                                <div
                                    className={`absolute left-0 right-0 top-full z-50 mt-2 rounded-2xl border p-2 ${
                                        isDaylight ? 'border-black/10 bg-white shadow-lg' : 'border-white/10 bg-[#141418] shadow-xl'
                                    }`}
                                >
                                    <div className="flex flex-col">
                                        {headerSuggestions.map((suggestion, index) => (
                                            <button
                                                key={`${suggestion.kind}:${suggestion.value}:${index}`}
                                                type="button"
                                                onMouseDown={event => event.preventDefault()}
                                                onMouseEnter={() => setHeaderSuggestionIndex(index)}
                                                onClick={() => pickHeaderSuggestion(suggestion)}
                                                className={`flex items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                                                    index === headerSuggestionIndex ? (isDaylight ? 'bg-black/10' : 'bg-white/10') : (isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/5')
                                                }`}
                                            >
                                                {suggestion.kind === 'singer'
                                                    ? <User size={15} className="shrink-0 opacity-55" />
                                                    : <Music size={15} className="shrink-0 opacity-55" />}
                                                <span className="truncate">{suggestion.value}</span>
                                                {suggestion.detail && (
                                                    <span className="truncate text-xs opacity-50">{suggestion.detail}</span>
                                                )}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </form>
                    </div>
                </div>
            </div>

            {/* Desktop Canvas Surface */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative">
                {isOnlineTab && activeAccountView === 'accountless' ? (
                    <OnlineProviderAccountlessPanel
                        providerLabel={activeProviderLabel}
                        isDaylight={isDaylight}
                        onSearch={() => searchInputRef.current?.focus()}
                    />
                ) : isOnlineTab && activeAccountView === 'resolving' ? (
                    <div className="flex flex-1 w-full items-center justify-center" aria-busy="true">
                        <Loader2 className="animate-spin opacity-30" size={28} />
                    </div>
                ) : isOnlineTab && activeAccountView === 'guest' ? (
                    <OnlineProviderConnectPanel
                        providers={onlineProviderPlatform?.providers || omni.getProviderSummaries()}
                        isDaylight={isDaylight}
                        title={activeProviderNeedsRelogin ? t('status.loginExpired') : t('home.guestTitle')}
                        prompt={activeProviderNeedsRelogin
                            ? t('home.guestPromptProvider', {
                                provider: activeProviderSummary?.shortName || activeProviderSummary?.displayName || activeProviderId,
                            })
                            : t('home.guestPrompt')}
                        getActionLabel={provider => canSwitchToProviderDirectly(provider)
                            ? t('home.switchToProvider', { provider: provider.shortName || provider.displayName })
                            : t('home.connectProviderAccount', { provider: provider.shortName || provider.displayName })}
                        onSelect={selectProvider}
                    />
                ) : isOnlineTab ? (
                    <DesktopGrid3DSurface
                        focusMemoryScope={JSON.stringify(['online', activeProviderId, activeUser?.id ?? null, homeViewTab])}
                        title={
                            homeViewTab === 'playlist'
                                ? t('home.playlists')
                                : homeViewTab === 'albums'
                                    ? t('home.albums')
                                    : homeViewTab === 'discover'
                                        ? t('home.discover')
                                        : t('home.radio')
                        }
                        mapButtonLabel={homeViewTab === 'discover' ? t('home.allSongs') : t('home.allAlbums')}
                        items={currentDesktopItems}
                        focusedIndex={focusedIndex}
                        onFocusedIndexChange={setFocusedIndex}
                        onSelect={handleSelectCollectionCard}
                        actions={homeViewTab === 'discover' ? discoverActions : homeViewTab === 'radio' ? radioActions : undefined}
                        actionOverlay={
                            homeViewTab === 'radio' && categoryPanelOpen && categoryGroups.length > 0 ? (
                                <CategoryFilterPanel
                                    groups={categoryGroups}
                                    isDaylight={isDaylight}
                                    sizeScale={panelSizeScale}
                                    selected={categorySelected}
                                    onSelect={(selection) => {
                                        setCategorySelected(selection);
                            // 换一批同样道理：整批替换后回到头部，否则停在后半段会让人认不出已经换了内容。
                            useHomeCardPositionStore.getState().forget(homeCardFocusScope);
                                    }}
                                    onClose={() => setCategoryPanelOpen(false)}
                                />
                            ) : null
                        }
                        isLoading={isLoading}
                        emptyMessage={homeViewTab === 'albums'
                            ? albumsEmptyMessage
                            : (currentOnlineTabUnavailableReason || t('home.loadingLibrary'))}
                        theme={theme}
                        isDaylight={isDaylight}
                        isInteractive={isInteractive}
                        hasFloatingPlayer={Boolean(currentTrack)}
                        playlistVisibilityScope={`online:${activeProviderId}`}
                    />
                ) : homeViewTab === 'local' ? (
                    <div className="w-full h-full flex-1">
                        <LocalGrid3DView
                            localSongs={localSongs}
                            localPlaylists={localPlaylists}
                            activeRow={localMusicState.activeRow}
                            setActiveRow={(row) => setLocalMusicState(prev => ({ ...prev, activeRow: row }))}
                            focusedFolderIndex={localMusicState.focusedFolderIndex}
                            setFocusedFolderIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedFolderIndex: index }))}
                            focusedAlbumIndex={localMusicState.focusedAlbumIndex}
                            setFocusedAlbumIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedAlbumIndex: index }))}
                            focusedArtistIndex={localMusicState.focusedArtistIndex}
                            setFocusedArtistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedArtistIndex: index }))}
                            focusedPlaylistIndex={localMusicState.focusedPlaylistIndex}
                            setFocusedPlaylistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedPlaylistIndex: index }))}
                            onImportFolder={handleFolderImport}
                            onImportPlaylistFile={handlePlaylistFileImport}
                            onRefreshFolders={handleRefreshFolders}
                            importButtonDisabled={isLocalImporting || isLocalPlaylistImporting || isLocalRefreshing || Boolean(scanProgress?.active)}
                            isImporting={isLocalImporting}
                            isRefreshing={isLocalRefreshing}
                            isScanInProgress={Boolean(scanProgress?.active)}
                            isImportingPlaylist={isLocalPlaylistImporting}
                            theme={theme}
                            isDaylight={isDaylight}
                            isInteractive={isInteractive}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onOpenGridView={onOpenGridView}
                            onPlayAll={onPlayAll}
                            onAddAllToQueue={onAddAllToQueue}
                            onRefreshLocalSongs={onRefreshLocalSongs}
                        />
                    </div>
                ) : (
                    <div className="w-full h-full flex-1">
                        <NavidromeGrid3DView
                            theme={theme}
                            isDaylight={isDaylight}
                            isInteractive={isInteractive}
                            focusedAlbumIndex={navidromeFocusedAlbumIndex}
                            setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex ?? (() => { })}
                            externalSelection={pendingNavidromeSelection}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onExternalSelectionHandled={onPendingNavidromeSelectionHandled}
                            onOpenSettings={() => onOpenSettings?.('help')}
                            onOpenGridView={onOpenGridView}
                        />
                    </div>
                )}
            </div>

            {/* Login Modal */}
            <AnimatePresence>
                {showLoginModal && (
                    <OnlineProviderLoginModal
                        title={t((LOGIN_COPY_BY_PROVIDER[loginProviderId] || NETEASE_LOGIN_COPY).title)}
                        note={t((LOGIN_COPY_BY_PROVIDER[loginProviderId] || NETEASE_LOGIN_COPY).note)}
                        qrCodeImg={qrCodeImg}
                        statusText={qrStatusText}
                        state={qrState}
                        retryLabel={t('home.retryQr')}
                        closeLabel={t('home.closeLogin')}
                        loginMethods={loginMethodOptions.length > 0
                            ? {
                                title: t('home.qqLoginMethodTitle'),
                                hint: t('home.qqLoginMethodHint'),
                                pendingText: t('home.qqLoginMethodPending'),
                                currentText: selectedLoginMethodId
                                    ? t('home.qqLoginMethodCurrent', {
                                        method: t(loginMethodOptions.find(option => option.id === selectedLoginMethodId)?.labelKey || ''),
                                    })
                                    : '',
                                options: loginMethodOptions.map(option => ({
                                    id: option.id,
                                    label: t(option.labelKey),
                                    iconUrl: LOGIN_METHOD_ICONS[option.iconKey] || '',
                                })),
                                selectedId: selectedLoginMethodId,
                                onSelect: selectLoginMethod,
                            }
                            : undefined}
                        backendFailure={neteaseBackendFailed
                            ? {
                                title: t('home.loginBackendDown'),
                                detail: neteaseApiStatus?.error ?? null,
                                restartLabel: t('home.restartBackend'),
                                restartingLabel: t('home.restartingBackend'),
                                restarting: neteaseApiRestarting,
                                onRestart: () => void handleRestartNeteaseApi(),
                            }
                            : undefined}
                        diagnostics={qrLoginFailure
                            ? buildQrLoginDiagnosticsProps({
                                t,
                                providerId: loginProviderId,
                                failure: qrLoginFailure,
                                buildReport: buildQrDiagnosticReport,
                            })
                            : undefined}
                        // 刷新时保留已选的登录方式，否则用户会被踢回步骤一。
                        onRetry={() => void startQrLogin(loginProviderId, selectedLoginMethodId ?? undefined)}
                        onClose={() => {
                            setShowLoginModal(false);
                            stopQrLogin();
                        }}
                    />
                )}
            </AnimatePresence>

            {onlineProviderPlatform && (
                <OnlineProviderSwitcher
                    providers={onlineProviderPlatform.providers}
                    activeProviderId={activeProviderId}
                    isDaylight={isDaylight}
                    onBackToPlayer={onBackToPlayer}
                    onSelect={selectProvider}
                    onLogout={provider => {
                        void onlineProviderPlatform.logoutProvider(provider.providerId);
                    }}
                />
            )}

            {/* 分类筛选面板：挂在根容器（relative）上、马在 actions 行右侧下方。
                只在电台 tab 开着时存在，关闭即卸载（不给全局留事件）。 */}

        </div>
    );
};

export default Grid3D;
