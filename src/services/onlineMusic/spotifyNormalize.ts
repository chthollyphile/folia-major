import type { Artist, UnifiedSong } from '../../types';
import type { JsonValue, ProviderCollection, ProviderUser } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/spotifyNormalize.ts
// Spotify 数据标准化层：将 Spotify Web API 的曲目、用户和歌单归一化为 Folia 统一实体格式

export type SpotifyRecord = Record<string, any>;
export const spotifyRecord = (value: unknown): SpotifyRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const text = (value: unknown) => (value == null ? '' : String(value));

const artistsOf = (item: SpotifyRecord): Artist[] => {
    const artists = Array.isArray(item.artists) ? item.artists : [];
    return artists.filter(a => a && a.name).map(a => ({
        id: text(a.id),
        name: text(a.name),
        catalogRef: a.id ? { providerId: 'spotify', kind: 'artist', id: text(a.id) } : undefined,
    }));
};

/**
 * 将 Spotify 原始曲目数据归一化为 UnifiedSong
 */
export const normalizeSpotifySong = (raw: unknown): UnifiedSong => {
    const item = spotifyRecord(raw);
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'spotify') {
        return item as UnifiedSong;
    }
    const id = text(item.id);
    if (!id) {
        throw new OnlineProviderError('invalid-response', 'Spotify song has no id', 'spotify');
    }
    const albumObj = spotifyRecord(item.album);
    const coverUrl = Array.isArray(albumObj.images) && albumObj.images[0]?.url ? albumObj.images[0].url : undefined;
    const previewUrl = typeof item.preview_url === 'string' ? item.preview_url : undefined;

    const providerData: Record<string, JsonValue> = {
        uri: text(item.uri),
    };
    if (previewUrl) providerData.previewUrl = previewUrl;

    return {
        id,
        name: text(item.name),
        artists: artistsOf(item),
        album: {
            id: text(albumObj.id),
            name: text(albumObj.name),
            coverUrl,
            catalogRef: albumObj.id ? { providerId: 'spotify', kind: 'album', id: text(albumObj.id) } : undefined,
        },
        durationMs: Math.max(0, Number(item.duration_ms) || 0),
        sourceRef: {
            kind: 'online',
            providerId: 'spotify',
            mediaId: id,
            providerData,
        },
    };
};

/**
 * 将 Spotify 用户数据归一化为 ProviderUser
 */
export const normalizeSpotifyUser = (raw: unknown): ProviderUser => {
    const user = spotifyRecord(raw);
    const avatarUrl = Array.isArray(user.images) && user.images[0]?.url ? user.images[0].url : undefined;
    return {
        id: text(user.id),
        nickname: text(user.display_name || user.id),
        avatarUrl,
        vipType: user.product === 'premium' ? 1 : 0,
    };
};

/**
 * 将 Spotify 播放列表/专辑归一化为 ProviderCollection
 */
export const normalizeSpotifyCollection = (raw: unknown, type = 'playlist', isOwned = false): ProviderCollection => {
    const item = spotifyRecord(raw);
    if (item.providerId === 'spotify') return item as ProviderCollection;
    const id = text(item.id);
    if (!id) {
        throw new OnlineProviderError('invalid-response', 'Spotify collection has no id', 'spotify');
    }
    const coverUrl = Array.isArray(item.images) && item.images[0]?.url ? item.images[0].url : undefined;
    const ownerObj = spotifyRecord(item.owner);

    return {
        providerId: 'spotify',
        id,
        type: type as any,
        name: text(item.name),
        coverUrl,
        description: text(item.description),
        trackCount: Number(item.tracks?.total ?? item.total_tracks ?? 0),
        isOwned,
        creator: ownerObj.id ? { id: text(ownerObj.id), nickname: text(ownerObj.display_name || ownerObj.id) } : undefined,
    };
};
