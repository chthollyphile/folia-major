import type { SongResult } from '../../../types';
import type { LibraryArtistAlbum, LibraryArtistAlbumSync, LibraryArtistLoadError, LibraryArtistSnapshot } from '../../core/artist/artist.contract';
import { ARTIST_ALBUM_PAGE_SIZE, artistAlbumCoverUrl } from '../../core/artist/artistModel';
import { artistAlbumEntryKey, artistSongEntryKey } from '../../core/artist/artistSurface';
import type { BravaisItem } from './bravaisLayer';
import { formatDuration, formatEntryBadge, type TrackDescription } from './bravaisProjection';
import { formatCollectionBadge, resolveCollectionTrackCount } from './bravaisTileForm';
import type { BravaisSeamStatus, BravaisSeamSync } from './bravaisSeamModels';

// src/library/suites/bravais/bravaisArtistModel.ts
// 歌手页的纯投影（设计稿 §10.4 / §10.6）：热门歌曲与专辑混排成一面墙的条目（热门歌曲在前、专辑在后——无限拼贴里
// 起点磁贴是第 1 首热门歌曲，有限拼贴里热门歌曲的 rank 离缝最近）；专辑后台分页期间无限拼贴的循环周期（新页只翻
// 原本空着的 slot）；缝底的状态行（加载、错误、空、过滤无结果分开）与元数据行的专辑分页进度 / 续页。
// 条目 key 用 core 的歌手页条目键（song:<播放键> / album:<id>），与网格、TUI 写进浏览会话的焦点同一套。

/** 混排条目：热门歌曲（全部，不受过滤影响）在前，专辑（按过滤之后的）在后。 */
export const projectArtistItems = ({
    topSongs,
    albums,
    describeTrack,
    unknownArtist,
    albumLabel,
    trackCountLabel,
}: {
    topSongs: readonly SongResult[];
    albums: readonly LibraryArtistAlbum[];
    describeTrack: (track: SongResult) => TrackDescription;
    unknownArtist: string;
    /** 专辑磁贴的徽标（「专辑」）。 */
    albumLabel: string;
    /** 专辑的「N 首」（进可访问名；设计稿 §7.7，标签上另写「专辑 · N」）；曲目数未知时没有。 */
    trackCountLabel: (count: number) => string;
}): BravaisItem[] => {
    const items: BravaisItem[] = [];
    const seen = new Set<string>();
    // 同一个播放键出现两次（上游的热门歌曲偶有重复）：后一份带序号，层内 key 唯一；会话焦点认第一份。
    const uniqueKey = (key: string) => {
        let candidate = key;
        for (let copy = 1; seen.has(candidate); copy += 1) candidate = `${key}#${copy}`;
        seen.add(candidate);
        return candidate;
    };
    topSongs.forEach((song, index) => {
        const description = describeTrack(song);
        items.push({
            key: uniqueKey(artistSongEntryKey(song)),
            kind: 'track',
            title: song.name,
            subtitle: description.artists.join(', ') || description.album || unknownArtist,
            coverUrl: description.coverUrl,
            badge: formatEntryBadge(index, topSongs.length),
            badgeIsIndex: true,
            playbackKey: description.playbackKey,
            album: description.album || undefined,
            artists: description.artists,
            durationLabel: formatDuration(description.durationMs),
            unavailable: description.unavailable || undefined,
        });
    });
    albums.forEach(album => {
        const year = albumYear(album);
        const count = resolveCollectionTrackCount('stack', album.trackCount);
        const item: BravaisItem = {
            key: uniqueKey(artistAlbumEntryKey(album)),
            kind: 'album',
            title: String(album.name ?? ''),
            subtitle: year,
            coverUrl: artistAlbumCoverUrl(album),
            badge: formatCollectionBadge(albumLabel, count),
        };
        if (count !== undefined) item.trackCountLabel = trackCountLabel(count);
        items.push(item);
    });
    return items;
};

const albumYear = (album: LibraryArtistAlbum) => {
    const publishedAt = album.publishedAt;
    if (typeof publishedAt !== 'number' || !Number.isFinite(publishedAt) || publishedAt <= 0) return '';
    return String(new Date(publishedAt).getFullYear());
};

const isAlbumSyncPending = (sync: LibraryArtistAlbumSync) => sync.state !== 'none';

/** 上游总数不可信（没有、比已到的还少）时，按页大小翻倍分档估一个周期：同一档里每来一页只翻新 slot。 */
const estimateAlbumPeriod = (loaded: number) => {
    let period = ARTIST_ALBUM_PAGE_SIZE;
    while (period < loaded + ARTIST_ALBUM_PAGE_SIZE) period *= 2;
    return period;
};

/**
 * 专辑后台分页期间无限拼贴的循环周期（与集合的补页周期同一个思路，见 bravaisCollectionStatus.resolveWallPeriodCount）：
 * 分页进行中或中断时按「热门歌曲数 + 专辑总数」算周期——已到的条目位置不变、还没到的位置是墙面，新页只让这些 slot
 * 翻牌。专辑总数优先用详情里的 albumCount；没有（或比已到的还少）时按页大小翻倍分档估，跨档时整面对齐一次。
 * 分页结束后回到条目数（总数与实际不符时在结束那一刻对齐一次）。有限拼贴的规划条目数也用它，分页不会超出容量重规划。
 */
export const resolveArtistWallPeriod = ({
    topSongCount,
    albumCount,
    albumTotal,
    albumSync,
}: {
    topSongCount: number;
    /** 已到的全部专辑（未过滤）。 */
    albumCount: number;
    albumTotal: number | undefined;
    albumSync: LibraryArtistAlbumSync;
}): number => {
    const itemCount = topSongCount + albumCount;
    if (!isAlbumSyncPending(albumSync)) return itemCount;
    const total = typeof albumTotal === 'number' && Number.isFinite(albumTotal) && albumTotal >= albumCount
        ? Math.floor(albumTotal)
        : estimateAlbumPeriod(albumCount);
    return topSongCount + Math.max(albumCount, total);
};

export type ArtistStatusLabels = {
    loading: string;
    loadFailed: (error: LibraryArtistLoadError) => string;
    empty: string;
    noMatch: string;
    retry: string;
    clearFilter: string;
    albumsSyncing: (loaded: number, total: number | undefined) => string;
    albumsInterrupted: (loaded: number) => string;
};

export type ArtistStatusHandlers = {
    /** 错误态的「重试」（resource.reload）；没声明或不支持时不给。 */
    reload?: () => void;
    /** 专辑分页失败中断时的「续页」（retryAlbums）；没声明时不给。 */
    retryAlbums?: () => void;
    clearFilter: () => void;
};

export type ArtistStatusProjection = {
    status?: BravaisSeamStatus;
    sync?: BravaisSeamSync;
    /** 首屏加载中（空画框轻微呼吸）；错误不呼吸。 */
    loading: boolean;
};

/**
 * 歌手页的状态（设计稿 §10.6）：加载中（idle / loading）、错误（重试 = 从头重新加载）、空（ready 但没有详情，或
 * 既没有热门歌曲也没有专辑）、过滤无结果（有专辑但一张都没匹配上；热门歌曲不参与过滤，墙上仍有它们）。
 * 专辑分页：进行中显示已到 / 总数；失败中断时整行是「续页」；被暂停（离开过）按进行中处理。
 */
export const projectArtistStatus = (
    input: {
        snapshot: Pick<LibraryArtistSnapshot, 'status' | 'error' | 'detail' | 'topSongs' | 'albums' | 'albumSync'> | null;
        albumTotal: number | undefined;
        shownAlbumCount: number;
        isFilterActive: boolean;
    },
    labels: ArtistStatusLabels,
    handlers: ArtistStatusHandlers,
): ArtistStatusProjection => {
    const { snapshot } = input;
    const status = snapshot?.status ?? 'idle';
    const isLoading = status === 'idle' || status === 'loading';
    const itemCount = (snapshot?.topSongs.length ?? 0) + (snapshot?.albums.length ?? 0);
    let line: BravaisSeamStatus | undefined;
    if (status === 'error') {
        line = {
            tone: 'error',
            text: labels.loadFailed(snapshot?.error ?? 'load-failed'),
            action: handlers.reload ? { id: 'retry', label: labels.retry, run: handlers.reload } : undefined,
        };
    } else if (isLoading) {
        line = { tone: 'loading', text: labels.loading };
    } else if (!snapshot?.detail || itemCount === 0) {
        line = { tone: 'empty', text: labels.empty };
    } else if (input.isFilterActive && input.shownAlbumCount === 0 && (snapshot?.albums.length ?? 0) > 0) {
        line = { tone: 'no-match', text: labels.noMatch, action: { id: 'clear-filter', label: labels.clearFilter, run: handlers.clearFilter } };
    }

    let sync: BravaisSeamSync | undefined;
    const albumSync = snapshot?.albumSync;
    const loaded = snapshot?.albums.length ?? 0;
    if (status === 'ready' && albumSync && albumSync.state !== 'none') {
        if (albumSync.state === 'interrupted' && albumSync.reason === 'failed') {
            sync = {
                state: 'interrupted',
                label: `${labels.albumsInterrupted(loaded)} · ${labels.retry}`,
                onResume: handlers.retryAlbums,
            };
        } else {
            sync = { state: 'syncing', label: labels.albumsSyncing(loaded, input.albumTotal) };
        }
    }
    return { status: line, sync, loading: isLoading && itemCount === 0 };
};
