import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, User, Loader2, Settings, LayoutGrid, Disc, Map as MapIcon, ArrowLeft, Heart } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSearchNavigationStore } from '../stores/useSearchNavigationStore';
import { useSettingsUiStore } from '../stores/useSettingsUiStore';
import { useShallow } from 'zustand/react/shallow';
import { SongResult, NeteaseUser, NeteasePlaylist, LocalSong, LocalPlaylist, LocalLibraryGroup, Theme, PlayerState } from '../types';
import { neteaseApi, isSongMarkedUnavailable } from '../services/netease';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import LocalMusicView from './LocalMusicView';
import NavidromeMusicView from './navidrome/NavidromeMusicView';
import GridMap from './GridMap';
import { formatSongName } from '../utils/songNameFormatter';

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

const compactDescription = (description?: string, maxLength = 72) => {
    if (!description) return '';
    const normalized = description.replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.substring(0, maxLength)}...` : normalized;
};

export const Grid3D: React.FC<Grid3DProps> = (props) => {
    const {
        onBackToPlayer,
        user,
        playlists,
        cloudPlaylist = null,
        currentTrack,
        onSelectLocalAlbum,
        onSelectLocalArtist,
        localSongs,
        localPlaylists,
        onRefreshLocalSongs,
        onPlayLocalSong,
        onAddLocalSongToQueue,
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
        onSearchCommitted,
        theme,
        onOpenSettings,
        navidromeEnabled = false,
        onOpenGridView,
    } = props;

    const { t } = useTranslation();
    const isDaylight = useSettingsUiStore(state => state.isDaylight);
    const grid3dCardStyle = useSettingsUiStore(state => state.grid3dCardStyle);
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

    // UI Interaction states
    const [isSliding, setIsSliding] = useState(false);
    const slidingTimeoutRef = useRef<any>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const [focusedIndex, setFocusedIndex] = useState(0);

    // Reset focused index and scroll to start when switching tabs; also run initial card transforms
    useEffect(() => {
        setFocusedIndex(0);
        const container = scrollContainerRef.current;
        if (container) {
            container.scrollLeft = 0;
        }
        // Defer initial transform update to next frame so DOM has rendered
        requestAnimationFrame(() => updateCardTransforms());
    }, [homeViewTab]);

    const [showCollectionGrid, setShowCollectionGrid] = useState(false);

    // Netease details
    const [favoriteAlbums, setFavoriteAlbums] = useState<any[]>([]);
    const [loadingAlbums, setLoadingAlbums] = useState(false);
    const [radioItems, setRadioItems] = useState<any[]>([]);
    const [loadingRadio, setLoadingRadio] = useState(false);

    // Trigger sliding fade indicators
    const handleSliding = () => {
        setIsSliding(true);
        if (slidingTimeoutRef.current) clearTimeout(slidingTimeoutRef.current);
        slidingTimeoutRef.current = setTimeout(() => {
            setIsSliding(false);
        }, 300);
    };

    /**
     * Directly update every card's transform/opacity based on its pixel distance
     * from the viewport center. Called on every scroll frame for continuous (无极) scaling.
     */
    const updateCardTransforms = () => {
        const container = scrollContainerRef.current;
        if (!container) return;
        const flexWrapper = container.firstElementChild;
        if (!flexWrapper) return;

        const containerCenter = container.scrollLeft + container.clientWidth / 2;
        const maxDist = 600; // distance (px) at which cards reach minimum scale
        const isImage = grid3dCardStyle === 'image';
        const peakScale = isImage ? 1.25 : 1.2;
        const minScale = 0.5;
        const cards = flexWrapper.children;

        let closestIndex = 0;
        let minPixelDist = Infinity;

        for (let i = 0; i < cards.length; i++) {
            const el = cards[i] as HTMLElement;
            const cardCenter = el.offsetLeft + el.offsetWidth / 2;
            const pixelDist = Math.abs(cardCenter - containerCenter);
            const t = Math.min(pixelDist / maxDist, 1);

            const scale = peakScale - (peakScale - minScale) * t;
            const opacity = Math.max(0.15, 1.0 - 0.85 * t);
            const y = -6 * (1 - t);
            const z = Math.max(1, Math.round(10 - 9 * t));

            el.style.transform = `scale(${scale}) translateY(${y}px)`;
            el.style.opacity = String(opacity);
            el.style.zIndex = String(z);

            if (pixelDist < minPixelDist) {
                minPixelDist = pixelDist;
                closestIndex = i;
            }
        }

        return closestIndex;
    };

    /**
     * Handles scrolling by triggering visual fade timeouts, updating card transforms,
     * and calculating the card that is currently closest to the horizontal center.
     */
    const handleScroll = () => {
        handleSliding();

        const container = scrollContainerRef.current;
        if (!container) return;

        // Always update card transforms for continuous scaling
        const closestIndex = updateCardTransforms();

        // Skip updating focusedIndex if currently executing a programmatic smooth scroll
        if (isProgrammaticScrollRef.current) {
            if (programmaticTargetLeftRef.current !== null) {
                const diff = Math.abs(container.scrollLeft - programmaticTargetLeftRef.current);
                if (diff < 3) {
                    isProgrammaticScrollRef.current = false;
                    programmaticTargetLeftRef.current = null;
                    if (programmaticScrollTimeoutRef.current) {
                        clearTimeout(programmaticScrollTimeoutRef.current);
                        programmaticScrollTimeoutRef.current = null;
                    }
                }
            } else {
                isProgrammaticScrollRef.current = false;
            }
            return;
        }

        if (closestIndex !== undefined) {
            setFocusedIndex((prev) => {
                if (prev === closestIndex) return prev;
                return closestIndex;
            });
        }
    };

    // --- Momentum / inertia engine shared by drag and wheel ---
    const momentumVelocityRef = useRef(0);
    const momentumRafRef = useRef<number | null>(null);

    /** Stop any running momentum animation */
    const stopMomentum = () => {
        if (momentumRafRef.current !== null) {
            cancelAnimationFrame(momentumRafRef.current);
            momentumRafRef.current = null;
        }
        momentumVelocityRef.current = 0;
    };

    /** Kick off a decaying inertia loop from the current velocity */
    const startMomentum = () => {
        const container = scrollContainerRef.current;
        if (!container || Math.abs(momentumVelocityRef.current) < 0.5) return;

        let lastTime = performance.now();
        const FRICTION = 0.80;

        const tick = (now: number) => {
            const elapsed = now - lastTime;
            lastTime = now;
            // Scale friction to ~60 fps baseline so momentum feels consistent across refresh rates
            const frames = elapsed / 16.67;
            momentumVelocityRef.current *= Math.pow(FRICTION, frames);

            if (Math.abs(momentumVelocityRef.current) < 0.5) {
                momentumVelocityRef.current = 0;
                momentumRafRef.current = null;
                return;
            }

            container.scrollLeft += momentumVelocityRef.current;
            momentumRafRef.current = requestAnimationFrame(tick);
        };

        momentumRafRef.current = requestAnimationFrame(tick);
    };

    // Mouse drag-to-scroll with velocity tracking
    const isDraggingRef = useRef(false);
    const startXRef = useRef(0);
    const scrollLeftRef = useRef(0);
    const dragDistanceRef = useRef(0);
    const lastDragScrollRef = useRef(0);
    const lastDragTimeRef = useRef(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!scrollContainerRef.current) return;
        if (e.button !== 0) return; // Only left click
        stopMomentum();
        isDraggingRef.current = true;
        startXRef.current = e.pageX - scrollContainerRef.current.offsetLeft;
        scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
        dragDistanceRef.current = 0;
        lastDragScrollRef.current = scrollContainerRef.current.scrollLeft;
        lastDragTimeRef.current = performance.now();
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDraggingRef.current || !scrollContainerRef.current) return;
        e.preventDefault();
        const x = e.pageX - scrollContainerRef.current.offsetLeft;
        const walk = (x - startXRef.current) * 1.5;
        dragDistanceRef.current = Math.abs(walk);

        const prevScroll = scrollContainerRef.current.scrollLeft;
        scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
        const nowScroll = scrollContainerRef.current.scrollLeft;

        // Track velocity for momentum
        const now = performance.now();
        const dt = now - lastDragTimeRef.current;
        if (dt > 0) {
            momentumVelocityRef.current = (nowScroll - lastDragScrollRef.current) / dt * 16;
        }
        lastDragScrollRef.current = nowScroll;
        lastDragTimeRef.current = now;
        handleSliding();
    };

    const handleMouseUpOrLeave = () => {
        if (!isDraggingRef.current) return;
        isDraggingRef.current = false;
        startMomentum();
    };



    // Clean sliding, programmatic scroll timeouts, and momentum
    useEffect(() => {
        return () => {
            if (slidingTimeoutRef.current) clearTimeout(slidingTimeoutRef.current);
            if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
            stopMomentum();
        };
    }, []);

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

    const isProgrammaticScrollRef = useRef(false);
    const programmaticTargetLeftRef = useRef<number | null>(null);
    const programmaticScrollTimeoutRef = useRef<any>(null);
    const lastKeyboardNavTimeRef = useRef<number>(0);

    const focusedIndexRef = useRef(focusedIndex);
    useEffect(() => {
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    const currentDesktopItemsRef = useRef(currentDesktopItems);
    useEffect(() => {
        currentDesktopItemsRef.current = currentDesktopItems;
    }, [currentDesktopItems]);

    // Center programmatic scrolling on a specific index card
    const scrollToIndex = useCallback((idx: number) => {
        if (idx < 0 || idx >= currentDesktopItems.length) return;
        setFocusedIndex(idx);
        const container = scrollContainerRef.current;
        if (container) {
            const flexWrapper = container.firstElementChild;
            const cardElement = flexWrapper?.children[idx] as HTMLElement;
            if (cardElement) {
                const targetScrollLeft = cardElement.offsetLeft + cardElement.offsetWidth / 2 - container.clientWidth / 2;

                isProgrammaticScrollRef.current = true;
                programmaticTargetLeftRef.current = targetScrollLeft;
                if (programmaticScrollTimeoutRef.current) clearTimeout(programmaticScrollTimeoutRef.current);
                programmaticScrollTimeoutRef.current = setTimeout(() => {
                    isProgrammaticScrollRef.current = false;
                    programmaticTargetLeftRef.current = null;
                }, 600);

                container.scrollTo({
                    left: targetScrollLeft,
                    behavior: 'smooth'
                });
            }
        }
    }, [currentDesktopItems]);

    // Keyboard arrow key navigation to jump to adjacent cards
    useEffect(() => {
        if (!isNeteaseTab || showCollectionGrid) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLTextAreaElement ||
                (e.target instanceof HTMLElement && e.target.isContentEditable)
            ) {
                return;
            }

            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                const now = performance.now();
                if (now - lastKeyboardNavTimeRef.current < 200) return;
                lastKeyboardNavTimeRef.current = now;
                scrollToIndex(focusedIndex - 1);
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                const now = performance.now();
                if (now - lastKeyboardNavTimeRef.current < 200) return;
                lastKeyboardNavTimeRef.current = now;
                scrollToIndex(focusedIndex + 1);
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, scrollToIndex, isNeteaseTab, showCollectionGrid]);

    // Wheel-to-horizontal scroll with momentum — direct + inertia on stop
    const wheelIdleTimerRef = useRef<any>(null);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const handleWheelEvent = (e: WheelEvent) => {
            e.preventDefault();
            handleSliding();

            // Stop any existing momentum when user resumes scrolling
            if (momentumRafRef.current !== null) {
                cancelAnimationFrame(momentumRafRef.current);
                momentumRafRef.current = null;
            }

            // Map vertical to horizontal; apply directly
            const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
            const scaled = delta * 0.6;
            container.scrollLeft += scaled;

            // Track velocity for momentum after wheel stops
            momentumVelocityRef.current = scaled;

            // Debounce: start momentum when wheel events stop
            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
            wheelIdleTimerRef.current = setTimeout(() => {
                startMomentum();
            }, 80);
        };

        container.addEventListener('wheel', handleWheelEvent, { passive: false });
        return () => {
            container.removeEventListener('wheel', handleWheelEvent);
            if (wheelIdleTimerRef.current) clearTimeout(wheelIdleTimerRef.current);
        };
    }, [homeViewTab]);

    // Delegate GridView opening to the app-level host so Grid3D remains only the home surface.
    const handleSelectCollectionCard = (card: any) => {
        onOpenGridView?.(card.raw || card);
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

    // Desktop Polaroid Layout parameters
    const cardSpacing = 'px-6';

    return (
        <div className={`relative w-full h-full flex flex-col font-sans overflow-hidden ${mainBg} pointer-events-auto backdrop-blur-sm`}>

            {/* Main Header Container (Fades out when sliding/interacting) */}
            <div className={`transition-opacity duration-300 ease-in-out z-20 ${isSliding ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <div className="grid grid-cols-2 md:grid-cols-3 items-center w-full max-w-7xl mx-auto p-4 md:p-8 gap-y-4 md:gap-y-0">
                    {/* Left title and settings */}
                    <div className="flex items-center justify-start">
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
                    <div className="flex justify-center col-span-2 md:col-span-1">
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
                    <div className="flex justify-end">
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
                {isNeteaseTab ? (
                    <div className="w-full flex-1 flex flex-col justify-center relative min-h-0">

                        {/* Map Button (GridView Launcher) */}
                        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10">
                            <motion.button
                                whileHover={{ scale: 1.05 }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setShowCollectionGrid(true)}
                                className="px-4 py-2 rounded-full flex items-center gap-2 text-xs font-semibold shadow-lg backdrop-blur-md transition-all border border-white/10"
                                style={{
                                    backgroundColor: isDaylight ? 'rgba(255,255,255,0.7)' : 'rgba(25,25,25,0.7)',
                                    color: 'var(--text-primary)'
                                }}
                            >
                                <MapIcon size={14} />
                                <span>{t('home.allAlbums') || '全部'}</span>
                            </motion.button>
                        </div>

                        {/* Horizontal Polaroid Slider Container */}
                        <div
                            ref={scrollContainerRef}
                            onScroll={handleScroll}
                            onTouchStart={handleSliding}
                            onTouchMove={handleSliding}
                            onMouseDown={handleMouseDown}
                            onMouseMove={handleMouseMove}
                            onMouseUp={handleMouseUpOrLeave}
                            onMouseLeave={handleMouseUpOrLeave}
                            className="w-full flex items-center overflow-x-auto overflow-y-hidden py-16 custom-scrollbar cursor-grab active:cursor-grabbing"
                            style={{ scrollbarWidth: 'none' }}
                        >
                            <div className="flex px-[40vw] gap-12">
                                {currentDesktopItems.map((item, idx) => {

                                    const polaroidClass = isDaylight
                                        ? 'bg-[#faf9f6] text-zinc-900 border-zinc-200/50 shadow-lg'
                                        : 'bg-zinc-900 text-zinc-100 border-zinc-800/80 shadow-2xl';

                                    const isFocused = idx === focusedIndex;

                                    return (
                                        <div
                                            key={item.id}
                                            className="shrink-0 cursor-pointer pointer-events-auto select-none"
                                            onClick={() => {
                                                if (dragDistanceRef.current < 8) {
                                                    if (isFocused) {
                                                        handleSelectCollectionCard(item);
                                                    } else {
                                                        scrollToIndex(idx);
                                                    }
                                                }
                                            }}
                                        >
                                            {grid3dCardStyle === 'image' ? (
                                                /* Pure Image Cover Style */
                                                <div
                                                    className={`w-64 aspect-square rounded-2xl overflow-hidden shadow-2xl relative border border-white/10 ${isFocused ? 'ring-2 ring-white/30' : ''
                                                        }`}
                                                >
                                                    {item.coverUrl ? (
                                                        <img src={item.coverUrl} alt={item.name} className="w-full h-full object-cover pointer-events-none select-none" />
                                                    ) : (
                                                        <div className="w-full h-full bg-zinc-800/20 flex items-center justify-center">
                                                            <Disc size={64} className="opacity-20" />
                                                        </div>
                                                    )}
                                                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent opacity-0 hover:opacity-100 transition-opacity" />
                                                </div>
                                            ) : (
                                                /* Polaroid Card Style */
                                                <div
                                                    className={`w-64 rounded-xl border p-4 flex flex-col items-center ${polaroidClass}`}
                                                >
                                                    {/* Square Album Cover */}
                                                    <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-800/20 relative shadow-inner mb-4 flex items-center justify-center">
                                                        {item.coverUrl ? (
                                                            <img src={item.coverUrl} alt={item.name} className="w-full h-full object-cover pointer-events-none select-none" />
                                                        ) : (
                                                            <Disc size={64} className="opacity-20" />
                                                        )}
                                                    </div>

                                                    {/* Details White Border Label */}
                                                    <div className="w-full text-left pt-2 min-w-0">
                                                        <h3 className="font-bold text-sm truncate max-w-full tracking-tight">
                                                            {item.name}
                                                        </h3>
                                                        {((item.type !== 'playlist' && item.description) || !compactDescription(item.summary)) && (
                                                            <p className="text-xs opacity-50 truncate max-w-full mt-1 font-medium">
                                                                {item.type !== 'playlist' && item.description ? item.description : '\u00A0'}
                                                            </p>
                                                        )}
                                                        {compactDescription(item.summary) && (
                                                            <p className="text-[10px] leading-snug opacity-45 mt-2 line-clamp-2">
                                                                {compactDescription(item.summary)}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Title details at the bottom (above player progress bar) */}
                        {currentDesktopItems.length > 0 && currentDesktopItems[focusedIndex] && (
                            <motion.div
                                key={`${homeViewTab}-${currentDesktopItems[focusedIndex].id}`}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ duration: 0.3 }}
                                className={`relative shrink-0 text-center z-10 px-8 pointer-events-none ${currentTrack ? 'pt-6 md:pt-8 pb-0 -mb-4 md:-mb-6' : 'pt-5 md:pt-6 pb-4'
                                    }`}
                            >
                                <h3 className="font-bold text-2xl truncate max-w-xl mx-auto" style={{ color: 'var(--text-primary)' }}>
                                    {currentDesktopItems[focusedIndex].name}
                                </h3>
                                <p className="text-xs opacity-50 font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
                                    {currentDesktopItems[focusedIndex].trackCount !== undefined ? `${currentDesktopItems[focusedIndex].trackCount} ${t('playlist.tracks') || 'songs'}` : ''}
                                    {currentDesktopItems[focusedIndex].description
                                        ? ` • ${currentDesktopItems[focusedIndex].description}`
                                        : ''}
                                </p>
                            </motion.div>
                        )}

                    </div>
                ) : homeViewTab === 'local' ? (
                    <div className="w-full h-full flex-1">
                        <LocalMusicView
                            localSongs={localSongs}
                            localPlaylists={localPlaylists}
                            onRefresh={onRefreshLocalSongs}
                            onPlaySong={onPlayLocalSong}
                            onAddToQueue={onAddLocalSongToQueue}
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
                    </div>
                ) : (
                    <div className="w-full h-full flex-1">
                        <NavidromeMusicView
                            onPlaySong={onPlayNavidromeSong || (() => { })}
                            onAddSongsToQueue={onAddNavidromeSongsToQueue}
                            onOpenSettings={() => onOpenSettings?.('help')}
                            onMatchSong={onMatchNavidromeSong}
                            theme={theme}
                            isDaylight={isDaylight}
                            focusedAlbumIndex={navidromeFocusedAlbumIndex}
                            setFocusedAlbumIndex={setNavidromeFocusedAlbumIndex}
                            externalSelection={pendingNavidromeSelection}
                            hasFloatingPlayer={Boolean(currentTrack)}
                            onExternalSelectionHandled={onPendingNavidromeSelectionHandled}
                        />
                    </div>
                )}
            </div>

            {/* Collection Grid View (All Items GridMap) */}
            <AnimatePresence>
                {showCollectionGrid && (
                    <GridMap
                        title={
                            homeViewTab === 'playlist'
                                ? t('home.playlists')
                                : homeViewTab === 'albums'
                                    ? t('home.albums')
                                    : t('home.radio')
                        }
                        items={currentDesktopItems.map(item => ({
                            id: item.id,
                            name: item.name,
                            coverUrl: item.coverUrl,
                            description: item.description,
                            summary: item.summary,
                            rawCollection: item
                        }))}
                        onBack={() => setShowCollectionGrid(false)}
                        onSelectCollection={(col, idx) => {
                            setShowCollectionGrid(false);
                            setFocusedIndex(idx);

                            // Scroll the container smoothly to center the selected card
                            const container = scrollContainerRef.current;
                            if (container) {
                                const flexWrapper = container.firstElementChild;
                                const cardElement = flexWrapper?.children[idx] as HTMLElement;
                                if (cardElement) {
                                    const targetScrollLeft = cardElement.offsetLeft + cardElement.offsetWidth / 2 - container.clientWidth / 2;
                                    
                                    // Snap to target vicinity first to shorten transition distance, then scroll smoothly
                                    const currentScroll = container.scrollLeft;
                                    const distance = targetScrollLeft - currentScroll;
                                    const threshold = 600; // Snap if target is further than ~2 cards away

                                    if (Math.abs(distance) > threshold) {
                                        container.scrollLeft = targetScrollLeft - Math.sign(distance) * threshold;
                                    }

                                    container.scrollTo({
                                        left: targetScrollLeft,
                                        behavior: 'smooth'
                                    });
                                }
                            }
                        }}
                        theme={theme}
                        isDaylight={isDaylight}
                    />
                )}
            </AnimatePresence>

        </div>
    );
};

export default Grid3D;
