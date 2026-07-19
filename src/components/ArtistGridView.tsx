import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, animate, AnimatePresence, useDragControls } from 'framer-motion';
import { ChevronLeft, Disc, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme } from '../types';
import { LocalSong } from '../types';
import { applyLocalSongCoverDisplay, buildLocalQueue } from '../services/playbackAdapters';
import { getNavidromeConfig, navidromeApi } from '../services/navidromeService';
import { omni } from '../services/onlineMusic/omni';
import { createCoverPlaceholder } from '../utils/coverPlaceholders';
import { getSizedCoverUrl } from '../utils/coverUrl';
import { getSongCoverUrl } from '../services/onlineMusic/songMetadata';
import { createSafeObjectUrl, getBlobObjectUrlSignature, isBlob } from '../utils/blobGuards';
import { PolaroidCard } from './GridView';
import { HexGridCoord, CubeCoord, getHexCubicSpiral } from './folia-grid/hexViewport';
import { useFoliaHexViewport } from './folia-grid/useFoliaHexViewport';
import { CollectionListItem, SidePanelList } from './shared/SidePanelList';
import { GridListSearchButton } from './shared/GridListSearchButton';
import { gridSearchPanelMotion } from './shared/gridSearchPanelMotion';
import { appendUniqueByKey, deriveProgressiveLoadingState } from './folia-grid/progressiveGrid';
import { useProgressiveItemEntrance } from './folia-grid/useProgressiveItemEntrance';
import { useLocalLibraryCatalog } from '../hooks/useLocalLibraryCatalog';
import { buildLocalLibraryIndex, followEntityRedirect } from '../utils/localLibraryIndex';
import { ArtistGridInfoCutInPanel } from './artist-grid/ArtistGridInfoCutInPanel';

/*
 * ArtistGridView.tsx
 *
 * This file implements the new Grid view style for the Artist profile.
 * It uses an infinite draggable and zoomable canvas representing the artist details.
 * Specifically, the artist avatar and editorial newspaper biography card are placed at custom central grid coordinates,
 * while popular tracks and albums are automatically distributed in the nearest and outer hexagonal cells.
 */

interface ArtistGridViewProps {
    collection: any; // GridViewCollectionDescriptor
    onBack: () => void;
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onAddTrackToQueue?: (track: SongResult) => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[]) => void;
    theme: Theme;
    isDaylight: boolean;
    localSongs?: LocalSong[];
    onEditEntity?: (entityId: string) => void;
}

interface GridItem {
    id: string | number;
    name: React.ReactNode;
    coverUrl?: string;
    subtitle?: string;
    description?: string;
    rawTrack?: SongResult;
    rawTrackIndex?: number;
    rawCollection?: any;
}

type LocalArtistCoverObjectUrlEntry = {
    signature: string;
    url: string;
};

type StoredArtistGridNavigationState = {
    focusedIndex: number;
    focusedAlbumId?: string | number;
    dragX: number;
    dragY: number;
    searchQuery: string;
};

const ARTIST_GRID_NAVIGATION_PREFIX = 'folia_artist_grid_state';

// Custom coordinate generator for Artist Grid
// Computes baseX/baseY for hexagons, reserving specific spots for Avatar and Bio.
// Popular songs are placed in the upper half (z <= -1) and albums are placed in the lower half (z >= 1).
export const buildArtistGridCoords = (
    songCount: number,
    albumCount: number,
    spacingX: number,
    spacingY: number
): HexGridCoord[] => {
    const coords: HexGridCoord[] = [];

    // Keep the avatar and biography visually grouped around the grid origin.
    coords.push({
        index: 0,
        cube: { x: -1, y: 1, z: 0 },
        baseX: -spacingX * 0.95,
        baseY: 0,
    });

    // Index 1: Biography Card
    coords.push({
        index: 1,
        cube: { x: 0, y: 0, z: 0 },
        baseX: spacingX * 0.65,
        baseY: 0,
    });

    // Generate candidates for the upper half (songs: z <= -1)
    const upperCandidates: { cube: CubeCoord; baseX: number; baseY: number; distSq: number; }[] = [];
    for (let z = -1; z >= -10; z--) {
        for (let x = -20; x <= 20; x++) {
            const y = -x - z;
            const baseX = x * spacingX + (z * spacingX) / 2;
            const baseY = z * spacingY;
            const distSq = baseX * baseX + baseY * baseY;
            upperCandidates.push({
                cube: { x, y, z },
                baseX,
                baseY,
                distSq,
            });
        }
    }
    // Sort upper candidates by distance to center to pack them tightly
    upperCandidates.sort((a, b) => a.distSq - b.distSq);

    // Assign upper candidates to popular songs (indices 2 .. 2 + songCount - 1)
    for (let i = 0; i < songCount; i++) {
        const candidate = upperCandidates[i];
        coords.push({
            index: 2 + i,
            cube: candidate.cube,
            baseX: candidate.baseX,
            baseY: candidate.baseY,
        });
    }

    // Generate candidates for the lower half (albums: z >= 1)
    const lowerCandidates: { cube: CubeCoord; baseX: number; baseY: number; distSq: number; }[] = [];
    const maxZ = Math.max(10, Math.floor(albumCount / 2) + 5);
    for (let z = 1; z <= maxZ; z++) {
        for (let x = -20; x <= 20; x++) {
            const y = -x - z;
            const baseX = x * spacingX + (z * spacingX) / 2;
            const baseY = z * spacingY;
            const distSq = baseX * baseX + baseY * baseY;
            lowerCandidates.push({
                cube: { x, y, z },
                baseX,
                baseY,
                distSq,
            });
        }
    }
    // Sort lower candidates by distance to center
    lowerCandidates.sort((a, b) => a.distSq - b.distSq);

    // Assign lower candidates to albums (indices starting after songs)
    const startIndex = 2 + songCount;
    for (let i = 0; i < albumCount; i++) {
        const candidate = lowerCandidates[i];
        coords.push({
            index: startIndex + i,
            cube: candidate.cube,
            baseX: candidate.baseX,
            baseY: candidate.baseY,
        });
    }

    return coords;
};

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

export const getArtistGridAlbumCoverUrl = (album: any): string | undefined => {
    const coverUrl = album?.coverUrl;
    return typeof coverUrl === 'string' && coverUrl ? toHttps(coverUrl) : undefined;
};

const ArtistGridView: React.FC<ArtistGridViewProps> = ({
    collection,
    onBack,
    onSelectTrack,
    onAddTrackToQueue,
    onSelectAlbum,
    onSelectArtist,
    theme,
    isDaylight,
    localSongs = [],
    onEditEntity,
}) => {
    const { t } = useTranslation();
    const localLibraryCatalog = useLocalLibraryCatalog(localSongs);
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const cardBg = isDaylight ? 'bg-white/60 border border-white/30' : 'bg-zinc-900/60 border border-white/10';

    // Viewport Size Observer
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 1024, height: 768 });
    const navigationStorageKey = useMemo(
        () => `${ARTIST_GRID_NAVIGATION_PREFIX}_${collection.source}_${collection.id}`,
        [collection.id, collection.source]
    );
    const pendingRestoreStateRef = useRef<StoredArtistGridNavigationState | null>(null);
    const hasRestoredNavigationRef = useRef(false);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const handleResize = (entries: ResizeObserverEntry[]) => {
            const entry = entries[0];
            if (entry) {
                setContainerSize({
                    width: Math.max(100, entry.contentRect.width),
                    height: Math.max(100, entry.contentRect.height),
                });
            }
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(el);
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
                avatarSize: 200,
                bioWidth: 360,
                bioHeight: 200,
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
                avatarSize: 280,
                bioWidth: 480,
                bioHeight: 260,
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
                avatarSize: 320,
                bioWidth: 540,
                bioHeight: 280,
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
                avatarSize: 360,
                bioWidth: 600,
                bioHeight: 300,
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
        clipRadius + Math.max(layoutConfig.spacingX, layoutConfig.spacingY) * 1.5
    ), [clipRadius, layoutConfig.spacingX, layoutConfig.spacingY]);

    const renderRing = useMemo(() => (
        Math.ceil(renderRadius / Math.min(layoutConfig.spacingX, layoutConfig.spacingY)) + 1
    ), [layoutConfig.spacingX, layoutConfig.spacingY, renderRadius]);

    // Load Data States
    const [artistInfo, setArtistInfo] = useState<any>(null);
    const [topSongs, setTopSongs] = useState<SongResult[]>([]);
    const [albums, setAlbums] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [backgroundLoading, setBackgroundLoading] = useState(false);
    const [backgroundLoadFailed, setBackgroundLoadFailed] = useState(false);
    const [showFullBio, setShowFullBio] = useState(false);
    const [showSearchPanel, setShowSearchPanel] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    const [draftSearchQuery, setDraftSearchQuery] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const isComposingSearchRef = useRef(false);
    const localCoverObjectUrlsRef = useRef<Map<string, LocalArtistCoverObjectUrlEntry>>(new Map());
    const loadGenerationRef = useRef(0);

    // Coordinate motion values mapping grid drags
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);
    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);
    const wheelTargetRef = useRef({ x: 0, y: 0 });
    const focusedIndexRef = useRef(0);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const lastUpdateRef = useRef(0);
    const pendingTimeoutRef = useRef<any>(null);

    useEffect(() => {
        hasRestoredNavigationRef.current = false;
        pendingRestoreStateRef.current = null;
        try {
            const saved = sessionStorage.getItem(navigationStorageKey);
            if (!saved) return;
            const parsed = JSON.parse(saved) as Partial<StoredArtistGridNavigationState>;
            pendingRestoreStateRef.current = {
                focusedIndex: Number.isFinite(parsed.focusedIndex) ? Number(parsed.focusedIndex) : 1,
                focusedAlbumId: parsed.focusedAlbumId,
                dragX: Number.isFinite(parsed.dragX) ? Number(parsed.dragX) : 0,
                dragY: Number.isFinite(parsed.dragY) ? Number(parsed.dragY) : 0,
                searchQuery: typeof parsed.searchQuery === 'string' ? parsed.searchQuery : '',
            };
            if (pendingRestoreStateRef.current.searchQuery) {
                setShowSearchPanel(true);
                setDraftSearchQuery(pendingRestoreStateRef.current.searchQuery);
                setSearchQuery(pendingRestoreStateRef.current.searchQuery);
            }
        } catch {
            sessionStorage.removeItem(navigationStorageKey);
        }
    }, [navigationStorageKey]);

    const clearLocalCoverObjectUrls = useCallback(() => {
        localCoverObjectUrlsRef.current.forEach(entry => URL.revokeObjectURL(entry.url));
        localCoverObjectUrlsRef.current.clear();
    }, []);

    const getOrCreateLocalCoverObjectUrl = useCallback((song: LocalSong) => {
        if (!isBlob(song.embeddedCover)) {
            return undefined;
        }

        const signature = getBlobObjectUrlSignature(song.embeddedCover, [
            song.id,
            song.fileSignature,
            song.fileSize,
            song.fileLastModified,
        ]);
        const cached = localCoverObjectUrlsRef.current.get(song.id);
        if (cached?.signature === signature) {
            return cached.url;
        }

        if (cached) {
            URL.revokeObjectURL(cached.url);
        }

        const url = createSafeObjectUrl(song.embeddedCover);
        if (!url) return null;
        localCoverObjectUrlsRef.current.set(song.id, { signature, url });
        return url;
    }, []);

    const resolveLocalSongCoverUrl = useCallback((song: LocalSong) => {
        const embeddedCoverUrl = getOrCreateLocalCoverObjectUrl(song);
        return song.useOnlineCover
            ? (song.onlineMetadata?.coverUrl || embeddedCoverUrl)
            : embeddedCoverUrl;
    }, [getOrCreateLocalCoverObjectUrl]);

    // Appends online provider album pages without replacing already rendered artist content.
    const loadOnlineAlbumPages = async (artistId: string | number, generation: number, startOffset = 0) => {
        setBackgroundLoading(true);
        setBackgroundLoadFailed(false);
        try {
            for (let offset = startOffset; offset < 10000; offset += 50) {
                const response = await omni.getArtistAlbums(collection, { limit: 50, offset });
                if (generation !== loadGenerationRef.current) return;
                const pageAlbums = response?.items || [];
                setAlbums(current => appendUniqueByKey(current, pageAlbums, album => String(album.id)));
                if (!response?.hasMore || pageAlbums.length === 0) break;
                await new Promise(resolve => setTimeout(resolve, 60));
            }
        } catch (error) {
            console.error('[ArtistGridView] Failed to progressively load albums', error);
            if (generation === loadGenerationRef.current) setBackgroundLoadFailed(true);
        } finally {
            if (generation === loadGenerationRef.current) setBackgroundLoading(false);
        }
    };

    // Fetch and sync artist details
    const loadArtistData = async () => {
        const generation = ++loadGenerationRef.current;
        setLoading(true);
        setBackgroundLoading(false);
        setBackgroundLoadFailed(false);
        setArtistInfo(null);
        setTopSongs([]);
        setAlbums([]);
        try {
            const artistId = collection.id;
            const source = collection.source;

            if (source === 'online') {
                const [detail, topSongsPage] = await Promise.all([
                    omni.getArtistDetail(collection),
                    omni.getArtistSongs(collection, { limit: 10, offset: 0 }),
                ]);
                if (generation !== loadGenerationRef.current) return;
                if (detail) {
                    setArtistInfo({
                        id: detail.id,
                        name: detail.name,
                        cover: detail.coverUrl,
                        description: detail.description,
                        trackCount: detail.trackCount,
                        albumCount: detail.albumCount,
                        aliases: detail.aliases,
                    });
                }
                if (topSongsPage?.items) {
                    setTopSongs(topSongsPage.items.slice(0, 10));
                }
                setLoading(false);
                await loadOnlineAlbumPages(artistId, generation);
            } else if (source === 'navidrome') {
                const config = getNavidromeConfig();
                if (config) {
                    const artistDetail = await navidromeApi.getArtist(config, String(artistId));
                    const albumsList = artistDetail?.album || [];

                    setArtistInfo({
                        name: artistDetail?.name || collection.name,
                        cover: albumsList[0]?.coverArt ? navidromeApi.getCoverArtUrl(config, albumsList[0].coverArt, 600) : undefined,
                        description: t('navidrome.artists') || 'Artists',
                        trackCount: 0,
                        albumCount: albumsList.length,
                    });

                    const mappedAlbums = albumsList.map(alb => ({
                        id: alb.id,
                        name: alb.name,
                        coverUrl: alb.coverArt ? navidromeApi.getCoverArtUrl(config, alb.coverArt, 600) : undefined,
                        publishedAt: alb.year ? new Date(alb.year, 0, 1).getTime() : undefined,
                    }));

                    // Load songs from first few albums to form the topSongs list
                    const albumsForSongs = albumsList.slice(0, 5);
                    const albumDetails = await Promise.all(albumsForSongs.map(alb => navidromeApi.getAlbum(config, alb.id)));
                    const subsonicSongs = albumDetails.flatMap(d => d?.song || []);
                    const naviSongs = subsonicSongs.map(song => navidromeApi.toNavidromeSong(config, song));
                    if (generation !== loadGenerationRef.current) return;
                    setTopSongs(naviSongs.slice(0, 10));
                    setAlbums(mappedAlbums);
                }
            } else if (source === 'local') {
                if (!localLibraryCatalog.ready) return;
                const catalogIndex = buildLocalLibraryIndex(
                    localLibraryCatalog.entities,
                    localLibraryCatalog.assignments,
                );
                const artistEntityId = followEntityRedirect(
                    String(collection.entityId || collection.id),
                    catalogIndex.entitiesById,
                );
                const artistEntity = artistEntityId ? catalogIndex.entitiesById.get(artistEntityId) : undefined;
                if (!artistEntity || artistEntity.kind !== 'artist') return;
                const artistName = artistEntity.displayName;
                const artistAssignments = localLibraryCatalog.assignments.filter(assignment => (
                    assignment.artistEntityIds.includes(artistEntity.id)
                ));
                const artistSongIds = new Set(artistAssignments.map(assignment => assignment.songId));
                const artistSongs = localSongs.filter(song => artistSongIds.has(song.id));

                const albumMap = new Map<string, { id: string, name: string, coverUrl?: string, publishedAt?: number; }>();
                artistSongs.forEach(song => {
                    const assignment = catalogIndex.assignmentsBySongId.get(song.id);
                    const albumEntityId = assignment?.albumEntityId
                        ? followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById)
                        : undefined;
                    const albumEntity = albumEntityId ? catalogIndex.entitiesById.get(albumEntityId) : undefined;
                    const albumKey = albumEntity?.id || '__unknown-album__';
                    const albumName = albumEntity?.displayName || t('localMusic.unknownAlbum');
                    const coverUrl = resolveLocalSongCoverUrl(song);
                    if (!albumMap.has(albumKey)) {
                        albumMap.set(albumKey, {
                            id: albumKey,
                            name: albumName,
                            coverUrl: coverUrl || undefined,
                            publishedAt: undefined,
                        });
                    } else if (coverUrl && !albumMap.get(albumKey)?.coverUrl) {
                        albumMap.get(albumKey)!.coverUrl = coverUrl;
                    }
                });

                const albumsList = Array.from(albumMap.values());
                const topLocalSongs = artistSongs.slice(0, 10);
                const formattedTopSongs = buildLocalQueue(
                    topLocalSongs,
                    undefined,
                    localLibraryCatalog,
                ).map((track, index) => {
                    const localSong = topLocalSongs[index];
                    const assignment = catalogIndex.assignmentsBySongId.get(localSong.id);
                    const albumEntityId = assignment?.albumEntityId
                        ? followEntityRedirect(assignment.albumEntityId, catalogIndex.entitiesById)
                        : undefined;
                    const albumKey = albumEntityId || '__unknown-album__';
                    const coverUrl = resolveLocalSongCoverUrl(localSong) || albumMap.get(albumKey)?.coverUrl;
                    return coverUrl ? applyLocalSongCoverDisplay(track, coverUrl) : track;
                }) as SongResult[];

                setArtistInfo({
                    name: artistName,
                    cover: albumsList[0]?.coverUrl || undefined,
                    description: t('artistGrid.localArtist', { artistName }),
                    trackCount: artistSongs.length,
                    albumCount: albumsList.length,
                });
                setTopSongs(formattedTopSongs);
                setAlbums(albumsList);
            }
        } catch (error) {
            console.error('[ArtistGridView] Failed to load artist grid data', error);
        } finally {
            if (generation === loadGenerationRef.current) setLoading(false);
        }
    };

    useEffect(() => {
        clearLocalCoverObjectUrls();
        void loadArtistData();
        return () => {
            loadGenerationRef.current++;
            clearLocalCoverObjectUrls();
        };
    }, [clearLocalCoverObjectUrls, collection.id, collection.source, localLibraryCatalog, resolveLocalSongCoverUrl]);

    useEffect(() => {
        if (!showSearchPanel) return;
        const frame = requestAnimationFrame(() => searchInputRef.current?.focus());
        return () => cancelAnimationFrame(frame);
    }, [showSearchPanel]);

    useEffect(() => {
        const handleSearchTyping = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) return;

            if (event.key === 'Escape') {
                event.preventDefault();
                if (showSearchPanel) {
                    setShowSearchPanel(false);
                    setDraftSearchQuery('');
                    setSearchQuery('');
                } else if (showSidePanel) {
                    setShowSidePanel(false);
                } else if (showCutInPanel) {
                    setShowCutInPanel(false);
                } else {
                    onBack();
                }
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
        };

        window.addEventListener('keydown', handleSearchTyping);
        return () => window.removeEventListener('keydown', handleSearchTyping);
    }, [onBack, showCutInPanel, showSearchPanel, showSidePanel]);

    const filteredAlbums = useMemo(() => {
        const query = deferredSearchQuery.trim().toLowerCase();
        if (!query) return albums;
        return albums.filter((album) => String(album.name || '').toLowerCase().includes(query));
    }, [albums, deferredSearchQuery]);

    const albumGridItems = useMemo<GridItem[]>(() => filteredAlbums.map((album) => {
        const coverUrl = getArtistGridAlbumCoverUrl(album);
        return {
            id: album.id,
            name: album.name,
            coverUrl,
            description: album.publishedAt ? new Date(album.publishedAt).getFullYear().toString() : '',
            rawCollection: {
                ...album,
                id: album.id,
                name: album.name,
                coverUrl,
                type: 'album',
                source: collection.source,
                providerId: album.providerId || collection.providerId,
            },
        };
    }), [collection.providerId, collection.source, filteredAlbums]);

    // Mapping items:
    // Index 0: Avatar
    // Index 1: Bio
    // Index 2..11: Songs
    // Index 12..: Albums
    const gridItems = useMemo<GridItem[]>(() => {
        if (!artistInfo) return [];

        const itemsList: GridItem[] = [];

        // 1. Avatar Item (No text info, pure image display)
        itemsList.push({
            id: '__artist_avatar__',
            name: '',
            coverUrl: artistInfo.cover,
        });

        // 2. Bio Card
        itemsList.push({
            id: '__artist_bio__',
            name: artistInfo.name,
            coverUrl: artistInfo.cover,
            description: artistInfo.description,
            subtitle: artistInfo.aliases?.[0] || '',
        });

        // 3. Popular Songs
        topSongs.forEach((song, idx) => {
            itemsList.push({
                id: song.id,
                name: song.name,
                coverUrl: getSongCoverUrl(song),
                subtitle: String(idx + 1),
                description: song.artists?.map(a => a.name).join('/') || '',
                rawTrack: song,
                rawTrackIndex: idx,
            });
        });

        // 4. Albums
        itemsList.push(...albumGridItems);

        return itemsList;
    }, [albumGridItems, artistInfo, topSongs]);
    const shouldAnimateItemEntrance = useProgressiveItemEntrance(
        `${String(collection.source)}:${String(collection.id)}`
    );

    // Spacing coordinates matching
    const baseCoords = useMemo(() => {
        return buildArtistGridCoords(topSongs.length, albumGridItems.length, layoutConfig.spacingX, layoutConfig.spacingY);
    }, [topSongs.length, albumGridItems.length, layoutConfig.spacingX, layoutConfig.spacingY]);

    const backgroundCoverUrl = getSongCoverUrl(topSongs[0]) || '';

    const {
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
        coords: baseCoords,
    });

    const dragBounds = useMemo(() => {
        if (baseCoords.length === 0) return { left: 0, right: 0, top: 0, bottom: 0 };

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        baseCoords.forEach((coord) => {
            minX = Math.min(minX, coord.baseX);
            maxX = Math.max(maxX, coord.baseX);
            minY = Math.min(minY, coord.baseY);
            maxY = Math.max(maxY, coord.baseY);
        });

        const bufferX = Math.max(0, containerSize.width / 2 - 2 * layoutConfig.spacingX);
        const bufferY = Math.max(0, containerSize.height / 2 - 2 * layoutConfig.spacingY);
        return {
            left: -maxX - bufferX,
            right: -minX + bufferX,
            top: -maxY - bufferY,
            bottom: -minY + bufferY,
        };
    }, [baseCoords, containerSize, layoutConfig.spacingX, layoutConfig.spacingY]);

    const persistNavigationState = useCallback((index: number) => {
        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const focusedItem = gridItems[safeIndex];
        const state: StoredArtistGridNavigationState = {
            focusedIndex: safeIndex,
            focusedAlbumId: focusedItem?.rawCollection?.id,
            dragX: dragX.get(),
            dragY: dragY.get(),
            searchQuery,
        };
        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
    }, [dragX, dragY, gridItems, navigationStorageKey, searchQuery]);

    const centerOnIndex = (index: number, snap = true) => {
        if (index < 0 || index >= baseCoords.length) return;
        const targetX = -baseCoords[index].baseX;
        const targetY = -baseCoords[index].baseY;

        if (pendingTimeoutRef.current) {
            clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
        setFocusedIndex(index);
        focusedIndexRef.current = index;
        lastUpdateRef.current = performance.now();
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
        if (gridItems.length > 0) {
            if (pendingRestoreStateRef.current && !hasRestoredNavigationRef.current) return;
            // Focus on Bio Card (Index 1) initially to give a balanced newspaper view
            centerOnIndex(1, false);
        }
    }, [gridItems.length]);

    useEffect(() => {
        if (hasRestoredNavigationRef.current) return;
        const pending = pendingRestoreStateRef.current;
        if (!pending || gridItems.length === 0 || baseCoords.length === 0) return;
        if (pending.searchQuery && deferredSearchQuery !== pending.searchQuery) return;

        const albumIndex = pending.focusedAlbumId === undefined
            ? -1
            : gridItems.findIndex((item) => String(item.rawCollection?.id) === String(pending.focusedAlbumId));
        const restoredIndex = albumIndex >= 0
            ? albumIndex
            : Math.max(0, Math.min(pending.focusedIndex, gridItems.length - 1));
        const restoredX = Number.isFinite(pending.dragX) ? pending.dragX : -baseCoords[restoredIndex].baseX;
        const restoredY = Number.isFinite(pending.dragY) ? pending.dragY : -baseCoords[restoredIndex].baseY;

        focusedIndexRef.current = restoredIndex;
        setFocusedIndex(restoredIndex);
        dragX.set(restoredX);
        dragY.set(restoredY);
        wheelTargetRef.current = { x: restoredX, y: restoredY };
        updateRenderedIndexesForViewport(restoredX, restoredY, true);
        hasRestoredNavigationRef.current = true;
        pendingRestoreStateRef.current = null;
    }, [baseCoords, deferredSearchQuery, dragX, dragY, gridItems, updateRenderedIndexesForViewport]);

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

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (gridItems.length === 0 || event.ctrlKey) return;

        event.preventDefault();
        const deltaScale = (event.deltaMode === 1
            ? 32
            : event.deltaMode === 2
                ? Math.max(containerSize.height, 1)
                : 1) * 2.8;

        const targetX = wheelTargetRef.current.x - event.deltaX * deltaScale;
        const targetY = wheelTargetRef.current.y - event.deltaY * deltaScale;
        const clampedX = Math.max(dragBounds.left, Math.min(dragBounds.right, targetX));
        const clampedY = Math.max(dragBounds.top, Math.min(dragBounds.bottom, targetY));
        wheelTargetRef.current = { x: clampedX, y: clampedY };

        animate(dragX, clampedX, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
        animate(dragY, clampedY, { type: 'spring', stiffness: 560, damping: 48, mass: 0.65 });
    }, [containerSize.height, dragX, dragY, gridItems.length, dragBounds]);

    useEffect(() => {
        const element = containerRef.current;
        if (!element) return;

        element.addEventListener('wheel', handleViewportWheel, { passive: false });
        return () => element.removeEventListener('wheel', handleViewportWheel);
    }, [handleViewportWheel]);

    // direct style manipulation using single centralized rAF loop
    const cardWrapperRefs = useRef<(HTMLDivElement | null)[]>([]);

    useEffect(() => {
        let rafId: number | null = null;

        const updateFocusedIndexThrottled = (newIndex: number) => {
            if (pendingTimeoutRef.current) {
                clearTimeout(pendingTimeoutRef.current);
                pendingTimeoutRef.current = null;
            }

            const now = performance.now();
            const timeSinceLast = now - lastUpdateRef.current;

            if (timeSinceLast >= 200) {
                setFocusedIndex(newIndex);
                focusedIndexRef.current = newIndex;
                lastUpdateRef.current = now;
            } else {
                const remaining = 200 - timeSinceLast;
                pendingTimeoutRef.current = setTimeout(() => {
                    setFocusedIndex(newIndex);
                    focusedIndexRef.current = newIndex;
                    lastUpdateRef.current = performance.now();
                }, remaining);
            }
        };

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
                    const cx = coord.baseX + dx;
                    const cy = coord.baseY + dy;
                    const distSq = cx * cx + cy * cy;

                    if (distSq < minDistSq) {
                        minDistSq = distSq;
                        closestIdx = i;
                    }

                    const el = cardWrapperRefs.current[i];
                    if (!el) continue;

                    const dist = Math.sqrt(distSq);

                    if (dist > clipRadius) {
                        el.style.display = 'none';
                        continue;
                    }

                    el.style.display = '';
                    const tVal = Math.min(dist / layoutConfig.maxDistance, 1);
                    const scale = 1.1 - 0.65 * tVal;
                    const opac = 1.0 - 0.60 * tVal;
                    const z = Math.round(50 - 49 * tVal);

                    el.style.transform = `translate(${coord.baseX}px, ${coord.baseY}px) scale(${scale})`;
                    el.style.opacity = String(opac);
                    el.style.zIndex = String(z);

                    if (dist > layoutConfig.lodEnd) {
                        el.style.setProperty('--queue-opacity', '0');
                        el.style.setProperty('--queue-pe', 'none');
                    } else if (dist < layoutConfig.lodStart) {
                        el.style.setProperty('--queue-opacity', '1');
                        el.style.setProperty('--queue-pe', 'auto');
                    } else {
                        const qt = (dist - layoutConfig.lodStart) / (layoutConfig.lodEnd - layoutConfig.lodStart);
                        el.style.setProperty('--queue-opacity', String(1 - qt));
                        el.style.setProperty('--queue-pe', 'auto');
                    }

                    if (dist < 40) {
                        const pt = dist / 40;
                        el.style.setProperty('--play-opacity', String(1 - pt));
                        el.style.setProperty('--play-scale', String(1 - 0.2 * pt));
                        el.style.setProperty('--play-pe', 'auto');
                    } else {
                        el.style.setProperty('--play-opacity', '0');
                        el.style.setProperty('--play-scale', '0.8');
                        el.style.setProperty('--play-pe', 'none');
                    }
                }

                updateFocusedIndexThrottled(closestIdx);
            });
        };

        update();

        const unsubX = dragX.on('change', update);
        const unsubY = dragY.on('change', update);
        return () => {
            unsubX();
            unsubY();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [dragX, dragY, baseCoords, layoutConfig, clipRadius, updateRenderedIndexesForViewport]);

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

    const renderedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = gridItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialCenterX = coord.baseX + initialDx;
            const initialCenterY = coord.baseY + initialDy;
            const initialDist = Math.sqrt(initialCenterX * initialCenterX + initialCenterY * initialCenterY);
            const initialT = Math.min(initialDist / layoutConfig.maxDistance, 1);
            const initialScale = 1.1 - 0.65 * initialT;
            const initialOpacity = 1.0 - 0.60 * initialT;
            const initialZ = Math.round(50 - 49 * initialT);

            // Index 0: Circular Avatar Card (No label details, pure image visual)
            if (idx === 0) {
                return (
                    <div
                        key={`avatar-${idx}`}
                        ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                        className="absolute select-none pointer-events-auto"
                        style={{
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            display: initialDist > clipRadius ? 'none' : undefined,
                            transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                            opacity: initialDist > clipRadius ? 0 : initialOpacity,
                            zIndex: initialZ,
                        }}
                    >
                        <div
                            className="rounded-full overflow-hidden shadow-2xl border-4 border-white/10 relative flex items-center justify-center shrink-0"
                            style={{
                                width: layoutConfig.avatarSize || 240,
                                height: layoutConfig.avatarSize || 240,
                                backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                            }}
                        >
                            {item.coverUrl ? (
                                <img src={item.coverUrl} alt="avatar" draggable={false} className="w-full h-full object-cover select-none" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center bg-white/5">
                                    <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '4s' }} />
                                </div>
                            )}
                        </div>
                    </div>
                );
            }

            // Index 1: Editorial Newspaper Biography Card
            if (idx === 1) {
                const totalTracksText = artistInfo?.trackCount ? `${artistInfo.trackCount} ${t('home.songs') || 'songs'}` : '';
                const totalAlbumsText = artistInfo?.albumCount ? `${artistInfo.albumCount} ${t('home.albums') || 'albums'}` : '';
                const statsLine = [totalTracksText, totalAlbumsText].filter(Boolean).join(' • ');

                return (
                    <div
                        key={`bio-${idx}`}
                        ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                        className="absolute select-none pointer-events-auto"
                        style={{
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            display: initialDist > clipRadius ? 'none' : undefined,
                            transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                            opacity: initialDist > clipRadius ? 0 : initialOpacity,
                            zIndex: initialZ + 5,
                        }}
                    >
                        <div
                            onClick={() => {
                                if (isDraggingRef.current) return;
                                if (focusedIndex !== 1) {
                                    centerOnIndex(1, true);
                                } else {
                                    setShowFullBio(true);
                                }
                            }}
                            className={`rounded-3xl p-6 flex flex-col justify-between shadow-2xl backdrop-blur-xl transition-shadow cursor-pointer select-none text-left ${cardBg}`}
                            style={{
                                width: layoutConfig.bioWidth || 460,
                                height: layoutConfig.bioHeight || 250,
                            }}
                        >
                            <div className="space-y-2 min-w-0">
                                <h1 className="text-3xl font-extrabold tracking-tight truncate" style={{ color: 'var(--text-primary)' }}>
                                    {item.name}
                                </h1>
                                {item.subtitle && (
                                    <p className="text-xs opacity-50 font-medium truncate">
                                        {item.subtitle}
                                    </p>
                                )}
                                <div className="w-12 h-0.5 bg-sky-400 opacity-60 rounded-full mt-1"></div>
                            </div>

                            <div className="flex-1 overflow-hidden mt-3 mb-2">
                                <p className="text-xs opacity-65 leading-relaxed break-words whitespace-pre-wrap">
                                    {item.description || t('options.noDescription')}
                                </p>
                            </div>

                            <div className="flex items-center border-t border-white/5 pt-3 mt-1 shrink-0">
                                <div className="text-[10px] opacity-40 font-semibold">{statsLine}</div>
                            </div>
                        </div>
                    </div>
                );
            }

            // Index 2..: Song & Album Polaroid cards
            const isSongCard = !!item.rawTrack;
            const cardMode = isSongCard ? 'tracks' : 'collection';
            const animateEntrance = shouldAnimateItemEntrance(String(item.id));

            return (
                <div
                    key={`${cardMode}-${idx}-${item.id}`}
                    ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                    className="absolute select-none pointer-events-auto"
                    style={{
                        transformOrigin: 'center center',
                        willChange: 'transform, opacity',
                        display: initialDist > clipRadius ? 'none' : undefined,
                        transform: `translate(${coord.baseX}px, ${coord.baseY}px) scale(${initialScale})`,
                        opacity: initialDist > clipRadius ? 0 : initialOpacity,
                        zIndex: initialZ,
                    }}
                >
                    <motion.div
                        initial={animateEntrance ? { opacity: 0, scale: 0.96 } : false}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                    <PolaroidCard
                        item={item}
                        isDaylight={isDaylight}
                        theme={theme}
                        mode={cardMode}
                        t={t}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        openWhenFocusedOnCardClick={!isSongCard}
                        isFocused={focusedIndex === idx}
                        onSelect={() => {
                            if (isSongCard && onSelectTrack && item.rawTrack) {
                                onSelectTrack(item.rawTrack, topSongs);
                            } else if (!isSongCard && onSelectAlbum && item.rawCollection) {
                                persistNavigationState(idx);
                                onSelectAlbum(item.rawCollection.id, item.rawCollection);
                            }
                        }}
                        onCenter={() => {
                            if (isDraggingRef.current) return;
                            centerOnIndex(idx, true);
                        }}
                        onSelectArtist={onSelectArtist}
                        onSelectAlbum={onSelectAlbum}
                        onAddQueue={() => {
                            if (isSongCard && onAddTrackToQueue && item.rawTrack) {
                                onAddTrackToQueue(item.rawTrack);
                            }
                        }}
                    />
                    </motion.div>
                </div>
            );
        });
    }, [
        renderedIndexes,
        gridItems,
        baseCoords,
        isDaylight,
        theme,
        t,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        layoutConfig.maxDistance,
        clipRadius,
        focusedIndex,
        artistInfo,
        topSongs,
        onSelectTrack,
        onSelectAlbum,
        onSelectArtist,
        onAddTrackToQueue,
        persistNavigationState,
        shouldAnimateItemEntrance,
    ]);

    const progressiveLoading = deriveProgressiveLoadingState(
        gridItems.length,
        loading,
        backgroundLoading
    );

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col font-sans select-none overflow-hidden"
            style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-color)' }}
        >
            {backgroundCoverUrl && (
                <div
                    className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
                    style={{ opacity: isDaylight ? 0.18 : 0.12 }}
                >
                    <img
                        src={toHttps(getLowResCoverUrl(backgroundCoverUrl))}
                        alt=""
                        className="w-full h-full object-cover scale-110 filter blur-[30px]"
                    />
                </div>
            )}

            {/* Header Area */}
            <div className="absolute top-0 left-0 p-6 z-30 flex items-center gap-4">
                <button
                    onClick={() => {
                        sessionStorage.removeItem(navigationStorageKey);
                        onBack();
                    }}
                    className={`w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md cursor-pointer`}
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </button>
            </div>

            {/* Title display inside viewport header */}
            <div
                onClick={() => {
                    setShowSearchPanel(false);
                    setShowSidePanel(false);
                    setShowCutInPanel(current => !current);
                }}
                className="absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none cursor-pointer hover:scale-[1.01] active:scale-98 transition-all px-5 py-2 rounded-2xl backdrop-blur-md"
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <button
                    type="button"
                    className="text-lg font-bold tracking-tight cursor-pointer"
                    aria-expanded={showCutInPanel}
                >
                    {artistInfo?.name || collection.name}
                </button>
                <p className="text-xs opacity-50 mt-0.5">{t('navidrome.artists') || 'Artists'}</p>
            </div>

            <ArtistGridInfoCutInPanel
                isOpen={showCutInPanel}
                artistName={artistInfo?.name || collection.name}
                coverUrl={artistInfo?.cover}
                description={artistInfo?.description}
                trackCount={artistInfo?.trackCount}
                albumCount={artistInfo?.albumCount}
                entityId={collection.source === 'local' ? collection.entityId : undefined}
                onClose={() => setShowCutInPanel(false)}
                onEditEntity={onEditEntity ? (entityId) => {
                    setShowCutInPanel(false);
                    onEditEntity(entityId);
                } : undefined}
            />

            <AnimatePresence>
                {showSearchPanel && (
                    <motion.div
                        {...gridSearchPanelMotion}
                        className="absolute top-24 left-1/2 z-[85] w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 pointer-events-auto"
                    >
                        <div className="relative rounded-full border shadow-2xl backdrop-blur-2xl theme-glass-panel">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 opacity-40 w-4 h-4" />
                            <input
                                ref={searchInputRef}
                                value={draftSearchQuery}
                                onChange={(event) => {
                                    const value = event.target.value;
                                    setDraftSearchQuery(value);
                                    if (!isComposingSearchRef.current) setSearchQuery(value);
                                }}
                                onCompositionStart={() => { isComposingSearchRef.current = true; }}
                                onCompositionEnd={(event) => {
                                    isComposingSearchRef.current = false;
                                    setDraftSearchQuery(event.currentTarget.value);
                                    setSearchQuery(event.currentTarget.value);
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === 'Escape') {
                                        setShowSearchPanel(false);
                                        setDraftSearchQuery('');
                                        setSearchQuery('');
                                    }
                                }}
                                placeholder={t('artistGrid.searchAlbums')}
                                className="w-full rounded-full bg-transparent py-3 pl-11 pr-11 text-sm font-medium outline-none placeholder:text-current placeholder:opacity-40"
                                style={{ color: 'var(--text-primary)' }}
                            />
                            <button
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
                                aria-label={draftSearchQuery ? t('ui.clear') : t('ui.close')}
                            >
                                <X size={15} />
                            </button>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>

            {(progressiveLoading.backgroundLoading || backgroundLoadFailed) && (
                <button
                    type="button"
                    onClick={() => {
                        if (!backgroundLoadFailed || collection.source !== 'online') return;
                        const generation = ++loadGenerationRef.current;
                        void loadOnlineAlbumPages(collection.id, generation, albums.length);
                    }}
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs backdrop-blur-md"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={t('playlist.loading')}
                >
                    <RefreshCw size={14} className={progressiveLoading.backgroundLoading ? 'animate-spin' : ''} />
                    {backgroundLoadFailed ? t('ui.retry') : t('playlist.loading')}
                </button>
            )}

            {/* Draggable Viewport Canvas */}
            <div
                ref={containerRef}
                onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    const target = event.target as HTMLElement;
                    if (target.closest('button, input, a, textarea')) return;
                    dragControls.start(event);
                }}
                className="w-full flex-1 relative z-10 flex items-center justify-center cursor-grab active:cursor-grabbing overflow-hidden"
                style={{ touchAction: 'none' }}
            >
                {progressiveLoading.initialLoading ? (
                    <div className="flex flex-col items-center gap-4 opacity-50">
                        <Loader2 className="animate-spin" size={32} />
                        <span className="text-sm font-semibold">{t('playlist.loading') || 'Loading...'}</span>
                    </div>
                ) : gridItems.length === 0 ? (
                    <div className="opacity-40 text-sm">{t('home.loadingLibrary') || 'No items found'}</div>
                ) : (
                    <motion.div
                        drag
                        dragListener={false}
                        dragControls={dragControls}
                        dragConstraints={dragBounds}
                        dragElastic={0.05}
                        dragTransition={{ power: 0.16, timeConstant: 220 }}
                        onDragStart={() => {
                            isDraggingRef.current = true;
                        }}
                        onDragEnd={() => {
                            setTimeout(() => {
                                isDraggingRef.current = false;
                            }, 50);
                        }}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        {/* Spatial visual separator texts anchored around the artist avatar. */}
                        <div
                            className="absolute text-2xl md:text-3xl font-extrabold tracking-[0.25em] select-none pointer-events-none opacity-[0.06] transition-opacity duration-300 font-serif"
                            style={{
                                transform: `translate(-50%, -50%) translate(${-(layoutConfig.spacingX * 2.55)}px, ${-(layoutConfig.spacingY * 0.42)}px)`,
                                color: 'var(--text-primary)',
                                left: '50%',
                                top: '50%',
                                whiteSpace: 'nowrap',
                                zIndex: 80,
                            }}
                        >
                            {t('artistGrid.popularSongs')}
                        </div>
                        <div
                            className="absolute text-2xl md:text-3xl font-extrabold tracking-[0.25em] select-none pointer-events-none opacity-[0.06] transition-opacity duration-300 font-serif"
                            style={{
                                transform: `translate(-50%, -50%) translate(${layoutConfig.spacingX * 0.45}px, ${layoutConfig.spacingY * 0.52}px)`,
                                color: 'var(--text-primary)',
                                left: '50%',
                                top: '50%',
                                whiteSpace: 'nowrap',
                                zIndex: 80,
                            }}
                        >
                            {t('artistGrid.artistAlbums')}
                        </div>

                        {renderedCards}
                    </motion.div>
                )}
            </div>

            {albumGridItems.length > 0 && (
                <GridListSearchButton
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    listTitle={t('artistGrid.viewAlbums')}
                    searchTitle={t('artistGrid.searchAlbums')}
                    onOpenList={() => setShowSidePanel(true)}
                    onOpenSearch={() => setShowSearchPanel(true)}
                />
            )}

            <SidePanelList
                isOpen={showSidePanel}
                onClose={() => setShowSidePanel(false)}
                title={t('artistGrid.artistAlbums')}
                items={albumGridItems}
                itemHeight={60}
                isDaylight={isDaylight}
                focusedIndex={Math.max(0, focusedIndex - 2 - topSongs.length)}
                renderItem={(item, index, style) => (
                    <CollectionListItem
                        key={`${item.id}-${index}`}
                        item={item}
                        index={index}
                        style={style}
                        isActive={focusedIndex === 2 + topSongs.length + index}
                        onClick={() => {
                            const gridIndex = 2 + topSongs.length + index;
                            centerOnIndex(gridIndex, true);
                            setShowSidePanel(false);
                            window.setTimeout(() => {
                                if (item.rawCollection) {
                                    persistNavigationState(gridIndex);
                                    onSelectAlbum?.(item.rawCollection.id, item.rawCollection);
                                }
                            }, 320);
                        }}
                    />
                )}
            />

            {/* Biography Full Text Modal */}
            <AnimatePresence>
                {showFullBio && artistInfo?.description && (
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        onClick={() => setShowFullBio(false)}
                        className="absolute inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-2xl p-4"
                    >
                        <motion.div
                            initial={{ scale: 0.95, y: 15 }}
                            animate={{ scale: 1, y: 0 }}
                            exit={{ scale: 0.95, y: 15 }}
                            transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                            onClick={(e) => e.stopPropagation()}
                            className={`max-w-xl w-full max-h-[70vh] rounded-3xl p-8 flex flex-col shadow-2xl text-left relative overflow-hidden ${cardBg}`}
                        >
                            <button
                                onClick={() => setShowFullBio(false)}
                                className="absolute top-6 right-6 opacity-40 hover:opacity-100 rounded-full bg-white/5 p-1 transition-colors cursor-pointer"
                                style={{ color: 'var(--text-primary)' }}
                            >
                                ✕
                            </button>

                            <div className="mb-4">
                                <span className="text-[10px] uppercase tracking-widest font-bold opacity-40">Biography</span>
                                <h3 className="text-2xl font-bold mt-1" style={{ color: 'var(--text-primary)' }}>
                                    {artistInfo.name}
                                </h3>
                                {artistInfo.aliases?.[0] && (
                                    <p className="text-xs opacity-50 mt-0.5">{artistInfo.aliases[0]}</p>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 leading-relaxed text-sm opacity-80 break-words whitespace-pre-wrap">
                                {artistInfo.description}
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
};

export default ArtistGridView;
