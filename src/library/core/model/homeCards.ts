import type { TFunction } from 'i18next';
import type { ProviderCollection } from '../../../types/onlineMusic';
import type { LibraryHomeCard, LibraryHomeRadioFeed } from '../contracts/homeModel';

// src/library/core/model/homeCards.ts
// 在线首页三个页签的卡片视图模型（纯函数，原样搬自 Grid3D）：账户歌单、收藏专辑、电台（私人 FM、每日推荐、
// 推荐歌单）。卡片的 raw 是打开集合时交给描述工厂的来源对象，形状与原先一致，所以宿主收到的集合描述不变。

/** 电台页签里的私人 FM 卡：点它直接播放，不打开集合。 */
export const PERSONAL_FM_CARD_ID = 'personal_fm';
export const HEARTBEAT_CARD_ID = 'heartbeat';
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

/** 账户歌单页签（含云盘）。 */
export const buildOnlinePlaylistCards = (collections: readonly ProviderCollection[], t: TFunction): LibraryHomeCard[] => (
    collections.map(collection => ({
        id: collection.id,
        name: collection.name,
        coverUrl: collection.coverUrl,
        trackCount: collection.trackCount,
        description: collection.creator?.nickname || t('home.playlists'),
        summary: collection.description || '',
        type: collection.type,
        raw: collection,
    }))
);

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
    isHeartbeat?: boolean;
    isDailyRecommendations?: boolean;
};

/**
 * 电台页签：私人 FM、每日推荐排在推荐歌单前面。私人 FM 卡的描述是当前的 FM 模式（provider 支持模式时），
 * 否则是「私人 FM」。feed 还没读到时为空。
 */
export const buildOnlineRadioCards = (
    feed: LibraryHomeRadioFeed | null,
    { t, personalFmModeLabel = '', supportsHeartbeat = false }: { t: TFunction; personalFmModeLabel?: string; supportsHeartbeat?: boolean },
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
        ...(supportsHeartbeat ? [{
            id: HEARTBEAT_CARD_ID,
            name: t('heartbeat.title'),
            coverUrl: feed.personalFmCoverUrl,
            description: t('heartbeat.description'),
            isHeartbeat: true,
        }] : []),
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
        type: source.isFm || source.isHeartbeat
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

export const isHeartbeatCard = (card: Pick<LibraryHomeCard, 'id'>): boolean => card.id === HEARTBEAT_CARD_ID;

/** 打开在线卡片时交给集合描述工厂的对象：来源对象带上卡片的类型（电台里的推荐歌单记作 playlist）。 */
export const onlineCardCollection = (card: LibraryHomeCard): Record<string, unknown> => (
    card.raw
        ? { ...(card.raw as Record<string, unknown>), type: card.type }
        : { ...card }
);
