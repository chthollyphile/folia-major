import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Loader2, Settings, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, NeteaseUser, NeteasePlaylist, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, PlayerState } from '../types';
import { neteaseApi, isSongMarkedUnavailable } from '../services/netease';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import LocalGrid3DView from './app/home/LocalGrid3DView';
import NavidromeGrid3DView from './app/home/NavidromeGrid3DView';
import { formatSongName } from '../utils/songNameFormatter';
import DesktopGrid3DSurface from './folia-grid/DesktopGrid3DSurface';
import { createNeteaseGridViewCollection } from './app/home/gridViewCollectionAdapters';
import { importFolder } from '../services/localMusicService';

// src/components/Grid3D.tsx
// Glassmorphic interactive desktop home view replacing the legacy 3D carousel.
// Supports cover sliding with auto-fading header controls and delegates GridView opening upward.

interface Grid3DProps {
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
    } = props;

    const { t } = useTranslation();
    const isDaylight = useSettingsUiStore(state => state.isDaylight);
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

    const isNeteaseTab = homeViewTab === 'playlist' || homeViewTab === 'albums' || homeViewTab === 'radio';

    const [focusedIndex, setFocusedIndex] = useState(0);
    const [isLocalImporting, setIsLocalImporting] = useState(false);

    // Reset focused index when switching tabs.
    useEffect(() => {
        setFocusedIndex(0);
    }, [homeViewTab]);

    // Login QR State
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [qrCodeImg, setQrCodeImg] = useState<string>("");
    const [qrStatus, setQrStatus] = useState<string>("");
    const qrCheckInterval = useRef<any>(null);

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

    useEffect(() => {
        return () => {
            if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
        };
    }, []);

    // Netease details
    const [favoriteAlbums, setFavoriteAlbums] = useState<any[]>([]);
    const [loadingAlbums, setLoadingAlbums] = useState(false);
    const [radioItems, setRadioItems] = useState<any[]>([]);
    const [loadingRadio, setLoadingRadio] = useState(false);

    const isLoading =
        (homeViewTab === 'playlist' && playlists.length === 0 && user !== null) ||
        (homeViewTab === 'albums' && loadingAlbums) ||
        (homeViewTab === 'radio' && loadingRadio);

    // Load favorite albums and recommendations
    useEffect(() => {
        if (homeViewTab === 'albums' && favoriteAlbums.length === 0 && user) {
            fetchFavoriteAlbums();
        }
        if (homeViewTab === 'radio' && radioItems.length === 0 && user) {
            fetchRadioItems();
        }
    }, [homeViewTab, user]);

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
                hasMore = res.hasMore;
                offset += limit;
            }
            setFavoriteAlbums(allAlbums);
        } catch (e) {
            console.error('[Grid3D] Failed to fetch favorite albums', e);
        } finally {
            setLoadingAlbums(false);
        }
    };

    const fetchRadioItems = async () => {
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
                    description: r.creator?.nickname || '每日推荐',
                    summary: r.description || r.copywriter || ''
                }));
            }
            setRadioItems([fmItem, ...recItems]);
        } catch (e) {
            console.error('[Grid3D] Failed to fetch radio items', e);
        } finally {
            setLoadingRadio(false);
        }
    };

    // Filter cloud and local playlists
    const playlistCards = useMemo(() => {
        const base = cloudPlaylist
            ? (playlists.length > 0
                ? [playlists[0], cloudPlaylist, ...playlists.slice(1)]
                : [cloudPlaylist])
            : playlists;
        return base.map(p => ({
            id: p.id,
            name: p.name,
            coverUrl: p.coverImgUrl || (p as any).coverUrl,
            trackCount: p.trackCount,
            description: p.creator?.nickname || '歌单',
            summary: p.description || '',
            type: 'playlist' as const,
            raw: p
        }));
    }, [playlists, cloudPlaylist]);

    const albumCards = useMemo(() => {
        return favoriteAlbums.map(a => ({
            id: a.id,
            name: a.name,
            coverUrl: a.picUrl,
            trackCount: a.size,
            description: a.artists?.[0]?.name || '未知歌手',
            summary: a.description || a.briefDesc || '',
            type: 'album' as const,
            raw: a
        }));
    }, [favoriteAlbums]);

    const radioCards = useMemo(() => {
        return radioItems.map(r => ({
            id: r.id,
            name: r.name,
            coverUrl: r.coverUrl,
            trackCount: r.trackCount,
            description: r.description || '电台',
            summary: r.summary || '',
            type: r.isFm ? 'radio' as const : 'playlist' as const,
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
                const fmRes = await neteaseApi.getPersonalFm();
                if (fmRes.data && fmRes.data.length > 0) {
                    onPlaySong(fmRes.data[0], fmRes.data, true);
                }
            } catch (e) {
                console.error('[Grid3D] Failed to fetch and play Personal FM:', e);
            }
            return;
        }

        const collection = card.raw
            ? { ...card.raw, type: card.type }
            : card;
        onOpenGridView?.(createNeteaseGridViewCollection(collection));
    };

    const handleFolderImport = async () => {
        if (isLocalImporting) return;

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

    // Search committed callback
    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const query = searchQuery.trim();
        if (!query) return;

        const didSearch = await submitSearch({
            query,
            sourceTab: homeViewTab,
            deps: {
                localSongs,
                t: (key, fallback) => t(key, fallback ?? ''),
            },
        });

        if (didSearch) {
            onSearchCommitted(query, homeViewTab);
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
            <div className="transition-opacity duration-300 ease-in-out z-20 opacity-100">
                <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto p-4 md:p-8 gap-y-4 md:gap-y-0">
                    {/* Left title and settings */}
                    <div className="flex items-center justify-start order-1 md:order-none">
                        <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                            Folia
                        </h1>
                        <button
                            onClick={() => onOpenSettings?.('help')}
                            className="p-2 rounded-full hover:bg-white/10 opacity-40 hover:opacity-100 transition-all ml-4"
                            title="Help & Options"
                        >
                            <Settings size={20} style={{ color: 'var(--text-primary)' }} />
                        </button>
                    </div>

                    {/* Center Tab Switcher */}
                    <div className="flex justify-center order-3 md:order-none col-span-2 md:col-span-1">
                        <div className={`relative ${navPillBg} backdrop-blur-md p-1 rounded-full scale-90 md:scale-100 origin-center`}>
                            <div className="inline-flex items-center gap-0">
                                {[
                                    { key: 'playlist', label: t('home.playlists') },
                                    { key: 'radio', label: t('home.radio') || '电台' },
                                    { key: 'albums', label: t('home.albums') || '专辑' },
                                    { key: 'local', label: t('localMusic.folder') },
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
                                className={`w-full ${inputBg} border border-white/10 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:border-white/20 transition-all placeholder:text-current placeholder:opacity-40`}
                                style={{ color: 'var(--text-primary)' }}
                            />
                        </form>
                    </div>
                </div>
            </div>

            {/* Desktop Canvas Surface */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center relative">
                {isNeteaseTab && !user ? (
                    /* Guest Connect Account Page */
                    <div className="flex flex-1 w-full flex-col items-center justify-center space-y-6">
                        <div className={`w-24 h-24 rounded-3xl ${isDaylight ? 'bg-white/40 shadow-sm border border-black/5' : 'bg-white/5 border border-white/5'} flex items-center justify-center backdrop-blur-md`}>
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
                ) : isNeteaseTab ? (
                    <DesktopGrid3DSurface
                        title={
                            homeViewTab === 'playlist'
                                ? t('home.playlists')
                                : homeViewTab === 'albums'
                                    ? t('home.albums')
                                    : t('home.radio')
                        }
                        mapButtonLabel={t('home.allAlbums') || '全部'}
                        items={currentDesktopItems}
                        focusedIndex={focusedIndex}
                        onFocusedIndexChange={setFocusedIndex}
                        onSelect={handleSelectCollectionCard}
                        isLoading={isLoading}
                        emptyMessage={t('home.loadingLibrary')}
                        theme={theme}
                        isDaylight={isDaylight}
                        hasFloatingPlayer={Boolean(currentTrack)}
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
                            importButtonDisabled={isLocalImporting}
                            isImporting={isLocalImporting}
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
            {showLoginModal && (
                <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-xl p-4">
                    <div className="bg-zinc-900/90 border border-white/10 p-8 rounded-3xl max-w-sm w-full text-center relative shadow-2xl animate-in fade-in zoom-in-95 duration-200">
                        <button
                            onClick={() => {
                                setShowLoginModal(false);
                                if (qrCheckInterval.current) clearInterval(qrCheckInterval.current);
                            }}
                            className="absolute top-4 right-4 opacity-30 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors cursor-pointer"
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
            )}

            {/* User Avatar - Back to Player */}
            {user && (
                <div className="absolute bottom-8 right-8 z-[100]">
                    <div
                        onClick={onBackToPlayer}
                        className="group relative w-12 h-12 cursor-pointer rounded-full border border-white/20 hover:scale-105 transition-all overflow-hidden shadow-lg pointer-events-auto"
                        title="Return to Player"
                    >
                        <img src={user.avatarUrl?.replace('http:', 'https:')} alt={user.nickname} className="w-full h-full object-cover" />

                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 backdrop-blur-[2px]">
                            <ChevronRight className="text-white" size={24} />
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default Grid3D;
