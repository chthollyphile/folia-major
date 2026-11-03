import React, { useCallback, useMemo, useRef } from 'react';
import { useIsPresent } from 'framer-motion';
import { useTranslation } from 'react-i18next';
import type { SongResult, StatusMessage } from '../../../types';
import type { LibraryArtistAlbum } from '../../core/artist/artist.contract';
import type { LibraryArtistSurfaceProps } from '../../core/suite/suite.contract';
import { filterArtistAlbums } from '../../core/artist/artistModel';
import { artistAlbumEntryKey } from '../../core/artist/artistSurface';
import { useArtistResourceState } from '../../core/artist/useArtistResourceState';
import { useArtistView } from '../../core/artist/useArtistView';
import { useLibraryArtistSurfaceRegistration } from '../../core/artist/useLibraryArtistSurfaceRegistration';
import { projectArtistItems } from './bravaisArtistModel';
import type { BravaisItem, BravaisLayer, BravaisSeamModel } from './bravaisLayer';
import { collectQueuedKeys, findNowPlayingKey } from './bravaisProjection';
import { describeBravaisTrack } from './describeBravaisTrack';
import { useBravaisArtistLinks } from './useBravaisArtistLinks';
import { useBravaisArtistSeam } from './useBravaisArtistSeam';
import { useBravaisCollectionFilter } from './useBravaisCollectionFilter';
import { useBravaisLayerRegistration } from './useBravaisLayerRegistration';
import { useBravaisPopTo } from './useBravaisPopTo';
import { useBravaisMutationNotice } from './useBravaisMutationNotice';
import { useBravaisPlaybackMarks } from './useBravaisPlaybackMarks';
import { useBravaisSessionFocus } from './useBravaisSessionFocus';

// src/library/suites/bravais/BravaisArtist.tsx
// 歌手页 surface（B8，设计稿 §10.4：全部 10 个动作）。它不画墙：订阅宿主交来的歌手资源，把热门歌曲与专辑混排成层描述
// 推进 stage store（热门歌曲在前、专辑在后），再向命令面板注册歌手页动作（useLibraryArtistSurfaceRegistration，
// core 能力 ∩ entry 的声明）。画面上只有一个不可见、铺满的锚点（页面教程的 none 标记与探针要的语义属性）。
// - 歌曲磁贴 → 聚焦卡（播放 / 入队，专辑与其他歌手的链接推入下一层）；专辑磁贴单击进入专辑（被点的专辑是起点磁贴）。
// - 过滤只筛专辑名（core 约定），热门歌曲不参与；过滤生效时退化为有限拼贴，热门歌曲的 rank 离缝最近。
// - 「加入热门歌曲」的条数提示显示在缝底（不走 toast）；本地歌手的实体编辑在缝的「⋯ 更多」，用宿主对话框。
// 缝与墙的投影在 useBravaisArtistSeam，聚焦卡上的链接在 useBravaisArtistLinks。

const NO_KEYS: ReadonlySet<string> = new Set();

const BravaisArtist: React.FC<LibraryArtistSurfaceProps> = ({
    collection,
    resource,
    playback,
    isInteractive,
    declaredActions,
    onEditEntity,
    onBack,
    onDone,
    onOpenAlbum,
    onOpenArtist,
    onPopTo,
}) => {
    const { t } = useTranslation();
    const isPresent = useIsPresent();
    const isActive = isInteractive && isPresent;
    const { snapshot } = useArtistResourceState(resource);
    const notice = useBravaisMutationNotice();
    // 「加入热门歌曲」的结果（core 交来的 StatusMessage）显示在缝底，不走应用的 toast。
    const noticeRef = useRef(notice);
    noticeRef.current = notice;
    const setStatus = useMemo(() => (message: StatusMessage) => {
        noticeRef.current.show(message.text, message.type === 'error' ? 'error' : 'info');
    }, []);
    const view = useArtistView({
        collection,
        resource,
        snapshot,
        playback,
        declaredActions,
        onEditEntity,
        onOpenAlbum,
        setStatus,
    });
    const sessionKey = view.sessionKey;
    const popTo = useBravaisPopTo(onPopTo);
    useLibraryArtistSurfaceRegistration({ isInteractive: isActive, getState: view.surfaceState, run: view.runSurface });

    // 过滤：缝里自己的输入位（墙上直接打字，useBravaisCollectionFilter），墙用防抖、组词按住之后的过滤词，只筛专辑名。
    const filter = useBravaisCollectionFilter({ sessionKey, isActive });
    const hasDetail = snapshot?.status === 'ready' && Boolean(snapshot.detail);
    const topSongs = hasDetail ? view.topSongs : NO_SONGS;
    const shownAlbums = useMemo(
        () => (hasDetail ? filterArtistAlbums(view.albums, filter.committedQuery) : NO_ALBUMS),
        [filter.committedQuery, hasDetail, view.albums],
    );

    const unknownArtist = t('player.unknownArtist');
    const albumLabel = t('libraryBravais.kind.album');
    const trackCountLabel = useCallback((count: number) => t('libraryBravais.trackCount', { count }), [t]);
    const items = useMemo<readonly BravaisItem[]>(() => projectArtistItems({
        topSongs,
        albums: shownAlbums,
        describeTrack: describeBravaisTrack,
        unknownArtist,
        albumLabel,
        trackCountLabel,
    }), [albumLabel, shownAlbums, topSongs, trackCountLabel, unknownArtist]);
    const songByKey = useMemo(() => {
        const map = new Map<string, SongResult>();
        items.forEach((item, index) => {
            if (item.kind === 'track' && topSongs[index]) map.set(item.key, topSongs[index]);
        });
        return map;
    }, [items, topSongs]);
    const albumByKey = useMemo(() => new Map<string, LibraryArtistAlbum>(
        shownAlbums.map(album => [artistAlbumEntryKey(album), album]),
    ), [shownAlbums]);

    const focus = useBravaisSessionFocus(sessionKey);
    const { playbackKey, queuedPlaybackKeys } = useBravaisPlaybackMarks();
    const nowPlayingKey = useMemo(() => findNowPlayingKey(items, playbackKey), [items, playbackKey]);
    const queuedKeys = useMemo(
        () => (queuedPlaybackKeys.size ? collectQueuedKeys(items, queuedPlaybackKeys) : NO_KEYS),
        [items, queuedPlaybackKeys],
    );

    const { seamCollection, seamArtist, filter: seamFilter, wall, entries, meta, isFilterActive } = useBravaisArtistSeam({
        collection,
        snapshot,
        view,
        shownAlbumCount: shownAlbums.length,
        query: filter.query,
        committedQuery: filter.committedQuery,
        setQuery: filter.setQuery,
        notice,
    });
    const callbacks = useBravaisArtistLinks({
        collection,
        view,
        songByKey,
        albumByKey,
        focus,
        onOpenAlbum,
        onOpenArtist,
        onBack,
        onDone,
    });

    const { capabilities, offers } = view;
    const playScopeEnabled = offers('play-scope') && capabilities['play-scope'].enabled;
    const enqueueScopeEnabled = offers('enqueue-scope') && capabilities['enqueue-scope'].enabled;
    const title = snapshot?.detail?.name || collection.name;
    const scopeLabels = useMemo(() => ({
        play: t('libraryBravaisArtist.playTopSongs'),
        enqueue: t('artistGrid.addTopSongsToQueue'),
    }), [t]);
    const seam = useMemo<BravaisSeamModel>(() => ({
        title,
        crumb: title,
        meta,
        onPlayScope: playScopeEnabled ? callbacks.onPlayScope : undefined,
        onEnqueueScope: enqueueScopeEnabled ? callbacks.onEnqueueScope : undefined,
        scopeLabels,
        filter: seamFilter,
        collection: seamCollection,
        artist: seamArtist,
    }), [callbacks, enqueueScopeEnabled, meta, playScopeEnabled, scopeLabels, seamArtist, seamCollection, seamFilter, title]);

    const mode = isFilterActive ? 'finite' : 'infinite';
    const layer = useMemo<BravaisLayer>(() => ({
        key: sessionKey,
        sessionKey,
        surface: 'artist',
        mode,
        items,
        seam,
        isInteractive: isActive,
        focusedEntryKey: focus.initialKey,
        nowPlayingKey,
        queuedKeys,
        onOpenItem: callbacks.onOpenItem,
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
    }), [callbacks, entries, focus.initialKey, isActive, items, mode, popTo, nowPlayingKey, queuedKeys, seam, sessionKey, wall]);
    useBravaisLayerRegistration('top', layer, isPresent);

    // 不可见的锚点：铺满但不接指针，画面全在 stage 里。Ponder 的页面标记（bravais-wall）要有尺寸才参与解析。
    return (
        <div
            data-library-renderer="bravais"
            data-library-surface="artist"
            data-ponder-page-scope="bravais-wall"
            data-bravais-layer={sessionKey}
            data-bravais-mode={mode}
            aria-hidden
            className="pointer-events-none fixed inset-0"
        />
    );
};

const NO_SONGS: SongResult[] = [];
const NO_ALBUMS: LibraryArtistAlbum[] = [];

export default BravaisArtist;
