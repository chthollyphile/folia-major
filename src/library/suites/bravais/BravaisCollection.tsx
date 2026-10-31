import React, { useCallback, useMemo, useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../../../types';
import type { LibraryActionId, LibraryCollectionSurfaceProps } from '../../core/suite/suite.contract';
import { collectionKey } from '../../core/collection/collectionIdentity';
import { buildCoreSurfaceParams, buildGridSurfaceState, runGridSurfaceAction } from '../../core/collection/collectionSurface';
import { resolveDeclaredMutationActions } from '../../core/suite/librarySuites';
import { resolveTrackAlbumLink, resolveTrackArtistLinks } from '../../core/shared/trackLinks';
import { useCollectionResourceState } from '../../core/collection/resource/useCollectionResourceState';
import { useCollectionView } from '../../core/collection/useCollectionView';
import { useCollectionActions } from '../../core/collection/mutations/useCollectionActions';
import { useCollectionMutationSnapshot } from '../../core/collection/mutations/useCollectionMutations';
import { useLocalTrackSortStore } from '../../core/directory/useLocalTrackSortStore';
import { useGridSurfaceRegistration } from '../../../hooks/useGridSurfaceRegistration';
import { canResolveSongCatalogRef } from '../../../services/onlineMusic/catalogRefs';
import { useNavigationPageKey } from '../../../components/app/playing-song-locator/useNavigationPageKey';
import type { BravaisItem, BravaisLayer, BravaisLayerLocate, BravaisSeamModel } from './bravaisLayer';
import { collectQueuedKeys, findNowPlayingKey, projectCollectionTracks } from './bravaisProjection';
import { describeBravaisTrack } from './describeBravaisTrack';
import type { BravaisPlaylistScope } from './bravaisFormModel';
import { useBravaisCollectionFilter } from './useBravaisCollectionFilter';
import { useBravaisCollectionForms } from './useBravaisCollectionForms';
import { useBravaisCollectionSeam } from './useBravaisCollectionSeam';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { useBravaisPopTo } from './useBravaisPopTo';
import { useBravaisMutationNotice } from './useBravaisMutationNotice';
import { useBravaisPlaybackMarks } from './useBravaisPlaybackMarks';
import { useBravaisSessionFocus } from './useBravaisSessionFocus';
import { projectBravaisSeamAlbum } from './bravaisAlbumModel';
import { assignAlbumCoverArt } from './bravaisAlbumWall';

// src/library/suites/bravais/BravaisCollection.tsx
// 集合 surface（B7：全部 23 个动作）。它不画墙：订阅 core binding，把曲目投影成层描述推进 stage store，再向命令面板注册
// 集合动作（useGridSurfaceRegistration + buildCoreSurfaceParams，按 entry 的声明过滤）。画面上只有一个不可见、铺满的
// 锚点（页面教程的 none 标记与探针要的语义属性）。
// 双模式（设计稿 §4）：没有过滤时层是无限拼贴（全部条目），过滤时退化为有限拼贴（只放匹配项，严格 rank），清空后翻回
// 无限拼贴、起点偏移保留——这两种层只差 mode / items / wall.filterKey，stage 按它们翻牌。缝里的集合块、列表面板、
// 表单态与结果提示的投影在 useBravaisCollectionSeam，过滤在 useBravaisCollectionFilter。

const NO_KEYS: ReadonlySet<string> = new Set();

const BravaisCollection: React.FC<LibraryCollectionSurfaceProps> = ({
    collection,
    resource,
    playback,
    mutations,
    localSongs,
    isInteractive,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
    declaredActions,
    onPopTo,
}) => {
    const { t } = useTranslation();
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const sessionKey = collectionKey(collection);
    const popTo = useBravaisPopTo(onPopTo);

    const { snapshot } = useCollectionResourceState(resource);
    const tracks = useMemo(() => snapshot?.tracks ?? [], [snapshot?.tracks]);
    const filter = useBravaisCollectionFilter({ sessionKey, isActive });
    // 与网格、TUI 同一条规则：只有本地文件夹（含「全部歌曲」）按本地排序。
    const supportsLocalTrackSorting = collection.source === 'local' && collection.type === 'folder';
    const sortField = useLocalTrackSortStore(state => state.field);
    const sortDirection = useLocalTrackSortStore(state => state.direction);
    const setSortField = useLocalTrackSortStore(state => state.setField);
    const setSortDirection = useLocalTrackSortStore(state => state.setDirection);
    const localSongsById = useMemo(() => new Map(localSongs?.map(song => [song.id, song])), [localSongs]);
    const localSort = useMemo(() => (
        supportsLocalTrackSorting ? { songsById: localSongsById, field: sortField, direction: sortDirection } : null
    ), [localSongsById, sortDirection, sortField, supportsLocalTrackSorting]);
    const view = useCollectionView({ tracks, committedQuery: filter.committedQuery, localSort });
    const mutationSnapshot = useCollectionMutationSnapshot(mutations);
    // 收进速记簿时记下的出处：改过名就用新名字（与缝里的标题一致）。
    const actions = useCollectionActions({
        resource, snapshot, view, port: playback, collectionType: collection.type,
        collectionName: mutationSnapshot.renamedTo ?? collection.name,
    });

    // 命令面板：与网格、TUI 同一个构建函数，按 entry 的声明过滤；bravais 没有网格的三个局部动作（见 entry）。
    const surfaceParams = buildCoreSurfaceParams({
        declaredActions,
        supportsLocalTrackSorting,
        canReloadOnlineCollection: actions.capabilities.reload.enabled,
        filteredTrackCount: view.contextTracks.length,
        isFilterActive: view.isFilterActive,
        sortField,
        sortDirection,
        playFiltered: actions.playScope,
        enqueueFiltered: actions.enqueueScope,
        collectFiltered: actions.capabilities.collect ? actions.collectScope : undefined,
        setSortField,
        setSortDirection,
        reloadOnlineCollection: actions.reload,
        mutationSnapshot,
        mutations,
    });
    useGridSurfaceRegistration({
        isInteractive: isActive,
        getState: () => buildGridSurfaceState(surfaceParams),
        run: action => runGridSurfaceAction(action, surfaceParams),
    });

    // 入口：suite 声明了、控制器也说这个集合支持（声明 ∩ 能力）。
    const offered = useMemo(
        () => new Set<LibraryActionId>(mutations ? resolveDeclaredMutationActions(declaredActions, mutationSnapshot.capabilities) : []),
        [declaredActions, mutationSnapshot.capabilities, mutations],
    );
    const offers = useCallback((action: LibraryActionId) => offered.has(action), [offered]);
    const declares = useCallback((action: LibraryActionId) => declaredActions.actions.includes(action), [declaredActions]);

    const focus = useBravaisSessionFocus(sessionKey);
    const { playbackKey, queuedPlaybackKeys } = useBravaisPlaybackMarks();
    const unknownArtist = t('player.unknownArtist');
    // 专辑页：曲目封面的画法（整面墙拼成封面，或带单曲封面时切成碎片，bravaisAlbumWall）；只在专辑海报在场时画出来。
    // 墙画的是曲目，用自动封面（由歌推出来的那张）：本地专辑设了自定义集合封面时，海报换成那张，墙上的曲目不变。
    const wallCoverUrl = collection.source === 'local' && collection.automaticCoverUrl !== undefined
        ? collection.automaticCoverUrl
        : collection.coverUrl;
    const albumCoverUrl = collection.type === 'album' ? snapshot?.detail?.coverUrl || wallCoverUrl || undefined : undefined;
    const isAlbum = collection.type === 'album';
    const allItems = useMemo(() => {
        const projected = projectCollectionTracks(view.displayTracks, view.entryKeyAt, describeBravaisTrack, unknownArtist);
        return isAlbum ? assignAlbumCoverArt(projected, albumCoverUrl) : projected;
    }, [albumCoverUrl, isAlbum, unknownArtist, view.displayTracks, view.entryKeyAt]);
    // 过滤时只放匹配项（序号徽标保留它在整张列表里的位置）。
    const items = useMemo<readonly BravaisItem[]>(() => {
        if (!view.matchIndexes) return allItems;
        const byKey = new Map(allItems.map(item => [item.key, item]));
        return view.matchIndexes
            .map(index => byKey.get(view.entryKeyAt(index) ?? ''))
            .filter((item): item is BravaisItem => Boolean(item));
    }, [allItems, view]);
    const trackByKey = useMemo(() => {
        const map = new Map<string, SongResult>();
        view.displayTracks.forEach((track, index) => {
            const key = view.entryKeyAt(index);
            if (key) map.set(key, track);
        });
        return map;
    }, [view]);
    const nowPlayingKey = useMemo(() => findNowPlayingKey(items, playbackKey), [items, playbackKey]);
    const queuedKeys = useMemo(
        () => (queuedPlaybackKeys.size ? collectQueuedKeys(items, queuedPlaybackKeys) : NO_KEYS),
        [items, queuedPlaybackKeys],
    );

    // 表单态与结果提示。
    const displayTitle = mutationSnapshot.renamedTo ?? collection.name;
    const notice = useBravaisMutationNotice();
    const latest = useRef({ trackByKey, actions, view, onOpenAlbum, onOpenArtist, onBack, onDone, declaredActions, focus, filter });
    latest.current = { trackByKey, actions, view, onOpenAlbum, onOpenArtist, onBack, onDone, declaredActions, focus, filter };
    const tracksFor = useCallback((scope: BravaisPlaylistScope): SongResult[] => {
        if (scope.kind === 'collection') return latest.current.view.playableTracks;
        const track = latest.current.trackByKey.get(scope.entryKey);
        return track ? [track] : [];
    }, []);
    const onBackStable = useCallback(() => latest.current.onBack(), []);
    const forms = useBravaisCollectionForms({
        mutations,
        displayTitle,
        tracksFor,
        onBack: onBackStable,
        run: notice.run,
        describe: notice.describe,
    });
    const { seamCollection, filter: seamFilter, wall, entries, matchLabel } = useBravaisCollectionSeam({
        collection,
        mutations,
        snapshot,
        mutationSnapshot,
        view,
        actions,
        offers,
        declares,
        displayTitle,
        itemCount: allItems.length,
        matchCount: items.length,
        query: filter.query,
        committedQuery: filter.committedQuery,
        setQuery: filter.setQuery,
        sort: {
            supported: supportsLocalTrackSorting,
            field: sortField,
            direction: sortDirection,
            setField: setSortField,
            setDirection: setSortDirection,
        },
        trackByKey,
        forms,
        notice,
    });

    // 回调身份稳定：执行时读最新的映射、动作与导航（层描述因此只在数据变化时换身份）。
    const callbacks = useMemo(() => {
        const trackOf = (key: string) => latest.current.trackByKey.get(key);
        const declared = (action: LibraryActionId) => latest.current.declaredActions.actions.includes(action);
        const albumLink = (key: string) => {
            const track = trackOf(key);
            return track && declared('open-album') ? resolveTrackAlbumLink(track, canResolveSongCatalogRef) : null;
        };
        const artistLink = (key: string, index: number) => {
            const track = trackOf(key);
            if (!track || !declared('open-artist')) return null;
            const link = resolveTrackArtistLinks(track, canResolveSongCatalogRef)[index];
            return link && link.targetId !== undefined ? link : null;
        };
        return {
            onPlayItem: (key: string) => {
                const track = trackOf(key);
                if (!track || !declared('play')) return;
                latest.current.focus.persistFocus(key);
                latest.current.actions.playTrack(track);
            },
            onEnqueueItem: (key: string) => {
                const track = trackOf(key);
                if (track && declared('enqueue')) latest.current.actions.enqueueTrack(track);
            },
            canOpenAlbum: (key: string) => Boolean(albumLink(key)),
            onOpenAlbum: (key: string) => {
                const track = trackOf(key);
                const link = albumLink(key);
                if (!track || !link) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenAlbum(link.targetId, { ...link.album }, track);
            },
            canOpenArtist: (key: string, index: number) => Boolean(artistLink(key, index)),
            onOpenArtist: (key: string, index: number) => {
                const track = trackOf(key);
                const link = artistLink(key, index);
                if (!track || !link || link.targetId === undefined) return;
                latest.current.focus.persistFocus(key);
                latest.current.onOpenArtist(link.targetId, { ...link.artist }, track);
            },
            onFocusEntry: (key: string | null) => latest.current.focus.noteFocus(key),
            onBack: () => latest.current.onBack(),
            onDone: () => latest.current.onDone(),
            onPlayScope: () => latest.current.actions.playScope(),
            onEnqueueScope: () => latest.current.actions.enqueueScope(),
            clearFilter: () => latest.current.filter.setQuery(''),
        };
    }, []);

    // 「定位正在播放」：与网格的集合页同一个页键（导航栈栈顶的那一份），列表全不全的读法也与网格相同（GridView）。
    const navigationPageKey = useNavigationPageKey();
    const locatePageKey = navigationPageKey ?? sessionKey;
    const isFiltered = Boolean(filter.query || filter.committedQuery);
    const cardsStillArriving = snapshot
        ? snapshot.status === 'idle' || snapshot.status === 'loading' || snapshot.sync.status === 'syncing'
        : false;
    const hasReadFailed = Boolean(snapshot?.error || snapshot?.sync.status === 'interrupted');
    const locate = useMemo<BravaisLayerLocate>(() => ({
        pageKey: locatePageKey,
        isFiltered,
        cardsStillArriving,
        hasReadFailed,
        clearFilter: callbacks.clearFilter,
    }), [callbacks, cardsStillArriving, hasReadFailed, isFiltered, locatePageKey]);

    const scopeEnabled = actions.capabilities.scope.enabled;
    const declaresScope = declaredActions.actions.includes('play-scope');
    const declaresEnqueueScope = declaredActions.actions.includes('enqueue-scope');
    // 专辑页的海报信息（左边的凝彩海报）：只有专辑类型的集合有，详情盖在集合描述上。
    const totalTracks = snapshot?.detail?.trackCount ?? collection.trackCount ?? allItems.length;
    const seamAlbum = useMemo(() => projectBravaisSeamAlbum({
        collection,
        detail: snapshot?.detail,
        trackCount: totalTracks,
        labels: { kind: t('libraryBravais.kind.album'), trackCount: count => t('libraryBravais.trackCount', { count }) },
    }), [collection, snapshot?.detail, t, totalTracks]);
    const seam = useMemo<BravaisSeamModel>(() => ({
        title: displayTitle,
        crumb: displayTitle,
        // 过滤中显示「匹配 / 总数」（书脊上也是它）。
        meta: view.isFilterActive ? matchLabel : t('libraryBravais.trackCount', { count: allItems.length }),
        onPlayScope: declaresScope && scopeEnabled ? callbacks.onPlayScope : undefined,
        onEnqueueScope: declaresEnqueueScope && scopeEnabled ? callbacks.onEnqueueScope : undefined,
        filter: seamFilter,
        collection: seamCollection,
        album: seamAlbum,
    }), [seamAlbum, allItems.length, callbacks, declaresEnqueueScope, declaresScope, displayTitle, matchLabel, scopeEnabled, seamCollection, seamFilter, t, view.isFilterActive]);

    const layer = useMemo<BravaisLayer>(() => ({
        key: sessionKey,
        sessionKey,
        surface: 'collection',
        mode: view.isFilterActive ? 'finite' : 'infinite',
        items,
        seam,
        isInteractive: isActive,
        focusedEntryKey: focus.initialKey,
        nowPlayingKey,
        queuedKeys,
        onPlayItem: callbacks.onPlayItem,
        onEnqueueItem: callbacks.onEnqueueItem,
        canOpenAlbum: callbacks.canOpenAlbum,
        onOpenAlbum: callbacks.onOpenAlbum,
        canOpenArtist: callbacks.canOpenArtist,
        onOpenArtist: callbacks.onOpenArtist,
        onFocusEntry: callbacks.onFocusEntry,
        onBack: callbacks.onBack,
        onDone: callbacks.onDone,
        onPopTo: popTo,
        wall,
        entries,
        locate,
    }), [callbacks, entries, focus.initialKey, isActive, items, locate, popTo, nowPlayingKey, queuedKeys, seam, sessionKey, view.isFilterActive, wall]);
    useBravaisLayerRegistration('top', layer, isPresent);

    // 不可见的锚点：铺满但不接指针，画面全在 stage 里。Ponder 的页面标记（bravais-wall）要有尺寸才参与解析。
    return (
        <div
            data-library-renderer="bravais"
            data-library-surface="collection"
            data-ponder-page-scope="bravais-wall"
            data-bravais-layer={sessionKey}
            data-bravais-mode={view.isFilterActive ? 'finite' : 'infinite'}
            aria-hidden
            className="pointer-events-none fixed inset-0"
        />
    );
};

export default BravaisCollection;
