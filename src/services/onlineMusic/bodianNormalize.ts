import type { Artist, UnifiedSong } from '../../types';
import type { JsonValue, ProviderCollection, ProviderPage, ProviderUser } from '../../types/onlineMusic';
import { OnlineProviderError } from '../../types/onlineMusic';

// src/services/onlineMusic/bodianNormalize.ts

export type BodianRecord = Record<string, any>;
export const bodianRecord = (value: unknown): BodianRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const text = (value: unknown) => value == null ? '' : String(value);
// The *.kuwo.cn TLS certificate does not cover nested kwcdn hosts.
const cover = (value: unknown) => text(value).replace(/^http:\/\/(?=[\w-]+\.kuwo\.cn\/)/, 'https://');
const ref = (kind: 'album' | 'artist', id: unknown) => (
    id ? { providerId: 'bodian', kind, id: text(id) } : undefined
);

const artistsOf = (item: BodianRecord): Artist[] => {
    const artists = Array.isArray(item.artists) ? item.artists : [{ id: item.artistId, name: item.artist }];
    return artists.filter(artist => artist.name).map(artist => ({
        id: text(artist.id), name: text(artist.name), catalogRef: ref('artist', artist.id),
    }));
};

// Cached canonical songs are accepted without converting their millisecond duration twice.
export const normalizeBodianSong = (raw: unknown): UnifiedSong => {
    const item = bodianRecord(raw);
    if (item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'bodian') return item as UnifiedSong;
    if (!item.id) throw new OnlineProviderError('invalid-response', 'Bodian song has no id', 'bodian');
    const data: Record<string, JsonValue> = {};
    if (typeof item.freeSign === 'string' || typeof item.fsig === 'string') data.freeSign = item.freeSign || item.fsig;
    // 下架信号（offline / online 0，未经核实，沿用现状）与「不能在线播放」分开记，后者只是限制，交给运行时判定；
    // 不读 isListenFee、feeType 等会员或付费字段，单靠这些标签推不出播放结果。
    if (item.offline === true || item.online === 0) data.availability = 'off-shelf';
    else if (item.payInfo?.cannotOnlinePlay === 1) data.availability = 'online-play-restricted';
    if (item.payInfo?.refrain_start !== undefined) data.chorusStartMs = Number(item.payInfo.refrain_start);
    if (item.payInfo?.refrain_end !== undefined) data.chorusEndMs = Number(item.payInfo.refrain_end);
    return {
        id: text(item.id), name: text(item.songName || item.name), artists: artistsOf(item),
        album: { id: text(item.albumId), name: text(item.album), coverUrl: cover(item.albumPic), catalogRef: ref('album', item.albumId) },
        durationMs: Math.max(0, Number(item.duration) || 0) * 1000,
        sourceRef: { kind: 'online', providerId: 'bodian', mediaId: text(item.id), providerData: data },
    };
};

export const normalizeBodianUser = (raw: unknown): ProviderUser => {
    const item = bodianRecord(raw);
    const user = bodianRecord(item.userInfo || item);
    return { id: text(user.uid ?? user.id ?? item.id), nickname: text(user.nickname), avatarUrl: cover(user.avatarUrl || user.headImg) };
};

export const normalizeBodianCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = bodianRecord(raw);
    if (item.providerId === 'bodian') return item as ProviderCollection;
    const id = type === 'album' ? (item.albumId ?? item.id) : item.id;
    if (!id) throw new OnlineProviderError('invalid-response', 'Bodian collection has no id', 'bodian');
    // Owned playlists omit sourceType in the account response but require source 5 for their tracks.
    const source = Number(item.sourceType ?? (type === 'album' ? 6 : item.isOwned ? 5 : 4));
    const publishedAt = Date.parse(item.showtime || '');
    return {
        providerId: 'bodian', id: text(id), type, name: text(item.name), coverUrl: cover(item.pic),
        description: text(item.description || item.info || item.desc),
        trackCount: Number(item.musicCount ?? item.musicCnt) || 0,
        ...(item.albumCnt == null ? {} : { albumCount: Number(item.albumCnt) }),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
        artists: artistsOf(item),
        ...(item.creatorId ? { creator: { id: text(item.creatorId), nickname: text(item.creatorName), avatarUrl: cover(item.creatorIcon) } } : {}),
        ...(item.isOwned === undefined ? {} : { isOwned: Boolean(item.isOwned) }),
        ...(item.isLiked === undefined ? {} : { isLiked: Boolean(item.isLiked) }),
        providerData: { source, ...(item.isPrivate === undefined ? {} : { isPrivate: Number(item.isPrivate) }) },
    };
};

// Some Bodian pages contain bogus PageHelper flags: raw item count and total are authoritative.
export const bodianPage = <T>(items: T[], total: unknown, offset: number, limit: number,
    cursor?: { nextOffset: number; hasMore: boolean }): ProviderPage<T> => {
    const count = Number(total);
    const knownTotal = total != null && Number.isFinite(count) && count >= 0;
    const validCursor = cursor && Number.isSafeInteger(cursor.nextOffset) && cursor.nextOffset >= offset + items.length
        && typeof cursor.hasMore === 'boolean' && (!cursor.hasMore || cursor.nextOffset > offset);
    const nextOffset = validCursor ? cursor.nextOffset : offset + items.length;
    return { items, ...(knownTotal ? { total: count } : {}), nextOffset,
        hasMore: validCursor ? cursor.hasMore : items.length > 0 && (knownTotal ? nextOffset < count : items.length === limit) };
};
