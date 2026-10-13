import type { TFunction } from 'i18next';
import type { SongResult, UnifiedSong } from '../../../types';
import type { ProviderCollection } from '../../../types/onlineMusic';
import type { LibraryHomeCard, LibraryHomeDiscoverSection, LibraryHomeRadioFeed } from '../contracts/homeModel';
import { DISCOVER_SECTION_TITLE_KEY } from './discoverSections';

// src/library/core/model/homeCards.ts
// 在线首页三个页签的卡片视图模型（纯函数，原样搬自 Grid3D）：账户歌单、收藏专辑、电台（私人 FM、每日推荐、
// 推荐歌单）。卡片的 raw 是打开集合时交给描述工厂的来源对象，形状与原先一致，所以宿主收到的集合描述不变。

/** 电台页签里的私人 FM 卡：点它直接播放，不打开集合。 */
export const PERSONAL_FM_CARD_ID = 'personal_fm';
/** 电台页签里的每日推荐卡。 */
export const DAILY_RECOMMENDATIONS_CARD_ID = 'daily_recommendations';

/** 在线集合卡片上的「作者」：专辑的歌手（逗号连接），没有就用创建者昵称。 */
export const getProviderCollectionArtistLabel = (
    collection: Pick<ProviderCollection, 'artists' | 'creator'> | null | undefined,
): string => {
    const artists = collection?.artists
        ?.map(artist => artist.name.trim())
        .filter(Boolean)
        .join(', ');
    return artists || collection?.creator?.nickname || '';
};

/** 最近播放卡的 id（跨音源的虚拟集合：曲目来自最近播放 store，不进任何 provider 缓存）。 */
export const RECENT_PLAYS_CARD_ID = 'recent_plays';

/**
 * 账户歌单页签（含云盘）。有最近播放历史时，统一最近播放那张卡置顶。
 *
 * 它是虚拟集合：曲目来自应用自己的最近播放 store，绝不进 provider 缓存——缓存会把历史冻结在打开那一刻，
 * 之后播的新歌就永远进不来。
 */
export const buildOnlinePlaylistCards = (
    collections: readonly ProviderCollection[],
    t: TFunction,
    recentPlays?: readonly { song: SongResult }[] | null,
): LibraryHomeCard[] => {
    const cards = collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        coverUrl: collection.coverUrl,
        trackCount: collection.trackCount,
        description: collection.creator?.nickname || t('home.playlists'),
        summary: collection.description || '',
        type: collection.type,
        raw: collection,
    }));
    if (!recentPlays || recentPlays.length === 0) return cards;
    const first = recentPlays[0]?.song;
    return [
        {
            id: RECENT_PLAYS_CARD_ID,
            name: t('home.recentPlays'),
            coverUrl: first?.album?.coverUrl,
            trackCount: recentPlays.length,
            description: t('home.recentPlays'),
            summary: '',
            type: RECENT_PLAYS_CARD_ID,
            raw: { id: RECENT_PLAYS_CARD_ID, name: t('home.recentPlays'), type: RECENT_PLAYS_CARD_ID },
        },
        ...cards,
    ];
};

/** 收藏专辑页签。 */
export const buildOnlineAlbumCards = (albums: readonly ProviderCollection[], t: TFunction): LibraryHomeCard[] => (
    albums.map(album => ({
        id: album.id,
        name: album.name,
        coverUrl: album.coverUrl,
        trackCount: album.trackCount,
        description: getProviderCollectionArtistLabel(album) || t('player.unknownArtist'),
        summary: album.description || '',
        type: 'album',
        raw: album,
    }))
);

type RadioSource = {
    id: string | number;
    name: string;
    coverUrl?: string;
    trackCount?: number;
    description?: string;
    summary?: string;
    isFm?: boolean;
    isDailyRecommendations?: boolean;
};

/**
 * 电台页签：私人 FM、每日推荐排在推荐歌单前面。私人 FM 卡的描述是当前的 FM 模式（provider 支持模式时），
 * 否则是「私人 FM」。feed 还没读到时为空。
 */
export const buildOnlineRadioCards = (
    feed: LibraryHomeRadioFeed | null,
    { t, personalFmModeLabel = '' }: { t: TFunction; personalFmModeLabel?: string },
): LibraryHomeCard[] => {
    if (!feed) return [];
    const sources: RadioSource[] = [
        {
            id: PERSONAL_FM_CARD_ID,
            name: t('home.personalFm'),
            coverUrl: feed.personalFmCoverUrl,
            description: t('home.personalFm'),
            isFm: true,
        },
        ...(feed.supportsDailySongs === false ? [] : [{
            id: DAILY_RECOMMENDATIONS_CARD_ID,
            name: t('home.dailyRecommendations'),
            coverUrl: feed.dailyCoverUrl,
            trackCount: feed.dailyCount,
            description: t('home.dailyRecommendationsDescription'),
            summary: t('home.dailyRecommendationsSummary'),
            isDailyRecommendations: true,
        }]),
        ...feed.recommended.map(collection => {
            const description = collection.description || collection.creator?.nickname || '';
            return {
                ...collection,
                coverUrl: collection.coverUrl,
                description,
                summary: description,
            };
        }),
    ];
    return sources.map(source => ({
        id: source.id,
        name: source.name,
        coverUrl: source.coverUrl,
        trackCount: source.trackCount,
        description: (source.isFm && personalFmModeLabel) || source.description || t('home.radio'),
        summary: source.summary || '',
        type: source.isFm
            ? 'radio'
            : source.isDailyRecommendations
                ? 'daily_recommendations'
                : 'playlist',
        raw: source,
    }));
};

/** 这张卡是私人 FM（直接播放，不打开集合）。 */
export const isPersonalFmCard = (card: Pick<LibraryHomeCard, 'id' | 'raw'>): boolean => (
    card.id === PERSONAL_FM_CARD_ID || (card.raw as { id?: unknown } | undefined)?.id === PERSONAL_FM_CARD_ID
);

/** 打开在线卡片时交给集合描述工厂的对象：来源对象带上卡片的类型（电台里的推荐歌单记作 playlist）。 */
export const onlineCardCollection = (card: LibraryHomeCard): Record<string, unknown> => (
    card.raw
        ? { ...(card.raw as Record<string, unknown>), type: card.type }
        : { ...card }
);

/**
 * 发现页的一段拍平成歌曲卡（与集合卡同构的三行文字：歌名 / 歌手 / 这一段叫什么）。
 *
 * id 必须带段 id：四段之间没有去重，同一首歌完全可以同时出现在两段里（FM 要的是「现在适合你的」，
 * 雷达要的是「同风格正在火的」，重合很常见）。只按播放键编 id 会让 React 撞 same key —— 它不抛异常崩溃，
 * 而是随机丢弃/错位子节点，现象是往后拉时卡片莫名消失、位置乱跳，盯渲染代码看不出来（2026-10-08 实测）。
 */
export const buildDiscoverSongCards = (
    sections: readonly LibraryHomeDiscoverSection[],
    /** 封面按 provider 解析的函数由调用方注入：model 是纯变换层，不读 services。 */
    { t, songCoverUrl }: { t: TFunction; songCoverUrl?: (song: SongResult | undefined) => string | undefined },
): LibraryHomeCard[] => sections.flatMap(section => section.songs.map(song => ({
    id: `discover-song-${section.id}-${String(song.sourceRef?.mediaId ?? song.id)}`,
    name: song.name,
    coverUrl: songCoverUrl?.(song) || '',
    description: song.artists?.map(artist => artist.name).join(', ') || '',
    summary: section.title || t(DISCOVER_SECTION_TITLE_KEY[section.id] ?? 'home.radio'),
    type: 'song' as const,
    raw: {
        song,
        queue: [...section.songs],
        isFmCall: section.id === 'personal-fm',
    },
})));
