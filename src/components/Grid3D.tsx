import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, Loader2, Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { resolveSearchSource, useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import type { LocalLibraryCatalogSnapshot } from '../hooks/useLocalLibraryCatalog';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, PlayerState } from '../types';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import LocalGrid3DView from './app/home/LocalGrid3DView';
import NavidromeGrid3DView from './app/home/NavidromeGrid3DView';
import DesktopGrid3DSurface from './folia-grid/DesktopGrid3DSurface';
import {
    createOnlineGridViewCollection,
    getProviderCollectionArtistLabel,
} from './app/home/gridViewCollectionAdapters';
import { importFolder, resyncAllFolders, LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../services/localMusicService';
import { useOnlineProviderQrLogin } from '../hooks/useOnlineProviderQrLogin';
import type { OnlineProviderPlatformState } from '../hooks/useOnlineProviderPlatform';
import { omni } from '../services/onlineMusic/omni';
import { getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import OnlineProviderSwitcher from './app/home/OnlineProviderSwitcher';
import OnlineProviderConnectPanel from './app/home/OnlineProviderConnectPanel';
import OnlineProviderLoginModal from './app/home/OnlineProviderLoginModal';
import { resolveOnlineProviderAccountView } from './app/home/onlineProviderAccountView';
import type { MediaId, ProviderCollection, ProviderUser } from '../types/onlineMusic';

// src/components/Grid3D.tsx
// Glassmorphic interactive desktop home view replacing the legacy 3D carousel.
// Supports cover sliding with auto-fading header controls and delegates GridView opening upward.

interface Grid3DProps {
    onlineProviderPlatform?: OnlineProviderPlatformState;
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: ProviderUser | null;
    playlists: ProviderCollection[];
    cloudPlaylist?: ProviderCollection | null;
    currentTrack?: SongResult | null;
    isPlaying: boolean;
    onSelectPlaylist: (playlist: ProviderCollection) => void;
    onSelectAlbum: (albumId: MediaId) => void;
    onSelectArtist: (artistId: MediaId) => void;
    onSelectLocalAlbum?: (albumName: string) => void;
    onSelectLocalArtist?: (artistName: string) => void;
    localSongs: LocalSong[];
    localLibraryCatalog: LocalLibraryCatalogSnapshot;
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => void;
    onPlayLocalSong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddLocalSongToQueue?: (song: LocalSong) => void;
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
    onPlayNavidromeSong?: (song: any, queue?: any[]) => void;
    onAddNavidromeSongsToQueue?: (songs: any[]) => void;
    onMatchNavidromeSong?: (song: any) => void;
    navidromeFocusedAlbumIndex?: number;
    setNavidromeFocusedAlbumIndex?: (index: number) => void;
    pendingNavidromeSelection?: any;
    onPendingNavidromeSelectionHandled?: () => void;
    onSearchCommitted: (query: string, sourceTab: any, replace?: boolean) => void;
    theme: Theme;
    onOpenSettings?: (initialTab?: 'help' | 'options') => void;
    navidromeEnabled?: boolean;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onAddSongToQueue?: (song: SongResult) => void;
    onOpenGridView?: (collection: any) => void;
    stageEnabled?: boolean;
    stageIsActive?: boolean;
    onOpenStagePlayer?: () => void;
}

export const Grid3D: React.FC<Grid3DProps> = (props) => {
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
        navidromeEnabled = false,
        onOpenGridView,
        stageEnabled = false,
        stageIsActive = false,
        onOpenStagePlayer,
        onlineProviderPlatform,
    } = props;

    const { t } = useTranslation();
    const {
        isDaylight,
        showHomeTabPlaylist,
        showHomeTabRadio,
        showHomeTabAlbums,
        showHomeTabLocal,
    } = useSettingsUiStore(useShallow(state => ({
        isDaylight: state.isDaylight,
        showHomeTabPlaylist: state.showHomeTabPlaylist,
        showHomeTabRadio: state.showHomeTabRadio,
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

    const isOnlineTab = homeViewTab === 'playlist' || homeViewTab === 'albums' || homeViewTab === 'radio';
    const activeProviderId = onlineProviderPlatform?.activeProviderId || 'netease';
    const activeProviderSummary = onlineProviderPlatform?.activeProvider;
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

    const [focusedIndex, setFocusedIndex] = useState(0);
    const [isLocalImporting, setIsLocalImporting] = useState(false);
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
    const {
        qrCodeImg,
        qrState,
        qrStatusText,
        start: startQrLogin,
        stop: stopQrLogin,
    } = useOnlineProviderQrLogin({
        providerId: loginProviderId,
        t,
        onConfirmed: async (confirmedProviderId) => {
            setShowLoginModal(false);
            if (onlineProviderPlatform) {
                await onlineProviderPlatform.completeLogin(confirmedProviderId);
            } else {
                onRefreshUser();
            }
        },
    });

    const initLogin = async (providerId = activeProviderId) => {
        const summary = onlineProviderPlatform?.providers.find(provider => provider.providerId === providerId);
        if (summary && !summary.availability.configured) return;
        setLoginProviderId(providerId);
        setShowLoginModal(true);
        await startQrLogin(providerId);
    };

    // Online provider collection details
    const [favoriteAlbums, setFavoriteAlbums] = useState<ProviderCollection[]>([]);
    const [loadingAlbums, setLoadingAlbums] = useState(false);
    const [radioItems, setRadioItems] = useState<any[]>([]);
    const [loadingRadio, setLoadingRadio] = useState(false);

    const isLoading =
        (homeViewTab === 'playlist' && activeCollections.length === 0 && activeUser !== null) ||
        (homeViewTab === 'albums' && loadingAlbums) ||
        (homeViewTab === 'radio' && loadingRadio);

    // Load favorite albums and recommendations
    useEffect(() => {
        if (homeViewTab === 'albums' && favoriteAlbums.length === 0 && activeUser) {
            fetchFavoriteAlbums();
        }
        if (homeViewTab === 'radio' && radioItems.length === 0 && activeUser) {
            fetchRadioItems();
        }
    }, [activeProviderId, activeUser, homeViewTab]);

    useEffect(() => {
        setFavoriteAlbums([]);
        setRadioItems([]);
        setFocusedIndex(0);
    }, [activeProviderId]);

    const fetchFavoriteAlbums = async () => {
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

    const fetchRadioItems = async () => {
        setLoadingRadio(true);
        try {
            const { personalFm: fmSongs, dailySongs, recommendedCollections } = await omni.getHomeFeed(35);
            const fmCoverUrl = getSongCoverUrl(fmSongs[0], activeProviderId);

            const fmItem = {
                id: 'personal_fm',
                name: '私人FM',
                coverUrl: fmCoverUrl,
                description: 'Personal FM',
                isFm: true,
            };

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
            setRadioItems([fmItem, dailyItem, ...recommendedItems]);
        } catch (e) {
            console.error('[Grid3D] Failed to fetch radio items', e);
        } finally {
            setLoadingRadio(false);
        }
    };

    // Filter cloud and local playlists
    const playlistCards = useMemo(() => {
        return activeCollections.map(p => ({
            id: p.id,
            name: p.name,
            coverUrl: p.coverUrl,
            trackCount: p.trackCount,
            description: p.creator?.nickname || t('home.playlists'),
            summary: p.description || '',
            type: p.type,
            raw: p
        }));
    }, [activeCollections, t]);

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
        return radioItems.map(r => ({
            id: r.id,
            name: r.name,
            coverUrl: r.coverUrl,
            trackCount: r.trackCount,
            description: r.description || t('home.radio'),
            summary: r.summary || '',
            type: r.isFm
                ? 'radio' as const
                : r.isDailyRecommendations
                    ? 'daily_recommendations' as const
                    : 'playlist' as const,
            raw: r
        }));
    }, [radioItems]);

    // Active tab list items mapping
    const currentDesktopItems = useMemo(() => {
        if (homeViewTab === 'playlist') return playlistCards;
        if (homeViewTab === 'albums') return albumCards;
        if (homeViewTab === 'radio') return radioCards;
        return [];
    }, [homeViewTab, playlistCards, albumCards, radioCards]);

    // Delegate GridView opening to the app-level host so Grid3D remains only the home surface.
    // If Personal FM is clicked, it plays Personal FM directly instead of opening GridView.
    const handleSelectCollectionCard = async (card: any) => {
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

    const handleFolderImport = async () => {
        if (isLocalImporting || isLocalRefreshing || scanProgress?.active) return;

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
        if (isLocalImporting || isLocalRefreshing || scanProgress?.active) return;

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

    // Search committed callback
    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const query = searchQuery.trim();
        if (!query) return;

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

    // Background style mappings
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';
    const activeTabBg = isDaylight ? 'text-black font-bold' : 'text-black';

    const bottomPadding = currentTrack ? 'pb-28 md:pb-32' : '';

    return (
        <div className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm ${bottomPadding}`}>

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
                            title="Help & Options"
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

                    {/* Center Tab Switcher */}
                    <div className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1">
                        <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-full scale-90 md:scale-100 origin-center`}>
                            <div className="inline-flex items-center gap-0">
                                {[
                                    ...(showHomeTabPlaylist ? [{ key: 'playlist', label: t('home.playlists') }] : []),
                                    ...(showHomeTabRadio ? [{ key: 'radio', label: t('home.radio') }] : []),
                                    ...(showHomeTabAlbums ? [{ key: 'albums', label: t('home.albums') }] : []),
                                    ...(showHomeTabLocal ? [{ key: 'local', label: t('localMusic.folder') }] : []),
                                    ...(navidromeEnabled ? [{ key: 'navidrome', label: t('navidrome.title') || 'Navidrome' }] : []),
                                ].map((tab) => {
                                    const isActive = homeViewTab === tab.key;
                                    return (
                                        <button
                                            key={tab.key}
                                            onClick={() => setHomeViewTab(tab.key as any)}
                                            className={`relative inline-flex items-center justify-center px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${isActive ? activeTabBg : navPillInactiveText}`}
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
                                type="text"
                                placeholder={homeViewTab === 'local' ? t('home.searchLocal') : homeViewTab === 'navidrome' ? t('home.searchNavidrome') : t('home.searchDatabase')}
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40 select-text`}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </form>
                    </div>
                </div>
            </div>

            {/* Desktop Canvas Surface */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative">
                {isOnlineTab && activeAccountView === 'resolving' ? (
                    <div className="flex flex-1 w-full items-center justify-center" aria-busy="true">
                        <Loader2 className="animate-spin opacity-30" size={28} />
                    </div>
                ) : isOnlineTab && activeAccountView === 'guest' ? (
                    <OnlineProviderConnectPanel
                        providers={onlineProviderPlatform?.providers || omni.getProviderSummaries()}
                        activeProviderId={activeProviderId}
                        isDaylight={isDaylight}
                        title={t('home.guestTitle')}
                        prompt={t('home.guestPrompt')}
                        getActionLabel={provider => provider.status === 'authenticated'
                            ? t('home.switchToProvider', { provider: provider.shortName || provider.displayName })
                            : t('home.connectProviderAccount', { provider: provider.shortName || provider.displayName })}
                        onSelect={provider => {
                            if (provider.status === 'authenticated') {
                                void onlineProviderPlatform?.switchProvider(provider.providerId);
                            } else {
                                void initLogin(provider.providerId);
                            }
                        }}
                    />
                ) : isOnlineTab ? (
                    <DesktopGrid3DSurface
                        title={
                            homeViewTab === 'playlist'
                                ? t('home.playlists')
                                : homeViewTab === 'albums'
                                    ? t('home.albums')
                                    : t('home.radio')
                        }
                        mapButtonLabel={t('home.allAlbums')}
                        items={currentDesktopItems}
                        focusedIndex={focusedIndex}
                        onFocusedIndexChange={setFocusedIndex}
                        onSelect={handleSelectCollectionCard}
                        isLoading={isLoading}
                        emptyMessage={t('home.loadingLibrary')}
                        theme={theme}
                        isDaylight={isDaylight}
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
                            onRefreshFolders={handleRefreshFolders}
                            importButtonDisabled={isLocalImporting || isLocalRefreshing || Boolean(scanProgress?.active)}
                            isImporting={isLocalImporting}
                            isRefreshing={isLocalRefreshing}
                            isScanInProgress={Boolean(scanProgress?.active)}
                            theme={theme}
                            isDaylight={isDaylight}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onOpenGridView={onOpenGridView}
                        />
                    </div>
                ) : (
                    <div className="w-full h-full flex-1">
                        <NavidromeGrid3DView
                            theme={theme}
                            isDaylight={isDaylight}
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
                        title={t(loginProviderId === 'kugou' ? 'home.loginTitleKugou' : 'home.loginTitle')}
                        note={t(loginProviderId === 'kugou' ? 'home.loginNoteKugou' : 'home.loginNote')}
                        qrCodeImg={qrCodeImg}
                        statusText={qrStatusText}
                        state={qrState}
                        retryLabel={t('home.retryQr')}
                        closeLabel={t('home.closeLogin')}
                        onRetry={() => void startQrLogin(loginProviderId)}
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
                    onSelect={provider => {
                        if (provider.status === 'authenticated') {
                            void onlineProviderPlatform.switchProvider(provider.providerId);
                        } else {
                            void initLogin(provider.providerId);
                        }
                    }}
                />
            )}

        </div>
    );
};

export default Grid3D;
