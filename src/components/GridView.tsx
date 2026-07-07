import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, animate, AnimatePresence, useDragControls } from 'framer-motion';
import { ChevronLeft, Disc, Play, Plus, Loader2, Heart, ListPlus, Pencil, Search, X, RefreshCw, Trash2, Star, List } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme } from '../types';
import { isSongMarkedUnavailable, getSongUnavailableTagText, neteaseApi } from '../services/netease';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { formatSongName } from '../utils/songNameFormatter';
import { getSizedCoverUrl } from '../utils/coverUrl';
import { colorWithAlpha } from './visualizer/colorMix';
import { saveToCache, getFromCache, removeFromCache } from '../services/db';
import { useFoliaHexViewport } from './folia-grid/useFoliaHexViewport';
import {
    applyHexCardFrameStyles,
    computeHexCardFrame,
    createHexCardFrameStyleCache,
    type HexCardFrameStyleCache,
} from './folia-grid/hexCardTransform';
import PlaylistSelectionDialog from './shared/PlaylistSelectionDialog';
import TextInputDialog from './shared/TextInputDialog';
import { SidePanelList, TrackListItem } from './shared/SidePanelList';

export interface GridViewSourceActions {
    local?: {
        onRefresh?: () => Promise<void> | void;
        onResyncFolder?: (collection: any) => Promise<void> | void;
        onResyncAllFolders?: () => Promise<void> | void;
        onDeleteFolder?: (collection: any) => Promise<void> | void;
        onRenamePlaylist?: (playlistId: string, name: string) => Promise<void> | void;
        onDeletePlaylist?: (playlistId: string) => Promise<void> | void;
        onRemovePlaylistSongs?: (playlistId: string, songIds: string[]) => Promise<void> | void;
    };
    navidrome?: {
        availablePlaylists?: Array<{ id: string | number; name: string; description?: string; }>;
        onAddToPlaylist?: (playlistId: string | number, songs: SongResult[]) => Promise<void> | void;
        onCreatePlaylist?: (name: string, songs: SongResult[]) => Promise<void> | void;
        onRenamePlaylist?: (playlistId: string, name: string) => Promise<void> | void;
        onDeletePlaylist?: (playlistId: string) => Promise<void> | void;
        onRemovePlaylistSongs?: (playlistId: string, songIndexes: number[]) => Promise<void> | void;
    };
}

interface GridItem {
    id: string | number;
    name: React.ReactNode;
    searchText?: string;
    coverUrl?: string;
    subtitle?: string;
    description?: string;
    rawTrack?: SongResult;
    rawTrackIndex?: number;
    rawCollection?: any;
}

interface GridViewProps {
    title: string;
    subtitle?: string;
    items?: GridItem[];
    mode: 'collection' | 'tracks';
    onBack: () => void;
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onSelectCollection?: (item: any) => void;
    onAddTrackToQueue?: (track: SongResult) => void;
    isLoading?: boolean;
    theme: Theme;
    isDaylight: boolean;

    // Optional self-contained collection props
    collection?: any;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    onSelectAlbum?: (albumId: number | string) => void;
    onSelectArtist?: (artistId: number | string) => void;
    currentUserId?: number | null;
    onPlaylistMutated?: () => Promise<void> | void;
    externalTracks?: SongResult[];
    externalTracksLoading?: boolean;
    sourceActions?: GridViewSourceActions;
}

type StoredGridViewNavigationState = {
    focusedIndex: number;
    focusedTrackId?: string | number;
    dragX: number;
    dragY: number;
    searchQuery: string;
};

const GRID_VIEW_NAVIGATION_PREFIX = 'folia_gridview_state';
const GRID_VIEW_LAST_INDEX_PREFIX = 'folia_gridview_last_index';
const GRID_VIEW_RENDER_BUFFER_FACTOR = 0.75;
const GRID_VIEW_CARD_VISIBILITY_BUFFER = 96;

/**
 * High-performance memoized Polaroid card — pure visual component.
 * All position/scale/opacity/zIndex/display transforms are managed
 * by a single centralized rAF loop in the parent GridView via wrapper refs.
 * Queue button opacity uses inherited CSS custom property --queue-opacity / --queue-pe.
 */
export const PolaroidCard = React.memo<{
    item: GridItem;
    isDaylight: boolean;
    theme: Theme;
    onSelect: () => void;
    onCenter: () => void;
    onAddQueue?: () => void;
    mode: 'collection' | 'tracks';
    t: any;
    cardWidth: number;
    cardHeight: number;
    isEditMode?: boolean;
    onRemoveTrack?: () => void;
    onSelectArtist?: (artistId: number | string) => void;
    onSelectAlbum?: (albumId: number | string) => void;
    onBeforeNestedNavigate?: () => void;
    openWhenFocusedOnCardClick?: boolean;
    isFocused?: boolean;
}>(
    ({
        item,
        isDaylight,
        theme,
        onSelect,
        onCenter,
        onAddQueue,
        mode,
        t,
        cardWidth,
        cardHeight,
        isEditMode = false,
        onRemoveTrack,
        onSelectArtist,
        onSelectAlbum,
        onBeforeNestedNavigate,
        openWhenFocusedOnCardClick = false,
        isFocused = false,
    }) => {
        const isUnavailable = mode === 'tracks' && item.rawTrack ? isSongMarkedUnavailable(item.rawTrack) : false;
        const unavailableTagText = (mode === 'tracks' && item.rawTrack)
            ? getSongUnavailableTagText(item.rawTrack, t('status.songUnavailableTag'))
            : '';

        const textLength = useMemo(() => {
            let len = 0;
            if (typeof item.name === 'string') {
                len += item.name.length;
            }
            if (item.subtitle) {
                len += item.subtitle.length;
            }
            if (item.description) {
                len += item.description.length;
            }
            if (mode === 'tracks' && item.rawTrack) {
                const albumName = item.rawTrack.al?.name || item.rawTrack.album?.name || '';
                len += albumName.length;
            }
            return len;
        }, [item.name, item.subtitle, item.description, item.rawTrack, mode]);

        const scaleFactor = useMemo(() => {
            if (textLength > 100) return 1.18;
            if (textLength > 65) return 1.12;
            if (textLength > 35) return 1.06;
            return 1.0;
        }, [textLength]);

        const dynamicWidth = cardWidth * scaleFactor;
        const dynamicHeight = cardHeight * scaleFactor;

        return (
            <div
                className="rounded-xl p-3 flex flex-col items-center border transition-shadow duration-300 shadow-lg hover:shadow-2xl theme-polaroid-card"
                style={{
                    width: dynamicWidth,
                    minHeight: dynamicHeight,
                    height: 'auto',
                }}
                onClick={(e) => {
                    if (isEditMode) {
                        e.stopPropagation();
                        return;
                    }
                    if (openWhenFocusedOnCardClick && isFocused) {
                        onSelect();
                        return;
                    }
                    onCenter();
                }}
            >
                {/* Square Polaroid Photo Area */}
                <div className="w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 relative shadow-inner flex items-center justify-center shrink-0">
                    {item.coverUrl ? (
                        <>
                            <img
                                src={item.coverUrl}
                                alt={typeof item.name === 'string' ? item.name : ''}
                                loading="lazy"
                                decoding="async"
                                ref={(el) => {
                                    if (el && el.complete) {
                                        el.style.opacity = isUnavailable ? '0.3' : '1';
                                        const placeholder = el.nextElementSibling as HTMLElement;
                                        if (placeholder) {
                                            placeholder.style.opacity = '0';
                                            placeholder.style.display = 'none';
                                        }
                                    }
                                }}
                                onLoad={(e) => {
                                    const img = e.currentTarget;
                                    img.style.opacity = isUnavailable ? '0.3' : '1';
                                    const placeholder = img.nextElementSibling as HTMLElement;
                                    if (placeholder) {
                                        placeholder.style.opacity = '0';
                                        setTimeout(() => {
                                            placeholder.style.display = 'none';
                                        }, 350);
                                    }
                                }}
                                className="w-full h-full object-cover transition-opacity duration-350 pointer-events-none select-none opacity-0"
                            />
                            <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 transition-opacity duration-350 flex items-center justify-center">
                                <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '3s', color: 'var(--text-primary)' }} />
                            </div>
                        </>
                    ) : (
                        <div className="absolute inset-0 bg-zinc-300/40 dark:bg-zinc-700/40 flex items-center justify-center">
                            <Disc size={48} className="opacity-20" style={{ color: 'var(--text-primary)' }} />
                        </div>
                    )}

                    {/* Unavailable Mask/Badge */}
                    {isUnavailable && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-2 text-center z-10">
                            <span className="text-[10px] bg-red-500/80 text-white font-bold px-2 py-1 rounded-full uppercase tracking-wider">
                                {unavailableTagText || t('status.songUnavailableTag').toUpperCase()}
                            </span>
                        </div>
                    )}

                    {/* Delete button overlay for Edit Mode */}
                    <AnimatePresence>
                        {isEditMode && onRemoveTrack && !isUnavailable && (
                            <motion.button
                                key="delete-btn"
                                initial={{ scale: 0, opacity: 0 }}
                                animate={{ scale: 1, opacity: 1 }}
                                exit={{ scale: 0, opacity: 0 }}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onRemoveTrack();
                                }}
                                className="absolute top-2 right-2 w-7 h-7 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg border border-white/20 z-[60] active:scale-90 transition-transform cursor-pointer"
                            >
                                <X size={14} className="stroke-[3]" />
                            </motion.button>
                        )}
                    </AnimatePresence>
                </div>

                {/* Bottom Polaroid Frame Label Details */}
                <div className="w-full flex-1 flex flex-col justify-between pt-3 text-left min-w-0">
                    <div className="space-y-1 mb-2">
                        {/* Title */}
                        <div className="text-s font-bold tracking-tight opacity-90 max-w-full line-clamp-4 whitespace-normal break-words">
                            {item.name}
                        </div>
                        {/* Clickable Artists */}
                        {item.description && (
                            <div className="text-[10px] opacity-55 max-w-full font-medium line-clamp-3 whitespace-normal break-words">
                                {mode === 'tracks' && onSelectArtist && item.rawTrack?.ar ? (
                                    <span className="flex gap-1 flex-wrap">
                                        {item.rawTrack.ar.map((artist, idx) => (
                                            <span
                                                key={`${artist.id ?? 'artist'}-${idx}-${artist.name}`}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (artist.id) {
                                                        onBeforeNestedNavigate?.();
                                                        onSelectArtist(artist.id);
                                                    }
                                                }}
                                                className="hover:underline hover:opacity-100 cursor-pointer text-current font-semibold"
                                            >
                                                {artist.name}{idx < item.rawTrack.ar.length - 1 ? ',' : ''}
                                            </span>
                                        ))}
                                    </span>
                                ) : (
                                    item.description
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-end justify-between mt-auto pt-1.5 w-full">
                        {/* Left: Clickable Album name & Duration */}
                        <div className="flex flex-col min-w-0 flex-1 pr-2">
                            {mode === 'tracks' && item.rawTrack && (
                                <>
                                    <span
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            const alId = item.rawTrack?.al?.id || item.rawTrack?.album?.id;
                                            if (alId && onSelectAlbum) {
                                                onBeforeNestedNavigate?.();
                                                onSelectAlbum(alId);
                                            }
                                        }}
                                        className="text-[9px] opacity-35 font-mono line-clamp-2 whitespace-normal break-words max-w-full hover:underline hover:opacity-85 cursor-pointer"
                                    >
                                        {item.rawTrack.al?.name || item.rawTrack.album?.name || ''}
                                    </span>
                                    <span className="text-[9px] opacity-35 font-mono">
                                        {(() => {
                                            const dt = item.rawTrack.dt || item.rawTrack.duration || 0;
                                            const min = Math.floor(dt / 60000);
                                            const sec = Math.floor((dt % 60000) / 1000);
                                            return `${min}:${sec < 10 ? '0' : ''}${sec}`;
                                        })()}
                                    </span>
                                </>
                            )}
                        </div>

                        {/* Right: Buttons in bottom right corner */}
                        <div className="flex items-center gap-1.5 shrink-0">
                            {mode === 'tracks' && !isEditMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onSelect();
                                    }}
                                    style={{
                                        opacity: 'var(--play-opacity, 0)',
                                        pointerEvents: 'var(--play-pe, none)' as any,
                                        transform: 'scale(var(--play-scale, 0.8))',
                                        transition: 'opacity 0.25s cubic-bezier(0.16, 1, 0.3, 1), transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), background-color 0.2s ease, color 0.2s ease',
                                    }}
                                    className="w-9 h-9 rounded-full bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 text-current flex items-center justify-center shadow-sm pointer-events-auto z-10"
                                    title={t('playlist.play')}
                                >
                                    <Play size={15} fill="currentColor" className="ml-0.5" />
                                </button>
                            )}
                            {mode === 'tracks' && onAddQueue && !isUnavailable && !isEditMode && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onAddQueue();
                                    }}
                                    style={{ opacity: 'var(--queue-opacity, 1)' as any, pointerEvents: 'var(--queue-pe, auto)' as any }}
                                    className="w-9 h-9 rounded-full bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 text-current flex items-center justify-center transition-colors shadow-sm pointer-events-auto"
                                    title={t('navidrome.addToQueue')}
                                >
                                    <Plus size={15} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    },
    (prev, next) => {
        return (
            prev.item.id === next.item.id &&
            prev.item.name === next.item.name &&
            prev.item.coverUrl === next.item.coverUrl &&
            prev.item.subtitle === next.item.subtitle &&
            prev.item.description === next.item.description &&
            prev.isDaylight === next.isDaylight &&
            prev.theme === next.theme &&
            prev.mode === next.mode &&
            prev.cardWidth === next.cardWidth &&
            prev.cardHeight === next.cardHeight &&
            prev.isEditMode === next.isEditMode &&
            prev.openWhenFocusedOnCardClick === next.openWhenFocusedOnCardClick &&
            prev.isFocused === next.isFocused
        );
    }
);
const getLowResCoverUrl = (url: string): string => getSizedCoverUrl(url, 150);

const toHttps = (url?: string): string => {
    if (!url) return '';
    if (
        url.startsWith('http:') &&
        !url.includes('/rest/') &&
        !url.includes('localhost') &&
        !url.includes('127.0.0.1') &&
        !url.includes('192.168.') &&
        !url.includes('10.') &&
        !url.includes('172.')
    ) {
        return url.replace('http:', 'https:');
    }
    return url;
};

const formatAlbumDate = (timestamp?: number) => {
    if (!timestamp || !Number.isFinite(timestamp)) return '';
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString();
};

const formatAlbumDuration = (duration?: number) => {
    if (!duration || !Number.isFinite(duration)) return '';
    const totalSeconds = duration > 10000 ? Math.round(duration / 1000) : Math.round(duration);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

export const GridView: React.FC<GridViewProps> = ({
    title,
    subtitle,
    items = [],
    mode,
    onBack,
    onSelectTrack,
    onSelectCollection,
    onAddTrackToQueue,
    isLoading = false,
    theme,
    isDaylight,
    collection,
    onPlayAll,
    onAddAllToQueue,
    onSelectAlbum,
    onSelectArtist,
    currentUserId,
    onPlaylistMutated,
    externalTracks,
    externalTracksLoading = false,
    sourceActions,
}) => {
    const { t } = useTranslation();
    const containerRef = useRef<HTMLDivElement>(null);
    const dragControls = useDragControls();
    const [focusedIndex, setFocusedIndex] = useState(0);
    const focusedIndexRef = useRef(0);
    const searchInputRef = useRef<HTMLInputElement | null>(null);
    const isComposingSearchRef = useRef(false);
    const pendingFocusCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDraggingRef = useRef(false);
    const pendingBackgroundTracksRef = useRef<SongResult[] | null>(null);
    const pendingBackgroundOffsetRef = useRef(0);
    const wheelTargetRef = useRef({ x: 0, y: 0 });
    const pendingRestoreStateRef = useRef<StoredGridViewNavigationState | null>(null);
    const hasRestoredNavigationRef = useRef(false);

    // Track responsive container size to scale grid card dimensions dynamically
    const [containerSize, setContainerSize] = useState(() => {
        if (typeof window === 'undefined') {
            return { width: 0, height: 0 };
        }
        return { width: window.innerWidth, height: window.innerHeight };
    });

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        const updateContainerSize = () => {
            const nextWidth = element.clientWidth;
            const nextHeight = element.clientHeight;

            setContainerSize((prev) => (
                prev.width === nextWidth && prev.height === nextHeight
                    ? prev
                    : { width: nextWidth, height: nextHeight }
            ));
        };

        updateContainerSize();

        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', updateContainerSize);
            return () => window.removeEventListener('resize', updateContainerSize);
        }

        const observer = new ResizeObserver(() => {
            updateContainerSize();
        });
        observer.observe(element);

        return () => observer.disconnect();
    }, []);

    // Layout values for different container size breakpoints
    const layoutConfig = useMemo(() => {
        const width = containerSize.width;
        if (width < 768) {
            // Mobile/Narrow
            return {
                cardWidth: 180,
                cardHeight: 280,
                spacingX: 205,
                spacingY: 270,
                maxDistance: 420,
                lodStart: 280,
                lodEnd: 320,
            };
        } else if (width < 1440) {
            // Desktop
            return {
                cardWidth: 220,
                cardHeight: 330,
                spacingX: 250,
                spacingY: 320,
                maxDistance: 500,
                lodStart: 340,
                lodEnd: 385,
            };
        } else if (width < 2000) {
            // Large Desktop
            return {
                cardWidth: 250,
                cardHeight: 375,
                spacingX: 285,
                spacingY: 365,
                maxDistance: 580,
                lodStart: 400,
                lodEnd: 450,
            };
        } else {
            // Ultra Desktop
            return {
                cardWidth: 280,
                cardHeight: 420,
                spacingX: 320,
                spacingY: 410,
                maxDistance: 660,
                lodStart: 450,
                lodEnd: 510,
            };
        }
    }, [containerSize.width]);

    // Dynamically calculate visible clipping radius centered on (0,0) viewport coordinates
    const clipRadius = useMemo(() => {
        const { width, height } = containerSize;
        const { cardWidth, cardHeight } = layoutConfig;
        const viewportRadius = Math.sqrt((width / 2) ** 2 + (height / 2) ** 2);
        const cardRadius = Math.sqrt(cardWidth ** 2 + cardHeight ** 2) / 2;
        return viewportRadius + cardRadius + 200; // 200px buffer to prevent visual pop-in during fast drags
    }, [containerSize, layoutConfig]);

    const renderRadius = useMemo(() => (
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * GRID_VIEW_RENDER_BUFFER_FACTOR
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    const cardFrameOptions = useMemo(() => ({
        clipRadius,
        maxDistance: layoutConfig.maxDistance,
        lodStart: layoutConfig.lodStart,
        lodEnd: layoutConfig.lodEnd,
        viewportWidth: containerSize.width,
        viewportHeight: containerSize.height,
        cardWidth: layoutConfig.cardWidth,
        cardHeight: layoutConfig.cardHeight,
        visibilityBuffer: GRID_VIEW_CARD_VISIBILITY_BUFFER,
    }), [
        clipRadius,
        containerSize.height,
        containerSize.width,
        layoutConfig.cardHeight,
        layoutConfig.cardWidth,
        layoutConfig.lodEnd,
        layoutConfig.lodStart,
        layoutConfig.maxDistance,
    ]);

    const navigationStorageKey = useMemo(() => {
        if (mode !== 'tracks' || !collection) return null;
        const collectionId = collection.id ?? collection.name ?? title;
        return `${GRID_VIEW_NAVIGATION_PREFIX}_${collectionId}`;
    }, [collection, mode, title]);

    const lastIndexStorageKey = useMemo(() => {
        if (mode !== 'tracks' || !collection) return null;
        const collectionId = collection.id ?? collection.name ?? title;
        return `${GRID_VIEW_LAST_INDEX_PREFIX}_${collectionId}`;
    }, [collection, mode, title]);

    // Self-loading track states for tracks mode
    const [tracks, setTracks] = useState<SongResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [loadedAlbumInfo, setLoadedAlbumInfo] = useState<any>(null);
    const [removedExternalTrackKeys, setRemovedExternalTrackKeys] = useState<Set<string>>(() => new Set());
    const baseDisplayTracks = externalTracks ?? tracks;
    const displayTracks = useMemo(() => (
        baseDisplayTracks.filter((track, index) => (
            !removedExternalTrackKeys.has(`${track.id}-${index}`) && !removedExternalTrackKeys.has(String(track.id))
        ))
    ), [baseDisplayTracks, removedExternalTrackKeys]);
    const usesExternalTracks = externalTracks !== undefined;
    const [isEditMode, setIsEditMode] = useState(false);
    const [editableTitle, setEditableTitle] = useState(title);
    const [isSourceActionPending, setIsSourceActionPending] = useState(false);
    const [playlistSubscribed, setPlaylistSubscribed] = useState<boolean | null>(null);
    const [isSubscribing, setIsSubscribing] = useState(false);
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = useState(false);
    const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    const [showSearchPanel, setShowSearchPanel] = useState(false);
    const [draftSearchQuery, setDraftSearchQuery] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);

    const collectionSource = collection?.source as string | undefined;
    const isLocalCollection = collectionSource === 'local';
    const isNavidromeCollection = collectionSource === 'navidrome';
    const isAlbumCollection = collection?.type === 'album';
    const neteaseAlbumInfo = collectionSource === 'netease' && isAlbumCollection
        ? (loadedAlbumInfo || collection?.raw || collection)
        : null;
    const isLocalFolderCollection = isLocalCollection && collection?.type === 'folder' && !collection?.isVirtual;
    const isLocalAllSongsCollection = isLocalCollection && collection?.type === 'folder' && Boolean(collection?.isVirtual);
    const isLocalPlaylistCollection = isLocalCollection && collection?.type === 'playlist' && Boolean(collection?.playlistId) && !collection?.isVirtual;
    const isNavidromePlaylistCollection = isNavidromeCollection && collection?.type === 'playlist' && Boolean(collection?.editable);
    const canAddNavidromeToPlaylist = isNavidromeCollection
        && collection?.type !== 'playlist'
        && Boolean(sourceActions?.navidrome?.onAddToPlaylist || sourceActions?.navidrome?.onCreatePlaylist);

    useEffect(() => {
        if (isDraggingRef.current || pendingFocusCommitTimeoutRef.current) return;
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    useEffect(() => {
        setEditableTitle(title);
        setIsEditMode(false);
        setRemovedExternalTrackKeys(new Set());
        setLoadedAlbumInfo(null);
    }, [collection?.id, title]);

    useEffect(() => {
        hasRestoredNavigationRef.current = false;
        pendingRestoreStateRef.current = null;

        if (!navigationStorageKey) return;

        const savedState = sessionStorage.getItem(navigationStorageKey);
        const savedIndex = lastIndexStorageKey ? sessionStorage.getItem(lastIndexStorageKey) : null;

        try {
            if (savedState) {
                const parsed = JSON.parse(savedState) as Partial<StoredGridViewNavigationState>;
                pendingRestoreStateRef.current = {
                    focusedIndex: Number.isFinite(parsed.focusedIndex) ? Number(parsed.focusedIndex) : 0,
                    focusedTrackId: parsed.focusedTrackId,
                    dragX: Number.isFinite(parsed.dragX) ? Number(parsed.dragX) : 0,
                    dragY: Number.isFinite(parsed.dragY) ? Number(parsed.dragY) : 0,
                    searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
                };
            } else if (savedIndex) {
                const parsedIndex = parseInt(savedIndex, 10);
                pendingRestoreStateRef.current = {
                    focusedIndex: Number.isFinite(parsedIndex) ? parsedIndex : 0,
                    dragX: Number.NaN,
                    dragY: Number.NaN,
                    searchQuery: '',
                };
            }

            const pendingSearchQuery = pendingRestoreStateRef.current?.searchQuery ?? '';
            if (pendingSearchQuery) {
                setShowSearchPanel(true);
                setDraftSearchQuery(pendingSearchQuery);
                setSearchQuery(pendingSearchQuery);
            }
        } catch {
            sessionStorage.removeItem(navigationStorageKey);
            if (lastIndexStorageKey) {
                sessionStorage.removeItem(lastIndexStorageKey);
            }
        }
    }, [lastIndexStorageKey, navigationStorageKey]);

    useEffect(() => {
        if (!showSearchPanel) return;
        const id = requestAnimationFrame(() => {
            searchInputRef.current?.focus();
            searchInputRef.current?.setSelectionRange(draftSearchQuery.length, draftSearchQuery.length);
        });
        return () => cancelAnimationFrame(id);
    }, [draftSearchQuery.length, showSearchPanel]);

    const playableTracks = useMemo(() => displayTracks.filter(track => !isSongMarkedUnavailable(track)), [displayTracks]);
    const handleSourceEditToggle = useCallback(async () => {
        if (!collection) return;

        if (!isEditMode) {
            setEditableTitle(collection.name || title);
            setIsEditMode(true);
            return;
        }

        const nextTitle = editableTitle.trim();
        setIsSourceActionPending(true);
        try {
            if (nextTitle && nextTitle !== collection.name) {
                if (isLocalPlaylistCollection && collection.playlistId) {
                    await sourceActions?.local?.onRenamePlaylist?.(collection.playlistId, nextTitle);
                } else if (isNavidromePlaylistCollection) {
                    await sourceActions?.navidrome?.onRenamePlaylist?.(String(collection.id), nextTitle);
                }
                collection.name = nextTitle;
            }
            setIsEditMode(false);
        } finally {
            setIsSourceActionPending(false);
        }
    }, [
        collection,
        editableTitle,
        isEditMode,
        isLocalPlaylistCollection,
        isNavidromePlaylistCollection,
        sourceActions,
        title,
    ]);

    const handleDeleteSourceCollection = useCallback(async () => {
        if (!collection) return;

        setIsSourceActionPending(true);
        try {
            if (isLocalFolderCollection) {
                await sourceActions?.local?.onDeleteFolder?.(collection);
            } else if (isLocalPlaylistCollection && collection.playlistId) {
                await sourceActions?.local?.onDeletePlaylist?.(collection.playlistId);
            } else if (isNavidromePlaylistCollection) {
                await sourceActions?.navidrome?.onDeletePlaylist?.(String(collection.id));
            }
            onBack();
        } finally {
            setIsSourceActionPending(false);
        }
    }, [
        collection,
        isLocalFolderCollection,
        isLocalPlaylistCollection,
        isNavidromePlaylistCollection,
        onBack,
        sourceActions,
    ]);

    const handleResyncLocalFolder = useCallback(async () => {
        if (!collection || !isLocalFolderCollection) return;

        setIsSourceActionPending(true);
        try {
            await sourceActions?.local?.onResyncFolder?.(collection);
        } finally {
            setIsSourceActionPending(false);
        }
    }, [collection, isLocalFolderCollection, sourceActions]);

    const handleResyncAllLocalFolders = useCallback(async () => {
        if (!isLocalAllSongsCollection) return;

        setIsSourceActionPending(true);
        try {
            await sourceActions?.local?.onResyncAllFolders?.();
        } finally {
            setIsSourceActionPending(false);
        }
    }, [isLocalAllSongsCollection, sourceActions]);

    const handleAddNavidromeCollectionToPlaylist = useCallback(async (playlistId: string | number) => {
        await sourceActions?.navidrome?.onAddToPlaylist?.(playlistId, playableTracks);
    }, [playableTracks, sourceActions]);

    const handleCreateNavidromePlaylist = useCallback(async (name: string) => {
        await sourceActions?.navidrome?.onCreatePlaylist?.(name, playableTracks);
        setIsCreatePlaylistOpen(false);
    }, [playableTracks, sourceActions]);

    const CACHE_SCHEMA_VERSION = 3;

    const isCloudDrive = collection ? (collection.specialType === 'cloud' || Number(collection.id) === -100) : false;
    const CACHE_KEY = collection ? (isCloudDrive
        ? `playlist_tracks_cloud_${currentUserId ?? 'anonymous'}`
        : `playlist_tracks_${collection.id}`) : '';

    const flushPendingBackgroundTracks = useCallback(() => {
        const pendingTracks = pendingBackgroundTracksRef.current;
        if (!pendingTracks) return;

        pendingBackgroundTracksRef.current = null;
        setTracks(pendingTracks);
        setOffset(pendingBackgroundOffsetRef.current);
    }, []);

    const loadTracks = async (reset = false) => {
        if (usesExternalTracks || !collection || collection.source !== 'netease' || loading || (!hasMore && !reset)) return;
        setLoading(true);

        try {
            const currentOffset = reset ? 0 : offset;
            const targetTime = collection.trackUpdateTime || collection.updateTime || 0;

            if (reset) {
                pendingBackgroundTracksRef.current = null;
                pendingBackgroundOffsetRef.current = 0;
                const cached = await getFromCache<{ tracks: SongResult[], snapshotTime: number; schemaVersion?: number; } | SongResult[]>(CACHE_KEY);

                let cachedTracks: SongResult[] = [];
                let cachedTime = 0;
                let cachedSchemaVersion = 0;

                if (Array.isArray(cached)) {
                    cachedTracks = cached;
                } else if (cached && cached.tracks) {
                    cachedTracks = cached.tracks;
                    cachedTime = cached.snapshotTime;
                    cachedSchemaVersion = cached.schemaVersion ?? 0;
                }

                if (cachedTracks.length > 0 && targetTime > 0 && cachedTime === targetTime && cachedSchemaVersion === CACHE_SCHEMA_VERSION) {
                    setTracks(cachedTracks);
                    setOffset(cachedTracks.length);
                    setLoading(false);
                    setHasMore(cachedTracks.length < (collection.trackCount || collection.size || 0));
                    return;
                }

                let responseTracks: SongResult[] = [];
                let hasMoreSync = false;

                if (collection.type === 'album') {
                    const res = await neteaseApi.getAlbum(Number(collection.id));
                    if (res.code === 200 && res.songs) {
                        setLoadedAlbumInfo(res.album);
                        responseTracks = res.songs.map((song: SongResult) => ({
                            ...song,
                            al: { id: res.album.id, name: res.album.name, picUrl: song.al?.picUrl || res.album.picUrl },
                            album: { id: res.album.id, name: res.album.name, picUrl: song.album?.picUrl || res.album.picUrl }
                        }));
                    }
                } else if (collection.type === 'radio' && collection.id === 'personal_fm') {
                    const fmRes = await neteaseApi.getPersonalFm();
                    if (fmRes.data) {
                        responseTracks = fmRes.data;
                    }
                } else {
                    const res = isCloudDrive
                        ? await neteaseApi.getUserCloud(150, 0)
                        : await neteaseApi.getPlaylistTracks(Number(collection.id), 150, 0);
                    responseTracks = res.songs || [];
                    hasMoreSync = isCloudDrive ? Boolean(res.hasMore) : responseTracks.length < (collection.trackCount || 0);
                }

                if (responseTracks.length > 0) {
                    setTracks(responseTracks);
                    setOffset(responseTracks.length);
                    setHasMore(hasMoreSync);

                    saveToCache(CACHE_KEY, { tracks: responseTracks, snapshotTime: targetTime, schemaVersion: CACHE_SCHEMA_VERSION });

                    if (hasMoreSync) {
                        fetchRemainingTracks(responseTracks, targetTime);
                    }
                } else {
                    setHasMore(false);
                    setTracks([]);
                }
            } else {
                // Manual Load More
                if (collection.type !== 'album' && collection.type !== 'radio') {
                    const res = isCloudDrive
                        ? await neteaseApi.getUserCloud(1000, currentOffset)
                        : await neteaseApi.getPlaylistTracks(Number(collection.id), 1000, currentOffset);
                    if (res.songs && res.songs.length > 0) {
                        setTracks(prev => {
                            const combined = [...prev, ...res.songs];
                            saveToCache(CACHE_KEY, { tracks: combined, snapshotTime: targetTime, schemaVersion: CACHE_SCHEMA_VERSION });
                            return combined;
                        });
                        setOffset(currentOffset + res.songs.length);
                        setHasMore(isCloudDrive ? Boolean(res.hasMore) : res.songs.length === 1000);
                    } else {
                        setHasMore(false);
                    }
                }
            }
        } catch (error) {
            console.error("GridView failed to load tracks:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchRemainingTracks = async (initialTracks: SongResult[], targetTime: number) => {
        let currentTracks = [...initialTracks];
        let currentOffset = initialTracks.length;
        let fetching = true;
        let safetyCount = 0;
        const MAX_LOOPS = 50;

        const totalTracks = collection.trackCount || collection.size || 0;

        while (fetching && currentTracks.length < totalTracks && safetyCount < MAX_LOOPS) {
            safetyCount++;
            try {
                await new Promise(r => setTimeout(r, 100));
                const res = isCloudDrive
                    ? await neteaseApi.getUserCloud(1000, currentOffset)
                    : await neteaseApi.getPlaylistTracks(Number(collection.id), 1000, currentOffset);
                if (res.songs && res.songs.length > 0) {
                    const newChunk = res.songs;
                    currentTracks = [...currentTracks, ...newChunk];
                    currentOffset += newChunk.length;
                    const nextTracks = [...currentTracks];
                    if (isDraggingRef.current) {
                        pendingBackgroundTracksRef.current = nextTracks;
                        pendingBackgroundOffsetRef.current = currentOffset;
                    } else {
                        setTracks(nextTracks);
                        setOffset(currentOffset);
                    }
                    saveToCache(CACHE_KEY, { tracks: currentTracks, snapshotTime: targetTime, schemaVersion: CACHE_SCHEMA_VERSION });

                    if ((isCloudDrive && !res.hasMore) || (!isCloudDrive && newChunk.length < 1000)) {
                        fetching = false;
                    }
                } else {
                    fetching = false;
                }
            } catch (e) {
                console.error("GridView background sync failed:", e);
                fetching = false;
            }
        }
        setHasMore(false);
    };

    useEffect(() => {
        if (mode === 'tracks' && collection && !usesExternalTracks && collection.source === 'netease') {
            loadTracks(true);
        }
    }, [collection?.id, mode, usesExternalTracks, collection?.source]);

    const canEditNeteasePlaylist = !usesExternalTracks && collection && collection.specialType !== 'cloud' && Boolean(currentUserId && collection.creator?.userId === currentUserId);
    const canEditPlaylist = Boolean(canEditNeteasePlaylist || isLocalPlaylistCollection || isNavidromePlaylistCollection);

    const isNeteasePlaylist = collectionSource === 'netease' && collection?.type === 'playlist' && !isCloudDrive;
    const isNeteaseAlbum = collectionSource === 'netease' && collection?.type === 'album' && !isCloudDrive;
    const showSubscribeButton = (isNeteasePlaylist && !canEditNeteasePlaylist) || isNeteaseAlbum;

    useEffect(() => {
        let active = true;

        const fetchCollectionDetail = async () => {
            if (isNeteasePlaylist) {
                try {
                    const res = await neteaseApi.getPlaylistDetailDynamic(Number(collection.id));
                    if (active && res.code === 200) {
                        setPlaylistSubscribed(res.subscribed);
                    }
                } catch (err) {
                    console.warn("[GridView] Failed to fetch playlist dynamic status:", err);
                }
            } else if (isNeteaseAlbum) {
                try {
                    const res = await neteaseApi.getAlbumDetailDynamic(Number(collection.id));
                    if (active && res.code === 200) {
                        setPlaylistSubscribed(res.isSub);
                    }
                } catch (err) {
                    console.warn("[GridView] Failed to fetch album dynamic status:", err);
                }
            } else {
                setPlaylistSubscribed(null);
            }
        };

        void fetchCollectionDetail();

        return () => {
            active = false;
        };
    }, [collection?.id, isNeteasePlaylist, isNeteaseAlbum]);

    const handleToggleSubscribe = async () => {
        if (!collection || isSubscribing) return;
        setIsSubscribing(true);
        try {
            const nextSubscribed = !playlistSubscribed;
            let res;
            if (isNeteasePlaylist) {
                res = await neteaseApi.subscribePlaylist(Number(collection.id), nextSubscribed);
            } else if (isNeteaseAlbum) {
                res = await neteaseApi.subscribeAlbum(Number(collection.id), nextSubscribed);
            }

            if (res && res.code === 200) {
                setPlaylistSubscribed(nextSubscribed);
                if (isNeteaseAlbum) {
                    window.dispatchEvent(new CustomEvent('folia-refresh-favorite-albums'));
                }
                if (onPlaylistMutated) {
                    void onPlaylistMutated();
                }
            } else {
                console.error("Failed to toggle collection subscription", res);
            }
        } catch (e) {
            console.error("Failed to toggle collection subscription", e);
        } finally {
            setIsSubscribing(false);
        }
    };

    const handleRemoveTrack = useCallback(async (track: SongResult, trackIndex: number) => {
        if (!collection) return;
        try {
            if (isLocalPlaylistCollection && collection.playlistId && sourceActions?.local?.onRemovePlaylistSongs) {
                const localSongId = (track as any).localData?.id || String(track.id);
                await sourceActions.local.onRemovePlaylistSongs(collection.playlistId, [localSongId]);
                setRemovedExternalTrackKeys(prev => new Set(prev).add(String(track.id)).add(`${track.id}-${trackIndex}`));
                await sourceActions.local.onRefresh?.();
                return;
            }

            if (isNavidromePlaylistCollection && sourceActions?.navidrome?.onRemovePlaylistSongs) {
                await sourceActions.navidrome.onRemovePlaylistSongs(String(collection.id), [trackIndex]);
                setRemovedExternalTrackKeys(prev => new Set(prev).add(`${track.id}-${trackIndex}`));
                return;
            }

            const trackId = Number(track.id);
            const isLiked = collection.isLiked || collection.name === '我喜欢的音乐' || collection.specialType === 'liked';
            if (isLiked) {
                await neteaseApi.likeSong(trackId, false);
            } else {
                await neteaseApi.updatePlaylistTracks('del', collection.id, [trackId]);
            }
            const nextTracks = tracks.filter(track => track.id !== trackId);
            setTracks(nextTracks);
            await saveToCache(CACHE_KEY, { tracks: nextTracks, snapshotTime: Date.now(), schemaVersion: CACHE_SCHEMA_VERSION });
            await removeFromCache(`playlist_detail_${collection.id}`);
            await onPlaylistMutated?.();
        } catch (error) {
            console.error('Failed to remove track in GridView', error);
        }
    }, [
        CACHE_KEY,
        collection,
        isLocalPlaylistCollection,
        isNavidromePlaylistCollection,
        onPlaylistMutated,
        sourceActions,
        tracks,
    ]);

    // Build the grid spiral coordinates mapping using responsive spacing
    const allGridItems = useMemo((): GridItem[] => {
        if (mode === 'collection') {
            return items || [];
        }
        return displayTracks.map((track, idx) => ({
            id: `${track.id}-${idx}`,
            name: formatSongName(track),
            searchText: [
                track.name,
                track.alia?.join(' '),
                track.tns?.join(' '),
            ].filter(Boolean).join(' '),
            coverUrl: track.al?.picUrl || track.album?.picUrl,
            subtitle: String(idx + 1).padStart(2, '0'),
            description: track.ar?.map(a => a.name).join(', '),
            rawTrack: track,
            rawTrackIndex: idx,
        }));
    }, [mode, items, displayTracks]);

    const gridItems = useMemo(() => {
        const query = deferredSearchQuery.trim().toLowerCase();
        if (!query) return allGridItems;

        return allGridItems.filter((item) => {
            const track = item.rawTrack;
            const searchableText = [
                item.searchText,
                typeof item.name === 'string' ? item.name : undefined,
                item.description,
                track?.al?.name,
                track?.album?.name,
                track?.ar?.map((artist) => artist.name).join(' '),
            ]
                .filter((value) => value !== undefined && value !== null)
                .join(' ')
                .toLowerCase();

            return searchableText.includes(query);
        });
    }, [allGridItems, deferredSearchQuery]);

    // Coordinate motion values mapping grid drags
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    const persistNavigationState = useCallback((index: number) => {
        if (!navigationStorageKey) return;

        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const focusedItem = gridItems[safeIndex];
        const state: StoredGridViewNavigationState = {
            focusedIndex: safeIndex,
            focusedTrackId: focusedItem?.rawTrack?.id,
            dragX: dragX.get(),
            dragY: dragY.get(),
            searchQuery,
        };

        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
        if (lastIndexStorageKey) {
            sessionStorage.setItem(lastIndexStorageKey, String(safeIndex));
        }
    }, [dragX, dragY, gridItems.length, lastIndexStorageKey, navigationStorageKey, searchQuery]);

    useEffect(() => {
        const syncWheelTarget = () => {
            wheelTargetRef.current = { x: dragX.get(), y: dragY.get() };
        };
        const unsubX = dragX.on('change', syncWheelTarget);
        const unsubY = dragY.on('change', syncWheelTarget);
        return () => {
            unsubX();
            unsubY();
        };
    }, [dragX, dragY]);

    const {
        coords: baseCoords,
        renderedIndexes,
        renderedIndexesRef,
        updateRenderedIndexesForViewport,
    } = useFoliaHexViewport({
        itemCount: gridItems.length,
        spacingX: layoutConfig.spacingX,
        spacingY: layoutConfig.spacingY,
        renderRadius,
        renderRing,
        fallbackIndexRef: focusedIndexRef,
    });

    const dragBounds = useMemo(() => {
        if (baseCoords.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        baseCoords.forEach((c) => {
            if (c.baseX < minX) minX = c.baseX;
            if (c.baseX > maxX) maxX = c.baseX;
            if (c.baseY < minY) minY = c.baseY;
            if (c.baseY > maxY) maxY = c.baseY;
        });

        const bufferX = Math.max(0, containerSize.width / 2 - 2 * layoutConfig.spacingX);
        const bufferY = Math.max(0, containerSize.height / 2 - 2 * layoutConfig.spacingY);

        return {
            left: -maxX - bufferX,
            right: -minX + bufferX,
            top: -maxY - bufferY,
            bottom: -minY + bufferY,
        };
    }, [baseCoords, layoutConfig, containerSize]);

    const commitFocusedIndex = useCallback((index = focusedIndexRef.current) => {
        if (pendingFocusCommitTimeoutRef.current) {
            clearTimeout(pendingFocusCommitTimeoutRef.current);
            pendingFocusCommitTimeoutRef.current = null;
        }

        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        focusedIndexRef.current = safeIndex;
        setFocusedIndex(prev => (prev === safeIndex ? prev : safeIndex));
    }, [gridItems.length]);

    const scheduleFocusedIndexCommit = useCallback((delayMs = 180) => {
        if (pendingFocusCommitTimeoutRef.current) {
            clearTimeout(pendingFocusCommitTimeoutRef.current);
        }

        pendingFocusCommitTimeoutRef.current = setTimeout(() => {
            pendingFocusCommitTimeoutRef.current = null;
            commitFocusedIndex();
        }, delayMs);
    }, [commitFocusedIndex]);

    // Keep the active focusedIndex centered when baseCoords changes on resize
    useEffect(() => {
        if (baseCoords.length > 0 && focusedIndex >= 0 && focusedIndex < baseCoords.length) {
            const targetX = -baseCoords[focusedIndex].baseX;
            const targetY = -baseCoords[focusedIndex].baseY;
            dragX.set(targetX);
            dragY.set(targetY);
            updateRenderedIndexesForViewport(targetX, targetY, true);
        }
    }, [baseCoords, updateRenderedIndexesForViewport]);

    // Recenter the viewport on target item coordinate offset
    const centerOnIndex = (index: number, snap = true) => {
        if (index < 0 || index >= baseCoords.length) return;
        const targetX = -baseCoords[index].baseX;
        const targetY = -baseCoords[index].baseY;

        commitFocusedIndex(index);
        updateRenderedIndexesForViewport(targetX, targetY, true);

        if (snap) {
            animate(dragX, targetX, { type: 'spring', stiffness: 220, damping: 28 });
            animate(dragY, targetY, { type: 'spring', stiffness: 220, damping: 28 });
        } else {
            dragX.set(targetX);
            dragY.set(targetY);
        }
    };

    useEffect(() => {
        if (hasRestoredNavigationRef.current) return;

        const pendingState = pendingRestoreStateRef.current;
        if (!pendingState || gridItems.length === 0 || baseCoords.length === 0) return;
        if (pendingState.searchQuery && deferredSearchQuery !== pendingState.searchQuery) return;

        const trackIndex = pendingState.focusedTrackId === undefined
            ? -1
            : gridItems.findIndex(item => String(item.rawTrack?.id) === String(pendingState.focusedTrackId));
        const restoredIndex = trackIndex >= 0
            ? trackIndex
            : Math.max(0, Math.min(pendingState.focusedIndex, gridItems.length - 1));
        const restoredCoord = baseCoords[restoredIndex];
        if (!restoredCoord) return;

        const restoredX = -restoredCoord.baseX;
        const restoredY = -restoredCoord.baseY;

        commitFocusedIndex(restoredIndex);
        dragX.set(restoredX);
        dragY.set(restoredY);
        wheelTargetRef.current = { x: restoredX, y: restoredY };
        updateRenderedIndexesForViewport(restoredX, restoredY, true);

        hasRestoredNavigationRef.current = true;
        pendingRestoreStateRef.current = null;
    }, [baseCoords, commitFocusedIndex, deferredSearchQuery, dragX, dragY, gridItems.length, updateRenderedIndexesForViewport]);

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (gridItems.length === 0 || event.ctrlKey) return;

        event.preventDefault();
        const deltaScale = (event.deltaMode === 1
            ? 32
            : event.deltaMode === 2
                ? Math.max(containerSize.height, 1)
                : 1) * 2.8;
        const horizontalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? event.deltaY
            : event.deltaX;
        const verticalDelta = event.shiftKey && Math.abs(event.deltaX) < 1
            ? 0
            : event.deltaY;

        const targetX = wheelTargetRef.current.x - horizontalDelta * deltaScale;
        const targetY = wheelTargetRef.current.y - verticalDelta * deltaScale;
        const clampedX = Math.max(dragBounds.left, Math.min(dragBounds.right, targetX));
        const clampedY = Math.max(dragBounds.top, Math.min(dragBounds.bottom, targetY));
        wheelTargetRef.current = { x: clampedX, y: clampedY };

        animate(dragX, clampedX, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        animate(dragY, clampedY, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        scheduleFocusedIndexCommit(240);
    }, [
        containerSize.height,
        dragX,
        dragY,
        gridItems.length,
        dragBounds,
        scheduleFocusedIndexCommit,
    ]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    // Center on the first item initially
    useEffect(() => {
        if (pendingRestoreStateRef.current && !hasRestoredNavigationRef.current) return;
        if (hasRestoredNavigationRef.current) return;
        if (gridItems.length > 0) {
            centerOnIndex(0, false);
        }
    }, [deferredSearchQuery, gridItems.length]);

    useEffect(() => {
        const handleSearchTyping = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) {
                return;
            }

            if (event.key === 'Escape' && showSearchPanel) {
                setShowSearchPanel(false);
                setDraftSearchQuery('');
                setSearchQuery('');
                return;
            }

            if (event.altKey || event.ctrlKey || event.metaKey) return;
            if (event.key === 'Process' || event.key === 'Unidentified') {
                setShowSearchPanel(true);
                return;
            }
            if (event.key.length !== 1) return;

            event.preventDefault();
            setShowSearchPanel(true);
            setDraftSearchQuery(event.key);
            setSearchQuery(event.key);
        };

        window.addEventListener('keydown', handleSearchTyping);
        return () => window.removeEventListener('keydown', handleSearchTyping);
    }, [showSearchPanel]);

    useEffect(() => {
        updateRenderedIndexesForViewport(dragX.get(), dragY.get(), true);
    }, [dragX, dragY, updateRenderedIndexesForViewport]);

    // Memoize only the nearby card set so React keeps heavy image/button trees out of the drag hot path
    const memoizedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = gridItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialFrame = computeHexCardFrame(coord, initialDx, initialDy, cardFrameOptions);

            return (
                <div
                    key={`${mode}-${idx}-${item.id}`}
                    ref={(el) => {
                        cardWrapperRefs.current[idx] = el;
                        cardFrameStyleCachesRef.current[idx] = el
                            ? createHexCardFrameStyleCache(initialFrame)
                            : undefined;
                    }}
                    className="absolute select-none pointer-events-auto folia-grid-card-frame"
                    style={{
                        transformOrigin: 'center center',
                        contain: 'layout style',
                        backfaceVisibility: 'hidden',
                        display: initialFrame.display || undefined,
                        transform: initialFrame.transform,
                        opacity: initialFrame.opacity,
                        zIndex: initialFrame.zIndex,
                        '--queue-opacity': initialFrame.queueOpacity,
                        '--queue-pe': initialFrame.queuePointerEvents,
                        '--play-opacity': initialFrame.playOpacity,
                        '--play-scale': initialFrame.playScale,
                        '--play-pe': initialFrame.playPointerEvents,
                    } as React.CSSProperties}
                >
                    <PolaroidCard
                        item={item}
                        isDaylight={isDaylight}
                        theme={theme}
                        mode={mode}
                        t={t}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        isEditMode={isEditMode}
                        onRemoveTrack={() => {
                            if (item.rawTrack) handleRemoveTrack(item.rawTrack, item.rawTrackIndex ?? idx);
                        }}
                        onSelectArtist={onSelectArtist}
                        onSelectAlbum={onSelectAlbum}
                        onBeforeNestedNavigate={() => {
                            persistNavigationState(idx);
                        }}
                        onSelect={() => {
                            if (mode === 'tracks' && onSelectTrack && item.rawTrack) {
                                persistNavigationState(idx);
                                onSelectTrack(item.rawTrack, displayTracks);
                            } else if (mode === 'collection' && onSelectCollection) {
                                onSelectCollection(item.rawCollection || item);
                            }
                        }}
                        onCenter={() => {
                            if (isDraggingRef.current) return;
                            centerOnIndex(idx, true);
                        }}
                        onAddQueue={() => {
                            if (mode === 'tracks' && onAddTrackToQueue && item.rawTrack) {
                                onAddTrackToQueue(item.rawTrack);
                            }
                        }}
                    />
                </div>
            );
        });
    }, [
        renderedIndexes,
        gridItems,
        baseCoords,
        isDaylight,
        theme,
        mode,
        t,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        cardFrameOptions,
        isEditMode,
        displayTracks,
        onSelectTrack,
        onSelectCollection,
        onSelectArtist,
        onSelectAlbum,
        onAddTrackToQueue,
        handleRemoveTrack,
        persistNavigationState
    ]);

    // Refs for direct DOM manipulation — eliminates per-card useTransform subscriptions
    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);
    const cardFrameStyleCachesRef = useRef<(HexCardFrameStyleCache | undefined)[]>([]);

    // Cleanup deferred focus state commits on unmount
    useEffect(() => {
        return () => {
            if (pendingFocusCommitTimeoutRef.current) {
                clearTimeout(pendingFocusCommitTimeoutRef.current);
            }
        };
    }, []);

    /**
     * Single centralized rAF loop: subscribes to dragX/dragY ONCE and only
     * updates the mounted viewport-near card set resolved from the hex grid.
     */
    useEffect(() => {
        let rafId: number | null = null;

        const update = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const dx = dragX.get();
                const dy = dragY.get();
                updateRenderedIndexesForViewport(dx, dy);

                let closestIdx = focusedIndexRef.current;
                let minDistSq = Infinity;
                const activeIndexes = renderedIndexesRef.current;

                for (let activeIndex = 0; activeIndex < activeIndexes.length; activeIndex++) {
                    const i = activeIndexes[activeIndex];
                    const coord = baseCoords[i];
                    if (!coord) continue;
                    const frame = computeHexCardFrame(coord, dx, dy, cardFrameOptions);

                    // Track closest card for focusedIndex
                    if (frame.distanceSq < minDistSq) {
                        minDistSq = frame.distanceSq;
                        closestIdx = i;
                    }

                    const el = cardWrapperRefs.current[i];
                    if (!el) continue;
                    const cache = cardFrameStyleCachesRef.current[i] ?? {};
                    cardFrameStyleCachesRef.current[i] = cache;
                    applyHexCardFrameStyles(el, frame, cache);
                }

                // Keep continuous focus out of React state during drag frames.
                focusedIndexRef.current = closestIdx;
            });
        };

        // Run once immediately to position all cards
        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, cardFrameOptions, updateRenderedIndexesForViewport]);

    // Setup arrow keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
                e.preventDefault();
                if (gridItems.length === 0) return;

                const curr = baseCoords[focusedIndex];
                let bestNextIdx = focusedIndex;
                let minDist = Infinity;

                baseCoords.forEach((coord, idx) => {
                    if (idx === focusedIndex) return;

                    const dx = coord.baseX - curr.baseX;
                    const dy = coord.baseY - curr.baseY;

                    let isMatch = false;
                    if (e.key === 'ArrowLeft' && dx < -50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowRight' && dx > 50 && Math.abs(dy) < 180) isMatch = true;
                    if (e.key === 'ArrowUp' && dy < -50 && Math.abs(dx) < 200) isMatch = true;
                    if (e.key === 'ArrowDown' && dy > 50 && Math.abs(dx) < 200) isMatch = true;

                    if (isMatch) {
                        const dist = dx * dx + dy * dy;
                        if (dist < minDist) {
                            minDist = dist;
                            bestNextIdx = idx;
                        }
                    }
                });

                if (bestNextIdx !== focusedIndex) {
                    centerOnIndex(bestNextIdx, true);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [focusedIndex, baseCoords, gridItems.length]);

    const showLoading = isLoading || externalTracksLoading || (mode === 'tracks' && loading && displayTracks.length === 0);
    const hasSearchQuery = deferredSearchQuery.trim().length > 0;

    const coverUrl = neteaseAlbumInfo?.picUrl || collection?.coverImgUrl || collection?.coverUrl || collection?.picUrl || '';
    const infoPanelCoverUrl = collection?.coverImgUrl || collection?.coverUrl || collection?.picUrl || neteaseAlbumInfo?.picUrl || '';

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex flex-col justify-between overflow-hidden select-none"
            style={{
                backgroundColor: 'var(--bg-color)',
                color: 'var(--text-primary)',
            }}
        >
            {coverUrl && (
                <div
                    className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
                    style={{ opacity: isDaylight ? 0.18 : 0.12 }}
                >
                    <img
                        src={toHttps(getLowResCoverUrl(coverUrl))}
                        alt=""
                        className="w-full h-full object-cover scale-110 filter blur-[30px]"
                    />
                </div>
            )}
            {/* Back Button */}
            <button
                onClick={() => {
                    if (navigationStorageKey) {
                        sessionStorage.removeItem(navigationStorageKey);
                    }
                    if (lastIndexStorageKey) {
                        sessionStorage.removeItem(lastIndexStorageKey);
                    }
                    onBack();
                }}
                className="absolute left-6 top-5 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 z-[70]"
                style={{
                    backgroundColor: isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <ChevronLeft size={20} />
            </button>

            {/* Center Clickable Area */}
            <div
                onClick={() => {
                    if (mode === 'tracks' && collection) {
                        setShowCutInPanel(!showCutInPanel);
                    }
                }}
                className="absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none cursor-pointer hover:scale-[1.01] active:scale-98 transition-all px-5 py-2 rounded-2xl backdrop-blur-md"
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <h2 className="text-lg font-bold tracking-tight flex items-center gap-1.5 justify-center">
                    {neteaseAlbumInfo?.name || title}
                    {mode === 'tracks' && collection && (
                        <span className="text-[9px] bg-zinc-500/20 text-current px-1.5 py-0.5 rounded-full font-normal opacity-60">
                            {t(showCutInPanel ? 'ui.close' : 'ui.info')}
                        </span>
                    )}
                </h2>
                {subtitle && <p className="text-xs opacity-50 mt-0.5">{subtitle}</p>}
            </div>

            {/* Honeycomb Drag/Viewport Canvas Area */}
            <div
                ref={containerRef}
                onPointerDown={(event) => {
                    if (event.button !== 0) return; // 仅限鼠标左键或主要指针拖动

                    const target = event.target as HTMLElement;
                    // 如果点击了按钮、输入框、链接或设置面板，则不触发拖动
                    if (
                        target.closest('button') ||
                        target.closest('input') ||
                        target.closest('a') ||
                        target.closest('textarea') ||
                        target.closest('.theme-glass-panel')
                    ) {
                        return;
                    }

                    // 向上遍历判断是否在卡片内部点击了具有 cursor-pointer 的非卡片元素（例如歌手、专辑链接）
                    let current: HTMLElement | null = target;
                    while (current && !current.classList.contains('theme-polaroid-card')) {
                        if (current.classList.contains('cursor-pointer')) {
                            return;
                        }
                        current = current.parentElement;
                    }

                    dragControls.start(event);
                }}
                className="w-full flex-1 relative flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
                style={{ touchAction: 'none' }}
            >
                <AnimatePresence>
                    {showSearchPanel && (
                        <motion.div
                            initial={{ opacity: 0, y: -12, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: -10, scale: 0.98 }}
                            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute top-24 left-1/2 z-[85] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 pointer-events-auto"
                        >
                            <div className="relative rounded-full border shadow-2xl backdrop-blur-2xl theme-glass-panel">
                                <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    value={draftSearchQuery}
                                    onChange={(event) => {
                                        const nextValue = event.target.value;
                                        setDraftSearchQuery(nextValue);
                                        if (!isComposingSearchRef.current) {
                                            setSearchQuery(nextValue);
                                        }
                                    }}
                                    onCompositionStart={() => {
                                        isComposingSearchRef.current = true;
                                    }}
                                    onCompositionEnd={(event) => {
                                        isComposingSearchRef.current = false;
                                        const nextValue = event.currentTarget.value;
                                        setDraftSearchQuery(nextValue);
                                        setSearchQuery(nextValue);
                                    }}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            setShowSearchPanel(false);
                                            setDraftSearchQuery('');
                                            setSearchQuery('');
                                        }
                                    }}
                                    placeholder={`${t('home.gridSearchPlaceholder')} (Esc)`}
                                    className="w-full rounded-full bg-transparent py-3 pl-11 pr-11 text-sm font-medium outline-none placeholder:text-current placeholder:opacity-40"
                                    style={{ color: 'var(--text-primary)' }}
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (draftSearchQuery) {
                                            setDraftSearchQuery('');
                                            setSearchQuery('');
                                            searchInputRef.current?.focus();
                                        } else {
                                            setShowSearchPanel(false);
                                        }
                                    }}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1.5 opacity-45 transition-opacity hover:opacity-90 cursor-pointer"
                                    aria-label={draftSearchQuery ? "Clear" : "Close"}
                                >
                                    <X size={15} />
                                </button>
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
                {showLoading ? (
                    <div className="flex flex-col items-center gap-4 opacity-50">
                        <Loader2 className="animate-spin" size={32} />
                        <span className="text-sm font-semibold font-sans">{t('playlist.loading')}</span>
                    </div>
                ) : gridItems.length === 0 ? (
                    <div className="opacity-40 text-sm font-sans">
                        {hasSearchQuery ? (t('home.gridSearchNoResults')) : (t('home.loadingLibrary'))}
                    </div>
                ) : (
                    <motion.div
                        drag
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={dragBounds}
                        dragElastic={0.05}
                        dragTransition={{ power: 0.16, timeConstant: 220 }}
                        onDragStart={() => {
                            if (pendingFocusCommitTimeoutRef.current) {
                                clearTimeout(pendingFocusCommitTimeoutRef.current);
                                pendingFocusCommitTimeoutRef.current = null;
                            }
                            isDraggingRef.current = true;
                        }}
                        onDragEnd={() => {
                            setTimeout(() => {
                                isDraggingRef.current = false;
                                flushPendingBackgroundTracks();
                                scheduleFocusedIndexCommit(140);
                            }, 50);
                        }}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        {memoizedCards}
                    </motion.div>
                )}

                {/* Cut-in Info Panel Overlay */}
                <AnimatePresence>
                    {showCutInPanel && mode === 'tracks' && collection && (
                        <motion.div
                            initial={{ opacity: 0, x: -60, scale: 0.95 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -60, scale: 0.95 }}
                            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute left-6 top-24 bottom-28 sm:bottom-6 w-80 rounded-3xl z-[80] overflow-y-auto hide-scrollbar flex flex-col p-6 shadow-2xl border backdrop-blur-2xl pointer-events-auto theme-glass-panel"
                            style={{
                                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                            }}
                        >
                            {/* Cover Image */}
                            <div className="w-full aspect-square rounded-2xl overflow-hidden shadow-lg mb-4 bg-zinc-800/20 relative shrink-0">
                                {infoPanelCoverUrl ? (
                                    <img src={toHttps(infoPanelCoverUrl)} alt={collection.name} className="w-full h-full object-cover select-none pointer-events-none" />
                                ) : (
                                    <Disc size={64} className="opacity-20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                )}
                                {showSubscribeButton && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void handleToggleSubscribe();
                                        }}
                                        disabled={isSubscribing}
                                        className="absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-90 z-10 border border-white/10 hover:scale-105 cursor-pointer backdrop-blur-md"
                                        style={{
                                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.5)',
                                        }}
                                        title={playlistSubscribed ? (isNeteaseAlbum ? t('options.unsubscribeAlbum') : t('options.unsubscribePlaylist')) : (isNeteaseAlbum ? t('options.subscribeAlbum') : t('options.subscribePlaylist'))}
                                    >
                                        {isSubscribing ? (
                                            <Loader2 size={18} className="animate-spin opacity-60" style={{ color: 'var(--text-primary)' }} />
                                        ) : (
                                            <Star
                                                size={18}
                                                className={playlistSubscribed ? "text-yellow-500 fill-yellow-500" : "opacity-60 hover:opacity-100"}
                                                style={{ color: playlistSubscribed ? undefined : 'var(--text-primary)' }}
                                            />
                                        )}
                                    </button>
                                )}
                            </div>

                            {/* Title & Creator */}
                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 space-y-4 text-left min-w-0">
                                <div>
                                    {(isLocalPlaylistCollection || isNavidromePlaylistCollection) && isEditMode ? (
                                        <input
                                            value={editableTitle}
                                            onChange={(event) => setEditableTitle(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    void handleSourceEditToggle();
                                                }
                                            }}
                                            className="w-full rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xl font-bold outline-none transition-colors focus:border-sky-400"
                                            style={{ color: 'var(--text-primary)' }}
                                            autoFocus
                                        />
                                    ) : (
                                        <h3 className="text-xl font-bold line-clamp-2 leading-snug">{collection.name}</h3>
                                    )}
                                    {collection.creator && (
                                        <div className="flex items-center gap-2 mt-2 text-xs opacity-60">
                                            <div className="w-5 h-5 rounded-full overflow-hidden">
                                                <img src={toHttps(collection.creator.avatarUrl)} alt="avatar" className="w-full h-full object-cover" />
                                            </div>
                                            <span className="font-semibold">{collection.creator.nickname}</span>
                                        </div>
                                    )}
                                    <div className="text-[10px] opacity-40 mt-1.5">
                                        {collection.trackCount !== undefined && <span>{collection.trackCount} {t('home.songs')}</span>}
                                        {collection.playCount !== undefined && <span> • {collection.playCount} {t('playlist.plays')}</span>}
                                    </div>
                                    {isAlbumCollection && (
                                        <div className="mt-3 space-y-1.5 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                            {neteaseAlbumInfo?.alias?.[0] && (
                                                <div className="font-medium opacity-80">{neteaseAlbumInfo.alias[0]}</div>
                                            )}
                                            {neteaseAlbumInfo?.artist && (
                                                <button
                                                    type="button"
                                                    onClick={() => onSelectArtist?.(neteaseAlbumInfo.artist.id)}
                                                    className="font-semibold hover:underline"
                                                >
                                                    {neteaseAlbumInfo.artist.name}
                                                </button>
                                            )}
                                            {!neteaseAlbumInfo?.artist && collection.albumArtist && (
                                                <div className="font-semibold">{collection.albumArtist}</div>
                                            )}
                                            {(formatAlbumDate(neteaseAlbumInfo?.publishTime || collection.albumPublishTime) || neteaseAlbumInfo?.company || collection.albumCompany) && (
                                                <div>
                                                    {[formatAlbumDate(neteaseAlbumInfo?.publishTime || collection.albumPublishTime), neteaseAlbumInfo?.company || collection.albumCompany]
                                                        .filter(Boolean)
                                                        .join(' • ')}
                                                </div>
                                            )}
                                            {isNavidromeCollection && (
                                                <div>
                                                    {[collection.albumYear, collection.albumGenre, formatAlbumDuration(collection.albumDuration)]
                                                        .filter(Boolean)
                                                        .join(' • ')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Description */}
                                {(neteaseAlbumInfo?.description || collection.description) && (
                                    <p className="text-xs opacity-65 leading-relaxed break-words whitespace-pre-wrap max-h-40 overflow-y-auto pr-1">
                                        {neteaseAlbumInfo?.description || collection.description}
                                    </p>
                                )}
                            </div>

                            {/* Buttons Area */}
                            <div
                                className="space-y-2 mt-4 pt-4 border-t shrink-0"
                                style={{ borderTopColor: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
                            >
                                <button
                                    onClick={() => {
                                        if (onPlayAll && playableTracks.length > 0) {
                                            onPlayAll(playableTracks);
                                        }
                                    }}
                                    disabled={playableTracks.length === 0}
                                    className="w-full py-3 rounded-full font-bold text-xs transition-transform hover:scale-102 active:scale-98 flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40 disabled:hover:scale-100 cursor-pointer"
                                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                                >
                                    <Play size={14} fill="currentColor" />
                                    {t('playlist.playAll')}
                                </button>
                                <button
                                    onClick={() => {
                                        if (onAddAllToQueue && playableTracks.length > 0) {
                                            onAddAllToQueue(playableTracks);
                                        }
                                    }}
                                    disabled={playableTracks.length === 0}
                                    className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                >
                                    <ListPlus size={14} />
                                    {t('navidrome.addToQueue')}
                                </button>
                                {canAddNavidromeToPlaylist && (
                                    <button
                                        onClick={() => setIsPlaylistPickerOpen(true)}
                                        disabled={playableTracks.length === 0 || isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        <Plus size={14} />
                                        {t('localMusic.addToPlaylist')}
                                    </button>
                                )}
                                {isLocalFolderCollection && sourceActions?.local?.onResyncFolder && (
                                    <button
                                        onClick={() => void handleResyncLocalFolder()}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {t('localMusic.reimport')}
                                    </button>
                                )}
                                {isLocalAllSongsCollection && sourceActions?.local?.onResyncAllFolders && (
                                    <button
                                        onClick={() => void handleResyncAllLocalFolders()}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {t('localMusic.reimport')}
                                    </button>
                                )}
                                {canEditPlaylist && (
                                    <button
                                        onClick={() => {
                                            if (canEditNeteasePlaylist) {
                                                setIsEditMode(prev => !prev);
                                                return;
                                            }
                                            void handleSourceEditToggle();
                                        }}
                                        disabled={isSourceActionPending}
                                        className={`w-full py-2.5 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${isEditMode ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'}`}
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                                        {isEditMode ? t('localMusic.finishEditing') : t('localMusic.editPlaylist')}
                                    </button>
                                )}
                                {(isLocalFolderCollection || isLocalPlaylistCollection || isNavidromePlaylistCollection) && (
                                    <button
                                        onClick={() => void handleDeleteSourceCollection()}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer bg-red-500/10 text-red-500 border border-red-500/25 hover:bg-red-500/20 disabled:opacity-40"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                                        {isLocalFolderCollection
                                            ? t('localMusic.delete')
                                            : t('localMusic.deletePlaylist')}
                                    </button>
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>
            <PlaylistSelectionDialog
                isOpen={isPlaylistPickerOpen}
                title={t('localMusic.addToPlaylist')}
                playlists={sourceActions?.navidrome?.availablePlaylists || []}
                onClose={() => setIsPlaylistPickerOpen(false)}
                onSelect={(playlistId) => {
                    void handleAddNavidromeCollectionToPlaylist(playlistId);
                    setIsPlaylistPickerOpen(false);
                }}
                onCreate={() => setIsCreatePlaylistOpen(true)}
                createLabel={t('localMusic.createPlaylist')}
                isDaylight={isDaylight}
            />
            <TextInputDialog
                isOpen={isCreatePlaylistOpen}
                title={t('localMusic.createPlaylist')}
                placeholder={t('localMusic.enterPlaylistName')}
                confirmLabel={t('localMusic.createPlaylist')}
                onClose={() => setIsCreatePlaylistOpen(false)}
                onConfirm={(name) => {
                    void handleCreateNavidromePlaylist(name);
                }}
                isDaylight={isDaylight}
            />

            {/* Bottom Right Floating Button */}
            {mode === 'tracks' && displayTracks.length > 0 && (
                <button
                    onClick={() => setShowSidePanel(true)}
                    className="fixed bottom-6 right-6 z-[80] w-12 h-12 rounded-full flex items-center justify-center shadow-2xl transition-transform hover:scale-105 active:scale-95 pointer-events-auto border"
                    style={{
                        backgroundColor: isDaylight ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.5)',
                        backdropFilter: 'blur(12px)',
                        borderColor: isDaylight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)',
                        color: 'var(--text-primary)'
                    }}
                    title={t('playlist.viewTracks')}
                >
                    <List size={22} />
                </button>
            )}

            {/* Tracks Cut-in Side Panel */}
            {mode === 'tracks' && (
                <SidePanelList
                    isOpen={showSidePanel}
                    onClose={() => setShowSidePanel(false)}
                    title={collection?.name || title}
                    items={displayTracks}
                    itemHeight={60}
                    isDaylight={isDaylight}
                    focusedIndex={focusedIndex}
                    renderItem={(track, index, style) => (
                        <TrackListItem
                            key={`${track.id}-${index}`}
                            track={track}
                            index={index}
                            style={style}
                            isUnavailable={isSongMarkedUnavailable(track)}
                            isActive={index === focusedIndex}
                            onPlay={() => {
                                onSelectTrack?.(track, playableTracks);
                            }}
                            onAddToQueue={onAddTrackToQueue ? () => {
                                onAddTrackToQueue(track);
                            } : undefined}
                        />
                    )}
                />
            )}
        </motion.div>
    );
};

export default GridView;
