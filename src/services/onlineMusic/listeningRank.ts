import type { UnifiedSong } from '../../types';
import type { ListeningRankRange, OnlineProviderId, ProviderCollection, ProviderPage, ProviderUser } from '../../types/onlineMusic';
import i18n from '../../i18n/config';

// src/services/onlineMusic/listeningRank.ts
// The listening ranking's entries and pages, alike on every platform that has one (capability
// `listeningRank`): an adapter reads the ranking its own way and hands the songs here.

export const LISTENING_RANK_RANGES: readonly ListeningRankRange[] = ['week', 'all'];

/**
 * The entry for one span of a user's ranking. Its id names the user: the songs of one account's
 * ranking are never shown, or kept, as another's.
 */
export const listeningRankCollection = (
    providerId: OnlineProviderId,
    user: ProviderUser,
    range: ListeningRankRange,
    songs: readonly UnifiedSong[],
): ProviderCollection => ({
    providerId,
    id: `listening-rank-${range}-${String(user.id)}`,
    type: 'listening_rank',
    listeningRank: range,
    // Named in the app's language, as it is shown among the playlists.
    name: i18n.t(`listeningRank.${range}`),
    description: i18n.t('listeningRank.description'),
    coverUrl: songs.find(song => song.album?.coverUrl)?.album.coverUrl || user.avatarUrl,
    trackCount: songs.length,
    isOwned: false,
    creator: user,
});

/** A play count the platform gave, on the row read from its ranking; anything else leaves the song as it is. */
export const withListenCount = (song: UnifiedSong, count: unknown): UnifiedSong => {
    const value = Number(count);
    return count !== null && count !== undefined && count !== '' && Number.isFinite(value) && value >= 0
        ? { ...song, listenCount: Math.floor(value) }
        : song;
};

/** A ranking comes whole from the platform: a page of it is a slice. */
export const listeningRankPage = (songs: readonly UnifiedSong[], limit: number, offset: number): ProviderPage<UnifiedSong> => {
    const items = songs.slice(offset, offset + limit);
    return { items, total: songs.length, hasMore: offset + items.length < songs.length, nextOffset: offset + items.length };
};
