import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Loader2, ChevronRight, Settings , ChevronDown } from 'lucide-react';
import { neteaseApi } from '../services/netease';
import { HomeViewTab, NeteaseUser, NeteasePlaylist, SongResult, LocalSong, Theme, LocalLibraryGroup, LocalPlaylist, DualTheme, ThemeMode, type CadenzaTuning, type FumeTuning, type LyricData, type PartitaTuning, type VisualizerMode, type StageStatus, type StageSource, type NowPlayingConnectionStatus } from '../types';
import { NavidromeSong, NavidromeViewSelection } from '../types/navidrome';
import { isNavidromeEnabled } from '../services/navidromeService';
import { LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../services/localMusicService';
import LocalMusicView from './LocalMusicView';
import NavidromeMusicView from './navidrome/NavidromeMusicView';
import HelpModal from './modal/HelpModal';
import { motion, AnimatePresence } from 'framer-motion';
import Carousel3D from './Carousel3D';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useShallow } from 'zustand/react/shallow';

interface HomeProps {
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: NeteaseUser | null;
    playlists: NeteasePlaylist[];
    cloudPlaylist?: NeteasePlaylist | null;
    currentTrack?: SongResult | null;
    isPlaying: boolean;
    onSelectPlaylist: (playlist: NeteasePlaylist) => void;
    onSelectAlbum: (albumId: number) => void;
    onSelectArtist: (artistId: number) => void;
    onSelectLocalAlbum?: (albumName: string) => void;
    onSelectLocalArtist?: (artistName: string) => void;
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => void;
    onPlayLocalSong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddLocalSongToQueue?: (song: LocalSong) => void;
    focusedPlaylistIndex?: number;
    setFocusedPlaylistIndex?: (index: number) => void;
    focusedFavoriteAlbumIndex?: number;
    setFocusedFavoriteAlbumIndex?: (index: number) => void;
    focusedRadioIndex?: number;
    setFocusedRadioIndex?: (index: number) => void;
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
    onMatchSong?: (song: LocalSong) => void;
    onPlayNavidromeSong?: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
    onAddNavidromeSongsToQueue?: (songs: NavidromeSong[]) => void;
    onMatchNavidromeSong?: (song: NavidromeSong) => void;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    pendingNavidromeSelection?: NavidromeViewSelection | null;
    onPendingNavidromeSelectionHandled?: () => void;
    staticMode?: boolean;
    onToggleStaticMode?: (enable: boolean) => void;
    enableMediaCache?: boolean;
    onToggleMediaCache?: (enable: boolean) => void;
    theme: Theme;
    backgroundOpacity: number;
    setBackgroundOpacity: (opacity: number) => void;
    bgMode: ThemeMode;
    onApplyDefaultTheme: () => void;
    hasCustomTheme: boolean;
    themeParkInitialTheme: DualTheme;
    isCustomThemePreferred: boolean;
    onSaveCustomTheme: (dualTheme: DualTheme) => void;
    onApplyCustomTheme: () => void;
    onToggleCustomThemePreferred: (enabled: boolean) => void;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    cadenzaTuning: CadenzaTuning;
    partitaTuning: PartitaTuning;
    fumeTuning: FumeTuning;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    onPartitaTuningChange: (patch: Partial<PartitaTuning>) => void;
    onResetPartitaTuning: () => void;
    onFumeTuningChange: (patch: Partial<FumeTuning>) => void;
    onResetFumeTuning: () => void;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFontFamily: string | null;
    lyricsCustomFontLabel: string | null;
    lyricFilterPattern: string;
    currentSongTitle?: string | null;
    showOpenPanelCloseButton: boolean;
    onLyricsFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onLyricsFontScaleChange: (fontScale: number) => void;
    onLyricsCustomFontChange: (font: { family: string; label?: string | null; } | null) => void;
    loadLyricFilterPreview: () => Promise<LyricData | null>;
    onSaveLyricFilterPattern: (pattern: string) => Promise<void> | void;
    onToggleOpenPanelCloseButton: (enable: boolean) => void;
    onSearchCommitted: (query: string, sourceTab: HomeViewTab, replace?: boolean) => void;
    stageEnabled?: boolean;
    stageSource?: StageSource | null;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
    stageStatus?: StageStatus | null;
    onToggleStageMode?: (enabled: boolean) => Promise<void> | void;
    onStageSourceChange?: (source: StageSource) => Promise<void> | void;
    onRegenerateStageToken?: () => Promise<void> | void;
    onClearStageState?: () => Promise<void> | void;
    enableNowPlayingStage?: boolean;
    onToggleNowPlayingStage?: (enabled: boolean) => Promise<void> | void;
    nowPlayingConnectionStatus?: NowPlayingConnectionStatus;
    pendingOpenSettings?: boolean;
    onPendingOpenSettingsHandled?: () => void;
}

const Home: React.FC<HomeProps> = ({
    onPlaySong,
    onBackToPlayer,
    onRefreshUser,
    user,
    playlists,
    cloudPlaylist = null,
    currentTrack,
    isPlaying,
    onSelectPlaylist,
    onSelectAlbum,
    onSelectArtist,
    onSelectLocalAlbum,
    onSelectLocalArtist,
    localSongs,
    localPlaylists,
    onRefreshLocalSongs,
    onPlayLocalSong,
    onAddLocalSongToQueue,
    focusedPlaylistIndex = 0,
    setFocusedPlaylistIndex,
    focusedFavoriteAlbumIndex = 0,
    setFocusedFavoriteAlbumIndex,
    focusedRadioIndex = 0,
    setFocusedRadioIndex,
    localMusicState,
    setLocalMusicState,
    onMatchSong,
    onPlayNavidromeSong,
    onAddNavidromeSongsToQueue,
    onMatchNavidromeSong,
    navidromeFocusedAlbumIndex = 0,
    setNavidromeFocusedAlbumIndex,
    pendingNavidromeSelection = null,
    onPendingNavidromeSelectionHandled,
    staticMode = false,
    onToggleStaticMode,
    enableMediaCache = false,
    onToggleMediaCache,
    theme,
    backgroundOpacity,
    setBackgroundOpacity,
    bgMode,
    onApplyDefaultTheme,
    hasCustomTheme,
    themeParkInitialTheme,
    isCustomThemePreferred,
    onSaveCustomTheme,
    onApplyCustomTheme,
    onToggleCustomThemePreferred,
    isDaylight,
    visualizerMode,
    cadenzaTuning,
    partitaTuning,
    fumeTuning,
    onVisualizerModeChange,
    onPartitaTuningChange,
    onResetPartitaTuning,
    onFumeTuningChange,
    onResetFumeTuning,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsCustomFontFamily,
    lyricsCustomFontLabel,
    lyricFilterPattern,
    currentSongTitle,
    showOpenPanelCloseButton,
    onLyricsFontStyleChange,
    onLyricsFontScaleChange,
    onLyricsCustomFontChange,
    loadLyricFilterPreview,
    onSaveLyricFilterPattern,
    onToggleOpenPanelCloseButton,
    onSearchCommitted,
    stageEnabled = false,
    stageSource = null,
    stageIsActive = false,
    onOpenStagePlayer,
    stageStatus = null,
    onToggleStageMode,
    onStageSourceChange,
    onRegenerateStageToken,
    onClearStageState,
    enableNowPlayingStage = false,
    onToggleNowPlayingStage,
    nowPlayingConnectionStatus = 'disabled',
    pendingOpenSettings = false,
    onPendingOpenSettingsHandled,
}) => {
    const { t } = useTranslation();
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
    const viewTab = homeViewTab;
    const hasNeteaseLogin = Boolean(user);
    const isNeteaseTab = viewTab === 'playlist' || viewTab === 'albums' || viewTab === 'radio';
    const homeContentBottomPadding = currentTrack ? 'pb-28 md:pb-32' : '';
    const playlistCards = cloudPlaylist
        ? (playlists.length > 0
            ? [playlists[0], cloudPlaylist, ...playlists.slice(1)]
            : [cloudPlaylist])
        : playlists;
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated, passed as prop

    // Style Variants
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    const cardBg = isDaylight ? 'bg-white/40' : 'bg-white/5';
    const activeTabBg = isDaylight ? 'text-black font-bold' : 'text-black'; // When tab active (white bg), text is black
    // For pill nav container
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    // UI State
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
    const helpModalInitialTabRef = useRef<'help' | 'options'>('help');

    // 当从播放器视图导航回来时，自动打开设置弹窗并跳到选项页
    useEffect(() => {
        if (pendingOpenSettings) {
            helpModalInitialTabRef.current = 'options';
            setShowHelpModal(true);
            onPendingOpenSettingsHandled?.();
        }
    }, [pendingOpenSettings]);

    const [updateStatus, setUpdateStatus] = useState<ElectronUpdateStatus | null>(null);
    const [navidromeEnabled, setNavidromeEnabled] = useState(isNavidromeEnabled());
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
    const homeTabs: Array<{ key: HomeViewTab; label: string; }> = [
        { key: 'playlist', label: t('home.playlists') },
        { key: 'radio', label: t('home.radio') || '电台' },
        { key: 'albums', label: t('home.albums') || '专辑' },
        { key: 'local', label: t('localMusic.folder') },
        ...(navidromeEnabled ? [{ key: 'navidrome' as HomeViewTab, label: t('navidrome.title') || 'Navidrome' }] : []),
    ];

    const handleToggleNavidrome = (enabled: boolean) => {
        setNavidromeEnabled(enabled);
        if (!enabled && viewTab === 'navidrome') {
            setHomeViewTab('local');
        }
    };

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

    const [searchNavidromeSelection, setSearchNavidromeSelection] = useState<NavidromeViewSelection | null>(null);

    // Login QR
    const [qrCodeImg, setQrCodeImg] = useState<string>("");
    const [qrStatus, setQrStatus] = useState<string>("");
    const qrCheckInterval = useRef<any>(null);
    const [isLocalPlaylistOpen, setIsLocalPlaylistOpen] = useState(false);

    // Favorite Albums
    const [favoriteAlbums, setFavoriteAlbums] = useState<any[]>([]);
    const [loadingAlbums, setLoadingAlbums] = useState(false);
    const [albumsLoaded, setAlbumsLoaded] = useState(false);
    // Swipe handling
    // const touchStartY = useRef(0);
    // const touchEndY = useRef(0);

    // const onTouchStart = (e: React.TouchEvent) => {
    //     touchStartY.current = e.targetTouches[0].clientY;
    // };

    // const onTouchEnd = (e: React.TouchEvent) => {
    //     touchEndY.current = e.changedTouches[0].clientY;
    //     const diff = touchStartY.current - touchEndY.current;

    //     // Threshold of 50px
    //     if (Math.abs(diff) > 50) {
    //         // Swipe Up (diff > 0) -> Go to Albums (if in Playlist)
    //         if (diff > 0 && viewTab === 'playlist') {
    //             setViewTab('albums');
    //         }
    //         // Swipe Down (diff < 0) -> Go to Playlist (if in Albums)
    //         else if (diff < 0 && viewTab === 'albums') {
    //             setViewTab('playlist');
    //         }
    //     }
    // };

    // Load favorite albums when tab is active
    useEffect(() => {
        if (viewTab === 'albums' && !albumsLoaded && user) {
            fetchFavoriteAlbums();
        }
    }, [viewTab, user, albumsLoaded]);

    const fetchFavoriteAlbums = async () => {
        setLoadingAlbums(true);
        try {
            let allAlbums: any[] = [];
            let offset = 0;
            const limit = 50;
            let hasMore = true;

            while (hasMore) {
                const res = await neteaseApi.getFavoriteAlbums(limit, offset);
                if (res.data) {
                    allAlbums = [...allAlbums, ...res.data];
                }

                // Use hasMore directly as requested
                hasMore = res.hasMore;
                offset += limit;
            }

            if (allAlbums.length > 0) {
                setFavoriteAlbums(allAlbums);
            }
            setAlbumsLoaded(true);
        } catch (e) {
            console.error("Failed to fetch favorite albums", e);
        } finally {
            setLoadingAlbums(false);
        }
    };

    // Radio State
    const [radioItems, setRadioItems] = useState<any[]>([]);
    const [loadingRadio, setLoadingRadio] = useState(false);
    const [radioLoaded, setRadioLoaded] = useState(false);

    useEffect(() => {
        if (viewTab === 'radio' && !radioLoaded && user) {
            fetchRadioData();
        }
    }, [viewTab, user, radioLoaded]);

    const fetchRadioData = async () => {
        setLoadingRadio(true);
        try {
            const fmRes = await neteaseApi.getPersonalFm();
            let fmCoverUrl = '';
            if (fmRes.data && fmRes.data.length > 0) {
                fmCoverUrl = fmRes.data[0].album?.picUrl || fmRes.data[0].al?.picUrl || '';
            }

            const fmItem = {
                id: 'personal_fm',
                name: '私人FM',
                coverUrl: fmCoverUrl,
                description: 'Personal FM',
                isFm: true,
            };

            const recRes = await neteaseApi.getDailyRecommendPlaylists();
            let recItems: any[] = [];
            if (recRes.recommend) {
                recItems = recRes.recommend.slice(0, 30).map((r: any) => ({
                    id: r.id,
                    name: r.name,
                    coverUrl: r.picUrl,
                    trackCount: r.trackCount,
                    description: r.creator?.nickname || '每日推荐'
                }));
            }
            
            setRadioItems([fmItem, ...recItems]);
            setRadioLoaded(true);
        } catch (e) {
            console.error("Failed to fetch radio data", e);
        } finally {
            setLoadingRadio(false);
        }
    };

    const initLogin = async () => {
        setShowLoginModal(true);
        setQrStatus(t('home.loadingQr'));
        try {
            const keyRes = await neteaseApi.getQrKey();
            const key = keyRes.data.unikey;

            const createRes = await neteaseApi.createQr(key);
            setQrCodeImg(createRes.data.qrimg);
            setQrStatus(t('home.scanQr'));

            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
            qrCheckInterval.current = setInterval(async () => {
                try {
                    const checkRes = await neteaseApi.checkQr(key);
                    const code = checkRes.code;

                    if (code === 800) {
                        setQrStatus(t('home.qrExpired'));
                        clearInterval(qrCheckInterval.current);
                    } else if (code === 801) {
                        // Waiting
                    } else if (code === 802) {
                        setQrStatus(t('home.qrScanned'));
                    } else if (code === 803) {
                        setQrStatus(t('home.loginSuccess'));
                        clearInterval(qrCheckInterval.current);
                        if (checkRes.cookie) {
                            localStorage.setItem('netease_cookie', checkRes.cookie);
                        }
                        // Trigger parent refresh
                        setTimeout(async () => {
                            onRefreshUser();
                            setShowLoginModal(false);
                        }, 1000);
                    }
                } catch (e) {
                    console.error(e);
                }
            }, 3000);

        } catch (e) {
            setQrStatus(t('home.loginError'));
        }
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const query = searchQuery.trim();
        if (!query) return;

        const didSearch = await submitSearch({
            query,
            sourceTab: viewTab,
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            onSearchCommitted(query, viewTab);
        }
    };

    useEffect(() => {
        return () => {
            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
        };
    }, []);

    useEffect(() => {
        const handleScanProgress = (event: Event) => {
            const customEvent = event as CustomEvent<{
                active: boolean;
                folderName: string;
                totalSongs: number;
                completedSongs: number;
            }>;
            setScanProgress(customEvent.detail);
            if (!customEvent.detail.active) {
                setScanDetailsExpanded(false);
            }
        };

        window.addEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
        return () => window.removeEventListener(LOCAL_MUSIC_SCAN_PROGRESS_EVENT, handleScanProgress as EventListener);
    }, []);

    return (
        <AnimatePresence>
            <motion.div
                key="home-main"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm overflow-y-auto custom-scrollbar`}
                style={{ color: 'var(--text-primary)' }}
            >
                {/* Header Section */}
                {!isLocalPlaylistOpen && (
                    <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto z-20 relative p-4 md:p-8 gap-y-4 md:gap-y-0">
                            {/* Left: Title & Help */}
                            <div className="flex items-center justify-start order-1 md:order-none">
                                <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                                    Folia
                                </h1>
                                <button
                                    onClick={() => { helpModalInitialTabRef.current = 'help'; setShowHelpModal(true); }}
                                    className="relative p-2 rounded-full hover:bg-white/10 opacity-40 hover:opacity-100 transition-all ml-4"
                                    title="Help & About"
                                >
                                    <Settings size={20} style={{ color: 'var(--text-primary)' }} />
                                    {showUpdateIndicator && (
                                        <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-red-400 ring-2 ring-black/20" />
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
                                            title="查看扫描进度"
                                        >
                                            <div
                                                className={`relative flex items-center justify-center min-w-[56px] h-7 px-2.5 rounded-full backdrop-blur-md ${
                                                    isDaylight ? 'bg-white/95 text-zinc-900 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]' : 'bg-zinc-950/92 text-zinc-100'
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
                                                    className={`absolute left-0 top-full mt-2 w-72 p-4 rounded-2xl border backdrop-blur-xl shadow-xl ${
                                                        isDaylight ? 'bg-white/85 border-black/10 text-zinc-800' : 'bg-black/60 border-white/10 text-zinc-100'
                                                    }`}
                                                >
                                                    <div className="text-sm font-semibold truncate">
                                                        正在扫描 {scanProgress.folderName}
                                                    </div>
                                                    <div className={`text-xs mt-1 ${isDaylight ? 'text-zinc-600' : 'text-zinc-300/70'}`}>
                                                        正在后台提取元数据与封面，媒体库较大时会持续一段时间。
                                                    </div>
                                                    <div className="mt-3 flex items-center justify-between text-xs font-mono">
                                                        <span>进度</span>
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

                            {/* Center: Tab Switcher */}
                            <div className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1">
                                <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-full scale-90 md:scale-100 origin-center`}>
                                    <div className="inline-flex items-center gap-0">
                                        {homeTabs.map((tab) => {
                                            const isActive = viewTab === tab.key;

                                            return (
                                                <button
                                                    key={tab.key}
                                                    onClick={() => setHomeViewTab(tab.key)}
                                                    className={`relative inline-flex items-center justify-center px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${isActive ? activeTabBg : navPillInactiveText}`}
                                                >
                                                    {isActive && (
                                                        <motion.span
                                                            layoutId="home-active-tab-pill"
                                                            className="absolute inset-0 rounded-full bg-white shadow-sm"
                                                            transition={{ type: 'spring', stiffness: 460, damping: 36, mass: 0.9 }}
                                                        />
                                                    )}
                                                    <span className="relative z-10">{tab.label}</span>
                                                </button>
                                            );
                                        })}
                                        {stageEnabled && (
                                            <button
                                                onClick={() => onOpenStagePlayer?.()}
                                                data-stage-active={stageIsActive ? 'true' : 'false'}
                                                className={`relative inline-flex items-center justify-center px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${navPillInactiveText}`}
                                            >
                                                <span className="relative z-10">{t('home.stage') || '舞台'}</span>
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Search Bar */}
                            <div className="flex justify-end order-2 md:order-none">
                                <form onSubmit={handleSearch} className="relative group w-full md:w-56 lg:w-60 transition-all focus-within:w-full md:focus-within:w-72 lg:focus-within:w-80">
                                    {isSearching ? (
                                        <Loader2
                                            className="absolute left-3 top-1/2 w-4 h-4 animate-spin opacity-40"
                                            style={{ marginTop: '-8px' }}
                                        />
                                    ) : (
                                        <Search
                                            className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4 cursor-pointer hover:opacity-100 transition-opacity"
                                            onClick={() => handleSearch()}
                                        />
                                    )}
                                    <input
                                        type="text"
                                        placeholder={viewTab === 'local' ? t('home.searchLocal') : viewTab === 'navidrome' ? t('home.searchNavidrome') : t('home.searchDatabase')}
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}

                                        className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40`}
                                        style={{ color: 'var(--text-primary)' }}
                                    />
                                </form>
                            </div>
                        </div>
                )}

                {/* Main Content Area */}
                <div className={`flex-1 min-h-0 flex flex-col items-center relative ${homeContentBottomPadding}`}>
                    {!hasNeteaseLogin && isNeteaseTab ? (
                        <div className="flex flex-1 w-full flex-col items-center justify-center space-y-6">
                            <div className={`w-24 h-24 rounded-3xl ${cardBg} border border-white/10 flex items-center justify-center backdrop-blur-md`}>
                                <User size={40} className="opacity-20" />
                            </div>
                            <h2 className="text-3xl font-bold opacity-80 text-center">{t('home.guestTitle')}</h2>
                            <p className="opacity-40 text-sm text-center max-w-md leading-6">{t('home.guestPrompt')}</p>
                            <button
                                onClick={initLogin}
                                className="px-8 py-3 bg-white text-black rounded-full font-bold text-sm hover:scale-105 transition-transform"
                            >
                                {t('home.connectAccount')}
                            </button>
                        </div>
                    ) : (
                        <>
                            {/* Conditional Content Based on Tab */}
                            <AnimatePresence mode="wait">
                                {viewTab === 'albums' ? (
                                    <motion.div
                                        key="albums"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="w-full h-full flex-1 min-h-0 flex flex-col justify-center"
                                    >
                                        <div className="w-full flex-[0_1_clamp(520px,46vh,760px)] min-h-0 max-h-[clamp(520px,46vh,760px)]">
                                            <Carousel3D
                                                items={favoriteAlbums.map(a => ({
                                                    id: a.id,
                                                    name: a.name,
                                                    coverUrl: a.picUrl,
                                                    trackCount: a.size,
                                                    description: a.artists?.[0]?.name
                                                }))}
                                                onSelect={(album) => onSelectAlbum(album.id)}
                                                isLoading={loadingAlbums}
                                                emptyMessage={t('home.noAlbums') || "No favorite albums found"}
                                                initialFocusedIndex={focusedFavoriteAlbumIndex}
                                                onFocusedIndexChange={setFocusedFavoriteAlbumIndex}
                                                isDaylight={isDaylight}
                                                hasFloatingPlayer={Boolean(currentTrack)}
                                            />
                                        </div>
                                    </motion.div>
                                ) : viewTab === 'playlist' ? (
                                    <motion.div
                                        key="playlist"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="w-full h-full flex-1 min-h-0 flex flex-col justify-center"
                                    >
                                        <div className="w-full flex-[0_1_clamp(520px,46vh,760px)] min-h-0 max-h-[clamp(520px,46vh,760px)]">
                                            <Carousel3D
                                                items={playlistCards.map(p => ({
                                                    ...p,
                                                    coverUrl: p.coverImgUrl
                                                }))}
                                                onSelect={(pl) => onSelectPlaylist(pl as any)}
                                                isLoading={false}
                                                emptyMessage={t('home.loadingLibrary')}
                                                initialFocusedIndex={focusedPlaylistIndex}
                                                onFocusedIndexChange={setFocusedPlaylistIndex}
                                                isDaylight={isDaylight}
                                                hasFloatingPlayer={Boolean(currentTrack)}
                                            />
                                        </div>
                                    </motion.div>
                                ) : viewTab === 'radio' ? (
                                    <motion.div
                                        key="radio"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="w-full h-full flex-1 min-h-0 flex flex-col justify-center"
                                    >
                                        <div className="w-full flex-[0_1_clamp(520px,46vh,760px)] min-h-0 max-h-[clamp(520px,46vh,760px)]">
                                            <Carousel3D
                                                items={radioItems}
                                                onSelect={async (item) => {
                                                    if (item.id === 'personal_fm') {
                                                        const fmRes = await neteaseApi.getPersonalFm();
                                                        if (fmRes.data && fmRes.data.length > 0) {
                                                            onPlaySong(fmRes.data[0], fmRes.data, true);
                                                        }
                                                    } else {
                                                        onSelectPlaylist({
                                                            id: item.id,
                                                            name: item.name,
                                                            coverImgUrl: item.coverUrl,
                                                            creator: { nickname: item.description },
                                                            trackCount: item.trackCount
                                                        } as any);
                                                    }
                                                }}
                                                isLoading={loadingRadio}
                                                emptyMessage={t('home.loadingLibrary')}
                                                initialFocusedIndex={focusedRadioIndex}
                                                onFocusedIndexChange={setFocusedRadioIndex}
                                                isDaylight={isDaylight}
                                                hasFloatingPlayer={Boolean(currentTrack)}
                                            />
                                        </div>
                                    </motion.div>
                                ) : viewTab === 'local' ? (
                                    <motion.div
                                        key="local"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="w-full h-full flex-1"
                                    >
                                        <LocalMusicView
                                            localSongs={localSongs}
                                            localPlaylists={localPlaylists}
                                            onRefresh={onRefreshLocalSongs}
                                            onPlaySong={onPlayLocalSong}
                                            onAddToQueue={onAddLocalSongToQueue}
                                            onPlaylistVisibilityChange={setIsLocalPlaylistOpen}
                                            activeRow={localMusicState.activeRow}
                                            setActiveRow={(row) => setLocalMusicState(prev => ({ ...prev, activeRow: row }))}
                                            selectedGroup={localMusicState.selectedGroup}
                                            setSelectedGroup={(group) => setLocalMusicState(prev => ({
                                                ...prev,
                                                selectedGroup: group,
                                                detailStack: group ? prev.detailStack : [],
                                                detailOriginView: group ? prev.detailOriginView : null,
                                            }))}
                                            onBackFromDetail={() => {
                                                if (localMusicState.detailStack.length > 0) {
                                                    setLocalMusicState(prev => {
                                                        const nextStack = prev.detailStack.slice(0, -1);
                                                        return {
                                                            ...prev,
                                                            selectedGroup: nextStack[nextStack.length - 1] ?? null,
                                                            detailStack: nextStack,
                                                        };
                                                    });
                                                    return;
                                                }

                                                const shouldReturnToPlayer = localMusicState.detailOriginView === 'player';
                                                setLocalMusicState(prev => ({
                                                    ...prev,
                                                    selectedGroup: null,
                                                    detailStack: [],
                                                    detailOriginView: null,
                                                }));

                                                if (shouldReturnToPlayer) {
                                                    onBackToPlayer();
                                                }
                                            }}
                                            onMatchSong={onMatchSong}
                                            focusedFolderIndex={localMusicState.focusedFolderIndex}
                                            setFocusedFolderIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedFolderIndex: index }))}
                                            focusedAlbumIndex={localMusicState.focusedAlbumIndex}
                                            setFocusedAlbumIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedAlbumIndex: index }))}
                                            focusedArtistIndex={localMusicState.focusedArtistIndex}
                                            setFocusedArtistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedArtistIndex: index }))}
                                            focusedPlaylistIndex={localMusicState.focusedPlaylistIndex}
                                            setFocusedPlaylistIndex={(index) => setLocalMusicState(prev => ({ ...prev, focusedPlaylistIndex: index }))}
                                            onSelectArtistGroup={onSelectLocalArtist}
                                            onSelectAlbumGroup={onSelectLocalAlbum}
                                            theme={theme}
                                            isDaylight={isDaylight}
                                            hasFloatingPlayer={Boolean(currentTrack)}
                                        />
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="navidrome"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        transition={{ duration: 0.2 }}
                                        className="w-full h-full flex-1"
                                    >
                                        <NavidromeMusicView
                                            onPlaySong={onPlayNavidromeSong || (() => { })}
                                            onAddSongsToQueue={onAddNavidromeSongsToQueue}
                                            onOpenSettings={() => { helpModalInitialTabRef.current = 'help'; setShowHelpModal(true); }}
                                            onMatchSong={onMatchNavidromeSong}
                                            theme={theme}
                                            isDaylight={isDaylight}
                                            focusedAlbumIndex={navidromeFocusedAlbumIndex}
                                            setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex}
                                            externalSelection={pendingNavidromeSelection ?? searchNavidromeSelection}
                                            hasFloatingPlayer={Boolean(currentTrack)}
                                            onExternalSelectionHandled={() => {
                                                if (pendingNavidromeSelection) {
                                                    onPendingNavidromeSelectionHandled?.();
                                                    return;
                                                }
                                                setSearchNavidromeSelection(null);
                                            }}
                                        />
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </>
                    )}
                </div>

                    {/* Login Modal */}
                    {
                        showLoginModal && (
                            <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4">
                                <div className="bg-zinc-900/90 border border-white/10 p-8 rounded-3xl max-w-sm w-full text-center relative shadow-2xl">
                                    <button
                                        onClick={() => {
                                            setShowLoginModal(false);
                                            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
                                        }}
                                        className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
                                        ✕
                                    </button>
                                    <h3 className="text-lg font-bold mb-6" style={{ color: 'var(--text-primary)' }}>{t('home.loginTitle')}</h3>

                                    <div className="relative inline-block bg-white p-2 rounded-xl mb-4 shadow-inner">
                                        {qrCodeImg ? (
                                            <img src={qrCodeImg} alt="QR Code" className="w-40 h-40" />
                                        ) : (
                                            <div className="w-40 h-40 flex items-center justify-center bg-gray-100 rounded-lg">
                                                <Loader2 className="animate-spin text-gray-400" size={24} />
                                            </div>
                                        )}
                                    </div>

                                    <p className={`text-xs font-medium mt-2 ${qrStatus.includes('Success') ? 'text-green-400' : 'opacity-60'}`} style={{ color: qrStatus.includes('Success') ? undefined : 'var(--text-secondary)' }}>
                                        {qrStatus}
                                    </p>

                                    <p className="text-[10px] opacity-30 mt-6" style={{ color: 'var(--text-secondary)' }}>
                                        {t('home.loginNote')}
                                    </p>
                                </div>
                            </div>
                        )
                    }

                    {/* Help Modal */}
                    <AnimatePresence>
                    {
                        showHelpModal && (
                            <HelpModal
                                onClose={() => setShowHelpModal(false)}
                                initialTab={helpModalInitialTabRef.current}
                                staticMode={staticMode}
                                onToggleStaticMode={onToggleStaticMode}
                                enableMediaCache={enableMediaCache}
                                onToggleMediaCache={onToggleMediaCache}
                                theme={theme}
                                backgroundOpacity={backgroundOpacity}
                                setBackgroundOpacity={setBackgroundOpacity}
                                bgMode={bgMode}
                                onApplyDefaultTheme={onApplyDefaultTheme}
                                hasCustomTheme={hasCustomTheme}
                                themeParkInitialTheme={themeParkInitialTheme}
                                isCustomThemePreferred={isCustomThemePreferred}
                                onSaveCustomTheme={onSaveCustomTheme}
                                onApplyCustomTheme={onApplyCustomTheme}
                                onToggleCustomThemePreferred={onToggleCustomThemePreferred}
                                isDaylight={isDaylight}
                                onToggleNavidrome={handleToggleNavidrome}
                                visualizerMode={visualizerMode}
                                cadenzaTuning={cadenzaTuning}
                                partitaTuning={partitaTuning}
                                fumeTuning={fumeTuning}
                                onVisualizerModeChange={onVisualizerModeChange}
                                onPartitaTuningChange={onPartitaTuningChange}
                                onResetPartitaTuning={onResetPartitaTuning}
                                onFumeTuningChange={onFumeTuningChange}
                                onResetFumeTuning={onResetFumeTuning}
                                lyricsFontStyle={lyricsFontStyle}
                                lyricsFontScale={lyricsFontScale}
                                lyricsCustomFontFamily={lyricsCustomFontFamily}
                                lyricsCustomFontLabel={lyricsCustomFontLabel}
                                lyricFilterPattern={lyricFilterPattern}
                                currentSongTitle={currentSongTitle}
                                showOpenPanelCloseButton={showOpenPanelCloseButton}
                                onLyricsFontStyleChange={onLyricsFontStyleChange}
                                onLyricsFontScaleChange={onLyricsFontScaleChange}
                                onLyricsCustomFontChange={onLyricsCustomFontChange}
                                loadLyricFilterPreview={loadLyricFilterPreview}
                                onSaveLyricFilterPattern={onSaveLyricFilterPattern}
                                onToggleOpenPanelCloseButton={onToggleOpenPanelCloseButton}
                                stageStatus={stageStatus}
                                onToggleStageMode={onToggleStageMode}
                                stageSource={stageSource}
                                onStageSourceChange={onStageSourceChange}
                                onRegenerateStageToken={onRegenerateStageToken}
                                onClearStageState={onClearStageState}
                                enableNowPlayingStage={enableNowPlayingStage}
                                onToggleNowPlayingStage={onToggleNowPlayingStage}
                                nowPlayingConnectionStatus={nowPlayingConnectionStatus}
                            />
                        )
                    }
                    </AnimatePresence>

                    {/* User Avatar - Back to Player */}
                    {
                        user && (
                            <div className="absolute bottom-8 right-8 z-[100]">
                                <div
                                    onClick={onBackToPlayer}
                                    className="group relative w-12 h-12 cursor-pointer rounded-full border border-white/20 hover:scale-105 transition-all overflow-hidden shadow-lg"
                                    title="Return to Player"
                                >
                                    <img src={user.avatarUrl?.replace('http:', 'https:')} alt={user.nickname} className="w-full h-full object-cover" />

                                    {/* Hover Overlay */}
                                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 backdrop-blur-[2px]">
                                        <ChevronRight className="text-white" size={24} />
                                    </div>
                                </div>
                            </div>
                        )
                }
            </motion.div>
        </AnimatePresence>
    );
};

export default Home;
