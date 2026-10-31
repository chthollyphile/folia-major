import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion, useMotionValue, animate, AnimatePresence, useDragControls, useIsPresent } from 'framer-motion';
import { ChevronLeft, Crosshair, Disc, Download, ImagePlus, Play, Plus, Loader2, Heart, ListPlus, NotebookPen, Pencil, RefreshCw, Trash2, Star, Tags } from 'lucide-react';
import GridPanelToggleIndicator from '../shared/GridPanelToggleIndicator';
import { useTranslation } from 'react-i18next';
import { SongResult, type LocalSong, type StatusMessage, Theme, type UnifiedSong } from '../../../../types';
import { isSongUnavailable } from '../../../../services/onlineMusic/songAvailability';
import { formatSongName } from '../../../../utils/songNameFormatter';
import { getSizedCoverUrl } from '../../../../utils/coverUrl';
import { getSongCoverUrl } from '../../../../services/onlineMusic/songMetadata';
import { colorWithAlpha } from '../../../../components/visualizer/colorMix';
import { onlineFailureOf, type OnlineFailure } from '../../../../services/onlineMusic/failure/onlineFailureCase';
import { onlineFailureMessage } from '../../../../services/onlineMusic/failure/onlineFailureTexts';
import { getPlaybackSongKey } from '../../../../utils/appPlaybackGuards';
import { GridLocateButton } from '../../../../components/app/playing-song-locator/GridLocateButton';
import { usePlaybackStore } from '../../../../stores/usePlaybackStore';
import { usePlayingSongLocatorStore } from '../../../../stores/usePlayingSongLocatorStore';
import { answerLocateRequest, locatePlayingSongOnPage } from '../../../../components/app/playing-song-locator/playingSongLocator';
import { resolveLocateStep } from '../../../../components/app/playing-song-locator/resolveLocateStep';
import { useFoliaHexViewport } from '../shared/useFoliaHexViewport';
import { PolaroidCard, fullBleedScrim, type GridItem } from '../shared/PolaroidCard';
import type { GridPlaybackMark } from '../shared/useGridStayPlayback';
import { squareGridCardBox } from '../shared/gridCardLayout';
import {
    gridViewStateStorageKey,
    readStoredGridViewState,
    resolveGridRestoreIndex,
    resolveGridRestoreTarget,
    type GridRestoreTarget,
    type StoredGridViewNavigationState,
} from '../shared/gridViewRestore';
import {
    CARD_TITLE_ATTR,
    GRID_CARD_ITEM_ID_ATTR,
    MORPH_FRAME_ATTR,
    MORPH_TARGET_ATTR,
} from '../transitions/gridMorphContract';
import { useMorphPageExit } from '../transitions/collectionMorphStore';
import { playFlyIn } from '../transitions/morphFlyIn';
import { handOverStandIn, type StandInHandover } from '../transitions/standInHandover';
import {
    collectionMorphEntranceTravel,
    collectionMorphFlyIn,
    collectionMorphSeed,
    type CollectionMorphPlan,
} from '../transitions/morphGeometry';
import ActiveGridMarker from '../shared/ActiveGridMarker';
import { createLazyGridItems } from './lazyGridItems';
import {
    applyHexCardFrameStyles,
    computeHexCardFrame,
    createHexCardFrameStyleCache,
    HEX_CARD_CENTER_SCALE,
    type HexCardFrameStyleCache,
} from '../shared/hexCardTransform';
import PlaylistSelectionDialog from '../../../../components/shared/PlaylistSelectionDialog';
import TextInputDialog from '../../../../components/shared/TextInputDialog';
import ConfirmDialog from '../../../../components/shared/ConfirmDialog';
import { SidePanelList, TrackListItem } from '../../../../components/shared/SidePanelList';
import { GridListSearchButton } from '../../../../components/shared/GridListSearchButton';
import { LocalTrackSortDirectionButton, LocalTrackSortMenu } from '../../../../components/shared/LocalTrackSortMenu';
import { CustomSelect } from '../../../../components/shared/CustomSelect';
import { deriveProgressiveLoadingState } from '../shared/progressiveGrid';
import { useProgressiveItemEntrance } from '../shared/useProgressiveItemEntrance';
import { useLocalCoverPreloader } from '../../../../hooks/useLocalCoverPreloader';
import { formatLocalAlbumTrackLabel } from '../../../../utils/localSongSorting';
import { resolveCollectionSyncCounts } from '../../../core/collection/collectionProgress';
import { buildCoreSurfaceParams, buildGridSurfaceState, runGridSurfaceAction } from '../../../core/collection/collectionSurface';
import { useGridSurfaceRegistration } from '../../../../hooks/useGridSurfaceRegistration';
import type { CollectionResource } from '../../../core/shared/resource.contract';
import type { CollectionMutationController, LibraryMutationResult } from '../../../core/collection/mutations/mutations.contract';
import type { LibraryDeclaredActions } from '../../../core/suite/suite.contract';
import type { LibraryCollectOrigin } from '../../../core/shared/ports.contract';
import { useSidePanelBottomPx } from '../../../../hooks/usePlayerBottomBarBottomPx';
import { hasBlockingWindow } from '../../../../utils/keyboardTargets';
import { useGridViewSettingsStore } from '../../../../stores/useGridViewSettingsStore';
import { collectionKey } from '../../../core/collection/collectionIdentity';
import { useCollectionResourceState } from '../../../core/collection/resource/useCollectionResourceState';
import { useCollectionMutationSnapshot } from '../../../core/collection/mutations/useCollectionMutations';
import { useCollectionView } from '../../../core/collection/useCollectionView';
import { useCommittedQuery } from '../../../core/shared/useCommittedQuery';
import { useLibrarySessionQuery } from '../../../core/shared/useLibrarySessionQuery';
import { useGridCommandFilter } from '../../../../hooks/useGridCommandFilter';
import {
    getLibraryBrowseSession,
    registerLibrarySessionFlush,
    useLibraryBrowseSessionStore,
} from '../../../core/shared/useLibraryBrowseSessionStore';
import { useLocalTrackSortStore } from '../../../core/directory/useLocalTrackSortStore';

interface GridViewProps {
    title: string;
    subtitle?: string;
    items?: GridItem[];
    mode: 'collection' | 'tracks';
    onBack: () => void;
    /** 返回按钮：看完了（宿主清会话与布局记录再返回）。 */
    onDone: () => void;
    onSelectTrack?: (track: SongResult, queue: SongResult[]) => void;
    onSelectCollection?: (item: any) => void;
    onAddTrackToQueue?: (track: SongResult) => void;
    /** fb3：「留在原处」时正在播放的那首的卡片画成暂停 / 继续（useGridStayPlayback.markFor）；不给就是普通的播放键。 */
    trackPlaybackMark?: (track: SongResult | undefined) => GridPlaybackMark | null;
    isLoading?: boolean;
    theme: Theme;
    isDaylight: boolean;

    // Optional self-contained collection props
    collection?: any;
    onPlayAll?: (songs: SongResult[]) => void;
    onAddAllToQueue?: (songs: SongResult[], options?: { suppressToast?: boolean }) => number | void;
    /** 收进速记簿：聚焦卡片与曲目侧栏行上的一首（suite 声明了 collect 才给）。出处由这里按显示的集合名补上。 */
    collectTrack?: (songs: SongResult[], origin?: LibraryCollectOrigin) => void;
    /** 收进速记簿：信息面板与命令面板的当前范围（声明了 collect-scope 才给）。 */
    collectScope?: (songs: SongResult[], origin?: LibraryCollectOrigin) => void;
    onSelectAlbum?: (albumId: number | string, album?: any, track?: SongResult) => void;
    onSelectArtist?: (artistId: number | string, artist?: any, track?: SongResult) => void;
    /**
     * 曲目的来源：加载、缓存、后台补页、错误与重新拉取都在资源里（见 library/core/collection/resource）。
     * 宿主持有它，切换 renderer 不会重新请求。
     */
    resource?: CollectionResource | null;
    /**
     * 集合的变更动作控制器（宿主按集合会话持有，见 library/core/collection/mutations/collectionMutations.service）：删条目、订阅、
     * 改名、删除、重扫、导出、加入歌单……都经它，按钮的可见与可点也读它的快照。没有时（性能探针）什么都不支持。
     */
    mutations?: CollectionMutationController | null;
    localSongs?: LocalSong[];
    onStatusMessage?: (message: StatusMessage) => void;
    isInteractive?: boolean;
    /**
     * The key the app's navigation knows this page by: collectionKey of the descriptor it was
     * opened with. `collection` may be a refreshed copy with another key (a local album or artist
     * takes the id of the entity it was merged into).
     */
    navigationKey?: string;
    /**
     * Optional shared-element「移形换影」plan, as it stands when the page is
     * first rendered. Either way every non-hero card settles into its grid
     * slot from a short push, in a distance sequence; `kind: 'morph'`
     * additionally means a cover is flying to this page: the page puts up a
     * stand-in card at the hero's place, showing the plan's `coverUrl`, for
     * the cover to land on, which then hands over to the hero. `kind:
     * 'cascade'` (no cover flying) leaves the hero visible. Absent for every
     * other caller, so behavior is unchanged unless the collection morph
     * hands it in.
     */
    morphPlan?: CollectionMorphPlan | null;
    /**
     * 网格 suite 在 entry.ts 里为集合 surface 声明的动作（宿主经 registry 解析后传入）。命令面板只发布
     * 声明过的；直接挂 GridView 的探针不传，不过滤。
     */
    declaredActions?: LibraryDeclaredActions;
}

const EMPTY_TRACKS: SongResult[] = [];
// What a page that is given no `items` has for them: the one list, render after render. A list
// made anew in every render made the grid's items anew, and with them every card on the page.
const NO_ITEMS: GridItem[] = [];
// Card box and hex spacing per container-width breakpoint. Module scope so the memo above
// reads as "pick a breakpoint, then apply the square-card option" rather than hiding the
// table inside it.
const resolveGridViewCardBox = (width: number) => {
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
};

const GRID_VIEW_RENDER_BUFFER_FACTOR = 0.75;
const GRID_VIEW_CARD_VISIBILITY_BUFFER = 96;
const TRACK_REMOVAL_ANIMATION_MS = 460;
const TRACK_REMOVAL_BEZIER = [0.22, 0.8, 0.24, 1] as const;

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
    items = NO_ITEMS,
    mode,
    onBack,
    onDone,
    onSelectTrack,
    onSelectCollection,
    onAddTrackToQueue,
    trackPlaybackMark,
    isLoading = false,
    theme,
    isDaylight,
    collection,
    onPlayAll,
    onAddAllToQueue,
    collectTrack,
    collectScope,
    onSelectAlbum,
    onSelectArtist,
    resource = null,
    mutations = null,
    localSongs,
    onStatusMessage,
    isInteractive = true,
    navigationKey,
    morphPlan = null,
    declaredActions,
}) => {
    const { t } = useTranslation();
    const bottomBarPanelBottomPx = useSidePanelBottomPx();
    const fullBleedCover = useGridViewSettingsStore(state => state.gridViewFullBleedCover);
    // Only the full-bleed layout can be square: the polaroid frame needs the extra height for the
    // printed label under its artwork.
    const squareCards = useGridViewSettingsStore(state => state.gridViewSquareCards) && fullBleedCover;
    const minCardScale = useGridViewSettingsStore(state => state.gridViewMinCardScale);
    const minCardOpacity = useGridViewSettingsStore(state => state.gridViewMinCardOpacity);
    // The stand-in: a card at the hero's place that a cover flying to this page lands on. It is
    // there from the first render (the overlay measures it in the commit that mounts the page),
    // shows the picture that flies, and is the loading card for as long as no track has come.
    // The plan is gone some half a second later; the stand-in is the page's own from then on.
    // `gone`: it has handed over and is off the page, while the hero is still coming to rest.
    const [standIn, setStandIn] = useState<{ coverUrl: string | null; title: string | null; gone?: boolean } | null>(() => (
        morphPlan?.kind === 'morph' ? { coverUrl: morphPlan.coverUrl ?? null, title: morphPlan.title ?? null } : null
    ));
    const standInCardRef = useRef<HTMLDivElement>(null);
    const standInHandoverRef = useRef<StandInHandover | null>(null);
    const pageExit = useMorphPageExit();
    // What the cards enter by. A page a cover flew to keeps its plan for as long as the stand-in
    // shows: its cards may come seconds after the flight, and still take the hero's place under it.
    // And until the hero has come to rest: the plan's end renders every card again, which is
    // not to fall into the middle of the hero's turn.
    // The plan's kind and not the plan: the page's own plan takes over from the flight's when that
    // is taken back (at landing), and every card would be rendered again for a plan that says the same.
    const entranceKind = morphPlan?.kind ?? (standIn ? 'morph' : null);
    const containerRef = useRef<HTMLDivElement>(null);
    const dragControls = useDragControls();
    const [focusedIndex, setFocusedIndex] = useState(0);
    const focusedIndexRef = useRef(0);
    const pendingFocusCommitTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isDraggingRef = useRef(false);
    const wheelTargetRef = useRef({ x: 0, y: 0 });
    const pendingRestoreStateRef = useRef<GridRestoreTarget | null>(null);
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
        const box = resolveGridViewCardBox(width);
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
        minScale: minCardScale,
        minOpacity: minCardOpacity,
    }), [
        clipRadius,
        containerSize.height,
        containerSize.width,
        layoutConfig.cardHeight,
        layoutConfig.cardWidth,
        layoutConfig.lodEnd,
        layoutConfig.lodStart,
        layoutConfig.maxDistance,
        minCardOpacity,
        minCardScale,
    ]);

    // 恢复记录按集合身份分开存：只用 id 时，不同来源、不同 provider 下同 id 的集合会互相恢复对方的焦点和筛选。
    const collectionIdentity = collection?.source ? collectionKey(collection) : '';
    const navigationStorageKey = useMemo(() => {
        if (mode !== 'tracks' || !collection) return null;
        return gridViewStateStorageKey(collectionIdentity || collection.name || title);
    }, [collection, collectionIdentity, mode, title]);
    // 浏览会话（筛选词、看到哪首）的键：与列表等别的 renderer 共用，换 renderer 时会话还在。
    const sessionKey = collectionIdentity || `${mode}:${title}`;
    // 恢复目标在挂载时定下（网格按集合 key 挂载）：恢复 effect 和移形换影的 hero 用同一份。
    const [initialRestoreTarget] = useState<GridRestoreTarget | null>(() => (
        navigationStorageKey
            ? resolveGridRestoreTarget(readStoredGridViewState(navigationStorageKey), getLibraryBrowseSession(sessionKey))
            : null
    ));

    // 曲目来自集合资源：加载、缓存、后台补页、错误都在资源里。拖拽中到达的分页先暂存，松手再提交——
    // 整表更新会重算网格项并重渲染整个渲染环，不能和拖拽抢主线程。
    // 删卡的退出动画也靠这道门：动画期间按住展示（holdPresentation），资源与变更控制器照常立即提交。
    const {
        snapshot: resourceSnapshot,
        flushHeld: flushHeldResourceSnapshot,
        holdPresentation,
        releasePresentation,
    } = useCollectionResourceState(resource, {
        holdBackground: () => isDraggingRef.current,
    });
    const tracks = resourceSnapshot?.tracks ?? EMPTY_TRACKS;
    const isOnlineResource = resource?.kind === 'online';
    const loading = resourceSnapshot ? resourceSnapshot.status === 'idle' || resourceSnapshot.status === 'loading' : false;
    const backgroundLoading = resourceSnapshot?.sync.status === 'syncing';
    // 后台补齐中断时记下原因和上游 offset：界面要能说明为什么少了歌，重试要从中断处续上。
    const backgroundLoadError = resourceSnapshot?.sync.status === 'interrupted'
        ? { message: resourceSnapshot.sync.message, offset: resourceSnapshot.sync.offset, cause: resourceSnapshot.sync.cause }
        : null;
    // 在线集合加载失败必须和「集合确实是空的」分开显示：两者都渲染成空网格的话，
    // provider 侧的鉴权、协议或网络故障在界面上就完全不可见。
    // 存判别式而不是成品文案：翻译要在渲染时做，切换语言才能跟着变。
    const loadError = resourceSnapshot?.error ?? null;
    // An online collection's failure, sorted into a named case (onlineFailureOf) from what was
    // thrown, which the resource hands on: the empty page and the background banner say which case
    // it is, and not the program's own sentence.
    const collectionProviderId = collection?.source === 'online' ? collection.providerId : undefined;
    const failureOf = (cause: unknown, notPublic = false): OnlineFailure => onlineFailureOf(
        { operation: 'collection', providerId: collectionProviderId },
        cause !== undefined ? { error: cause } : { detail: notPublic ? { case: 'not-public' } : {} },
    );
    const loadFailure = loadError && isOnlineResource ? failureOf(loadError.cause, loadError.kind === 'not-public') : null;
    const backgroundFailure = backgroundLoadError ? failureOf(backgroundLoadError.cause) : null;
    const collectionDetail = resourceSnapshot?.detail ?? null;
    // 变更动作的状态（订阅、每日推荐的日期与次数、进行中标记、候选歌单）、来源分支与能力都在控制器里，
    // 网格只订阅；按钮的可见 / 可点条件是原先 GridView 的分支布尔逐字搬过去的（见 collectionMutationCapabilities）。
    const mutationSnapshot = useCollectionMutationSnapshot(mutations);
    const { branches: mutationBranches, capabilities: mutationCapabilities } = mutationSnapshot;
    const isSourceActionPending = mutationSnapshot.sourceActionPending;
    const [removingTrackKeys, setRemovingTrackKeys] = useState<Set<string>>(() => new Set());
    const trackRemovalTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
    const trackRemovalSeqRef = useRef(0);
    // 本地排序选择跨 renderer 共用（见 useLocalTrackSortStore）。
    const localTrackSortField = useLocalTrackSortStore(state => state.field);
    const localTrackSortDirection = useLocalTrackSortStore(state => state.direction);
    const handleLocalTrackSortFieldChange = useLocalTrackSortStore(state => state.setField);
    const handleLocalTrackSortDirectionChange = useLocalTrackSortStore(state => state.setDirection);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editableTitle, setEditableTitle] = useState(title);
    const [isPlaylistPickerOpen, setIsPlaylistPickerOpen] = useState(false);
    const [isCreatePlaylistOpen, setIsCreatePlaylistOpen] = useState(false);
    const [isDeleteFolderOpen, setIsDeleteFolderOpen] = useState(false);
    const [showCutInPanel, setShowCutInPanel] = useState(false);
    const [showSidePanel, setShowSidePanel] = useState(false);
    // 退场动画期间旧网格仍挂着：只有在场的那一个接键盘、筛选框和命令面板，
    // 否则在上一个网格还没退完时按下的 Enter 会落到它身上。
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    // The filter box is the command palette now; this grid only says who owns typing and where the
    // box belongs. See useGridCommandFilter for why all three grids stopped carrying their own.
    // 筛选词存在浏览会话里（见 useLibrarySessionQuery），换 renderer 不丢。
    const { query: searchQuery, setQuery: setSearchQuery, port: searchQueryPort } = useLibrarySessionQuery(sessionKey);
    const isFiltering = useGridCommandFilter({
        isInteractive: isActive,
        port: searchQueryPort,
        // The box used to be an absolutely positioned child of the canvas; it still is.
        anchorRef: containerRef,
        reopenIfFiltered: true,
    });
    const deferredSearchQuery = useCommittedQuery(searchQuery);

    // 删除的结果可能在网格卸载之后才回来（控制器属于集合会话，不随网格卸载）：那时什么都不用做。
    const isMountedRef = useRef(false);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Keeps a successfully removed card on screen until its flip-and-fade transition finishes: the resource
    // has already dropped it, the held presentation keeps showing the frame from before until the release.
    const playTrackRemovalAnimation = useCallback((trackKey: string, holdToken: string) => {
        setRemovingTrackKeys(current => new Set(current).add(trackKey));
        const timeout = setTimeout(() => {
            trackRemovalTimeoutsRef.current.delete(trackKey);
            releasePresentation(holdToken);
            setRemovingTrackKeys(current => {
                const next = new Set(current);
                next.delete(trackKey);
                return next;
            });
        }, TRACK_REMOVAL_ANIMATION_MS);
        trackRemovalTimeoutsRef.current.set(trackKey, timeout);
    }, [releasePresentation]);

    useEffect(() => () => {
        trackRemovalTimeoutsRef.current.forEach(timeout => clearTimeout(timeout));
        trackRemovalTimeoutsRef.current.clear();
    }, []);

    const collectionSource = collection?.source as string | undefined;
    const isLocalCollection = collectionSource === 'local';
    const isNavidromeCollection = collectionSource === 'navidrome';
    const isAlbumCollection = collection?.type === 'album';
    const isDailyRecommendationsCollection = collectionSource === 'online' && collection?.type === 'daily_recommendations';
    // 每日推荐自带「刷新」，私人 FM 不分页；其余在线集合都能跳过缓存整张重新拉取。
    const canReloadOnlineCollection = mode === 'tracks'
        && collectionSource === 'online'
        && isOnlineResource
        && !isDailyRecommendationsCollection
        && collection?.type !== 'radio';
    // 本地排序只给文件夹（含虚拟的「全部歌曲」）：这是视图规则，不随变更能力走。
    const supportsLocalTrackSorting = isLocalCollection && collection?.type === 'folder';
    const {
        isLocalFolderCollection,
        canEditOwnedPlaylist,
        canEditProviderPlaylist,
        canEditPlaylist,
        showSubscribeButton,
        isOnlineAlbum,
        canAddNavidromeToPlaylist,
    } = mutationBranches;
    // 改名成功、宿主的描述还没跟上时，显示控制器记下的新名字（不改描述本身，它可能是导航栈里共用的对象）。
    const collectionName: string | undefined = mutationSnapshot.renamedTo ?? collection?.name;
    // 收进速记簿时记下的出处：和标题一样用改名后的名字。身份稳定：onCollectTrack 在卡片渲染的依赖里。
    const onCollectTrack = useMemo(() => {
        if (!collectTrack) return undefined;
        const origin = collectionName ? { label: collectionName } : undefined;
        return (track: SongResult) => collectTrack([track], origin);
    }, [collectTrack, collectionName]);
    const onCollectAll = useMemo(() => {
        if (!collectScope) return undefined;
        const origin = collectionName ? { label: collectionName } : undefined;
        return (songs: SongResult[]) => collectScope(songs, origin);
    }, [collectScope, collectionName]);
    const localSongsById = useMemo(() => new Map(localSongs?.map(song => [song.id, song])), [localSongs]);
    // 只有能选专辑号排序的本地列表才挂轨道号；本地歌单等自定义顺序的列表不属于这个语境。
    const getAlbumTrackLabel = useCallback((track: SongResult): string | null => {
        if (!supportsLocalTrackSorting) return null;
        const localRef = (track as UnifiedSong).localRef;
        if (!localRef) return null;
        const localSong = localSongsById.get(localRef.songId);
        return localSong ? formatLocalAlbumTrackLabel(localSong) : null;
    }, [localSongsById, supportsLocalTrackSorting]);
    // 隐藏、本地排序、筛选与操作范围的规则见 library/core/collection/collectionView（专辑归属以本地曲库的
    // 专辑实体为准）；别的 renderer 用同一个 hook，所以同一个筛选在两边命中同一批歌。
    const localSortContext = useMemo(() => (
        supportsLocalTrackSorting
            ? { songsById: localSongsById, field: localTrackSortField, direction: localTrackSortDirection }
            : null
    ), [localSongsById, localTrackSortDirection, localTrackSortField, supportsLocalTrackSorting]);
    const collectionView = useCollectionView({
        tracks,
        committedQuery: mode === 'tracks' ? deferredSearchQuery : '',
        localSort: localSortContext,
    });
    const {
        displayTracks,
        playableTracks,
        matchIndexes,
        contextTracks: contextActionTracks,
        occurrences: trackOccurrences,
    } = collectionView;

    useEffect(() => {
        if (isDraggingRef.current || pendingFocusCommitTimeoutRef.current) return;
        focusedIndexRef.current = focusedIndex;
    }, [focusedIndex]);

    useEffect(() => {
        setEditableTitle(title);
        setIsEditMode(false);
    }, [collection?.id, title]);

    useEffect(() => {
        hasRestoredNavigationRef.current = false;
        pendingRestoreStateRef.current = initialRestoreTarget;
    }, [initialRestoreTarget]);

    const canRename = mutationCapabilities.rename.supported;
    const canMatchSong = mutationCapabilities.matchSong.supported;
    const handleSourceEditToggle = useCallback(async () => {
        if (!collection) return;

        if (!isEditMode) {
            setEditableTitle(collectionName || title);
            setIsEditMode(true);
            return;
        }

        // 改名经控制器（空名字或没变时它直接返回 ok）；没改成就留在编辑模式。不能改名的集合（每日推荐）直接退出。
        if (canRename && mutations) {
            const result = await mutations.rename(editableTitle);
            if (!result.ok) return;
        }
        setIsEditMode(false);
    }, [
        canRename,
        collection,
        collectionName,
        editableTitle,
        isEditMode,
        mutations,
        title,
    ]);

    // 删除成功才返回上一层（文件夹先经确认对话框）。
    const handleDeleteSourceCollection = useCallback(async () => {
        const result = await mutations?.deleteCollection();
        if (result?.ok) onBack();
    }, [mutations, onBack]);

    const handleResyncLocalFolder = useCallback(() => void mutations?.resyncFolder(), [mutations]);
    const handleResyncAllLocalFolders = useCallback(() => void mutations?.resyncAllFolders(), [mutations]);
    const handleExportLocalPlaylist = useCallback(() => void mutations?.exportPlaylist(), [mutations]);
    const handleOrganizeSongInfo = useCallback(() => void mutations?.organizeSongInfo(), [mutations]);
    const handleEditEntity = useCallback(() => void mutations?.editEntity(), [mutations]);
    const handleSetCover = useCallback(() => void mutations?.setCover(), [mutations]);

    const handleAddNavidromeCollectionToPlaylist = useCallback(async (playlistId: string | number) => {
        await mutations?.addToPlaylist(playlistId, playableTracks);
    }, [mutations, playableTracks]);

    const handleCreateNavidromePlaylist = useCallback(async (name: string) => {
        const result = await mutations?.createPlaylist(name, playableTracks);
        if (result?.ok) setIsCreatePlaylistOpen(false);
    }, [mutations, playableTracks]);

    // 续传、重新拉取都交给资源；资源负责作废晚到的旧结果。
    const resumeBackgroundSync = () => resource?.resumeSync();
    const reloadOnlineCollection = () => resource?.reload();

    // An owned online playlist edits in place; a local or Navidrome one commits a rename on the way
    // out. Shared so the command palette and the panel button cannot end up meaning different things.
    const handleEditModeToggle = useCallback(() => {
        if (canEditOwnedPlaylist || canEditProviderPlaylist) {
            setIsEditMode(prev => !prev);
            return;
        }
        void handleSourceEditToggle();
    }, [canEditOwnedPlaylist, canEditProviderPlaylist, handleSourceEditToggle]);

    // 订阅状态在控制器第一次被订阅时取。星星一按就变：控制器先改显示，再在后台问平台，请求期间再按只改「要的」，
    // 请求跟着它走；平台没答应时星星回到平台上的样子，这里说一句（按下时的那一页已经关了也说）。
    const playlistSubscribed = mutationSnapshot.subscribed;
    const [starPresses, setStarPresses] = useState(0);
    const handleToggleSubscribe = async () => {
        if (!mutations) return;
        setStarPresses(count => count + 1);
        const result = await mutations.toggleSubscribe();
        if (!result.ok && result.reason === 'failed') {
            onStatusMessage?.({
                type: 'error',
                text: t(mutations.getSnapshot().subscribed ? 'status.collectionUnsaveFailed' : 'status.collectionSaveFailed'),
                nonce: Date.now(),
            });
        }
    };

    // Switches the virtual playlist between today's recommendations and a supported history date.
    const handleDailyRecommendationDateChange = useCallback(async (date: string, afresh = false) => {
        if (!mutations || !mutationCapabilities.dailyDate.supported) return;
        setIsEditMode(false);
        // 整表替换经控制器交给资源（加载中状态、作废晚到结果都在那里）；失败时保持原样，日期也不切。
        await mutations.setDailyDate(date, { afresh });
    }, [mutationCapabilities.dailyDate.supported, mutations]);

    // 删一个条目（每日推荐是「不喜欢并换一首」）：先按住展示，控制器在上游确认后立即提交给资源；成功就给卡片
    // 打上 removing 播退出动画，动画结束再放开展示，失败立即放开。entryKey 就是卡片 id：重复序号在完整的
    // 展示列表上算（不受筛选影响），控制器自己在资源里解出原始下标。
    const handleRemoveTrack = useCallback(async (track: SongResult, entryKey: string) => {
        if (!mutations || trackRemovalTimeoutsRef.current.has(entryKey)) return;
        trackRemovalSeqRef.current += 1;
        // 每次点击一个 token：同一张卡连点时，被挡掉（busy）的那一次只放开自己的，不会提前放开第一次的。
        const holdToken = `remove:${entryKey}:${trackRemovalSeqRef.current}`;
        holdPresentation(holdToken);
        let result: LibraryMutationResult;
        try {
            result = await mutations.removeEntry({ entryKey, track });
        } catch (error) {
            console.error('Failed to remove track in GridView', error);
            result = { ok: false, reason: 'failed' };
        }
        if (!isMountedRef.current) return;
        if (result.ok) {
            playTrackRemovalAnimation(entryKey, holdToken);
            return;
        }
        releasePresentation(holdToken);
        if (result.reason === 'limit-reached') {
            onStatusMessage?.({
                type: 'info',
                text: t('home.noMoreDailyRecommendations'),
                nonce: Date.now(),
            });
        } else if (result.reason === 'failed') {
            onStatusMessage?.({
                type: 'error',
                text: isDailyRecommendationsCollection ? t('home.dislikeRecommendationFailed') : t('home.removeTrackFailed'),
                nonce: Date.now(),
            });
        }
    }, [
        holdPresentation,
        isDailyRecommendationsCollection,
        mutations,
        onStatusMessage,
        playTrackRemovalAnimation,
        releasePresentation,
        t,
    ]);

    // 网格项**惰性**塑形（见 lazyGridItems.ts）：length 立刻可用，真对象只在被读到下标时才塑形。
    // 原来整表 map 一遍，5000 首实测 120ms，而分页每来一页都要重算 —— 大歌单打开时卡在这里。
    // 重复序号由集合视图维护（分页追加时复用前缀），与条目键是同一份。
    const allGridItems = useMemo((): GridItem[] => {
        if (mode === 'collection') {
            return items || [];
        }
        return createLazyGridItems(displayTracks, trackOccurrences);
    }, [mode, items, displayTracks, trackOccurrences]);

    // 曲目模式按曲目本身做匹配，只取命中的网格项：不必为了筛选把整张歌单的卡片都塑形一遍。
    const gridItems = useMemo(() => {
        if (mode === 'tracks') {
            return matchIndexes ? matchIndexes.map(index => allGridItems[index]) : allGridItems;
        }
        // 集合模式（目前没有调用方）沿用对网格项的匹配。
        const query = deferredSearchQuery.trim().toLowerCase();
        if (!query) return allGridItems;

        return allGridItems.filter((item) => {
            const track = item.rawTrack;
            const searchableText = [
                item.searchText,
                typeof item.name === 'string' ? item.name : undefined,
                item.description,
                track?.album?.name,
                track?.artists?.map((artist) => artist.name).join(' '),
            ]
                .filter((value) => value !== undefined && value !== null)
                .join(' ')
                .toLowerCase();

            return searchableText.includes(query);
        });
    }, [allGridItems, deferredSearchQuery, matchIndexes, mode]);
    const hasSearchQuery = deferredSearchQuery.trim().length > 0;
    const shouldAnimateItemEntrance = useProgressiveItemEntrance(
        `${mode}:${collectionIdentity || title}`
    );

    // Coordinate motion values mapping grid drags
    const dragX = useMotionValue(0);
    const dragY = useMotionValue(0);

    // 「看到哪首」以条目键写进浏览会话（别的 renderer 也认），网格自己的布局另存一份。
    const persistNavigationState = useCallback((index: number) => {
        if (!navigationStorageKey) return;

        const safeIndex = Math.max(0, Math.min(index, Math.max(gridItems.length - 1, 0)));
        const focusedEntryKey = gridItems[safeIndex] ? String(gridItems[safeIndex].id) : undefined;
        const state: StoredGridViewNavigationState = {
            focusedEntryKey,
            focusedIndex: safeIndex,
            dragX: dragX.get(),
            dragY: dragY.get(),
        };

        sessionStorage.setItem(navigationStorageKey, JSON.stringify(state));
        useLibraryBrowseSessionStore.getState().setFocusedEntry(sessionKey, focusedEntryKey ?? null);
    }, [dragX, dragY, gridItems, navigationStorageKey, sessionKey]);

    // 切换 renderer 之前，切换器会让当前网格把焦点写回会话。写的是已提交的焦点（Enter 播放的那张），
    // 不是拖拽帧循环里的 focusedIndexRef：筛选刚变化时那个值可能还来自旧的渲染环。
    const committedFocusIndexRef = useRef(focusedIndex);
    committedFocusIndexRef.current = focusedIndex;
    useEffect(() => registerLibrarySessionFlush(sessionKey, () => persistNavigationState(committedFocusIndexRef.current)), [
        persistNavigationState,
        sessionKey,
    ]);

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
    // 封面按需取：预加载只需要「视口附近那几个下标」的封面，不必先把整张歌单的 URL 映成数组
    // （5000 首那种列表里，这个数组以前每页都要重建一次）。
    const getItemCoverUrl = useCallback(
        (index: number) => gridItems[index]?.coverUrl,
        [gridItems],
    );
    useLocalCoverPreloader(gridItems.length, getItemCoverUrl, renderedIndexes);

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

    // Keep the focused card centred when the spacing of the cards changes (the window crossed a
    // size breakpoint): the offset the grid stands at then points somewhere else. Cards that
    // join the ones there move nothing: every card keeps its place, and so does the view.
    useEffect(() => {
        if (baseCoords.length > 0 && focusedIndex >= 0 && focusedIndex < baseCoords.length) {
            const targetX = -baseCoords[focusedIndex].baseX;
            const targetY = -baseCoords[focusedIndex].baseY;
            dragX.set(targetX);
            dragY.set(targetY);
            updateRenderedIndexesForViewport(targetX, targetY, true);
        }
    }, [layoutConfig.spacingX, layoutConfig.spacingY]);

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

        const restoredIndex = resolveGridRestoreIndex({
            target: pendingState,
            itemCount: gridItems.length,
            findEntryIndex: collectionView.findEntryIndex,
            matchIndexes,
        });
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
    }, [baseCoords, collectionView.findEntryIndex, commitFocusedIndex, dragX, dragY, gridItems.length, matchIndexes, updateRenderedIndexesForViewport]);

    const handleViewportWheel = useCallback((event: WheelEvent) => {
        if (gridItems.length === 0 || event.ctrlKey) return;
        if (event.target instanceof Element && event.target.closest('[data-wheel-scroll-region]')) return;

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

    // Centre on the first card when cards first appear, and when the filter changes which ones
    // are shown. Not when further cards join the ones there: an online collection is read page
    // by page (15 or 100 songs a page on YouTube Music), and every page that arrived pulled the
    // listener back to the first card from wherever they had scrolled to.
    const firstCardShownForRef = useRef<string | null>(null);
    useEffect(() => {
        if (gridItems.length === 0) {
            firstCardShownForRef.current = null;
            return;
        }
        if (pendingRestoreStateRef.current && !hasRestoredNavigationRef.current) return;
        const shownFor = firstCardShownForRef.current;
        firstCardShownForRef.current = deferredSearchQuery;
        if (hasRestoredNavigationRef.current) return;
        if (shownFor !== deferredSearchQuery) {
            centerOnIndex(0, false);
        }
    }, [deferredSearchQuery, gridItems.length]);

    useEffect(() => {
        if (!isActive) return;

        // Typing itself is the palette's now; what stays here is the Escape ladder, which is about
        // this grid's own panels and has nothing to do with the filter box.
        const handleEscape = (event: KeyboardEvent) => {
            const target = event.target;
            if (
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                (target instanceof HTMLElement && target.isContentEditable)
            ) {
                return;
            }

            // A window above (e.g. the lyrics timeline opened from the bottom bar) owns its own
            // Escape; auto-repeat would walk the whole ladder and leave the grid.
            if (event.key !== 'Escape' || event.repeat || hasBlockingWindow()) {
                return;
            }

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
    }, [isActive, onBack, searchQuery, showCutInPanel, showSidePanel]);

    useEffect(() => {
        updateRenderedIndexesForViewport(dragX.get(), dragY.get(), true);
    }, [dragX, dragY, updateRenderedIndexesForViewport]);

    // Memoize only the nearby card set so React keeps heavy image/button trees out of the drag hot path
    // The card the viewport will actually centre on. GridView restores its
    // scroll/focus from sessionStorage in an EFFECT (after first paint), while
    // React's focusedIndex is still 0 when the cards first render — radiating
    // the fly-in from index 0 of a grid that immediately restores elsewhere is
    // what left the cascade skewed. Reading the same session state GridView
    // restores from (through the same resolver the restore effect uses) keeps
    // the origin exact from frame zero; -1 (restored search filter, whose items
    // are not filtered yet) skips the morph entrance and uses the plain one.
    const morphHeroIndex = useMemo(() => {
        if (mode === 'tracks' && initialRestoreTarget) {
            if (initialRestoreTarget.hadQuery) {
                return -1;
            }
            const restored = resolveGridRestoreIndex({
                target: initialRestoreTarget,
                itemCount: gridItems.length,
                findEntryIndex: collectionView.findEntryIndex,
                matchIndexes,
            });
            if (restored >= 0) {
                return restored;
            }
        }
        return gridItems.length === 0
            ? -1
            : Math.max(0, Math.min(focusedIndex, gridItems.length - 1));
    }, [collectionView.findEntryIndex, focusedIndex, gridItems.length, initialRestoreTarget, matchIndexes, mode]);

    const cardFlyInOffset = useMemo(() => {
        // The hero is the card the restored viewport actually centres on, NOT
        // index 0: a resumed grid may be scrolled anywhere, and radiating from
        // a stale index-0 slot skews the whole cascade.
        const heroIndex = morphHeroIndex;
        if (!entranceKind || heroIndex < 0 || baseCoords[heroIndex] === undefined) {
            return null;
        }
        const hero = baseCoords[heroIndex];
        // 入场的推进距离是短距离的「就位」，不是从屏幕外飞进来（见 morphGeometry 的说明）。
        const reach = collectionMorphEntranceTravel(containerSize);
        const spacing = Math.max(layoutConfig.spacingX, layoutConfig.spacingY) || 1;
        return { hero, reach, spacing };
    }, [baseCoords, containerSize, layoutConfig.spacingX, layoutConfig.spacingY, morphHeroIndex, entranceKind]);

    const memoizedCards = useMemo(() => {
        return renderedIndexes.map((idx) => {
            const item = gridItems[idx];
            const coord = baseCoords[idx];
            if (!item || !coord) return null;

            const initialDx = dragX.get();
            const initialDy = dragY.get();
            const initialFrame = computeHexCardFrame(coord, initialDx, initialDy, cardFrameOptions);

            const animateEntrance = shouldAnimateItemEntrance(String(item.id));
            const trackKey = String(item.id);
            const isRemovingTrack = removingTrackKeys.has(trackKey);
            // 「移形换影」: the hero (the card the viewport restores onto + centres)
            // stays in its place while `kind === 'morph'` (the stand-in covers it,
            // and hands over to it); every other card that is actually on screen
            // settles into its slot from a short radial push, staggered by distance.
            //
            // 屏外的卡不参与：渲染环本身带 200px 缓冲，那些卡用户根本看不见，却要付一次
            // 动画（大歌单打开时正是这些并发的动画和首帧的挂载一起把主线程压住）。
            const cardOnScreen = initialFrame.display !== 'none' && Number.parseFloat(initialFrame.opacity) > 0.05;
            const isMorphHero = Boolean(entranceKind === 'morph' && cardFlyInOffset && idx === morphHeroIndex);
            const isMorphFlyIn = Boolean(entranceKind && cardFlyInOffset && cardOnScreen && !isMorphHero);
            const morphFlyIn = isMorphFlyIn
                ? collectionMorphFlyIn(
                    { x: coord.baseX, y: coord.baseY },
                    { x: cardFlyInOffset!.hero.baseX, y: cardFlyInOffset!.hero.baseY },
                    cardFlyInOffset!.spacing,
                    cardFlyInOffset!.reach,
                    collectionMorphSeed(String(item.id)),
                )
                : null;
            return (
                <div
                    key={`${mode}-${item.id}`}
                    {...{ [GRID_CARD_ITEM_ID_ATTR]: String(item.id) }}
                    ref={(el) => {
                        if (el) {
                            cardWrapperRefs.current[idx] = el;
                            cardFrameStyleCachesRef.current[idx] = createHexCardFrameStyleCache(initialFrame);
                            return;
                        }

                        if (cardWrapperRefs.current[idx]?.dataset.foliaGridItemId === String(item.id)) {
                            cardWrapperRefs.current[idx] = null;
                            cardFrameStyleCachesRef.current[idx] = undefined;
                        }
                    }}
                    className="absolute select-none pointer-events-auto folia-grid-card-frame"
                    style={{
                        transformOrigin: 'center center',
                        contain: 'layout style',
                        backfaceVisibility: 'hidden',
                        perspective: '1200px',
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
                    <motion.div
                        // The fly-in is the card's own Web Animation, begun in the commit that
                        // mounts it (see morphFlyIn.ts). To framer the card is at rest from the start.
                        ref={morphFlyIn ? card => playFlyIn(card, morphFlyIn) : undefined}
                        initial={isMorphHero
                            // Not shown until the stand-in hands over to it: the handover
                            // holds it and brings it in (standInHandover.ts).
                            ? false
                            : isMorphFlyIn
                                ? false
                                : animateEntrance
                                    ? { opacity: 0, scale: 0.98, rotateY: -90 }
                                    : false}
                        animate={isRemovingTrack
                            ? { opacity: [1, 1, 0], scale: [1, 0.98, 0.96], rotateY: [0, 180, 180] }
                            : {
                                // Key set must be identical across branches: if `rotate`
                                // appears only in the fly-in branch and the plan expires
                                // mid-flight, the key vanishes from animate and the card
                                // freezes at its crooked in-between angle forever.
                                opacity: 1,
                                x: 0,
                                y: 0,
                                scale: 1,
                                rotate: 0,
                                rotateY: 0,
                            }}
                        exit={{
                            opacity: 0,
                            scale: 0.98,
                            rotateY: 90,
                            transition: { duration: 0.36, ease: [0.4, 0, 0.2, 1] },
                        }}
                        transition={isRemovingTrack
                            ? { duration: TRACK_REMOVAL_ANIMATION_MS / 1000, times: [0, 0.72, 1], ease: TRACK_REMOVAL_BEZIER }
                            : entranceKind
                                ? { duration: 0.01 }
                                : { duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
                        style={{
                            transformStyle: 'preserve-3d',
                            transformOrigin: 'center center',
                            willChange: 'transform, opacity',
                            pointerEvents: isRemovingTrack ? 'none' : undefined,
                            position: 'relative',
                        }}
                    >
                        <div style={{ backfaceVisibility: 'hidden' }}>
                            <PolaroidCard
                                item={item}
                                isDaylight={isDaylight}
                                theme={theme}
                                mode={mode}
                                t={t}
                                cardWidth={layoutConfig.cardWidth}
                                cardHeight={layoutConfig.cardHeight}
                                fullBleedCover={fullBleedCover}
                                isEditMode={isEditMode}
                                onRemoveTrack={isRemovingTrack ? undefined : () => {
                                    if (item.rawTrack) void handleRemoveTrack(item.rawTrack, trackKey);
                                }}
                                onSelectArtist={onSelectArtist}
                                onSelectAlbum={onSelectAlbum}
                                onBeforeNestedNavigate={() => {
                                    persistNavigationState(idx);
                                }}
                                onEditLocalMetadata={(() => {
                                    const track = item.rawTrack;
                                    const songId = (track as UnifiedSong | undefined)?.localRef?.songId;
                                    if (!track || !songId || !canMatchSong) return undefined;
                                    return () => void mutations?.matchSong(track);
                                })()}
                                onSelect={() => {
                                    if (mode === 'tracks' && onSelectTrack && item.rawTrack) {
                                        persistNavigationState(idx);
                                        onSelectTrack(item.rawTrack, contextActionTracks);
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
                                // 只在聚焦的那张上给：每张卡都多一颗按钮太挤（与 Bravais 的聚焦卡「⋯」同一个位置感）。
                                onCollect={idx === focusedIndex && mode === 'tracks' && onCollectTrack && item.rawTrack
                                    ? () => onCollectTrack(item.rawTrack!)
                                    : undefined}
                                isFocused={idx === focusedIndex}
                                playbackMark={mode === 'tracks' ? trackPlaybackMark?.(item.rawTrack) ?? null : null}
                            />
                        </div>
                        <div
                            aria-hidden="true"
                            className="absolute inset-0 rounded-xl border shadow-lg theme-polaroid-card flex items-center justify-center"
                            style={{
                                backfaceVisibility: 'hidden',
                                transform: 'rotateY(180deg)',
                            }}
                        >
                            <div className="w-[58%] aspect-square rounded-full border border-current flex items-center justify-center opacity-30">
                                <Disc className="w-1/2 h-1/2" />
                            </div>
                        </div>
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
        mode,
        t,
        layoutConfig.cardWidth,
        layoutConfig.cardHeight,
        cardFrameOptions,
        fullBleedCover,
        isEditMode,
        focusedIndex,
        contextActionTracks,
        onSelectTrack,
        onSelectCollection,
        onSelectArtist,
        onSelectAlbum,
        onAddTrackToQueue,
        onCollectTrack,
        trackPlaybackMark,
        canMatchSong,
        mutations,
        handleRemoveTrack,
        removingTrackKeys,
        persistNavigationState,
        shouldAnimateItemEntrance,
        cardFlyInOffset,
        morphHeroIndex,
        entranceKind,
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
        if (!isActive) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target;
            if (
                target instanceof HTMLElement
                && (target.isContentEditable || Boolean(target.closest('button, input, select, textarea, a[href]')))
            ) return;

            if (e.key === 'Enter') {
                if (
                    e.repeat
                    || isEditMode
                    || isFiltering
                    || showSidePanel
                    || showCutInPanel
                    || isPlaylistPickerOpen
                    || isCreatePlaylistOpen
                    || isDeleteFolderOpen
                ) return;

                const focusedItem = gridItems[focusedIndex];
                if (!focusedItem) return;
                if (mode === 'tracks' && onSelectTrack && focusedItem.rawTrack) {
                    e.preventDefault();
                    persistNavigationState(focusedIndex);
                    onSelectTrack(focusedItem.rawTrack, contextActionTracks);
                } else if (mode === 'collection' && onSelectCollection) {
                    e.preventDefault();
                    onSelectCollection(focusedItem.rawCollection || focusedItem);
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
        contextActionTracks,
        focusedIndex,
        gridItems,
        isCreatePlaylistOpen,
        isDeleteFolderOpen,
        isEditMode,
        isActive,
        isPlaylistPickerOpen,
        mode,
        onSelectCollection,
        onSelectTrack,
        persistNavigationState,
        isFiltering,
        showCutInPanel,
        showSidePanel,
    ]);

    const progressiveLoading = deriveProgressiveLoadingState(
        gridItems.length,
        isLoading || (mode === 'tracks' && loading),
        backgroundLoading
    );
    const showLoading = progressiveLoading.initialLoading;
    // The stand-in hands over to the hero card (standInHandover.ts). Looked at after every
    // commit: the handover starts in the commit that mounts the hero, which is held out of sight
    // from then on, and is told once the flight to the stand-in is over (the plan is gone). The
    // stand-in goes when the handover says so.
    useLayoutEffect(() => {
        const standInCard = standInCardRef.current;
        if (!standIn || !standInCard) {
            standInHandoverRef.current?.cancel();
            standInHandoverRef.current = null;
            return;
        }
        if (!standInHandoverRef.current) {
            const hero = cardWrapperRefs.current[morphHeroIndex]?.firstElementChild;
            const hasHero = hero instanceof HTMLElement;
            // No hero is to come to a page whose flight is over and that has stopped reading
            // with no cards, or shows cards with the hero not among them. Cards that have been
            // read are mounted a commit later: until then one may come.
            const noHeroToCome = !morphPlan && !showLoading && (gridItems.length === 0 || renderedIndexes.length > 0);
            if (hasHero || noHeroToCome) {
                standInHandoverRef.current = handOverStandIn(
                    standInCard,
                    hasHero ? hero : null,
                    () => setStandIn(current => current && { ...current, gone: true }),
                    () => setStandIn(null),
                );
            }
        }
        if (!morphPlan) standInHandoverRef.current?.land();
    });
    useEffect(() => () => {
        standInHandoverRef.current?.cancel();
        standInHandoverRef.current = null;
    }, []);

    // "Where is the song that is playing" (app/playing-song-locator/playingSongLocator.ts): this page answers the
    // question put to it. A song among its cards is centred. One that is not is reported once no
    // filter hides any card: at once to the page's own button, and to a question the page was
    // opened for once no further card can come. The answer is that the song is not here where
    // the list is whole, and that the page cannot tell where it is not (cards are still to come,
    // or the reading failed). Declared after the effects that place the grid when it opens, so
    // that on a page opened for this the song's card is where it ends.
    const playingSongKey = usePlaybackStore(state => (state.currentSong ? getPlaybackSongKey(state.currentSong) : null));
    const locateRequest = usePlayingSongLocatorStore(state => state.request);
    const isPlayingSongHere = useMemo(() => (
        mode === 'tracks' && playingSongKey !== null && displayTracks.some(track => getPlaybackSongKey(track) === playingSongKey)
    ), [displayTracks, mode, playingSongKey]);
    // Further cards may still come while the resource reads its first page or fills the rest in
    // the background; a read that failed (the first page, a page of the background fill, or a
    // Navidrome read) brings nothing more and leaves the list short of what it did not reach. The
    // snapshot says both in one update with the tracks they speak of.
    const hasReadFailed = Boolean(loadError || backgroundLoadError);
    const cardsStillArriving = isLoading || loading || backgroundLoading;
    const pageKey = navigationKey ?? collectionKey(collection);
    const isLocateAsked = locateRequest !== null && mode === 'tracks' && locateRequest.collectionKey === pageKey;
    const locateOnThisPage = useCallback(() => locatePlayingSongOnPage(pageKey), [pageKey]);
    // Counts the times the song was found: the list beside the grid goes to its row each time,
    // also when the grid already stood on its card.
    const [locatedTimes, setLocatedTimes] = useState(0);
    // The row of the focused card in that list. The list holds every track; under a filter the
    // grid has fewer cards, and the card's index among them is another song's row.
    const listFocusedIndex = useMemo(() => {
        const track = hasSearchQuery ? gridItems[focusedIndex]?.rawTrack : undefined;
        const row = track ? displayTracks.indexOf(track) : -1;
        return row >= 0 ? row : focusedIndex;
    }, [displayTracks, focusedIndex, gridItems, hasSearchQuery]);
    useEffect(() => {
        if (!locateRequest || !isActive || !isLocateAsked) return;
        const index = gridItems.findIndex(item => item.rawTrack !== undefined && getPlaybackSongKey(item.rawTrack) === locateRequest.songKey);
        const step = resolveLocateStep({
            isHere: index >= 0,
            isFiltered: Boolean(searchQuery || hasSearchQuery),
            waits: locateRequest.waits,
            cardsStillArriving,
            hasReadFailed,
        });
        if (step.kind === 'wait') return;
        if (step.kind === 'unfilter') {
            // A filter may be what hides it: it is looked for again among all the cards.
            if (searchQuery) setSearchQuery('');
            return;
        }
        if (step.answer === true) {
            centerOnIndex(index, true);
            setLocatedTimes(times => times + 1);
        } else if (step.answer === 'unread') {
            // Why the page took its list for not whole, for the day a listener sees a whole one called so.
            console.log(`[Locate] The list is not whole: ${displayTracks.length} tracks, reading ${isLoading || loading}, filling up ${backgroundLoading}, failed ${hasReadFailed}`);
        }
        answerLocateRequest(locateRequest.nonce, step.answer);
    }, [backgroundLoading, cardsStillArriving, displayTracks.length, gridItems, hasReadFailed, hasSearchQuery, isActive, isLoading, isLocateAsked, loading, locateRequest, searchQuery]);
    // 大歌单要分几十页补齐，只写「加载中」用户会以为歌丢了；拿得到总数就把进度写出来。
    const backgroundSyncTotal = collectionDetail?.trackCount ?? collection?.trackCount;
    const backgroundSyncCounts = resolveCollectionSyncCounts(tracks.length, backgroundSyncTotal);
    const backgroundSyncLabel = backgroundLoadError
        ? (backgroundSyncCounts ? t('playlist.syncInterruptedProgress', backgroundSyncCounts) : t('playlist.syncInterrupted'))
        : (backgroundSyncCounts ? t('playlist.syncProgress', backgroundSyncCounts) : t('playlist.loading'));
    // What went wrong, said in the empty page and in the background banner's hover text.
    const loadFailureSaid = loadFailure && !hasSearchQuery ? onlineFailureMessage(loadFailure, t) : null;
    const backgroundFailureSaid = backgroundFailure ? onlineFailureMessage(backgroundFailure, t) : null;

    const displayCollection = mutationSnapshot.renamedTo && collection ? { ...collection, name: mutationSnapshot.renamedTo } : collection;
    const infoCollection = collectionDetail ? { ...displayCollection, ...collectionDetail } : displayCollection;
    const coverUrl = infoCollection?.coverUrl || '';
    const infoPanelCoverUrl = infoCollection?.coverUrl || '';
    // 只有 tracks 模式下的合集才有切入面板，没有面板时标题不做成可点控件
    const hasCutInPanel = mode === 'tracks' && Boolean(collection);

    // Everything the palette is allowed to do to this grid, and the branch rules that decide which
    // of it applies. Declared next to the buttons it mirrors so the two cannot disagree; the actual
    // gating and dispatch live in ../library/core/collection/collectionSurface.
    // core 动作（播放范围、排序、重新拉取、来源维护、订阅）与 TUI 同一个构建函数、同一份控制器快照；
    // 网格只补自己的信息面板、曲目侧栏与编辑模式。
    const gridSurfaceParams = buildCoreSurfaceParams({
        declaredActions,
        filteredTrackCount: contextActionTracks.length,
        isFilterActive: hasSearchQuery,
        supportsLocalTrackSorting,
        sortField: localTrackSortField,
        sortDirection: localTrackSortDirection,
        setSortField: handleLocalTrackSortFieldChange,
        setSortDirection: handleLocalTrackSortDirectionChange,
        canReloadOnlineCollection: canReloadOnlineCollection && !loading,
        playFiltered: () => onPlayAll?.(contextActionTracks),
        enqueueFiltered: () => onAddAllToQueue?.(contextActionTracks),
        collectFiltered: onCollectAll ? () => onCollectAll(contextActionTracks) : undefined,
        reloadOnlineCollection,
        mutationSnapshot,
        mutations: mutations ?? null,
    }, {
        hasInfoPanel: hasCutInPanel,
        hasTrackList: mode === 'tracks' && displayTracks.length > 0,
        canEditPlaylist,
        isInfoPanelOpen: showCutInPanel,
        isTrackListOpen: showSidePanel,
        isEditMode,
        toggleInfoPanel: () => setShowCutInPanel(current => !current),
        toggleTrackList: () => setShowSidePanel(current => !current),
        toggleEditMode: handleEditModeToggle,
    });
    useGridSurfaceRegistration({
        isInteractive: isActive,
        getState: () => buildGridSurfaceState(gridSurfaceParams),
        run: (action) => runGridSurfaceAction(action, gridSurfaceParams),
    });

    const albumArtists = Array.isArray(infoCollection?.artists) ? infoCollection.artists : [];
    const albumAlias = infoCollection?.aliases?.[0];
    const albumPublishedAt = infoCollection?.publishedAt;
    const albumPublisher = infoCollection?.publisher;

    return (
        <motion.div
            data-ponder-page-scope="grid-view-page"
            data-library-renderer="grid"
            data-library-surface="collection"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={pageExit}
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
            {/* 「我是当前这层网格」的标记，放在根节点里：移形换影的测量只在这个子树里找卡片和
                落点，否则正在退出的上一层网格会被当成落点。订阅关在子组件里，见 ActiveGridMarker。 */}
            <ActiveGridMarker />

            {/* Back Button */}
            <button
                // 返回按钮表示看完了（onDone）：宿主清掉浏览会话、让每套 suite 忘掉布局记录（网格的 sessionStorage
                // 记录经 entry 的 layout.forget），再返回。Escape 与浏览器后退保留（onBack）。P4.5 起不在这里清。
                onClick={onDone}
                className="absolute left-6 top-5 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 z-[70]"
                style={{
                    backgroundColor: isDaylight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(8px)',
                }}
            >
                <ChevronLeft size={20} />
            </button>

            {(progressiveLoading.backgroundLoading || backgroundLoadError) && (
                <button
                    type="button"
                    onClick={resumeBackgroundSync}
                    disabled={!backgroundLoadError}
                    className="absolute right-6 top-5 z-[70] flex items-center gap-2 rounded-full px-3 py-2 text-xs tabular-nums backdrop-blur-md disabled:cursor-default"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--bg-color) 65%, transparent)' }}
                    title={backgroundFailureSaid
                        ? t('playlist.syncFailedHint', {
                            error: backgroundFailureSaid.quote
                                ? `${backgroundFailureSaid.title}: ${[backgroundFailureSaid.quote.text, backgroundFailureSaid.quote.code].filter(Boolean).join(' ')}`
                                : backgroundFailureSaid.title,
                        })
                        : backgroundSyncLabel}
                >
                    <RefreshCw size={14} className={progressiveLoading.backgroundLoading ? 'animate-spin' : ''} />
                    {backgroundSyncLabel}
                    {backgroundLoadError && <span className="font-semibold">{t('ui.retry')}</span>}
                </button>
            )}

            {/* Center Clickable Area */}
            <div
                onClick={() => {
                    if (!hasCutInPanel) return;
                    setShowCutInPanel(!showCutInPanel);
                }}
                className={`group/grid-title absolute left-1/2 top-5 -translate-x-1/2 z-[70] text-center flex flex-col items-center select-none transition-all px-5 py-2 rounded-2xl backdrop-blur-md ${hasCutInPanel ? 'cursor-pointer hover:scale-[1.01] active:scale-98' : ''}`}
                style={{
                    backgroundColor: 'color-mix(in srgb, var(--bg-color) 20%, transparent)',
                    color: 'var(--text-primary)',
                }}
            >
                <h2 className="text-lg font-bold tracking-tight flex items-center gap-1.5 justify-center">
                    {infoCollection?.name || collectionName || title}
                    {hasCutInPanel && <GridPanelToggleIndicator isOpen={showCutInPanel} />}
                </h2>
                {(infoCollection?.description || subtitle) && (
                    <p className="mt-0.5 max-w-[min(40rem,calc(100vw-8rem))] text-xs leading-relaxed opacity-50 line-clamp-2 whitespace-normal break-words">
                        {infoCollection?.description || subtitle}
                    </p>
                )}
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
                {showLoading ? (
                    // (The stand-in says it where it shows: both stand at the middle.)
                    !standIn && (
                        <div className="flex flex-col items-center gap-4 opacity-50">
                            <Loader2 className="animate-spin" size={32} />
                            <span className="text-sm font-semibold font-sans">{t('playlist.loading')}</span>
                        </div>
                    )
                ) : gridItems.length === 0 ? (
                    <div className="max-w-md px-6 text-center text-sm font-sans opacity-40">
                        {loadFailureSaid
                            ? (
                                <>
                                    <p>{loadFailureSaid.title}</p>
                                    {loadFailureSaid.note && <p>{loadFailureSaid.note}</p>}
                                    {loadFailureSaid.quote && (
                                        <p className="mt-1 text-xs [overflow-wrap:anywhere]">
                                            {loadFailureSaid.quote.text}
                                            {loadFailureSaid.quote.code && <code className="ml-1.5 font-mono">{loadFailureSaid.quote.code}</code>}
                                        </p>
                                    )}
                                </>
                            )
                            : hasSearchQuery ? (t('home.gridSearchNoResults'))
                                // Given no tracks because their read failed: not a collection that holds none.
                                : loadError && !hasSearchQuery ? t('playlist.loadFailedPlain') : (t('home.loadingLibrary'))}
                    </div>
                ) : (
                    <motion.div
                        data-grid-canvas
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
                                flushHeldResourceSnapshot();
                                scheduleFocusedIndexCommit(140);
                            }, 50);
                        }}
                        style={{ x: dragX, y: dragY, background: 'rgba(0,0,0,0)', touchAction: 'none' }}
                        className="absolute inset-0 flex items-center justify-center cursor-grab active:cursor-grabbing bg-transparent"
                    >
                        <AnimatePresence initial={false}>
                            {memoizedCards}
                        </AnimatePresence>
                    </motion.div>
                )}

                {/* The stand-in: where the centred card stands (the middle of this box, at the
                    centred card's scale), in a card's frame. Not on the canvas, so a drag does
                    not move it from under a cover in flight. It goes when its handover to the
                    hero card says so, by then turned edge-on or faded out: nothing here takes it
                    off the screen. `perspective` as the cards' own boxes have it, for its turn. */}
                {standIn && !standIn.gone && (
                    <motion.div
                        aria-hidden="true"
                        className="absolute left-1/2 top-1/2 z-[60] pointer-events-none"
                        style={{ x: '-50%', y: '-50%', scale: HEX_CARD_CENTER_SCALE, perspective: '1200px' }}
                    >
                        <div
                            ref={standInCardRef}
                            {...{ [MORPH_FRAME_ATTR]: '' }}
                            {...(fullBleedCover ? { [MORPH_TARGET_ATTR]: '' } : {})}
                            className={`relative rounded-xl border shadow-lg theme-polaroid-card ${fullBleedCover ? 'overflow-hidden' : 'p-3'}`}
                            style={{ width: layoutConfig.cardWidth, [fullBleedCover ? 'height' : 'minHeight']: layoutConfig.cardHeight }}
                        >
                            <div
                                {...(fullBleedCover ? {} : { [MORPH_TARGET_ATTR]: '' })}
                                className={fullBleedCover
                                    ? 'absolute inset-0 bg-zinc-200/60 dark:bg-zinc-800/60'
                                    : 'relative w-full aspect-square rounded-lg overflow-hidden bg-zinc-200/60 dark:bg-zinc-800/60 shadow-inner'}
                            >
                                {standIn.coverUrl && (
                                    <img src={standIn.coverUrl} alt="" draggable={false} decoding="sync" className="absolute inset-0 h-full w-full object-cover" />
                                )}
                            </div>
                            {fullBleedCover && <div className="absolute inset-0" style={{ backgroundImage: fullBleedScrim(isDaylight) }} />}
                            {/* The title that flies with the cover (the clicked card's; the
                                collection's own where that card has none), where a card's
                                title stands, and under it what the page is doing. */}
                            <div className={fullBleedCover ? 'absolute inset-x-0 bottom-0 flex flex-col gap-1 p-3 text-left' : 'pt-3 text-left'}>
                                <div
                                    {...{ [CARD_TITLE_ATTR]: '' }}
                                    className={fullBleedCover
                                        ? 'text-sm font-bold tracking-tight leading-snug line-clamp-3 whitespace-normal break-words'
                                        : 'text-s font-bold tracking-tight opacity-90 max-w-full line-clamp-4 whitespace-normal break-words'}
                                >
                                    {standIn.title ?? collectionName ?? title}
                                </div>
                                {showLoading && (
                                    <div className="mt-1 flex items-center gap-2 text-xs font-semibold font-sans opacity-60">
                                        <Loader2 className="animate-spin shrink-0" size={14} />
                                        <span className="truncate">{t('playlist.loading')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    </motion.div>
                )}

                {/* Cut-in Info Panel Overlay */}
                <AnimatePresence>
                    {showCutInPanel && mode === 'tracks' && collection && (
                        <motion.div
                            data-wheel-scroll-region
                            onWheelCapture={event => event.stopPropagation()}
                            initial={{ opacity: 0, x: -60, scale: 0.95 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: -60, scale: 0.95 }}
                            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                            className="absolute left-6 top-24 w-80 rounded-3xl z-[80] overflow-y-auto overscroll-contain hide-scrollbar flex flex-col p-6 shadow-2xl border backdrop-blur-2xl pointer-events-auto theme-glass-panel"
                            style={{
                                bottom: bottomBarPanelBottomPx,
                                boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.2)',
                            }}
                        >
                            {/* Cover Image */}
                            <div className="w-full aspect-square rounded-2xl overflow-hidden shadow-lg mb-4 bg-zinc-800/20 relative shrink-0">
                                {infoPanelCoverUrl ? (
                                    <img src={getSizedCoverUrl(toHttps(infoPanelCoverUrl), 512)} alt={infoCollection?.name || title} decoding="async" className="w-full h-full object-cover select-none pointer-events-none" />
                                ) : (
                                    <Disc size={64} className="opacity-20 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                                )}
                                {showSubscribeButton && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            void handleToggleSubscribe();
                                        }}
                                        className="absolute bottom-3 right-3 w-10 h-10 rounded-full flex items-center justify-center transition-all shadow-lg active:scale-90 z-10 border border-white/10 hover:scale-105 cursor-pointer backdrop-blur-md"
                                        style={{
                                            backgroundColor: isDaylight ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.5)',
                                        }}
                                        title={playlistSubscribed ? (isOnlineAlbum ? t('options.unsubscribeAlbum') : t('options.unsubscribePlaylist')) : (isOnlineAlbum ? t('options.subscribeAlbum') : t('options.subscribePlaylist'))}
                                    >
                                        <Star
                                            key={starPresses}
                                            size={18}
                                            className={`${starPresses > 0 ? 'star-pop ' : ''}${playlistSubscribed ? 'text-yellow-500 fill-yellow-500' : 'opacity-60 hover:opacity-100'}`}
                                            style={{ color: playlistSubscribed ? undefined : 'var(--text-primary)' }}
                                        />
                                    </button>
                                )}
                            </div>

                            {/* Title & Creator */}
                            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain custom-scrollbar pr-1 space-y-4 text-left min-w-0">
                                <div>
                                    {canRename && isEditMode ? (
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
                                        <button
                                            type="button"
                                            disabled={!mutationCapabilities.editEntity.supported}
                                            onClick={handleEditEntity}
                                            className="text-left text-xl font-bold line-clamp-2 leading-snug disabled:cursor-default"
                                        >
                                            {infoCollection?.name || title}
                                        </button>
                                    )}
                                    {infoCollection?.creator && (
                                        <div className="flex items-center gap-2 mt-2 text-xs opacity-60">
                                            <div className="w-5 h-5 rounded-full overflow-hidden">
                                                <img src={toHttps(infoCollection.creator.avatarUrl)} alt="avatar" className="w-full h-full object-cover" />
                                            </div>
                                            <span className="font-semibold">{infoCollection.creator.nickname}</span>
                                        </div>
                                    )}
                                    <div className="text-[10px] opacity-40 mt-1.5">
                                        {(isDailyRecommendationsCollection || infoCollection?.trackCount !== undefined) && (
                                            <span>{isDailyRecommendationsCollection ? displayTracks.length : infoCollection.trackCount} {t('home.songs')}</span>
                                        )}
                                        {infoCollection?.playCount !== undefined && <span> • {infoCollection.playCount} {t('playlist.plays')}</span>}
                                    </div>
                                    {isDailyRecommendationsCollection && (
                                        <div className="mt-3 space-y-2">
                                            <div className="flex items-center gap-2">
                                                {mutationSnapshot.dailyHistoryAvailable && (
                                                    <div className="min-w-0 flex-1">
                                                        <CustomSelect
                                                            value={mutationSnapshot.dailyDate}
                                                            onChange={date => void handleDailyRecommendationDateChange(date)}
                                                            options={[
                                                                { value: '', label: t('home.todayRecommendations') },
                                                                ...mutationSnapshot.dailyHistoryDates.map(date => ({ value: date, label: date })),
                                                            ]}
                                                            placeholder={t('home.todayRecommendations')}
                                                            ariaLabel={t('home.recommendationDate')}
                                                            disabled={loading}
                                                            isDaylight={isDaylight}
                                                            theme={theme}
                                                        />
                                                    </div>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => void handleDailyRecommendationDateChange('', true)}
                                                    disabled={loading || Boolean(mutationSnapshot.dailyDate)}
                                                    title={t('home.refreshRecommendations')}
                                                    aria-label={t('home.refreshRecommendations')}
                                                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 transition-colors hover:bg-white/10 disabled:opacity-30"
                                                >
                                                    <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                    {isAlbumCollection && (
                                        <div className="mt-3 space-y-1.5 text-xs opacity-60" style={{ color: 'var(--text-secondary)' }}>
                                            {albumAlias && (
                                                <div className="font-medium opacity-80">{albumAlias}</div>
                                            )}
                                            {albumArtists.length > 0 ? (
                                                <div className="flex flex-wrap gap-x-2 gap-y-1">
                                                    {albumArtists.map((artist: { id: string | number; name: string }, index: number) => (
                                                        <button
                                                            key={`${artist.id}-${index}`}
                                                            type="button"
                                                            onClick={() => onSelectArtist?.(artist.id, artist)}
                                                            className="font-semibold hover:underline"
                                                        >
                                                            {artist.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            ) : null}
                                            {albumArtists.length === 0 && infoCollection?.albumArtist && (
                                                <div className="font-semibold">{infoCollection.albumArtist}</div>
                                            )}
                                            {(formatAlbumDate(albumPublishedAt) || albumPublisher) && (
                                                <div>
                                                    {[formatAlbumDate(albumPublishedAt), albumPublisher]
                                                        .filter(Boolean)
                                                        .join(' • ')}
                                                </div>
                                            )}
                                            {isNavidromeCollection && (
                                                <div>
                                                    {[infoCollection?.albumYear, infoCollection?.albumGenre, formatAlbumDuration(infoCollection?.albumDuration)]
                                                        .filter(Boolean)
                                                        .join(' • ')}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Description */}
                                {infoCollection?.description && (
                                    <p data-wheel-scroll-region className="text-xs opacity-65 leading-relaxed break-words whitespace-pre-wrap max-h-40 overflow-y-auto overscroll-contain pr-1">
                                        {infoCollection.description}
                                    </p>
                                )}
                            </div>

                            {/* Buttons Area */}
                            <div
                                // 这一排里有重扫、整理 tag 和删除，删除是不可逆的 ——
                                // 思索把整块认成一个目标，指着哪一颗都讲得到。
                                data-ponder={isLocalCollection ? 'local-folder-actions' : 'online-collection-actions'}
                                className="space-y-2 mt-4 pt-4 border-t shrink-0"
                                style={{ borderTopColor: 'color-mix(in srgb, var(--text-primary) 12%, transparent)' }}
                            >
                                <button
                                    onClick={() => {
                                        if (onPlayAll && contextActionTracks.length > 0) {
                                            onPlayAll(contextActionTracks);
                                        }
                                    }}
                                    disabled={contextActionTracks.length === 0}
                                    className="w-full py-3 rounded-full font-bold text-xs transition-transform hover:scale-102 active:scale-98 flex items-center justify-center gap-1.5 shadow-md disabled:opacity-40 disabled:hover:scale-100 cursor-pointer"
                                    style={{ backgroundColor: 'var(--text-primary)', color: 'var(--bg-color)' }}
                                >
                                    <Play size={14} fill="currentColor" />
                                    {hasSearchQuery
                                        ? t('playlist.playFilteredTracks', { count: contextActionTracks.length })
                                        : t('playlist.playAll')}
                                </button>
                                <button
                                    onClick={() => {
                                        if (onAddAllToQueue && contextActionTracks.length > 0) {
                                            onAddAllToQueue(contextActionTracks);
                                        }
                                    }}
                                    disabled={contextActionTracks.length === 0}
                                    className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                >
                                    <ListPlus size={14} />
                                    {hasSearchQuery
                                        ? t('playlist.addFilteredTracksToQueue', { count: contextActionTracks.length })
                                        : t('navidrome.addToQueue')}
                                </button>
                                {onCollectAll && (
                                    <button
                                        onClick={() => {
                                            if (contextActionTracks.length > 0) onCollectAll(contextActionTracks);
                                        }}
                                        disabled={contextActionTracks.length === 0}
                                        data-grid-action="collect-scope"
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        <NotebookPen size={14} />
                                        {hasSearchQuery
                                            ? t('scratchpad.collectFiltered', { count: contextActionTracks.length })
                                            : t('scratchpad.collectScope')}
                                    </button>
                                )}
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
                                {mutationCapabilities.resyncFolder.supported && (
                                    <button
                                        onClick={handleResyncLocalFolder}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {t('localMusic.reimport')}
                                    </button>
                                )}
                                {mutationCapabilities.organizeSongInfo.supported && (
                                    <button
                                        onClick={handleOrganizeSongInfo}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <Tags size={14} />
                                        {t('localMusic.organizeSongInfo')}
                                    </button>
                                )}
                                {mutationCapabilities.resyncAllFolders.supported && (
                                    <button
                                        onClick={handleResyncAllLocalFolders}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {t('localMusic.reimport')}
                                    </button>
                                )}
                                {canReloadOnlineCollection && (
                                    <button
                                        onClick={reloadOnlineCollection}
                                        disabled={loading}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                                        {t('playlist.reload')}
                                    </button>
                                )}
                                {canEditPlaylist && (
                                    <button
                                        onClick={handleEditModeToggle}
                                        disabled={isSourceActionPending}
                                        // 思索靠这个属性认出它。类名会改，属性不会。
                                        data-ponder="grid-view-edit-mode"
                                        className={`w-full py-2.5 rounded-full text-xs font-semibold transition-all flex items-center justify-center gap-1.5 cursor-pointer ${isEditMode ? 'bg-red-500/20 text-red-500 border border-red-500/30' : 'bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900'}`}
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}
                                        {isDailyRecommendationsCollection
                                            ? (isEditMode ? t('home.finishManagingRecommendations') : t('home.manageRecommendations'))
                                            : (isEditMode ? t('localMusic.finishEditing') : t('localMusic.editPlaylist'))}
                                    </button>
                                )}
                                {mutationCapabilities.exportPlaylist.supported && (
                                    <button
                                        onClick={handleExportLocalPlaylist}
                                        disabled={isSourceActionPending}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 disabled:opacity-40 cursor-pointer"
                                    >
                                        {isSourceActionPending ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                                        {t('localMusic.exportPlaylist')}
                                    </button>
                                )}
                                {mutationCapabilities.editEntity.supported && (
                                    <button
                                        onClick={handleEditEntity}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <Pencil size={14} />
                                        {t('localMusic.entityInfo', {
                                            kind: collection.type === 'album'
                                                ? t('localMusic.albumLabel')
                                                : t('localMusic.artistLabel'),
                                        })}
                                    </button>
                                )}
                                {mutationCapabilities.setCover.supported && (
                                    <button
                                        onClick={handleSetCover}
                                        className="w-full py-2.5 rounded-full text-xs font-semibold bg-zinc-800/10 dark:bg-zinc-100/10 hover:bg-zinc-900 hover:text-zinc-100 dark:hover:bg-zinc-100 dark:hover:text-zinc-900 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                                    >
                                        <ImagePlus size={14} />
                                        {t('localCollectionCover.menuLabel')}
                                    </button>
                                )}
                                {mutationCapabilities.deleteCollection.supported && (
                                    <button
                                        onClick={() => isLocalFolderCollection ? setIsDeleteFolderOpen(true) : void handleDeleteSourceCollection()}
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
                playlists={mutationSnapshot.availablePlaylists}
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
            <ConfirmDialog
                isOpen={isDeleteFolderOpen}
                title={t('localMusic.deleteFolderTitle')}
                description={t(collection?.name?.replace(/\\/g, '/').includes('/')
                    ? 'localMusic.deleteSubfolderMessage' : 'localMusic.deleteRootFolderMessage', { folderName: collection?.name })}
                confirmText={t('localMusic.deleteFromLibrary')}
                confirmVariant="danger"
                onConfirm={() => {
                    setIsDeleteFolderOpen(false);
                    void handleDeleteSourceCollection();
                }}
                onClose={() => setIsDeleteFolderOpen(false)}
                isDaylight={isDaylight}
            />

            {/* Bottom Right Floating Button */}
            {mode === 'tracks' && displayTracks.length > 0 && (
                <GridListSearchButton
                    isDaylight={isDaylight}
                    accentColor={theme.accentColor}
                    listTitle={t('playlist.viewTracks')}
                    searchTitle={t('home.gridSearchPlaceholder')}
                    onOpenList={() => setShowSidePanel(true)}
                    above={playingSongKey !== null && collection ? (
                        <GridLocateButton
                            isDaylight={isDaylight}
                            accentColor={theme.accentColor}
                            isHere={isPlayingSongHere}
                            isSeeking={isLocateAsked}
                            title={t('playlist.locatePlaying')}
                            onLocate={locateOnThisPage}
                        />
                    ) : undefined}
                />
            )}

            {/* Tracks Cut-in Side Panel */}
            {mode === 'tracks' && (
                <SidePanelList
                    isOpen={showSidePanel}
                    onClose={() => setShowSidePanel(false)}
                    title={collectionName || title}
                    items={displayTracks}
                    itemHeight={60}
                    isDaylight={isDaylight}
                    focusedIndex={listFocusedIndex}
                    revealTimes={locatedTimes}
                    hideTitle={supportsLocalTrackSorting}
                    headerLeadingActions={supportsLocalTrackSorting ? (
                        <LocalTrackSortDirectionButton
                            direction={localTrackSortDirection}
                            onDirectionChange={handleLocalTrackSortDirectionChange}
                        />
                    ) : undefined}
                    headerActions={(
                        <>
                            {/* The same question as the button over the grid: is the playing song on this page. */}
                            {playingSongKey !== null && collection && (
                                <button
                                    type="button"
                                    data-list-locate={isPlayingSongHere ? 'here' : 'elsewhere'}
                                    title={t('playlist.locatePlaying')}
                                    aria-label={t('playlist.locatePlaying')}
                                    onClick={locateOnThisPage}
                                    className="p-1.5 rounded-full hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                                >
                                    <Crosshair size={18} style={{ color: isPlayingSongHere ? theme.accentColor : undefined }} />
                                </button>
                            )}
                            {supportsLocalTrackSorting && (
                                <LocalTrackSortMenu
                                    field={localTrackSortField}
                                    onFieldChange={handleLocalTrackSortFieldChange}
                                />
                            )}
                        </>
                    )}
                    renderItem={(track, index, style) => (
                        <TrackListItem
                            key={`${track.id}-${index}`}
                            track={track}
                            index={index}
                            style={style}
                            isUnavailable={isSongUnavailable(track)}
                            isActive={index === listFocusedIndex}
                            albumTrackLabel={getAlbumTrackLabel(track)}
                            onPlay={() => {
                                onSelectTrack?.(track, playableTracks);
                            }}
                            onAddToQueue={onAddTrackToQueue ? () => {
                                onAddTrackToQueue(track);
                            } : undefined}
                            onCollect={onCollectTrack ? () => onCollectTrack(track) : undefined}
                        />
                    )}
                />
            )}
        </motion.div>
    );
};

export default GridView;
