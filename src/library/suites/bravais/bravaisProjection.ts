import type { SongResult } from '../../../types';
import type { LibraryHomeCard } from '../../core/home/homeModel.contract';
import type { BravaisItem, BravaisItemKind } from './bravaisLayer';
import { formatCollectionBadge, resolveBravaisTileForm, resolveCollectionTrackCount } from './bravaisTileForm';

// src/library/suites/bravais/bravaisProjection.ts
// core 数据 → 磁贴条目（BravaisItem）的纯投影，surface 用它们拼层描述。曲目的展示字段（歌手、封面、时长、
// 可播放性）由调用方经 describeTrack 注入：surface 用 services/onlineMusic 的元数据 helper，单测给假的。

/** 首页卡片的条目 key（与集合的条目键分开命名空间：同一面墙上两种 key 不会撞）。 */
export const homeCardItemKey = (card: Pick<LibraryHomeCard, 'id' | 'type'>) => `card:${card.type ?? 'item'}:${card.id}`;

/** 卡片类型 → 磁贴种类。电台与每日推荐是 feed；未知类型当歌单（首页的在线集合大多是歌单）。 */
export const homeCardKind = (type: string | undefined): BravaisItemKind => {
    switch (type) {
        case 'album': return 'album';
        case 'artist': return 'artist';
        case 'folder': return 'folder';
        case 'radio':
        case 'daily_recommendations': return 'feed';
        default: return 'playlist';
    }
};

export type HomeCardLabels = {
    /** 种类徽标（歌单 / 专辑 / 电台…）。 */
    kindLabel: (kind: BravaisItemKind) => string;
    /** 「N 首」。 */
    trackCount: (count: number) => string;
};

/**
 * 一张首页卡片 → 磁贴条目（首页 surface 与性能探针共用）。集合（resolveBravaisTileForm 判为 stack）的曲目数并进类型标签
 * （「歌单 · 124」），可访问名里另有「N 首」（trackCountLabel），副标题只留描述；其余的曲目数仍拼在副标题前面。
 * direct：点了直接播放（私人 FM），不是集合。
 */
export const projectHomeCardItem = (
    card: LibraryHomeCard,
    labels: HomeCardLabels,
    { key = homeCardItemKey(card), direct = false }: { key?: string; direct?: boolean } = {},
): BravaisItem => {
    const kind = homeCardKind(card.type);
    const collectionCount = resolveCollectionTrackCount(resolveBravaisTileForm({ kind, direct }), card.trackCount);
    const count = collectionCount === undefined && typeof card.trackCount === 'number' && card.trackCount > 0 ? labels.trackCount(card.trackCount) : '';
    const item: BravaisItem = {
        key,
        kind,
        title: card.name,
        subtitle: [count, card.description].filter(Boolean).join(' · '),
        coverUrl: card.coverUrl,
        badge: formatCollectionBadge(labels.kindLabel(kind), collectionCount),
    };
    if (collectionCount !== undefined) item.trackCountLabel = labels.trackCount(collectionCount);
    return item;
};

export const projectHomeCards = (cards: readonly LibraryHomeCard[], labels: HomeCardLabels): BravaisItem[] => (
    cards.map(card => projectHomeCardItem(card, labels))
);

/** 一首歌在磁贴与聚焦卡上要的展示字段。 */
export type TrackDescription = {
    artists: readonly string[];
    album: string;
    coverUrl?: string;
    durationMs: number;
    playbackKey: string;
    unavailable: boolean;
};

export const formatDuration = (durationMs: number) => {
    if (!Number.isFinite(durationMs) || durationMs <= 0) return '';
    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/** 徽标上的序号：两位起，条目多时跟着位数走。 */
export const formatEntryBadge = (index: number, total: number) => (
    String(index + 1).padStart(Math.max(2, String(total).length), '0')
);

/**
 * 集合的曲目 → 条目。key 是 core 的条目键（entryKeyAt，重复的歌带序号），与浏览会话的 focusedEntryKey 同一套；
 * 拿不到条目键的（理论上不会）跳过。
 */
export const projectCollectionTracks = (
    tracks: readonly SongResult[],
    entryKeyAt: (index: number) => string | null,
    describeTrack: (track: SongResult) => TrackDescription,
    unknownArtist: string,
): BravaisItem[] => {
    const items: BravaisItem[] = [];
    tracks.forEach((track, index) => {
        const key = entryKeyAt(index);
        if (!key) return;
        const description = describeTrack(track);
        items.push({
            key,
            kind: 'track',
            title: track.name,
            subtitle: description.artists.join(', ') || description.album || unknownArtist,
            coverUrl: description.coverUrl,
            badge: formatEntryBadge(index, tracks.length),
            badgeIsIndex: true,
            playbackKey: description.playbackKey,
            album: description.album || undefined,
            artists: description.artists,
            durationLabel: formatDuration(description.durationMs),
            unavailable: description.unavailable || undefined,
        });
    });
    return items;
};

/** 正在播放的那首在这一层里的条目 key（同一首出现多次时取第一次）。 */
export const findNowPlayingKey = (items: readonly BravaisItem[], playbackKey: string | null): string | null => {
    if (!playbackKey) return null;
    return items.find(item => item.playbackKey === playbackKey)?.key ?? null;
};

/** 已在播放队列里的条目 key。 */
export const collectQueuedKeys = (items: readonly BravaisItem[], queuedPlaybackKeys: ReadonlySet<string>): Set<string> => {
    const keys = new Set<string>();
    if (queuedPlaybackKeys.size === 0) return keys;
    for (const item of items) {
        if (item.playbackKey && queuedPlaybackKeys.has(item.playbackKey)) keys.add(item.key);
    }
    return keys;
};
