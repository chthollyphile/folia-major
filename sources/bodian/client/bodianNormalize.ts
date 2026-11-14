import type {
    FoliumJsonValue,
    FoliumSourceCollection,
    FoliumSourceLyricAlias,
    FoliumSourceNamedRef,
    FoliumSourcePage,
    FoliumSourceSong,
    FoliumSourceUser,
} from '@folia/folium';
import { bodianError } from './bodianTransport';

// sources/bodian/client/bodianNormalize.ts
// 波点的原始记录 → 公开契约的 DTO（FoliumSourceSong、FoliumSourceCollection、FoliumSourceUser、FoliumSourcePage）。
// 宿主的形状由适配层转（src/mods/folium/registries/sourceDtos.ts）：歌的 `data` 就是 sourceRef.providerData，
// 歌手、专辑只在有 id 时带目录引用。

export type BodianRecord = Record<string, any>;
export const bodianRecord = (value: unknown): BodianRecord => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);
const text = (value: unknown) => value == null ? '' : String(value);
// The *.kuwo.cn TLS certificate does not cover nested kwcdn hosts.
const cover = (value: unknown) => text(value).replace(/^http:\/\/(?=[\w-]+\.kuwo\.cn\/)/, 'https://');
// Where Bodian names no id, the artist or album opens nowhere (as the built-in provider made no catalog ref).
const named = (id: unknown, name: unknown): FoliumSourceNamedRef => (
    { id: text(id), name: text(name), ...(id ? {} : { ref: false }) }
);

const artistsOf = (item: BodianRecord): FoliumSourceNamedRef[] => {
    const artists = Array.isArray(item.artists) ? item.artists : [{ id: item.artistId, name: item.artist }];
    return artists.filter(artist => artist.name).map(artist => named(artist.id, artist.name));
};

export const normalizeBodianSong = (raw: unknown): FoliumSourceSong => {
    const item = bodianRecord(raw);
    if (!item.id) throw bodianError('invalid-response', 'Bodian song has no id');
    const data: Record<string, FoliumJsonValue> = {};
    if (typeof item.freeSign === 'string' || typeof item.fsig === 'string') data.freeSign = item.freeSign || item.fsig;
    // 下架信号（offline / online 0，未经核实，沿用现状）与「不能在线播放」分开记，后者只是限制，交给运行时判定；
    // 不读 isListenFee、feeType 等会员或付费字段，单靠这些标签推不出播放结果。
    if (item.offline === true || item.online === 0) data.availability = 'off-shelf';
    else if (item.payInfo?.cannotOnlinePlay === 1) data.availability = 'online-play-restricted';
    if (item.payInfo?.refrain_start !== undefined) data.chorusStartMs = Number(item.payInfo.refrain_start);
    if (item.payInfo?.refrain_end !== undefined) data.chorusEndMs = Number(item.payInfo.refrain_end);
    // 显示用的 `songName` 带版本（「夜に駆ける (Live)」），`name` 是不带它的原名：两者不同时存下，
    // 歌词搜索在歌名搜不到时用它再搜一次。`FSONGNAME` 是中文译名、`subtitle` 是说明，都不当别名。
    const name = text(item.songName || item.name);
    if (item.songName && item.name && text(item.name) !== name) data.originalName = text(item.name);
    return {
        id: text(item.id), title: name, artists: artistsOf(item),
        album: { ...named(item.albumId, item.album), coverUrl: cover(item.albumPic) },
        durationMs: Math.max(0, Number(item.duration) || 0) * 1000,
        data,
    };
};

// 歌名的原名（normalizeBodianSong 存下的 `name`）配上同一组歌手，供歌词搜索换个名字再搜。
export const getBodianLyricSearchAlias = async (song: FoliumSourceSong): Promise<FoliumSourceLyricAlias | null> => {
    const originalName = text(song.data?.originalName).trim();
    if (!originalName || originalName === song.title) return null;
    return {
        title: originalName,
        artist: song.artists.map(artist => artist.name).join(', '),
        ...(song.album?.name ? { album: song.album.name } : {}),
    };
};

export const normalizeBodianUser = (raw: unknown): FoliumSourceUser => {
    const item = bodianRecord(raw);
    const user = bodianRecord(item.userInfo || item);
    return { id: text(user.uid ?? user.id ?? item.id), nickname: text(user.nickname), avatarUrl: cover(user.avatarUrl || user.headImg) };
};

export const normalizeBodianCollection = (raw: unknown, type = 'playlist'): FoliumSourceCollection => {
    const item = bodianRecord(raw);
    const id = type === 'album' ? (item.albumId ?? item.id) : item.id;
    if (!id) throw bodianError('invalid-response', 'Bodian collection has no id');
    // Owned playlists omit sourceType in the account response but require source 5 for their tracks.
    const source = Number(item.sourceType ?? (type === 'album' ? 6 : item.isOwned ? 5 : 4));
    const publishedAt = Date.parse(item.showtime || '');
    return {
        id: text(id), type, name: text(item.name), coverUrl: cover(item.pic),
        description: text(item.description || item.info || item.desc),
        trackCount: Number(item.musicCount ?? item.musicCnt) || 0,
        ...(item.albumCnt == null ? {} : { albumCount: Number(item.albumCnt) }),
        ...(Number.isFinite(publishedAt) ? { publishedAt } : {}),
        artists: artistsOf(item),
        ...(item.creatorId ? { creator: { id: text(item.creatorId), nickname: text(item.creatorName), avatarUrl: cover(item.creatorIcon) } } : {}),
        ...(item.isOwned === undefined ? {} : { isOwned: Boolean(item.isOwned) }),
        ...(item.isLiked === undefined ? {} : { isLiked: Boolean(item.isLiked) }),
        data: { source, ...(item.isPrivate === undefined ? {} : { isPrivate: Number(item.isPrivate) }) },
    };
};

// Some Bodian pages contain bogus PageHelper flags: raw item count and total are authoritative.
export const bodianPage = <T>(items: T[], total: unknown, offset: number, limit: number,
    cursor?: { nextOffset: number; hasMore: boolean }): FoliumSourcePage<T> & { nextOffset: number } => {
    const count = Number(total);
    const knownTotal = total != null && Number.isFinite(count) && count >= 0;
    const validCursor = cursor && Number.isSafeInteger(cursor.nextOffset) && cursor.nextOffset >= offset + items.length
        && typeof cursor.hasMore === 'boolean' && (!cursor.hasMore || cursor.nextOffset > offset);
    const nextOffset = validCursor ? cursor.nextOffset : offset + items.length;
    return { items, ...(knownTotal ? { total: count } : {}), nextOffset,
        hasMore: validCursor ? cursor.hasMore : items.length > 0 && (knownTotal ? nextOffset < count : items.length === limit) };
};
