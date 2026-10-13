import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, animate, AnimatePresence, useDragControls, useIsPresent } from 'framer-motion';
import { ChevronLeft, Disc, ListPlus, Loader2, RefreshCw } from 'lucide-react';
import GridPanelToggleIndicator from '../shared/GridPanelToggleIndicator';
import { useTranslation } from 'react-i18next';
import { SongResult, Theme } from '../../../../types';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import type { LibraryArtistResource } from '../../../core/contracts/artist';
import type { LibraryPlaybackPort } from '../../../core/contracts/ports';
import type { LibraryDeclaredActions } from '../../../core/contracts/suite';
import { useArtistResourceState } from '../../../core/bindings/useArtistResourceState';
import { useArtistView } from '../../../core/bindings/useArtistView';
import { useLibraryArtistSurfaceRegistration } from '../../../core/bindings/useLibraryArtistSurfaceRegistration';
import {
    getLibraryBrowseSession,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../../core/state/useLibraryBrowseSessionStore';
import {
    artistAlbumCoverUrl,
    artistAlbumLink,
    toHttpsCoverUrl,
} from '../../../core/model/artistModel';
import { artistAlbumEntryKey, artistSongEntryKey } from '../../../core/model/artistSurface';
import { PolaroidCard } from '../shared/PolaroidCard';
import { useGridStayPlayback } from '../shared/useGridStayPlayback';
import { HEX_CARD_CENTER_SCALE } from '../shared/hexCardTransform';
import { squareGridCardBox } from '../shared/gridCardLayout';
import {
    ARTIST_AVATAR_ATTR,
    ARTIST_BIO_TITLE_ATTR,
    ARTIST_INTRO_ATTR,
    ARTIST_INTRO_VALUE_AVATAR,
    ARTIST_INTRO_VALUE_BIO,
    GRID_CARD_ITEM_ID_ATTR,
} from '../transitions/gridMorphContract';
import ActiveGridMarker from '../shared/ActiveGridMarker';
import { shouldApplyInitialGridFocus } from '../shared/gridViewRestore';
import {
    collectionMorphEntranceTravel,
    collectionMorphFlyIn,
    collectionMorphSeed,
    type CollectionMorphPlan,
} from '../transitions/morphGeometry';
import { useGridViewSettingsStore } from '../../../../stores/useGridViewSettingsStore';
import { HexGridCoord, CubeCoord, getHexCubicSpiral } from '../shared/hexViewport';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import { CollectionListItem, SidePanelList } from '../../../../components/shared/SidePanelList';
import { GridListSearchButton } from '../../../../components/shared/GridListSearchButton';
import { useGridCommandFilter } from '../../../../hooks/useGridCommandFilter';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import { closeCommandFilter } from '../../../../stores/useAppViewStore';
import { deriveProgressiveLoadingState } from '../shared/progressiveGrid';
import { useProgressiveItemEntrance } from '../shared/useProgressiveItemEntrance';
import { ArtistGridInfoCutInPanel } from './ArtistGridInfoCutInPanel';
import { setStatusMessage } from '../../../../stores/useStatusMessageStore';

/*
 * ArtistGridView.tsx
 *
 * This file implements the new Grid view style for the Artist profile.
 * It uses an infinite draggable and zoomable canvas representing the artist details.
 * Specifically, the artist avatar and editorial newspaper biography card are placed at custom central grid coordinates,
 * while popular tracks and albums are automatically distributed in the nearest and outer hexagonal cells.
 *
 * P4.1 起数据来自宿主持有的歌手资源（core/services/artistResource，经 useArtistResourceState 订阅）：
 * 详情、热门歌曲、专辑与专辑的后台分页、失败与重试都在资源里；这里只负责展示与交互。
 *
 * P4.2 起筛选词与「看到哪一项」（条目键：song:… / album:…）在浏览会话里（core/bindings/useArtistView），
 * 换 suite 不丢；这里另存的 sessionStorage 记录只放网格自己的布局（相机位置与焦点卡的下标），键带版本与完整的
 * collectionKey（folia_artist_grid_state:v2:<key>），旧版只按来源与 id 存的记录不再读取。
 * 动作的能力来自 core（声明 ∩ 能力），并作为 artist surface 发布到命令面板。
 */

interface ArtistGridViewProps {
    collection: any; // GridViewCollectionDescriptor
    /** 宿主持有的歌手资源（没有时按加载中处理）。 */
    resource: LibraryArtistResource | null;
    /** 播放端口：单曲播放 / 入队、播放全部与静默整批入队（「加入热门歌曲」）。 */
    playback: LibraryPlaybackPort;
    /** 网格在歌手页上声明的动作（entry.ts）；入口与命令面板只给「声明 ∩ core 能力」。 */
    declaredActions: LibraryDeclaredActions;
    onBack: () => void;
    /** 返回按钮：看完了（宿主清会话与布局记录再返回）。 */
    onDone: () => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    theme: Theme;
    isDaylight: boolean;
    onEditEntity?: (entityId: string) => void;
    isInteractive?: boolean;
    /**
     * Optional「移形换影」plan handed in by the overlay host: every song/album
     * card flies in from outside the viewport in a distance-staggered cascade,
     * and `kind: 'morph'` additionally means the overlay's composite currently
     * covers the avatar + bio, so they stay hidden until it fades (a plain
     * 'cascade' has nothing covering them and must leave them visible). Absent
     * for every existing caller, so behavior is unchanged.
     */
    morphPlan?: CollectionMorphPlan | null;
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

/** 网格自己的布局记录：相机位置与当时焦点卡的下标（语义焦点在浏览会话里）。 */
type StoredArtistGridNavigationState = {
    focusedIndex: number;
    dragX: number;
    dragY: number;
};

/** 挂载时定下的恢复目标：会话里的条目键优先，其次是布局记录里的下标；相机位置只在两者指向同一张卡时沿用。 */
type ArtistGridRestoreTarget = {
    entryKey: string | null;
    stored: StoredArtistGridNavigationState | null;
};

export const ARTIST_GRID_STATE_STORAGE_PREFIX = 'folia_artist_grid_state:v2:';

export const artistGridStateStorageKey = (sessionKey: string): string => `${ARTIST_GRID_STATE_STORAGE_PREFIX}${sessionKey}`;

const readStoredArtistGridState = (storageKey: string): StoredArtistGridNavigationState | null => {
    try {
        const saved = sessionStorage.getItem(storageKey);
        if (!saved) return null;
        const parsed = JSON.parse(saved) as Partial<StoredArtistGridNavigationState>;
        return {
            focusedIndex: Number.isFinite(parsed.focusedIndex) ? Number(parsed.focusedIndex) : 1,
            dragX: Number.isFinite(parsed.dragX) ? Number(parsed.dragX) : NaN,
            dragY: Number.isFinite(parsed.dragY) ? Number(parsed.dragY) : NaN,
        };
    } catch {
        sessionStorage.removeItem(storageKey);
        return null;
    }
};

/** 网格项在浏览会话里的条目键（头像与简介卡没有）。 */
const gridItemEntryKey = (item: GridItem | undefined): string | null => {
    if (!item) return null;
    if (item.rawTrack) return artistSongEntryKey(item.rawTrack);
    if (item.rawCollection) return artistAlbumEntryKey(item.rawCollection);
    return null;
};

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

// Card box, hex spacing and the sizes of the artist wall's own avatar and bio cards, per
// container-width breakpoint. Lifted out of the component so the memo shows only the choice
// between the plain box and the squared one.
const resolveArtistGridCardBox = (width: number) => {
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
};

const ArtistGridView: React.FC<ArtistGridViewProps> = ({
    collection,
    resource,
    playback,
    declaredActions,
    onBack,
    onDone,
    onSelectAlbum,
    onSelectArtist,
    theme,
    isDaylight,
    onEditEntity,
    isInteractive = true,
    morphPlan = null,
}) => {
    const { t } = useTranslation();
    // The artist wall renders the same cards as GridView, so it follows the same look settings.
    const fullBleedCover = useGridViewSettingsStore(state => state.gridViewFullBleedCover);
    const squareCards = useGridViewSettingsStore(state => state.gridViewSquareCards) && fullBleedCover;
    const minCardScale = useGridViewSettingsStore(state => state.gridViewMinCardScale);
    const minCardOpacity = useGridViewSettingsStore(state => state.gridViewMinCardOpacity);
    const closeBtnBg = isDaylight ? 'bg-black/5 hover:bg-black/10 text-black/60' : 'bg-black/20 hover:bg-white/10 text-white/60';
    const cardBg = isDaylight ? 'bg-white/60 border border-white/30' : 'bg-zinc-900/60 border border-white/10';

    // Viewport Size Observer
    const containerRef = useRef<HTMLDivElement>(null);
    const [containerSize, setContainerSize] = useState({ width: 1024, height: 768 });
    // 退场动画期间旧歌手页仍挂着：只有在场的那一个接筛选框与命令面板。
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    // Coordinate motion values mapping grid drags
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);
    const dragControls = useDragControls();
    const isDraggingRef = useRef(false);

    // 歌手数据：宿主的歌手资源。专辑的后台分页在拖拽中先暂存，松手后提交（与集合网格同一道门）。
    const { snapshot, flushHeld } = useArtistResourceState(resource, { holdBackground: () => isDraggingRef.current });
    // fb3：「留在原处」时热门歌曲卡片上正在播放的那首切换暂停 / 继续（与集合网格同一个规则，见 useGridStayPlayback）。
    const stayPlayback = useGridStayPlayback(playback.playTrack, playback);
    const stayPort = useMemo<LibraryPlaybackPort>(
        () => ({ ...playback, playTrack: stayPlayback.selectTrack }),
        [playback, stayPlayback.selectTrack],
    );
    // 筛选词、专辑筛选、能力与动作：与 TUI 歌手页同一份 core 绑定。
    const artistView = useArtistView({
        collection,
        resource,
        snapshot,
        playback: stayPort,
        declaredActions,
        onEditEntity,
        onOpenAlbum: onSelectAlbum,
        setStatus: setStatusMessage,
    });
    const { sessionKey, offers, actions: artistActions, capabilities } = artistView;
    const navigationStorageKey = useMemo(() => artistGridStateStorageKey(sessionKey), [sessionKey]);
    // 恢复目标在挂载时定下（歌手页按 collectionKey 挂载）：会话里的语义焦点 + 网格自己的布局记录。
    const [initialRestoreTarget] = useState<ArtistGridRestoreTarget | null>(() => {
        const stored = readStoredArtistGridState(navigationStorageKey);
        const entryKey = getLibraryBrowseSession(sessionKey).focusedEntryKey;
        return stored || entryKey ? { entryKey, stored } : null;
    });
    const pendingRestoreStateRef = useRef<ArtistGridRestoreTarget | null>(initialRestoreTarget);
    const hasRestoredNavigationRef = useRef(false);
    // 初始定位只做一次：专辑列表是分页追加的，只看 items.length 会在数据落地时把相机从用户
    // 已经移过去的那张卡上拽回介绍卡。判据见 shouldApplyInitialGridFocus。
    const hasAppliedInitialFocusRef = useRef(false);

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
        const box = resolveArtistGridCardBox(containerSize.width);
        return squareCards ? squareGridCardBox(box) : box;
    }, [containerSize.width, squareCards]);

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

    const [showFullBio, setShowFullBio] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    // 筛选词在浏览会话里（换 suite 不丢）；会话里已有筛选时首次可交互就把筛选框带出来。
    const searchQuery = artistView.query;
    const setSearchQuery = artistView.setQuery;
    // The filter box is the command palette now; this grid only says who owns typing and where the
    // box belongs. See useGridCommandFilter for why all three grids stopped carrying their own.
    const rootRef = useRef<HTMLDivElement>(null);
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: artistView.queryPort,
        // The box was positioned against this component's root, not the drag canvas.
        anchorRef: rootRef,
        reopenIfFiltered: true,
    });
    // 命令面板的歌手页动作（播放 / 入队热门歌曲、重新加载、续专辑、编辑本地歌手）：声明 ∩ core 能力。
    useLibraryArtistSurfaceRegistration({
        isInteractive: isActive,
        getState: artistView.surfaceState,
        run: artistView.runSurface,
    });

    const artistInfo = snapshot?.detail ?? null;
    const topSongs = artistView.topSongs;
    const status = snapshot?.status ?? 'idle';
    const loading = status === 'idle' || status === 'loading';
    const albumSync = snapshot?.albumSync;
    // 被暂停的分页（资源刚被复用、ensure 马上会续上）按「还在加载」显示。
    const backgroundLoading = albumSync?.state === 'syncing'
        || (albumSync?.state === 'interrupted' && albumSync.reason === 'paused');
    const backgroundLoadFailed = albumSync?.state === 'interrupted' && albumSync.reason === 'failed';
    const loadError = status === 'error' ? snapshot?.error ?? 'load-failed' : null;
    const wheelTargetRef = useRef({ x: 0, y: 0 });
    const focusedIndexRef = useRef(0);
    const [focusedIndex, setFocusedIndex] = useState(0);
    const lastUpdateRef = useRef(0);
    const pendingTimeoutRef = useRef<any>(null);

    useEffect(() => {
        if (!isInteractive) return;

        // Typing itself is the palette's now; what stays here is the Escape ladder, which is about
        // this grid's own panels and has nothing to do with the filter box.
        const handleEscape = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) return;

            // Same as GridView: a window above owns Escape, and auto-repeat must not leave the grid.
            if (event.key !== 'Escape' || event.repeat || hasBlockingWindow()) return;

            event.preventDefault();
            // A filter still applied is the first thing Escape undoes, as it always was.
            if (searchQuery) {
                setSearchQuery('');
            } else if (showSidePanel) {
                setShowSidePanel(false);
            } else if (showCutInPanel) {
                setShowCutInPanel(false);
            } else {
                onBack();
            }
        };

        window.addEventListener('keydown', handleEscape);
        return () => window.removeEventListener('keydown', handleEscape);
    }, [isInteractive, onBack, searchQuery, showCutInPanel, showSidePanel]);

    const filteredAlbums = artistView.shownAlbums;

    // 专辑卡带着打开专辑时交给宿主的链接提示（来源与 provider 取自歌手页，见 artistAlbumLink）。
    const albumGridItems = useMemo<GridItem[]>(() => filteredAlbums.map((album) => ({
        id: album.id,
        name: album.name,
        coverUrl: artistAlbumCoverUrl(album),
        description: album.publishedAt ? new Date(album.publishedAt).getFullYear().toString() : '',
        rawCollection: artistAlbumLink(album, collection),
    })), [collection, filteredAlbums]);

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
            coverUrl: artistInfo.coverUrl,
        });

        // 2. Bio Card
        itemsList.push({
            id: '__artist_bio__',
            name: artistInfo.name,
            coverUrl: artistInfo.coverUrl,
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
    // Queue context for track selection: unavailable tracks are excluded so playback matches the playlist/album
    // surfaces (useArtistView's playSong uses the playable top songs as the queue).
    const canPlaySong = offers('play');
    const canEnqueueSong = offers('enqueue');
    const canOpenAlbum = offers('open-album');
    const handleSelectArtist = offers('open-artist') ? onSelectArtist : undefined;
    const handleSelectAlbumLink = offers('open-album') ? onSelectAlbum : undefined;
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

    // 「看到哪一项」以条目键写进浏览会话（TUI 也认），网格自己的布局另存一份。
    const persistNavigationState = useCallback((index: number) => {
        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const state: StoredArtistGridNavigationState = {
            focusedIndex: safeIndex,
            dragX: dragX.get(),
            dragY: dragY.get(),
        };
        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, gridItemEntryKey(gridItems[safeIndex]));
    }, [dragX, dragY, gridItems, navigationStorageKey, sessionKey]);

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
        if (!shouldApplyInitialGridFocus({
            itemCount: gridItems.length,
            hasAppliedInitialFocus: hasAppliedInitialFocusRef.current,
            restoreApplied: hasRestoredNavigationRef.current,
            restorePending: Boolean(pendingRestoreStateRef.current),
        })) {
            return;
        }
        hasAppliedInitialFocusRef.current = true;
        // Focus on Bio Card (Index 1) initially to give a balanced newspaper view
        centerOnIndex(1, false);
    }, [gridItems.length]);

    useEffect(() => {
        if (hasRestoredNavigationRef.current) return;
        const pending = pendingRestoreStateRef.current;
        if (!pending || gridItems.length === 0 || baseCoords.length === 0) return;

        // 会话里的条目键优先（另一个 suite 可能改过它），找不到再用布局记录里的下标。
        const entryIndex = pending.entryKey
            ? gridItems.findIndex(item => gridItemEntryKey(item) === pending.entryKey)
            : -1;
        const storedIndex = pending.stored ? pending.stored.focusedIndex : 1;
        const restoredIndex = Math.max(0, Math.min(entryIndex >= 0 ? entryIndex : storedIndex, gridItems.length - 1));
        // 相机位置只在布局记录指向的就是这张卡时沿用，否则把这张卡居中。
        const stored = pending.stored;
        const keepsStoredCamera = stored !== null && stored.focusedIndex === restoredIndex;
        const restoredX = keepsStoredCamera && Number.isFinite(stored.dragX) ? stored.dragX : -baseCoords[restoredIndex].baseX;
        const restoredY = keepsStoredCamera && Number.isFinite(stored.dragY) ? stored.dragY : -baseCoords[restoredIndex].baseY;

        focusedIndexRef.current = restoredIndex;
        setFocusedIndex(restoredIndex);
        dragX.set(restoredX);
        dragY.set(restoredY);
        wheelTargetRef.current = { x: restoredX, y: restoredY };
        updateRenderedIndexesForViewport(restoredX, restoredY, true);
        hasRestoredNavigationRef.current = true;
        pendingRestoreStateRef.current = null;
    }, [baseCoords, dragX, dragY, gridItems, updateRenderedIndexesForViewport]);

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

    // 200ms 节流定时器：200ms 窗口内离开页面（点开歌单、返回）就会 fire 到已卸载组件上。
    // GridMap.tsx 对同名 ref 有这段清理，ArtistGridView 一直没有。
    useEffect(() => () => {
        if (pendingTimeoutRef.current !== null) {
            clearTimeout(pendingTimeoutRef.current);
            pendingTimeoutRef.current = null;
        }
    }, []);

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
                    const scale = HEX_CARD_CENTER_SCALE - (HEX_CARD_CENTER_SCALE - minCardScale) * tVal;
                    const opac = 1.0 - (1.0 - minCardOpacity) * tVal;
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
    }, [dragX, dragY, baseCoords, layoutConfig, clipRadius, minCardOpacity, minCardScale, updateRenderedIndexesForViewport]);

    // Setup arrow keyboard navigation
    useEffect(() => {
        if (!isInteractive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) return;

            if (e.key === 'Enter') {
                if (e.repeat || isFiltering || showSidePanel || showCutInPanel || showFullBio) return;

                const focusedItem = gridItems[focusedIndex];
                if (!focusedItem) return;
                if (focusedIndex === 1) {
                    e.preventDefault();
                    setShowFullBio(true);
                } else if (focusedItem.rawTrack && canPlaySong) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    artistActions.playSong(focusedItem.rawTrack);
                } else if (focusedItem.rawCollection && onSelectAlbum && canOpenAlbum) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    onSelectAlbum(focusedItem.rawCollection.id, focusedItem.rawCollection);
                }
                return;
            }

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
    }, [
        baseCoords,
        focusedIndex,
        gridItems,
        isInteractive,
        onSelectAlbum,
        artistActions,
        canPlaySong,
        canOpenAlbum,
        persistNavigationState,
        showCutInPanel,
        isFiltering,
        showFullBio,
        showSidePanel,
    ]);

    // 切换 suite 之前，切换器会让当前歌手页把焦点写回会话。写的是已提交的焦点，不是拖拽帧循环里的值。
    const committedFocusIndexRef = useRef(focusedIndex);
    committedFocusIndexRef.current = focusedIndex;
    useEffect(() => registerLibrarySessionFlush(sessionKey, () => persistNavigationState(committedFocusIndexRef.current)), [
        persistNavigationState,
        sessionKey,
    ]);

    // 「移形换影」artist-page entrance: with a morph plan the avatar + bio stay
    // hidden ONLY while the overlay's composite actually covers them
    // (kind 'morph'), revealed as it fades out; every song/album card flies in
    // from outside the viewport along its radial from the avatar — the same
    // distance-staggered cascade as GridView's morph entrance, so a nested back
    // into the artist page reads as scatter-out → cascade-in. A plain 'cascade'
    // plan (a push with nothing covering the page) must leave the intro visible:
    // hiding it there is a 340ms empty slot with no composite to justify it.
    const morphCoversIntro = morphPlan?.kind === 'morph';
    const morphFlyInReach = useMemo(() => (
        morphPlan ? collectionMorphEntranceTravel(containerSize) : 0
    ), [morphPlan, containerSize]);

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
            const initialScale = HEX_CARD_CENTER_SCALE - (HEX_CARD_CENTER_SCALE - minCardScale) * initialT;
            const initialOpacity = 1.0 - (1.0 - minCardOpacity) * initialT;
            const initialZ = Math.round(50 - 49 * initialT);

            // Index 0: Circular Avatar Card (No label details, pure image visual)
            if (idx === 0) {
                return (
                    <div
                        key={`avatar-${idx}`}
                        ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                        {...{ [ARTIST_AVATAR_ATTR]: '', [ARTIST_INTRO_ATTR]: ARTIST_INTRO_VALUE_AVATAR }}
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
                        {/* Morph target of the song-card flight: hidden while the
                            overlay morphs onto it, revealed as the overlay fades. */}
                        <motion.div
                            initial={morphCoversIntro ? { opacity: 0, scale: 0.985 } : false}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                                opacity: { delay: 0.12, duration: 0.3, ease: 'easeOut' },
                                // 尺度收势走 Apple 惯用的那条 ease，比透明度稍长一点，
                                // 落定时才「稳」下来。
                                scale: { delay: 0.12, duration: 0.42, ease: [0.32, 0.72, 0, 1] },
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
                                    <img src={getSizedCoverUrl(item.coverUrl, 512)} alt="avatar" draggable={false} loading="lazy" decoding="async" className="w-full h-full object-cover select-none" />
                                ) : (
                                    <div className="w-full h-full flex items-center justify-center bg-white/5">
                                        <Disc size={48} className="opacity-20 animate-spin" style={{ animationDuration: '4s' }} />
                                    </div>
                                )}
                            </div>
                        </motion.div>
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
                        // Part of the intro cluster, not a morphable card: it has
                        // no cover and no card title, so it is excluded from both
                        // the capture source and the reverse flight's scatter
                        // (it used to fly out as a blank frame).
                        {...{ [ARTIST_INTRO_ATTR]: ARTIST_INTRO_VALUE_BIO }}
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
                        {/* Hidden while the overlay's title flight morphs onto
                            the h1, revealed as the overlay fades. */}
                        <motion.div
                            initial={morphCoversIntro ? { opacity: 0, scale: 0.985 } : false}
                            animate={{ opacity: 1, scale: 1 }}
                            transition={{
                                opacity: { delay: 0.12, duration: 0.3, ease: 'easeOut' },
                                // 尺度收势走 Apple 惯用的那条 ease，比透明度稍长一点，
                                // 落定时才「稳」下来。
                                scale: { delay: 0.12, duration: 0.42, ease: [0.32, 0.72, 0, 1] },
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
                                    <h1
                                        {...{ [ARTIST_BIO_TITLE_ATTR]: '' }}
                                        className="text-3xl font-extrabold tracking-tight truncate"
                                        style={{ color: 'var(--text-primary)' }}
                                    >
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
                        </motion.div>
                    </div>
                );
            }

            // Index 2..: Song & Album Polaroid cards
            const isSongCard = !!item.rawTrack;
            const cardMode = isSongCard ? 'tracks' : 'collection';
            const animateEntrance = shouldAnimateItemEntrance(String(item.id));
            // 「移形换影」fly-in: every non-intro card arrives from outside the
            // viewport along its radial from the avatar cluster, staggered with
            // an ease-out distance curve plus a deterministic jitter.
            // 屏外的卡不参与入场：渲染环带缓冲，那些卡看不见，却要各付一次动画。
            const cardOnScreen = initialDist <= clipRadius;
            const isMorphFlyIn = Boolean(morphPlan && idx >= 2 && cardOnScreen);
            const morphFlyIn = isMorphFlyIn
                ? collectionMorphFlyIn(
                    { x: coord.baseX, y: coord.baseY },
                    { x: baseCoords[0].baseX, y: baseCoords[0].baseY },
                    layoutConfig.spacingX || 1,
                    morphFlyInReach,
                    collectionMorphSeed(String(item.id)),
                )
                : null;

            return (
                <div
                    key={`${cardMode}-${idx}-${item.id}`}
                    ref={(el) => { cardWrapperRefs.current[idx] = el; }}
                    // Morph capture source (nested artist/album pushes) and
                    // squad-scatter member on back-out.
                    {...{ [GRID_CARD_ITEM_ID_ATTR]: String(item.id) }}
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
                        initial={isMorphFlyIn
                            ? { opacity: 0, x: morphFlyIn!.x, y: morphFlyIn!.y, scale: 0.94 }
                            : animateEntrance ? { opacity: 0, scale: 0.96 } : false}
                        animate={{
                            // Key set identical across branches so a plan
                            // expiring mid-flight can never freeze a card at
                            // its crooked in-between angle.
                            opacity: 1,
                            x: 0,
                            y: 0,
                            scale: 1,
                            rotate: 0,
                        }}
                        transition={isMorphFlyIn
                            // 一条 Apple 的 ease 补间而不是每张卡一条 spring：观感上整片网格
                            // 一起落定，成本上每帧只做插值（大页面同时有几十条动画在跑）。
                            ? { duration: 0.5, ease: [0.32, 0.72, 0, 1], delay: morphFlyIn!.delay }
                            : { duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                    >
                    <PolaroidCard
                        item={item}
                        isDaylight={isDaylight}
                        theme={theme}
                        mode={cardMode}
                        t={t}
                        cardWidth={layoutConfig.cardWidth}
                        cardHeight={layoutConfig.cardHeight}
                        fullBleedCover={fullBleedCover}
                        openWhenFocusedOnCardClick={!isSongCard}
                        isFocused={focusedIndex === idx}
                        onSelect={() => {
                            if (isSongCard && canPlaySong && item.rawTrack) {
                                persistNavigationState(idx);
                                artistActions.playSong(item.rawTrack);
                            } else if (!isSongCard && onSelectAlbum && canOpenAlbum && item.rawCollection) {
                                persistNavigationState(idx);
                                onSelectAlbum(item.rawCollection.id, item.rawCollection);
                            }
                        }}
                        onCenter={() => {
                            if (isDraggingRef.current) return;
                            centerOnIndex(idx, true);
                        }}
                        onSelectArtist={handleSelectArtist}
                        onSelectAlbum={handleSelectAlbumLink}
                        onAddQueue={() => {
                            if (isSongCard && canEnqueueSong && item.rawTrack) {
                                artistActions.enqueueSong(item.rawTrack);
                            }
                        }}
                        playbackMark={isSongCard ? stayPlayback.markFor(item.rawTrack) : null}
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
        fullBleedCover,
        minCardOpacity,
        minCardScale,
        focusedIndex,
        artistInfo,
        artistActions,
        stayPlayback.markFor,
        canPlaySong,
        canEnqueueSong,
        canOpenAlbum,
        onSelectAlbum,
        handleSelectArtist,
        handleSelectAlbumLink,
        persistNavigationState,
        shouldAnimateItemEntrance,
        morphPlan,
        morphFlyInReach,
    ]);

    const progressiveLoading = deriveProgressiveLoadingState(
        gridItems.length,
        loading,
        backgroundLoading
    );

    return (
        <motion.div
            ref={rootRef}
            data-ponder-page-scope="grid-view-page"
            data-library-renderer="grid"
            data-library-surface="artist"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex flex-col font-sans select-none overflow-hidden"
            style={{ color: 'var(--text-primary)', backgroundColor: 'var(--bg-color)' }}
        >
            {/* 把「我是当前这层网格」写在根节点上：移形换影的测量只在这个子树里找落点，
                否则正在退出的上一层网格会被当成目标。订阅关在子组件里，见 ActiveGridMarker。 */}
            <ActiveGridMarker target={rootRef} />

            {backgroundCoverUrl && (
                <div
                    className="absolute inset-0 pointer-events-none overflow-hidden select-none z-0"
                    style={{ opacity: isDaylight ? 0.18 : 0.12 }}
                >
                    <img
                        src={toHttpsCoverUrl(getLowResCoverUrl(backgroundCoverUrl))}
                        alt=""
                        className="w-full h-full object-cover scale-110 filter blur-[30px]"
                    />
                </div>
            )}

            {/* Header Area */}
            <div className="absolute top-0 left-0 p-6 z-30 flex items-center gap-4">
                <button
                    // 返回按钮表示看完了（onDone）：宿主清掉浏览会话、让每套 suite 忘掉布局记录，再返回
                    // （Escape 与浏览器后退保留）。P4.5 起这条语义在宿主，不在这里清。
                    onClick={onDone}
                    className={`w-10 h-10 rounded-full ${closeBtnBg} flex items-center justify-center transition-colors backdrop-blur-md cursor-pointer`}
                    style={{ color: 'var(--text-primary)' }}
                >
                    <ChevronLeft size={20} />
                </button>
                {offers('enqueue-scope') && (
                    <button
                        type="button"
                        onClick={() => artistActions.enqueueScope()}
                        disabled={!capabilities['enqueue-scope'].enabled}
                        className={`h-10 w-10 sm:w-auto sm:px-4 rounded-full ${closeBtnBg} flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors backdrop-blur-md cursor-pointer disabled:opacity-40 disabled:cursor-default`}
                        style={{ color: 'var(--text-primary)' }}
                        title={t('artistGrid.addTopSongsToQueue')}
                        aria-label={t('artistGrid.addTopSongsToQueue')}
                    >
                        <ListPlus size={16} />
                        <span className="hidden sm:inline">{t('artistGrid.addTopSongsToQueue')}</span>
                    </button>
                )}
            </div>

            {/* Title display inside viewport header */}
            <div
                onClick={() => {
                    closeCommandFilter();
                    setShowSidePanel(false);
                    setShowCutInPanel(current => !current);
                }}
                className="group/grid-title absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none cursor-pointer hover:scale-[1.01] active:scale-98 transition-all px-5 py-2 rounded-2xl backdrop-blur-md"
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <button
                    type="button"
                    className="flex items-center gap-1.5 text-lg font-bold tracking-tight cursor-pointer"
                    aria-expanded={showCutInPanel}
                >
                    {artistInfo?.name || collection.name}
                    <GridPanelToggleIndicator isOpen={showCutInPanel} />
                </button>
                <p className="text-xs opacity-50 mt-0.5">{t('navidrome.artists') || 'Artists'}</p>
            </div>

            <ArtistGridInfoCutInPanel
                isOpen={showCutInPanel}
                artistName={artistInfo?.name || collection.name}
                coverUrl={artistInfo?.coverUrl}
                description={artistInfo?.description}
                trackCount={artistInfo?.trackCount}
                albumCount={artistInfo?.albumCount}
                entityId={collection.source === 'local' ? collection.entityId : undefined}
                onClose={() => setShowCutInPanel(false)}
                onEditEntity={offers('edit-entity') ? () => {
                    setShowCutInPanel(false);
                    artistActions.editEntity();
                } : undefined}
            />


            {(progressiveLoading.backgroundLoading || backgroundLoadFailed || loadError) && (
                <button
                    type="button"
                    onClick={() => {
                        // 加载失败：从头重新加载；专辑分页失败：从失败的那一页续（详情与热门歌曲不重新请求）。
                        if (loadError) artistActions.reload();
                        else if (backgroundLoadFailed) artistActions.retryAlbums();
                    }}
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs backdrop-blur-md"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={t('playlist.loading')}
                >
                    <RefreshCw size={14} className={progressiveLoading.backgroundLoading ? 'animate-spin' : ''} />
                    {backgroundLoadFailed || loadError ? t('ui.retry') : t('playlist.loading')}
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
                ) : loadError && gridItems.length === 0 ? (
                    // 失败用集合页同一句文案（「加载失败：…」），重试在右上角的按钮上。
                    <div className="opacity-40 text-sm">
                        {t('playlist.loadFailed', {
                            error: loadError === 'source-unavailable' ? t('search.sourceNavidrome') : (collection.name || ''),
                        })}
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
                                // 拖拽期间暂存的专辑分页现在提交。
                                flushHeld();
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
                                if (item.rawCollection && canOpenAlbum) {
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
