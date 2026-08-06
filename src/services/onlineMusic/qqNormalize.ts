import type { UnifiedSong } from '../../types';
import type { JsonValue, MediaId, ProviderCollection, ProviderUser } from '../../types/onlineMusic';

// src/services/onlineMusic/qqNormalize.ts

// Album art rule already proven by the existing QQ lyric search in utils/lyrics/providers/qqLyricProvider.ts.
const ALBUM_COVER_BASE = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000';

const pick = (raw: any, ...keys: string[]): any => {
    for (const key of keys) {
        const value = raw?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
};

const text = (value: unknown): string => (
    value === undefined || value === null ? '' : String(value).trim()
);

const record = (value: unknown): any => (
    value && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const jsonData = (entries: Array<[string, unknown]>): Record<string, JsonValue> => Object.fromEntries(
    entries.filter((entry): entry is [string, JsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

export const getQqAlbumCoverUrl = (albumMid: string): string | undefined => (
    albumMid ? `${ALBUM_COVER_BASE}${albumMid}.jpg?max_age=2592000` : undefined
);

const normalizeArtists = (raw: any): Array<{ id: MediaId; name: string }> => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    if (!Array.isArray(singers)) return [];
    return singers
        .map((singer: any, index: number) => ({
            id: (pick(singer, 'id', 'mid', 'singerid') ?? index) as MediaId,
            name: text(pick(singer, 'name', 'title', 'singername')),
        }))
        .filter(artist => artist.name);
};

// Accepts the upstream `item_song` payload, the SongResult shape produced by the existing QQ search,
// and a previously normalized song, so cached songs survive a round trip through this normalizer.
export const normalizeQqSong = (raw: unknown): UnifiedSong => {
    const item = record(raw);
    const sourceRef = item.sourceRef?.kind === 'online' && item.sourceRef.providerId === 'qq'
        ? item.sourceRef
        : undefined;
    const providerData = record(sourceRef?.providerData);
    const album = record(item.album);
    const file = record(item.file);

    // songmid is the stable playback identity; the numeric song id is only a lyric/detail request parameter.
    const songMid = text(pick(item, 'qqMid', 'mid', 'songmid') ?? sourceRef?.mediaId ?? pick(providerData, 'songMid'));
    const rawSongId = pick(item, 'songid', 'songId') ?? pick(providerData, 'songId') ?? item.id;
    const numericSongId = Number(rawSongId);
    const songId: MediaId = Number.isFinite(numericSongId) && numericSongId > 0 ? numericSongId : songMid;
    const albumMid = text(pick(album, 'mid', 'albummid') ?? pick(item, 'albummid') ?? pick(providerData, 'albumMid'));
    const mediaMid = text(
        pick(file, 'media_mid', 'mediaMid')
        ?? pick(item, 'mediaMid')
        ?? pick(providerData, 'mediaMid'),
    );

    const durationMs = Number(item.durationMs);
    const intervalSeconds = Number(pick(item, 'interval', 'duration'));
    const coverUrl = text(pick(album, 'coverUrl', 'picUrl')) || getQqAlbumCoverUrl(albumMid);

    return {
        id: songId,
        name: text(pick(item, 'title', 'name', 'songname')) || 'Unknown Song',
        artists: normalizeArtists(item),
        album: {
            id: (pick(album, 'id', 'albumid') ?? albumMid ?? '') as MediaId,
            name: text(pick(album, 'name', 'title', 'albumname')),
            ...(coverUrl ? { coverUrl } : {}),
        },
        durationMs: Number.isFinite(durationMs) && durationMs > 0
            ? durationMs
            : Number.isFinite(intervalSeconds) ? intervalSeconds * 1000 : 0,
        ...(songMid ? { qqMid: songMid } : {}),
        sourceRef: {
            kind: 'online',
            providerId: 'qq',
            mediaId: songMid || String(songId),
            providerData: jsonData([
                ['songId', songId],
                ['songMid', songMid],
                ['albumMid', albumMid],
                ['mediaMid', mediaMid],
            ]),
        },
    };
};

// Reads `/login/status` (`{ data: { profile } }`), `/user/detail` (`{ profile }`) and a cached ProviderUser.
export const normalizeQqUser = (raw: unknown): ProviderUser => {
    const source = record(raw);
    const profile = record(source.data?.profile ?? source.profile ?? source.data ?? source);
    // GetLoginUserInfo keeps the account fields under `info`; its top level only carries banners and portals.
    const info = record(profile.info);

    const id = pick(profile, 'musicid', 'str_musicid', 'uin', 'id')
        ?? pick(info, 'musicid', 'str_musicid', 'uin');
    // Display-name candidates observed while probing the upstream API; the acceptance test account returned none of them.
    const nickname = text(
        pick(profile, 'nickname', 'nick', 'name', 'userName')
        ?? pick(info, 'nickname', 'nick', 'name', 'userName'),
    );
    // No upstream avatar field has been captured yet, so only a cached ProviderUser can supply one.
    const avatarUrl = text(pick(profile, 'avatarUrl'));

    return {
        id: (typeof id === 'number' || typeof id === 'string' ? id : '') as MediaId,
        nickname,
        ...(avatarUrl ? { avatarUrl } : {}),
    };
};

// Reads a GetPlaylistByUin `v_playlist` entry or a cached ProviderCollection.
export const normalizeQqCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = record(raw);
    const existing = record(item.providerData);

    const tid = pick(item, 'tid') ?? pick(existing, 'tid');
    const dirId = pick(item, 'dirId', 'dirid') ?? pick(existing, 'dirId');
    const rawId = pick(item, 'id');
    const dissid = pick(item, 'dissid')
        ?? pick(existing, 'dissid')
        ?? (tid === undefined && dirId === undefined && Object.keys(existing).length === 0 ? rawId : undefined);
    const name = text(pick(item, 'dirName', 'dirname', 'dissname', 'title', 'name'));
    // GetPlaylistByUin exposes both cover sizes and songNum; cached normalized keys remain fallbacks.
    const coverUrl = text(pick(item, 'bigpicUrl', 'picUrl', 'picurl', 'coverUrl'));
    const trackCount = Number(pick(item, 'songNum', 'songnum', 'trackCount'));

    return {
        providerId: 'qq',
        id: (tid ?? dissid ?? rawId ?? dirId ?? '') as MediaId,
        name,
        type: text(item.type) || type,
        ...(coverUrl ? { coverUrl } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        providerData: jsonData([
            ['tid', tid],
            ['dirId', dirId],
            ['dissid', dissid],
        ]),
    };
};
