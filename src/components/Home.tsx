import React, { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Loader2, Disc, ArrowRight, ChevronRight, HelpCircle, ChevronDown } from 'lucide-react';
import { neteaseApi } from '../services/netease';
import { NeteaseUser, NeteasePlaylist, SongResult, LocalSong, Theme, UnifiedSong, LocalLibraryGroup, LocalPlaylist, type CadenzaTuning, type VisualizerMode } from '../types';
import { NavidromeSong, NavidromeViewSelection } from '../types/navidrome';
import { isNavidromeEnabled, getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { LOCAL_MUSIC_SCAN_PROGRESS_EVENT } from '../services/localMusicService';
import PlaylistView from './PlaylistView';
import LocalMusicView from './LocalMusicView';
import NavidromeMusicView from './navidrome/NavidromeMusicView';
import HelpModal from './HelpModal';
import { motion, AnimatePresence } from 'framer-motion';
import { formatSongName } from '../utils/songNameFormatter';
import Carousel3D from './Carousel3D';



interface HomeProps {
    onPlaySong: (song: SongResult, playlistCtx?: SongResult[], isFmCall?: boolean) => void;
    onQueueAddAndPlay: (song: SongResult) => void;
    onBackToPlayer: () => void;
    onRefreshUser: () => void;
    user: NeteaseUser | null;
    playlists: NeteasePlaylist[];
    currentTrack?: SongResult | null;
    isPlaying: boolean;
    selectedPlaylist: NeteasePlaylist | null;
    onSelectPlaylist: (playlist: NeteasePlaylist | null) => void;
    onSelectAlbum: (albumId: number | null) => void;
    onSelectArtist: (artistId: number | null) => void;
    onSelectLocalAlbum?: (albumName: string) => void;
    onSelectLocalArtist?: (artistName: string) => void;
    localSongs: LocalSong[];
    localPlaylists: LocalPlaylist[];
    onRefreshLocalSongs: () => void;
    onPlayLocalSong: (song: LocalSong, queue?: LocalSong[]) => void;
    onAddLocalSongToQueue?: (song: LocalSong) => void;
    viewTab: 'playlist' | 'local' | 'albums' | 'navidrome' | 'radio';
    setViewTab: (tab: 'playlist' | 'local' | 'albums' | 'navidrome' | 'radio') => void;
    focusedPlaylistIndex?: number;
    setFocusedPlaylistIndex?: (index: number) => void;
    focusedFavoriteAlbumIndex?: number;
    setFocusedFavoriteAlbumIndex?: (index: number) => void;
    focusedRadioIndex?: number;
    setFocusedRadioIndex?: (index: number) => void;
    localMusicState: {
        activeRow: 0 | 1 | 2 | 3;
        selectedGroup: LocalLibraryGroup | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    };
    setLocalMusicState: React.Dispatch<React.SetStateAction<{
        activeRow: 0 | 1 | 2 | 3;
        selectedGroup: LocalLibraryGroup | null;
        focusedFolderIndex: number;
        focusedAlbumIndex: number;
        focusedArtistIndex: number;
        focusedPlaylistIndex: number;
    }>>;
    onMatchSong?: (song: LocalSong) => void;
    onPlayNavidromeSong?: (song: NavidromeSong, queue?: NavidromeSong[]) => void;
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
    onSetThemePreset: (preset: 'midnight' | 'daylight') => void;
    isDaylight: boolean;
    visualizerMode: VisualizerMode;
    cadenzaTuning: CadenzaTuning;
    onVisualizerModeChange: (mode: VisualizerMode) => void;
    lyricsFontStyle: Theme['fontStyle'];
    lyricsFontScale: number;
    lyricsCustomFontFamily: string | null;
    lyricsCustomFontLabel: string | null;
    onLyricsFontStyleChange: (fontStyle: Theme['fontStyle']) => void;
    onLyricsFontScaleChange: (fontScale: number) => void;
    onLyricsCustomFontChange: (font: { family: string; label?: string | null; } | null) => void;
}
const SearchResultCover: React.FC<{ track: UnifiedSong }> = ({ track }) => {
    const [src, setSrc] = useState<string | undefined>(undefined);

    useEffect(() => {
        let objectUrl: string | undefined;

        if (track.isLocal && track.localData) {
            const ls = track.localData;
            if (ls.useOnlineCover !== false && ls.matchedCoverUrl) {
                setSrc(ls.matchedCoverUrl.replace('http:', 'https:'));
            } else if (ls.embeddedCover) {
                objectUrl = URL.createObjectURL(ls.embeddedCover);
                setSrc(objectUrl);
            } else {
                setSrc(undefined);
            }
        } else if (track.isNavidrome) {
            const remoteUrl = track.al?.picUrl || track.album?.picUrl;
            setSrc(remoteUrl);
        } else {
            const remoteUrl = track.al?.picUrl || track.album?.picUrl;
            if (remoteUrl) {
                setSrc(remoteUrl.replace('http:', 'https:'));
            } else {
                setSrc(undefined);
            }
        }

        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [track]);

    if (!src) {
        return <div className="w-full h-full flex items-center justify-center"><Disc size={20} className="opacity-20" /></div>;
    }

    return (
        <img
            src={src}
            className="w-full h-full object-cover"
            loading="lazy"
        />
    );
};

const Home: React.FC<HomeProps> = ({
    onPlaySong,
    onQueueAddAndPlay,
    onBackToPlayer,
    onRefreshUser,
    user,
    playlists,
    currentTrack,
    isPlaying,
    selectedPlaylist,
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
    viewTab,
    setViewTab,
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
    onSetThemePreset,
    isDaylight,
    visualizerMode,
    cadenzaTuning,
    onVisualizerModeChange,
    lyricsFontStyle,
    lyricsFontScale,
    lyricsCustomFontFamily,
    lyricsCustomFontLabel,
    onLyricsFontStyleChange,
    onLyricsFontScaleChange,
    onLyricsCustomFontChange,
}) => {
    const { t } = useTranslation();
    const hasNeteaseLogin = Boolean(user);
    const isNeteaseTab = viewTab === 'playlist' || viewTab === 'albums' || viewTab === 'radio';
    // const isDaylight = theme.name === 'Daylight Default'; // Deprecated, passed as prop

    // Style Variants
    const mainBg = isDaylight ? 'bg-white/40' : 'bg-black/20';
    const inputBg = isDaylight ? 'bg-black/5 focus:bg-black/10' : 'bg-white/5 focus:bg-white/10';
    const resultItemBg = isDaylight ? 'bg-black/5 hover:bg-black/10' : 'bg-white/5 hover:bg-white/10';
    const cardBg = isDaylight ? 'bg-white/40' : 'bg-white/5';
    const activeTabBg = isDaylight ? 'text-black font-bold' : 'text-black'; // When tab active (white bg), text is black
    // For pill nav container
    const navPillBg = isDaylight ? 'bg-black/5' : 'bg-white/10';
    const navPillInactiveText = isDaylight ? 'text-black/60 hover:text-black' : 'text-white/60 hover:text-white';

    // UI State
    const [searchQuery, setSearchQuery] = useState("");
    const [showLoginModal, setShowLoginModal] = useState(false);
    const [showHelpModal, setShowHelpModal] = useState(false);
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

    const handleToggleNavidrome = (enabled: boolean) => {
        setNavidromeEnabled(enabled);
        if (!enabled && viewTab === 'navidrome') {
            setViewTab('local');
        }
    };

    // viewTab lifted to App.tsx
    // Search State
    const [searchResults, setSearchResults] = useState<SongResult[] | null>(null);
    const [isSearching, setIsSearching] = useState(false);
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

    const openNavidromeAlbum = (albumId: string) => {
        setViewTab('navidrome');
        setSearchNavidromeSelection({ type: 'album', albumId });
    };

    const openNavidromeArtist = (artistId: string) => {
        setViewTab('navidrome');
        setSearchNavidromeSelection({ type: 'artist', artistId });
    };

    const handleSearch = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const query = searchQuery.trim();
        if (!query) return;

        setIsSearching(true);
        setSearchResults(null); // Clear previous results while loading

        try {
            if (viewTab === 'local') {
                const lowerQuery = query.toLowerCase();
                const matchedLocalSongs = localSongs.filter(ls => {
                    const title = (ls.title || ls.embeddedTitle || ls.fileName || '').toLowerCase();
                    const artist = (ls.artist || ls.embeddedArtist || '').toLowerCase();
                    const album = (ls.album || ls.embeddedAlbum || '').toLowerCase();
                    return title.includes(lowerQuery) || artist.includes(lowerQuery) || album.includes(lowerQuery);
                });

                const unifiedResults: UnifiedSong[] = matchedLocalSongs.map((ls, index) => {
                    // Create a pseudo unique negative ID
                    const uniqueId = -(Date.now() + index);
                    return {
                        id: uniqueId,
                        name: ls.title || ls.embeddedTitle || ls.fileName,
                        artists: [{ id: 0, name: ls.artist || ls.embeddedArtist || t('player.unknownArtist', '未知歌手') }],
                        album: { id: 0, name: ls.album || ls.embeddedAlbum || t('player.unknownAlbum', '未知专辑'), picUrl: ls.matchedCoverUrl || undefined },
                        duration: ls.duration,
                        al: {
                            id: 0,
                            name: ls.album || ls.embeddedAlbum || t('player.unknownAlbum', '未知专辑'),
                            picUrl: ls.matchedCoverUrl || undefined
                        },
                        ar: [{ id: 0, name: ls.artist || ls.embeddedArtist || t('player.unknownArtist', '未知歌手') }],
                        dt: ls.duration,
                        isLocal: true,
                        localData: ls
                    };
                });
                setSearchResults(unifiedResults);
            } else if (viewTab === 'navidrome') {
                const config = getNavidromeConfig();
                if (config) {
                    const res = await navidromeApi.search(config, query, 0, 0, 30);
                    if (res && res.song) {
                        const naviResults: UnifiedSong[] = res.song.map(s => {
                            const ns = navidromeApi.toNavidromeSong(config, s);
                            return {
                                ...ns,
                                ar: ns.artists,
                                al: ns.album,
                                dt: ns.duration
                            } as UnifiedSong;
                        });
                        setSearchResults(naviResults);
                    } else {
                        setSearchResults([]);
                    }
                } else {
                    setSearchResults([]);
                }
            } else {
                const res = await neteaseApi.cloudSearch(query);
                if (res.result && res.result.songs) {
                    setSearchResults(res.result.songs);
                } else {
                    setSearchResults([]);
                }
            }
        } catch (err) {
            console.error(err);
            setSearchResults([]);
        } finally {
            setIsSearching(false);
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
            {selectedPlaylist ? (
                <PlaylistView
                    key="playlist-view"
                    playlist={selectedPlaylist}
                    onBack={() => onSelectPlaylist(null)}
                    onPlaySong={onPlaySong}
                    onPlayAll={(songs) => {
                        if (songs.length > 0) onPlaySong(songs[0], songs);
                    }}
                    onSelectAlbum={(id) => onSelectAlbum(id)}
                    onSelectArtist={onSelectArtist}
                    currentUserId={user?.userId}
                    isLikedSongsPlaylist={Boolean(playlists[0] && playlists[0].id === selectedPlaylist.id)}
                    onPlaylistMutated={onRefreshUser}
                    theme={theme}
                    isDaylight={isDaylight}
                />
            ) : (
                <motion.div
                    key="home-main"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.3 }}

                    className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm overflow-y-auto custom-scrollbar`}
                    style={{ color: 'var(--text-primary)' }}
                // onTouchStart={onTouchStart}
                // onTouchEnd={onTouchEnd}
                >
                    {/* Header Section */}
                    {!isLocalPlaylistOpen && (
                        <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto z-20 relative mb-8 p-4 md:p-8 gap-y-4 md:gap-y-0">
                            {/* Left: Title & Help */}
                            <div className="flex items-center justify-start order-1 md:order-none">
                                <h1 className="text-2xl font-bold tracking-tight opacity-90 flex items-center gap-3">
                                    Folia
                                </h1>
                                <button
                                    onClick={() => setShowHelpModal(true)}
                                    className="p-2 rounded-full hover:bg-white/10 opacity-40 hover:opacity-100 transition-all ml-4"
                                    title="Help & About"
                                >
                                    <HelpCircle size={20} style={{ color: 'var(--text-primary)' }} />
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
                                    <div className={`grid ${navidromeEnabled ? 'grid-cols-5' : 'grid-cols-4 transition-all duration-300'}`}>
                                        <div
                                            className="absolute top-1 bottom-1 rounded-full bg-white shadow-sm transition-all duration-300 ease-spring"
                                            style={{
                                                left: viewTab === 'playlist' ? '4px'
                                                    : viewTab === 'radio' ? (navidromeEnabled ? 'calc(20% + 1px)' : 'calc(25% + 1px)')
                                                    : viewTab === 'albums' ? (navidromeEnabled ? 'calc(40% + 1px)' : 'calc(50% + 1px)')
                                                        : viewTab === 'local' ? (navidromeEnabled ? 'calc(60%)' : 'calc(75% - 1px)')
                                                            : 'calc(80% - 1px)',
                                                width: navidromeEnabled ? 'calc(20% - 2px)' : 'calc(25% - 2px)'
                                            }}
                                        />
                                        <button
                                            onClick={() => setViewTab('playlist')}
                                            className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${viewTab === 'playlist' ? activeTabBg : navPillInactiveText}`}
                                        >
                                            {t('home.playlists')}
                                        </button>
                                        <button
                                            onClick={() => setViewTab('radio')}
                                            className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${viewTab === 'radio' ? activeTabBg : navPillInactiveText}`}
                                        >
                                            {t('home.radio') || '电台'}
                                        </button>
                                        <button
                                            onClick={() => setViewTab('albums')}
                                            className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${viewTab === 'albums' ? activeTabBg : navPillInactiveText
                                                }`}
                                        >
                                            {t('home.albums') || '专辑'}
                                        </button>
                                        <button
                                            onClick={() => setViewTab('local')}
                                            className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${viewTab === 'local' ? activeTabBg : navPillInactiveText
                                                }`}
                                        >
                                            {t('localMusic.folder')}
                                        </button>
                                        {navidromeEnabled && (
                                            <button
                                                onClick={() => setViewTab('navidrome')}
                                                className={`relative z-10 px-3 md:px-4 py-1.5 rounded-full text-xs md:text-sm font-medium transition-colors duration-300 whitespace-nowrap ${viewTab === 'navidrome' ? activeTabBg : navPillInactiveText
                                                    }`}
                                            >
                                                {t('navidrome.title') || 'Navidrome'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Right: Search Bar */}
                            <div className="flex justify-end order-2 md:order-none">
                                <form onSubmit={handleSearch} className="relative group w-full md:w-64 transition-all focus-within:w-full md:focus-within:w-80">
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
                    <div className="flex-1 flex flex-col items-center justify-center relative">
                        {!hasNeteaseLogin && isNeteaseTab ? (
                            <div className="flex flex-col items-center justify-center space-y-6">
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
                                            className="w-full h-full flex-1"
                                        >
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
                                            />
                                        </motion.div>
                                    ) : viewTab === 'playlist' ? (
                                        <motion.div
                                            key="playlist"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full h-full flex-1"
                                        >
                                            <Carousel3D
                                                items={playlists.map(p => ({
                                                    ...p,
                                                    coverUrl: p.coverImgUrl
                                                }))}
                                                onSelect={(pl) => onSelectPlaylist(pl as any)}
                                                isLoading={false}
                                                emptyMessage={t('home.loadingLibrary')}
                                                initialFocusedIndex={focusedPlaylistIndex}
                                                onFocusedIndexChange={setFocusedPlaylistIndex}
                                                isDaylight={isDaylight}
                                            />
                                        </motion.div>
                                    ) : viewTab === 'radio' ? (
                                        <motion.div
                                            key="radio"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full h-full flex-1"
                                        >
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
                                            />
                                        </motion.div>
                                    ) : viewTab === 'local' ? (
                                        <motion.div
                                            key="local"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full h-full flex-1 overflow-hidden"
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
                                                setSelectedGroup={(group) => setLocalMusicState(prev => ({ ...prev, selectedGroup: group }))}
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
                                            />
                                        </motion.div>
                                    ) : (
                                        <motion.div
                                            key="navidrome"
                                            initial={{ opacity: 0 }}
                                            animate={{ opacity: 1 }}
                                            exit={{ opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="w-full h-full flex-1 overflow-hidden"
                                        >
                                            <NavidromeMusicView
                                                onPlaySong={onPlayNavidromeSong || (() => { })}
                                                onOpenSettings={() => setShowHelpModal(true)}
                                                onMatchSong={onMatchNavidromeSong}
                                                theme={theme}
                                                isDaylight={isDaylight}
                                                focusedAlbumIndex={navidromeFocusedAlbumIndex}
                                                setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex}
                                                externalSelection={pendingNavidromeSelection ?? searchNavidromeSelection}
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

                    {/* Search Results Overlay */}
                    <AnimatePresence>
                        {searchResults !== null && (
                            <motion.div
                                initial={{ opacity: 0, y: 50 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: 50 }}

                                className={`fixed inset-0 z-50 ${isDaylight ? 'bg-white/95' : 'bg-black/90'} backdrop-blur-xl flex flex-col p-6 md:p-12 overflow-hidden`}
                                style={{ color: theme.primaryColor }}
                            >
                                <div className="flex items-center justify-between mb-8 max-w-4xl mx-auto w-full">
                                    <h2 className="text-2xl font-bold flex items-center gap-2">
                                        <Search size={24} />
                                        <span className="opacity-80">{t('home.resultsFor')}</span>
                                        <span className="italic">"{searchQuery}"</span>
                                    </h2>
                                    <button
                                        onClick={() => setSearchResults(null)}
                                        className="p-3 bg-white/10 rounded-full hover:bg-white/20 transition-colors"
                                    >
                                        <ArrowRight className="rotate-180" size={20} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto custom-scrollbar w-full">
                                    {isSearching ? (
                                        <div className="flex justify-center p-20"><Loader2 className="animate-spin w-10 h-10 opacity-50" /></div>
                                    ) : searchResults.length === 0 ? (
                                        <div className="text-center opacity-50 p-20 text-lg">{t('home.noResults')}</div>
                                    ) : (
                                        <div className="space-y-3 max-w-4xl mx-auto pb-20">
                                            {searchResults.map((track, i) => (
                                                <motion.div
                                                    initial={{ opacity: 0, y: 10 }}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    transition={{ delay: i * 0.03 }}
                                                    key={track.id}
                                                    onClick={() => {
                                                        const unifiedTrack = track as UnifiedSong;
                                                        if (unifiedTrack.isLocal && unifiedTrack.localData) {
                                                            onPlayLocalSong(unifiedTrack.localData);
                                                        } else if (unifiedTrack.isNavidrome && unifiedTrack.navidromeData) {
                                                            if (onPlayNavidromeSong) {
                                                                onPlayNavidromeSong(unifiedTrack as NavidromeSong);
                                                            }
                                                        } else {
                                                            onQueueAddAndPlay(track);
                                                        }
                                                        setSearchResults(null);
                                                    }}

                                                    className={`flex items-center gap-4 p-4 rounded-xl ${resultItemBg} cursor-pointer group transition-colors border border-transparent hover:border-white/10`}
                                                >
                                                    <div className="w-12 h-12 rounded-lg bg-zinc-800 overflow-hidden flex-shrink-0 shadow-lg relative">
                                                        <SearchResultCover track={track as UnifiedSong} />
                                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <Disc size={20} />
                                                        </div>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                                                            {formatSongName(track)}
                                                        </div>
                                                        <div className="text-xs opacity-50 truncate mt-0.5" style={{ color: 'var(--text-secondary)' }}>
                                                            {track.ar?.map((a, i) => (
                                                                <React.Fragment key={a.id}>
                                                                    {i > 0 && ", "}
                                                                    <span
                                                                        className="cursor-pointer hover:underline hover:opacity-100 transition-opacity"
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            const unifiedTrack = track as UnifiedSong;
                                                                            if (unifiedTrack.isLocal) {
                                                                                onSelectLocalArtist?.(a.name);
                                                                            } else if (unifiedTrack.isNavidrome && unifiedTrack.navidromeData) {
                                                                                openNavidromeArtist(unifiedTrack.navidromeData.artistId);
                                                                            } else {
                                                                                onSelectArtist(a.id);
                                                                            }
                                                                            setSearchResults(null);
                                                                        }}
                                                                    >
                                                                        {a.name}
                                                                    </span>
                                                                </React.Fragment>
                                                            ))} •
                                                            <span
                                                                className="cursor-pointer hover:opacity-100 hover:underline transition-all"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const unifiedTrack = track as UnifiedSong;
                                                                    if (unifiedTrack.isLocal) {
                                                                        const albumName = track.al?.name || track.album?.name;
                                                                        if (albumName) {
                                                                            onSelectLocalAlbum?.(albumName);
                                                                            setSearchResults(null);
                                                                        }
                                                                        return;
                                                                    }
                                                                    if (unifiedTrack.isNavidrome && unifiedTrack.navidromeData) {
                                                                        openNavidromeAlbum(unifiedTrack.navidromeData.albumId);
                                                                        setSearchResults(null);
                                                                        return;
                                                                    }
                                                                    const albumId = track.al?.id || track.album?.id;
                                                                    if (albumId) {
                                                                        onSelectAlbum(albumId);
                                                                        setSearchResults(null);
                                                                    }
                                                                }}
                                                            >
                                                                {track.al?.name || track.album?.name}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className="text-xs font-mono opacity-30">
                                                        {((track.dt || track.duration) / 60000).toFixed(2).replace('.', ':')}
                                                    </div>
                                                </motion.div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

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
                    {
                        showHelpModal && (
                            <HelpModal
                                onClose={() => setShowHelpModal(false)}
                                staticMode={staticMode}
                                onToggleStaticMode={onToggleStaticMode}
                                enableMediaCache={enableMediaCache}
                                onToggleMediaCache={onToggleMediaCache}
                                theme={theme}
                                backgroundOpacity={backgroundOpacity}
                                setBackgroundOpacity={setBackgroundOpacity}
                                onSetThemePreset={onSetThemePreset}
                                isDaylight={isDaylight}
                                onToggleNavidrome={handleToggleNavidrome}
                                visualizerMode={visualizerMode}
                                cadenzaTuning={cadenzaTuning}
                                onVisualizerModeChange={onVisualizerModeChange}
                                lyricsFontStyle={lyricsFontStyle}
                                lyricsFontScale={lyricsFontScale}
                                lyricsCustomFontFamily={lyricsCustomFontFamily}
                                lyricsCustomFontLabel={lyricsCustomFontLabel}
                                onLyricsFontStyleChange={onLyricsFontStyleChange}
                                onLyricsFontScaleChange={onLyricsFontScaleChange}
                                onLyricsCustomFontChange={onLyricsCustomFontChange}
                            />
                        )
                    }

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
                </motion.div >
            )
            }
        </AnimatePresence >
    );
};

export default Home;
