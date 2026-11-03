import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import {
    getActiveGridViewCollection,
    subscribeCollectionPop,
    useCollectionNavigationStore,
    type CollectionNavigationSnapshot,
} from '../../stores/useCollectionNavigationStore';
import { LocalSong, SongResult, UnifiedSong } from '../../types';
import { getNavidromeConfig, navidromeApi } from '../../services/navidromeService';
import { getLocalCoverAssetUrl } from '../../services/localCoverAssetUrl';
import {
    collectionKey,
    GridViewCollectionDescriptor,
    LocalGridViewCollectionDescriptor,
    isLocalGridViewCollection,
    isNavidromeGridViewCollection,
    refreshLocalGridViewCollection,
    resolveLocalAlbumArtistDisplay,
    resolveLocalGridViewTracks,
} from '../../components/app/home/gridViewCollectionAdapters';
import { createLibraryPlaybackPort } from './createLibraryPlaybackPort';
import { createLibraryMutationPort } from './createLibraryMutationPort';
import { useCollectionResource } from '../core/collection/resource/useCollectionResource';
import { useCollectionMutations } from '../core/collection/mutations/useCollectionMutations';
import { useArtistResource } from '../core/artist/useArtistResource';
import type { LibraryLocalCatalogSnapshot } from '../core/home/home.contract';
import { LocalLibraryEntityPanel } from '../../components/modal/LocalLibraryEntityPanel';
import { LocalFolderSongInfoPanel } from '../../components/modal/LocalFolderSongInfoPanel';
import { LocalSongMetadataMatchDialog } from '../../components/modal/LocalSongMetadataMatchDialog';
import { useScratchpadStore } from '../../stores/useScratchpadStore';
import LocalCollectionCoverDialog from '../../components/local-collection-cover/LocalCollectionCoverDialog';
import { resolveLocalCollectionCover } from '../core/collection/cover/localCollectionCover';
import { useLocalCollectionCoverUrls } from '../core/collection/cover/useLocalCollectionCoverUrls';
import { followEntityRedirect } from '../../utils/localLibraryIndex';
import { buildLocalCatalogIndex, resolveLocalCatalogLink } from '../core/shared/localCatalogLinks';
import { resolveSongCatalogRef } from '../../services/onlineMusic/catalogRefs';
import type { HomeSurfaceProps } from '../../components/app/home/homeSurfaceTypes';
import { useThemeSettingsStore } from '../../stores/useThemeSettingsStore';
import { useAppViewStore } from '../../stores/useAppViewStore';
import { countRender } from '../../dev/renderCount';
import { useLibraryBackdrop } from './useLibraryBackdrop';
import { useLibrarySuiteStore } from '../core/suite/useLibrarySuiteStore';
import { useLibraryBrowseSessionStore } from '../core/shared/useLibraryBrowseSessionStore';
import type { LibraryNavigationContext, LibrarySurfaceId } from '../core/suite/suite.contract';
import {
    forgetLibraryLayouts,
    hasLibrarySuiteChoice,
    listLibrarySuiteOverlays,
    resolveLibraryStage,
    resolveLibrarySurface,
} from '../registry';
import { resolveLibraryLayerPresentation } from '../core/suite/libraryStage';
import { projectNavigationTrail, resolveCollectionPush } from '../core/collection/collectionNavigation';
import { LIBRARY_HOME_SESSION_KEY } from './librarySuiteChoice';
import LibrarySuiteStageSlot from './LibrarySuiteStageSlot';

// src/library/app/GridViewOverlayHost.tsx
// Hosts the GridView overlay outside Grid3D so it can be opened/restored independently.
// R3 起集合层与歌手页经 registry 解析：当前选中的 suite 实现了就由它渲染，否则回退默认 suite（grid）。
// 宿主只交出契约里的输入（core/suite/suite.contract）；网格专属的转场（移形换影的入场计划、返回时的测量、
// 常驻的转场层）由网格 entry 的 transitions 提供，宿主不再直接 import 任何 suite。
// B1 起还挂生效 suite 的常驻舞台（manifest 的 stage，见 LibrarySuiteStageSlot）：当前层归带 stage 的 suite 时
// 不垫背景板、不藏首页（规则在 core/suite/libraryStage）；grid / TUI 没有 stage，行为不变。
//
// 返回的语义（P4.5，同一个手势在每套 suite 里含义相同）：
// - 返回按钮 = 完成（onDone）：清掉这一层的浏览会话，让每套 suite 忘掉这一层的布局记录，再返回；
// - Escape 与浏览器后退 = 离开但保留（onBack / popstate）。
// 两条返回路径都只让渲染这一层的 suite 跑一次 beforeBack：应用内返回在这里先跑，再走历史后退；浏览器后退
// 不经过这里，由导航 store 在 popstate 弹栈之前通知（subscribeCollectionPop），界面那时还是返回前的样子。
// N1 起「进入的正好是上一层」（歌手 ↔ 专辑来回点，折成一次返回）与面包屑跳层（onPopTo）也是弹栈：导航层走浏览器
// 历史退回，beforeBack 同样由弹栈通知跑一次；这两条路径在宿主这里都不跑 beforePush / beforeBack。

// suite 的切换浮层：懒加载、且只在 DEV 下引用，生产包不受影响（生产构建里也只有一套 suite）。
const DevLibraryRendererSwitch = import.meta.env.DEV ? React.lazy(() => import('./DevLibraryRendererSwitch')) : null;
const HAS_SUITE_CHOICE = hasLibrarySuiteChoice();
/** 在首页上切 suite 时交给 switchLibrarySuite 的会话 key（首页没有集合浏览会话，冲刷什么都不做）。 */
const HOME_SUITE_SESSION_KEY = LIBRARY_HOME_SESSION_KEY;
// 声明了转场层的 suite：常驻渲染，只有当前负责集合层的那套收到 enabled。
const SUITE_OVERLAYS = listLibrarySuiteOverlays();

/** 导航快照 → 交给 suite 的导航上下文（转场钩子与 stage 共用一种形状；B11 起带上每一层的面包屑）。 */
const toNavigationContext = (snapshot: CollectionNavigationSnapshot | null): LibraryNavigationContext => {
    const depth = snapshot?.stack.length ?? 0;
    return {
        depth,
        origin: snapshot?.origin ?? null,
        activeType: snapshot?.stack[depth - 1]?.type ?? null,
        trail: projectNavigationTrail(snapshot),
    };
};

/** 导航发生之前的栈状态，交给 suite 的转场钩子。 */
const readNavigationContext = (): LibraryNavigationContext => (
    toNavigationContext(useCollectionNavigationStore.getState().snapshot)
);

type GridViewOverlayHostProps = {
    surfaceProps: HomeSurfaceProps;
    onOpenCollection: (collection: GridViewCollectionDescriptor) => void;
    onPushCollection: (collection: GridViewCollectionDescriptor) => void;
    /** 跳到导航栈第 depth 层（保留的层数，0 为整个关掉）；交给 surface 的 onPopTo。 */
    onPopCollectionTo: (depth: number) => void;
    onBackCollection: () => void;
    isInteractive?: boolean;
    children: (
        openGridView: (collection: GridViewCollectionDescriptor) => void,
        isHomeGridInteractive: boolean,
    ) => React.ReactNode;
};

// How long the home surface stays shown under a collection page that opens: longer than the
// page's own fade to opaque (0.3s), which is what covers it.
const HOME_HIDDEN_AFTER_SECONDS = 0.45;

const getPersistentCoverUrl = (url?: string) => (
    url && !url.startsWith('blob:') ? url : undefined
);

const resolveLocalCollectionCoverUrlFromTracks = (
    tracks: UnifiedSong[],
    localSongs: LocalSong[],
): string | undefined => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const songs = tracks
        .map(track => track.localRef ? songsById.get(track.localRef.songId) : undefined)
        .filter((song): song is LocalSong => Boolean(song))
        .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    const preferredSong = songs.find(song => {
        const hasEmbeddedCover = Boolean(getLocalCoverAssetUrl(song.localCoverAssetId));
        if (song.useOnlineCover) {
            return song.onlineMetadata?.coverUrl || hasEmbeddedCover;
        }
        return hasEmbeddedCover || song.onlineMetadata?.coverUrl;
    });

    if (!preferredSong) {
        return undefined;
    }

    if (preferredSong.useOnlineCover && preferredSong.onlineMetadata?.coverUrl) {
        return preferredSong.onlineMetadata.coverUrl;
    }

    const localCoverUrl = getLocalCoverAssetUrl(preferredSong.localCoverAssetId, 512);
    if (localCoverUrl) return localCoverUrl;

    return preferredSong.onlineMetadata?.coverUrl;
};

const resolveLiveLocalCollection = (
    collection: LocalGridViewCollectionDescriptor,
    surfaceProps: HomeSurfaceProps,
    catalog: LibraryLocalCatalogSnapshot,
): LocalGridViewCollectionDescriptor | null => {
    if (!collection.playlistId) {
        return refreshLocalGridViewCollection(
            collection,
            surfaceProps.localSongs,
            catalog.ready ? catalog : undefined,
        );
    }

    const playlist = surfaceProps.localPlaylists.find(item => item.id === collection.playlistId);
    if (!playlist) {
        return null;
    }

    const validSongIds = new Set(surfaceProps.localSongs.map(song => song.id));
    const songIds = playlist.songIds.filter(songId => validSongIds.has(songId));

    return {
        ...collection,
        name: playlist.name,
        songIds,
        trackCount: songIds.length,
        isVirtual: playlist.isFavorite,
    };
};

const GridViewOverlayHost: React.FC<GridViewOverlayHostProps> = ({
    surfaceProps,
    onOpenCollection,
    onPushCollection,
    onPopCollectionTo,
    onBackCollection,
    isInteractive = true,
    children,
}) => {
    countRender('GridViewOverlayHost');
    const { t } = useTranslation();
    const collectionSnapshot = useCollectionNavigationStore(state => state.snapshot);
    const isDaylight = useThemeSettingsStore(state => state.isDaylight);
    const localLibraryCatalog = surfaceProps.localLibraryCatalog;
    const selectedCollection = getActiveGridViewCollection(collectionSnapshot);
    const suiteId = useLibrarySuiteStore(state => state.suite);
    // 集合层与歌手页都由选中的 suite 渲染（它没实现那个 surface 时回退网格；P4.3 起 TUI 也实现了歌手页）。
    const collectionSurface = resolveLibrarySurface('collection', suiteId);
    const artistSurface = resolveLibrarySurface('artist', suiteId);
    // 转场属于渲染集合层的那套 suite：已经打开的看它所在的 surface；还在首页时看「将要打开的集合」由谁渲染
    // （选中 TUI 时，首页卡片点开的集合是 TUI，不该起飞移形换影）。
    const transitionSurface: LibrarySurfaceId = selectedCollection?.type === 'artist' ? 'artist' : 'collection';
    const transitionOwner = transitionSurface === 'artist' ? artistSurface : collectionSurface;
    // 背景板和转场启用状态由实际渲染这一层的 suite 解析；未声明背景板时使用中性淡入淡出。
    const backdrop = useLibraryBackdrop(transitionOwner.transitions?.backdrop);
    const activeTransitions = backdrop.enabled ? transitionOwner.transitions : undefined;
    // 生效 suite 的 stage（B1；grid / TUI 没有，未知 id 回退 grid 也没有）。当前层由带 stage 的 suite 渲染时，
    // 画面归 stage：不垫背景板、不藏首页。当前层回退到 grid 时与没有 stage 一样。
    const stage = resolveLibraryStage(suiteId);
    const layerPresentation = resolveLibraryLayerPresentation({
        hasOpenLayer: Boolean(selectedCollection),
        stageSuiteId: stage?.suiteId ?? null,
        layerSuiteId: transitionOwner.suiteId,
    });
    const stageNavigation = useMemo(() => toNavigationContext(collectionSnapshot), [collectionSnapshot]);
    // What is under a page: the home grid and the Explore page (`children`). Home put up while
    // the poster wall is being left for a page has that page over it from its first frame, and
    // is left for the wall again: they are not mounted for it, until a page closes onto the
    // home screen itself. Asked of the moment this host is put up, and of no page: put up
    // later (the app is back from the player), it mounts them under whatever page it has. (A
    // flight back to the wall keeps this host for a moment in the wall's view, with no page:
    // what is not mounted is not mounted for that either.)
    const isHomeView = useAppViewStore(state => state.view === 'home');
    const [isSurfaceMounted, setIsSurfaceMounted] = useState(() => (
        !selectedCollection || !useAppViewStore.getState().isLatticeLeftForPage
    ));
    if (!isSurfaceMounted && !selectedCollection && isHomeView) {
        setIsSurfaceMounted(true);
    }
    // In the wall's view this host is up only for a flight back to the wall. Where the home grid
    // is mounted under that page (the host was put up anew, back from the player), it stays
    // hidden once the page is gone: the wall fades in over the page, not over the home screen.
    // (A suite with a stage draws the wall's handoff itself, and is left as it is.)
    const isWallView = useAppViewStore(state => state.view === 'lattice');
    const isSurfaceHidden = layerPresentation.hideHome || (isWallView && !stage);
    const isSurfaceCovered = Boolean(selectedCollection) || (isWallView && !stage);
    const [resolvedLocalCollectionCoverUrl, setResolvedLocalCollectionCoverUrl] = useState<string | undefined>(undefined);
    const [navidromePlaylistItems, setNavidromePlaylistItems] = useState<Array<{ id: string | number; name: string; description?: string; }>>([]);
    const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
    const [organizingFolder, setOrganizingFolder] = useState<LocalGridViewCollectionDescriptor | null>(null);
    const [matchingSongId, setMatchingSongId] = useState<string | null>(null);
    const [coverEditingCollection, setCoverEditingCollection] = useState<LocalGridViewCollectionDescriptor | null>(null);
    // 本地集合的自定义封面（键 → URL）：盖在下面由曲目推出来的自动封面上。
    const localCollectionCoverUrls = useLocalCollectionCoverUrls();
    const selectedCollectionKey = collectionKey(selectedCollection);
    const refreshedSelectedCollection = useMemo(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            if (selectedCollection?.source !== 'online') return selectedCollection;

            const refreshed = surfaceProps.playlists.find(collection => (
                collection.providerId === selectedCollection.providerId
                && String(collection.id) === String(selectedCollection.id)
            ));
            return refreshed
                ? { ...selectedCollection, ...refreshed, source: 'online' as const, providerId: selectedCollection.providerId }
                : selectedCollection;
        }

        return resolveLiveLocalCollection(selectedCollection, surfaceProps, localLibraryCatalog);
    }, [surfaceProps.localPlaylists, surfaceProps.localSongs, surfaceProps.playlists, localLibraryCatalog, selectedCollection]);
    // Navidrome 歌单的名字以刷新过的歌单列表为准：改名之后 refreshNavidromePlaylists 带回新名字，
    // 不必就地改写导航栈里的描述（嵌套返回再进来也还是新名字）。单独一层 memo：别的来源不随歌单列表换新对象
    // （本地集合的 effect 会清空这个列表，放进同一个 memo 会互相触发）。
    const liveSelectedCollection = useMemo(() => {
        const collection = refreshedSelectedCollection;
        if (collection?.source !== 'navidrome' || collection.type !== 'playlist') return collection;
        const listed = navidromePlaylistItems.find(item => String(item.id) === String(collection.id));
        return listed && listed.name !== collection.name ? { ...collection, name: listed.name } : collection;
    }, [navidromePlaylistItems, refreshedSelectedCollection]);
    const displaySelectedCollection = useMemo(() => {
        if (!liveSelectedCollection) {
            return null;
        }

        if (!isLocalGridViewCollection(liveSelectedCollection)) {
            return liveSelectedCollection;
        }

        // 设了自定义封面就用它（固定不变）；否则是由曲目推出来的自动封面。自动封面另外带着，画曲目的地方
        // （Bravais 的专辑墙）用它：集合封面不影响集合里的歌。（自定义封面是 blob: 地址，getPersistentCoverUrl
        // 不会把导航栈里带着的那张当成自动封面。）
        const automaticCoverUrl = resolvedLocalCollectionCoverUrl || getPersistentCoverUrl(liveSelectedCollection.coverUrl);
        const coverUrl = resolveLocalCollectionCover(liveSelectedCollection, automaticCoverUrl, localCollectionCoverUrls);

        return {
            ...liveSelectedCollection,
            coverUrl,
            automaticCoverUrl: automaticCoverUrl ?? null,
        };
    }, [liveSelectedCollection, localCollectionCoverUrls, resolvedLocalCollectionCoverUrl]);

    // 本地集合的曲目在渲染期算好：放在 effect 里的话，新打开的网格第一帧会带着上一个集合的曲目。
    const localTracks = useMemo(() => (
        liveSelectedCollection && isLocalGridViewCollection(liveSelectedCollection)
            ? resolveLocalGridViewTracks(liveSelectedCollection, surfaceProps.localSongs, localLibraryCatalog) as UnifiedSong[]
            : undefined
    ), [liveSelectedCollection, localLibraryCatalog, surfaceProps.localSongs]);
    // 宿主持有集合资源，网格（以及别的 renderer）只订阅它：切换 renderer 不会重新请求。
    // 宿主自己不订阅快照，所以分页到达不会让首页这棵大树重渲染。歌手页同理，见下面的 artistResource。
    const collectionResource = useCollectionResource({
        descriptor: liveSelectedCollection && liveSelectedCollection.type !== 'artist' ? liveSelectedCollection : null,
        currentUserId: surfaceProps.user?.id,
        localTracks,
    });
    // 歌手资源：宿主按导航栈里那一层的 collectionKey 持有（本地描述的 id 会在 catalog 就绪后改写，不拿它算 key），
    // 本地歌手由宿主这一份 catalog 派生（歌手页不再自带第二个 catalog 实例）。宿主同样不订阅它的快照。
    const artistLocalLibrary = useMemo(() => ({
        catalog: localLibraryCatalog,
        songs: surfaceProps.localSongs,
    }), [localLibraryCatalog, surfaceProps.localSongs]);
    const isArtistSelected = selectedCollection?.type === 'artist';
    const artistResource = useArtistResource({
        key: isArtistSelected ? selectedCollectionKey : null,
        descriptor: isArtistSelected ? liveSelectedCollection : null,
        local: artistLocalLibrary,
    });
    // 播放与入队的语义集中在端口里，网格与别的 renderer 共用。
    // A collection page of tracks: what is played from it is said to be started there (the
    // navigation's descriptor of the page on show), so that "locate the playing song" knows
    // which page to come back to. An artist's page is no such page.
    const playbackPort = useMemo(() => createLibraryPlaybackPort(
        selectedCollection && selectedCollection.type !== 'artist'
            ? {
                ...surfaceProps,
                onPlaySong: (track, queue) => surfaceProps.onPlaySong(track, queue, false, selectedCollection),
                onPlayAll: surfaceProps.onPlayAll && ((songs) => surfaceProps.onPlayAll?.(songs, selectedCollection)),
            }
            : surfaceProps,
    ), [selectedCollection, surfaceProps]);

    const openGridView = useCallback((collection: GridViewCollectionDescriptor) => {
        onOpenCollection(collection);
    }, [onOpenCollection]);

    // 压栈 / 返回之前先让负责集合层的 suite 安排转场（网格：级联入场计划、反向移形换影，原先写在这里的
    // 两段逻辑原样搬进了 suites/grid/transitions/gridHostTransitions）。
    // 只有真的压栈才安排入场：要进入的正好是上一层时（N1 折叠紧邻往返）是一次返回，反向转场由弹栈通知跑；
    // 就是当前这一层时什么都不发生，也不该留下一个没人用的入场计划。
    const handlePushCollection = useCallback((col: GridViewCollectionDescriptor) => {
        const decision = resolveCollectionPush(useCollectionNavigationStore.getState().snapshot, col);
        if (decision.kind === 'push') {
            activeTransitions?.beforePush?.(readNavigationContext());
        }
        onPushCollection(col);
    }, [activeTransitions, onPushCollection]);

    // 应用内返回已经跑过 beforeBack 的那次弹栈（弹栈前的快照）：随后 history.back() 的 popstate 再通知时认出它、不重跑。
    // 快照每次导航都是新对象，按引用比较；没等来通知（例如返回被忽略）也无妨，下一次弹栈的快照不会是它。
    const armedBackRef = useRef<CollectionNavigationSnapshot | null>(null);
    const handleBackCollection = useCallback(() => {
        activeTransitions?.beforeBack?.(readNavigationContext());
        armedBackRef.current = useCollectionNavigationStore.getState().snapshot;
        onBackCollection();
    }, [activeTransitions, onBackCollection]);

    // 浏览器后退（popstate 直接恢复历史里的栈，不经过上面的 handleBackCollection）：在 store 变化之前跑同一个
    // beforeBack，网格的反向移形换影与卡片散开和应用内返回一样出现。
    const activeTransitionsRef = useRef(activeTransitions);
    activeTransitionsRef.current = activeTransitions;
    useEffect(() => subscribeCollectionPop((from) => {
        const armed = armedBackRef.current;
        armedBackRef.current = null;
        if (armed === from) return;
        activeTransitionsRef.current?.beforeBack?.(readNavigationContext());
    }), []);

    useEffect(() => {
        if (
            localLibraryCatalog.ready &&
            selectedCollection &&
            isLocalGridViewCollection(selectedCollection) &&
            selectedCollection.entityId &&
            liveSelectedCollection &&
            isLocalGridViewCollection(liveSelectedCollection) &&
            liveSelectedCollection.trackCount === 0
        ) {
            handleBackCollection();
        }
    }, [handleBackCollection, liveSelectedCollection, localLibraryCatalog.ready, selectedCollection]);

    const showCatalogUnavailable = useCallback(() => {
        surfaceProps.onStatusMessage?.({ type: 'error', text: t('search.catalogUnavailable') });
    }, [surfaceProps, t]);

    const handlePushAlbumCollection = useCallback(async (
        albumId: number | string,
        album?: any,
        track?: SongResult,
    ) => {
        if (!selectedCollection) return;

        const source = selectedCollection.source;
        const albumName = album?.name || '';
        const albumCoverUrl = album?.coverUrl;
        // 点的是当前正在看的这张专辑时直接返回：不必再去解析 catalog（在线路径会发请求，
        // 解析失败还会弹「目录不可用」，而用户只是点了自己在看的那张专辑）。解析之后再比一次
        // 由 store 的 push 兜底 —— 那条才是所有分支都绕不过的不变式。
        if (selectedCollection.type === 'album' && String(selectedCollection.id) === String(albumId)) {
            return;
        }
        if (source === 'online') {
            let resolvedAlbumId = albumId;
            if (track) {
                try {
                    const ref = await resolveSongCatalogRef(track as UnifiedSong, 'album', {
                        id: albumId,
                        name: albumName,
                        coverUrl: albumCoverUrl,
                        catalogRef: album?.catalogRef,
                    });
                    if (!ref) {
                        showCatalogUnavailable();
                        return;
                    }
                    resolvedAlbumId = ref.id;
                } catch (error) {
                    console.warn('[CatalogNavigation] Failed to resolve nested album:', error);
                    showCatalogUnavailable();
                    return;
                }
            }
            handlePushCollection({
                ...(album && typeof album === 'object' ? album : {}),
                source: 'online',
                providerId: selectedCollection.providerId,
                id: resolvedAlbumId,
                name: albumName,
                type: 'album',
                coverUrl: albumCoverUrl,
            });
        } else if (source === 'navidrome') {
            handlePushCollection({
                source: 'navidrome',
                id: String(albumId),
                name: albumName,
                type: 'album',
                coverUrl: albumCoverUrl,
            });
        } else if (source === 'local') {
            const catalogIndex = buildLocalCatalogIndex(localLibraryCatalog);
            const link = resolveLocalCatalogLink(localLibraryCatalog, surfaceProps.localSongs, {
                kind: 'album',
                entityId: String(albumId),
                name: album?.name,
            }, catalogIndex);
            if (!link) return;
            const localAlbumEntity = link.entity;
            const selectedAlbumSourceId = selectedCollection.entityId
                || (selectedCollection.type === 'album' ? String(selectedCollection.id) : undefined);
            const selectedAlbumEntityId = selectedAlbumSourceId
                ? followEntityRedirect(selectedAlbumSourceId, catalogIndex.entitiesById)
                : undefined;
            if (selectedCollection.type === 'album' && selectedAlbumEntityId === localAlbumEntity.id) {
                return;
            }
            const localAlbumName = localAlbumEntity.displayName;
            const localCoverUrl = albumCoverUrl;
            const albumSongs = link.songs;
            const albumArtist = resolveLocalAlbumArtistDisplay(
                albumSongs.map(song => song.id),
                localLibraryCatalog,
            );
            handlePushCollection({
                source: 'local',
                id: localAlbumEntity.id,
                entityId: localAlbumEntity.id,
                name: localAlbumName,
                type: 'album',
                coverUrl: localCoverUrl,
                description: albumArtist,
                albumArtist,
                songIds: albumSongs.map(song => song.id),
            });
        }
    }, [handlePushCollection, surfaceProps.localSongs, localLibraryCatalog, selectedCollection, showCatalogUnavailable]);

    const handlePushArtistCollection = useCallback(async (
        artistId: number | string,
        artist?: any,
        track?: SongResult,
    ) => {
        if (!selectedCollection) return;

        const source = selectedCollection.source;
        const artistName = artist?.name || String(artistId);
        // 同上：歌手页的曲目卡片带着同一张歌手的入口，点它不该再压一层同样的歌手页。
        if (selectedCollection.type === 'artist' && String(selectedCollection.id) === String(artistId)) {
            return;
        }
        if (source === 'online') {
            let resolvedArtistId = artistId;
            if (track) {
                try {
                    const ref = await resolveSongCatalogRef(track as UnifiedSong, 'artist', {
                        id: artistId,
                        name: artistName,
                        catalogRef: artist?.catalogRef,
                    });
                    if (!ref) {
                        showCatalogUnavailable();
                        return;
                    }
                    resolvedArtistId = ref.id;
                } catch (error) {
                    console.warn('[CatalogNavigation] Failed to resolve nested artist:', error);
                    showCatalogUnavailable();
                    return;
                }
            }
            handlePushCollection({
                source: 'online',
                providerId: selectedCollection.providerId,
                id: resolvedArtistId,
                name: artistName,
                type: 'artist',
            });
            return;
        }
        if (source === 'navidrome') {
            handlePushCollection({
                source: 'navidrome',
                id: String(artistId),
                name: artistName,
                type: 'artist',
            });
            return;
        }

        const link = resolveLocalCatalogLink(localLibraryCatalog, surfaceProps.localSongs, {
            kind: 'artist',
            entityId: String(artistId),
            name: artistName,
        });
        if (!link) return;
        const artistEntity = link.entity;
        const artistSongs = link.songs;
        handlePushCollection({
            source: 'local',
            id: artistEntity.id,
            entityId: artistEntity.id,
            name: artistEntity.displayName,
            type: 'artist',
            songIds: artistSongs.map(song => song.id),
        });
    }, [handlePushCollection, surfaceProps.localSongs, localLibraryCatalog, selectedCollection, showCatalogUnavailable]);

    useEffect(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            setResolvedLocalCollectionCoverUrl(undefined);
        }
        if (!selectedCollection || selectedCollection.source === 'online') {
            setNavidromePlaylistItems([]);
        }
    }, [selectedCollectionKey]);

    useEffect(() => {
        if (!selectedCollection || !isLocalGridViewCollection(selectedCollection)) {
            return;
        }

        if (!liveSelectedCollection || !isLocalGridViewCollection(liveSelectedCollection)) {
            handleBackCollection();
            return;
        }

        const resolvedTracks = localTracks ?? [];
        if (liveSelectedCollection.songIds.length > 0 && resolvedTracks.length === 0) {
            handleBackCollection();
            return;
        }

        setNavidromePlaylistItems([]);
        setResolvedLocalCollectionCoverUrl(resolveLocalCollectionCoverUrlFromTracks(
            resolvedTracks,
            surfaceProps.localSongs,
        ));
    }, [
        handleBackCollection,
        surfaceProps.localSongs,
        liveSelectedCollection,
        localTracks,
        selectedCollection,
    ]);

    const refreshNavidromePlaylists = useCallback(async () => {
        const config = getNavidromeConfig();
        if (!config) {
            setNavidromePlaylistItems([]);
            return;
        }

        const playlists = await navidromeApi.getPlaylists(config);
        setNavidromePlaylistItems(playlists.map(playlist => ({
            id: playlist.id,
            name: playlist.name,
            description: playlist.owner,
        })));
    }, []);

    useEffect(() => {
        if (selectedCollection && isNavidromeGridViewCollection(selectedCollection)) {
            void refreshNavidromePlaylists();
        }
    }, [refreshNavidromePlaylists, selectedCollection]);


    // 「完成」（任意 suite 的返回按钮）：清掉这一层的浏览会话，让每套 suite 忘掉这一层的布局记录，再返回。
    // 键与 suite 用的会话键一致：歌手页是导航栈那一层的 collectionKey（= 歌手资源的 key），集合是显示用描述的
    // collectionKey（本地集合在 catalog 就绪后可能换 id，两个都清）。先清再返回：正在离开的 TUI 卸载时想写回焦点，
    // 会被会话的「代」挡住（core/shared/useLibraryBrowseSessionStore）。
    const handleDoneCollection = useCallback(() => {
        const keys = new Set([selectedCollectionKey, collectionKey(displaySelectedCollection)].filter(Boolean));
        const sessions = useLibraryBrowseSessionStore.getState();
        keys.forEach(key => {
            forgetLibraryLayouts(key);
            sessions.clearSession(key);
        });
        handleBackCollection();
    }, [displaySelectedCollection, handleBackCollection, selectedCollectionKey]);

    // 来源动作（本地曲库、Navidrome、对话框、账户刷新）集中在变更端口里，只交给变更控制器；
    // suite 不直接拿端口，所有变更都经控制器（能力判定、进行中标记与重复提交保护在那里）。
    const mutationPort = useMemo(() => createLibraryMutationPort({
        surface: surfaceProps,
        t,
        dialogs: {
            editEntity: setEditingEntityId,
            editCover: setCoverEditingCollection,
            organizeFolder: setOrganizingFolder,
            matchSong: setMatchingSongId,
        },
        navidromePlaylists: navidromePlaylistItems,
        refreshNavidromePlaylists,
    }), [surfaceProps, t, navidromePlaylistItems, refreshNavidromePlaylists]);
    // 变更动作控制器：宿主按集合会话创建与释放，自己不订阅快照（不会因进行中的状态重渲染首页）。
    // 交给集合 surface：网格与 TUI 都订阅它（换 suite 不重建，订阅状态、进行中的删除都留在这里）。
    const collectionMutations = useCollectionMutations({
        descriptor: liveSelectedCollection && liveSelectedCollection.type !== 'artist' ? liveSelectedCollection : null,
        resource: collectionResource,
        port: mutationPort,
        currentUserId: surfaceProps.user?.id,
    });
    const CollectionSurface = collectionSurface.component;
    const ArtistSurface = artistSurface.component;

    const editingEntity = editingEntityId
        ? localLibraryCatalog.entities.find(entity => entity.id === editingEntityId)
        : undefined;
    const editingEntityMemberIds = new Set(localLibraryCatalog.assignments
        .filter(assignment => editingEntity?.kind === 'artist'
            ? assignment.artistEntityIds.includes(editingEntity.id)
            : assignment.albumEntityId === editingEntity?.id)
        .map(assignment => assignment.songId));
    const editingEntitySongs = surfaceProps.localSongs.filter(song => editingEntityMemberIds.has(song.id));
    const organizingFolderSongs = organizingFolder
        ? organizingFolder.songIds
            .map(songId => surfaceProps.localSongs.find(song => song.id === songId))
            .filter((song): song is LocalSong => Boolean(song))
        : [];
    const matchingSong = matchingSongId
        ? surfaceProps.localSongs.find(song => song.id === matchingSongId)
        : undefined;
    // 本地实体、歌曲信息、手动匹配这几个弹窗和首页层在同一个层叠上下文里，盖不过左边的速记簿：开着时让它藏起来。
    const isScratchpadCovered = Boolean(editingEntity || organizingFolder || matchingSong);
    useEffect(() => {
        useScratchpadStore.getState().setCovered(isScratchpadCovered);
    }, [isScratchpadCovered]);
    useEffect(() => () => useScratchpadStore.getState().setCovered(false), []);

    // 封面对话框列的是集合此刻的歌（导航栈里的描述可能落后于曲库，取刷新过的那一份）。
    const coverEditingTarget = coverEditingCollection && liveSelectedCollection
        && isLocalGridViewCollection(liveSelectedCollection)
        && collectionKey(liveSelectedCollection) === collectionKey(coverEditingCollection)
        ? liveSelectedCollection
        : coverEditingCollection;
    const coverEditingSongs = useMemo(() => {
        if (!coverEditingTarget) return [];
        const songsById = new Map(surfaceProps.localSongs.map(song => [song.id, song]));
        return coverEditingTarget.songIds
            .map(songId => songsById.get(songId))
            .filter((song): song is LocalSong => Boolean(song));
    }, [coverEditingTarget, surfaceProps.localSongs]);
    const matchingSongAssignment = matchingSongId
        ? localLibraryCatalog.assignments.find(assignment => assignment.songId === matchingSongId)
        : undefined;

    return (
        <>
            <div
                className="absolute inset-0"
                aria-hidden={isSurfaceCovered}
                style={{
                    visibility: isSurfaceHidden ? 'hidden' : 'visible',
                    // Hidden only once the page that opens has covered it. The home surface
                    // paints a tint and a blur over what the player draws behind it; taken
                    // away at the click, while the page was still see-through, they left that
                    // picture bare for the first frames, which showed as a flash.
                    transition: `visibility 0s linear ${selectedCollection ? HOME_HIDDEN_AFTER_SECONDS : 0}s`,
                    pointerEvents: isSurfaceCovered ? 'none' : 'auto',
                }}
            >
                {isSurfaceMounted && children(openGridView, isInteractive && !selectedCollection)}
            </div>
            {/* 生效 suite 的常驻舞台：首页之上、背景板与集合层之下；始终占这个位置，打开 / 关闭集合不重挂。 */}
            <LibrarySuiteStageSlot
                stage={stage}
                isInteractive={isInteractive}
                theme={surfaceProps.theme}
                isDaylight={isDaylight}
                navigation={stageNavigation}
                onBackToPlayer={surfaceProps.onBackToPlayer}
                onTogglePlayback={surfaceProps.onTogglePlayback}
                onEnterPlaybackView={surfaceProps.onEnterPlaybackView}
                onOpenLattice={surfaceProps.onOpenLattice}
            />
            <AnimatePresence initial={false}>
                {layerPresentation.showBackdrop && (
                    <motion.div
                        key="library-transition-backdrop"
                        data-library-backdrop=""
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={backdrop.exit
                            ? { opacity: 0, transition: backdrop.exit }
                            : { opacity: 0 }}
                        transition={backdrop.enter}
                        className="fixed inset-0 z-[49] pointer-events-none"
                        style={{ backgroundColor: 'var(--bg-color)' }}
                    />
                )}
            </AnimatePresence>
            <AnimatePresence initial={false}>
                {displaySelectedCollection && (
                    // key 带上实际渲染它的 suite：切换 suite 时集合层换一个实例；两个都回退到网格的 suite 之间
                    // 切换（例如歌手页）不重新挂载。Suspense 给 lazy 的 suite 组件用，即时组件不会挂起。
                    displaySelectedCollection.type === 'artist' ? (
                        <React.Suspense key={`${artistSurface.suiteId}:${selectedCollectionKey}`} fallback={null}>
                            <ArtistSurface
                                collection={displaySelectedCollection}
                                resource={artistResource}
                                playback={playbackPort}
                                theme={surfaceProps.theme}
                                isDaylight={isDaylight}
                                isInteractive={isInteractive}
                                onEditEntity={setEditingEntityId}
                                declaredActions={artistSurface.declaredActions}
                                onBack={handleBackCollection}
                                onDone={handleDoneCollection}
                                onOpenAlbum={handlePushAlbumCollection}
                                onOpenArtist={handlePushArtistCollection}
                                onPopTo={onPopCollectionTo}
                            />
                        </React.Suspense>
                    ) : (
                        <React.Suspense key={`${collectionSurface.suiteId}:${selectedCollectionKey}`} fallback={null}>
                            <CollectionSurface
                                collection={displaySelectedCollection}
                                resource={collectionResource}
                                playback={playbackPort}
                                mutations={collectionMutations}
                                localSongs={surfaceProps.localSongs}
                                theme={surfaceProps.theme}
                                isDaylight={isDaylight}
                                isInteractive={isInteractive}
                                onStatusMessage={surfaceProps.onStatusMessage}
                                currentUserId={surfaceProps.user?.id}
                                declaredActions={collectionSurface.declaredActions}
                                onBack={handleBackCollection}
                                onDone={handleDoneCollection}
                                onOpenAlbum={handlePushAlbumCollection}
                                onOpenArtist={handlePushArtistCollection}
                                onPopTo={onPopCollectionTo}
                            />
                        </React.Suspense>
                    )
                )}
            </AnimatePresence>
            {/* After the pages: a transition layer's layout effect measures the page that has just
                mounted (the grid's cover lands on it in that commit), and a component later in the
                tree has its layout effects run later. */}
            {SUITE_OVERLAYS.map(({ suiteId: overlaySuiteId, Overlay }) => (
                <Overlay key={overlaySuiteId} enabled={backdrop.enabled && transitionOwner.suiteId === overlaySuiteId} />
            ))}
            {/* 首页上也有（切换的是首页 surface；没有集合会话要冲刷，用首页的固定 key）；歌手页上也有（P4.3 起 TUI 实现了歌手页，
                冲刷的是这一层歌手页的会话——键与歌手资源的 key 相同）。 */}
            {DevLibraryRendererSwitch && HAS_SUITE_CHOICE && (isInteractive || displaySelectedCollection) && (
                <React.Suspense fallback={null}>
                    <DevLibraryRendererSwitch
                        sessionKey={displaySelectedCollection ? selectedCollectionKey : HOME_SUITE_SESSION_KEY}
                        placement={displaySelectedCollection ? (displaySelectedCollection.type === 'artist' ? 'artist' : 'collection') : 'home'}
                    />
                </React.Suspense>
            )}
            {editingEntity && (
                <LocalLibraryEntityPanel
                    entity={editingEntity}
                    sameKindEntities={localLibraryCatalog.entities.filter(entity => entity.kind === editingEntity.kind)}
                    memberSongs={editingEntitySongs}
                    isDaylight={isDaylight}
                    onClose={() => setEditingEntityId(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await surfaceProps.onRefreshLocalSongs();
                    }}
                />
            )}
            {organizingFolder && (
                <LocalFolderSongInfoPanel
                    folderName={organizingFolder.name}
                    songs={organizingFolderSongs}
                    assignments={localLibraryCatalog.assignments}
                    isDaylight={isDaylight}
                    onClose={() => setOrganizingFolder(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await surfaceProps.onRefreshLocalSongs();
                    }}
                />
            )}
            {coverEditingTarget && (
                <LocalCollectionCoverDialog
                    collection={coverEditingTarget}
                    songs={coverEditingSongs}
                    isDaylight={isDaylight}
                    onClose={() => setCoverEditingCollection(null)}
                />
            )}
            {matchingSong && (
                <LocalSongMetadataMatchDialog
                    song={matchingSong}
                    assignment={matchingSongAssignment}
                    isDaylight={isDaylight}
                    onClose={() => setMatchingSongId(null)}
                    onChanged={async () => {
                        await localLibraryCatalog.reload();
                        await surfaceProps.onRefreshLocalSongs();
                    }}
                />
            )}
        </>
    );
};

export default GridViewOverlayHost;
