import type { UnifiedSong } from '../../types';
import type { JsonValue, MediaId, ProviderCollection, ProviderUser } from '../../types/onlineMusic';

// src/services/onlineMusic/qqNormalize.ts

// Album art rule already proven by the existing QQ lyric search in utils/lyrics/providers/qqLyricProvider.ts.
const ALBUM_COVER_BASE = 'https://y.gtimg.cn/music/photo_new/T002R300x300M000';
// 歌手头像与专辑封面是同一套 photo_new 规则，只差 T001 / T002 前缀。
const SINGER_AVATAR_BASE = 'https://y.gtimg.cn/music/photo_new/T001R300x300M000';

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

export const getQqSingerAvatarUrl = (singerMid: string): string | undefined => (
    singerMid ? `${SINGER_AVATAR_BASE}${singerMid}.jpg?max_age=2592000` : undefined
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

const timestamp = (value: unknown): number | undefined => {
    // 正规化后的缓存回填的是毫秒数，上游给的是 `1993-05-01` 这类日期串。
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : undefined;
    const parsed = Date.parse(text(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

// 专辑条目的歌手可能是数组，也可能只在顶层给一组 singerMID / singerName。
const normalizeCollectionArtists = (raw: any): Array<{ id: MediaId; name: string }> => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    const list = Array.isArray(singers)
        ? singers
        : [{
            id: pick(raw, 'singerMID', 'singermid', 'singerMid'),
            name: pick(raw, 'singerName', 'singername', 'singer_name'),
        }];
    return list
        .map((singer: any, index: number) => ({
            // 识别键一律用 mid，与歌曲用 songmid 的判断一致；数字 id 只是上游的请求参数。
            id: (pick(singer, 'mid', 'singerMID', 'singermid', 'id') ?? index) as MediaId,
            name: text(pick(singer, 'name', 'singerName', 'singername', 'title')),
        }))
        .filter(artist => artist.name);
};

// 读取 `/getAlbumInfo` 的 data、`/getSingerAlbum` 的 albumList 条目，或一份已正规化的专辑缓存。
const normalizeQqAlbum = (item: any, existing: any): ProviderCollection => {
    const albumMid = text(pick(item, 'albumMID', 'albummid', 'albumMid', 'mid') ?? pick(existing, 'albumMid'));
    const name = text(pick(item, 'albumName', 'albumname', 'name', 'title'));
    const coverUrl = text(pick(item, 'coverUrl', 'picUrl', 'albumPic')) || getQqAlbumCoverUrl(albumMid);
    const description = text(pick(item, 'desc', 'description'));
    const publisher = text(pick(item, 'company', 'publisher'));
    const publishedAt = timestamp(pick(item, 'publishDate', 'publictime', 'publish_time', 'aDate', 'publishedAt'));
    const trackCount = Number(pick(item, 'total_song_num', 'totalSongNum', 'song_num', 'songNum', 'cur_song_num', 'total', 'trackCount'));
    const artists = normalizeCollectionArtists(item);

    return {
        providerId: 'qq',
        id: (albumMid || '') as MediaId,
        name,
        type: 'album',
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(artists.length > 0 ? { artists } : {}),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(publisher ? { publisher } : {}),
        providerData: jsonData([['albumMid', albumMid]]),
    };
};

// 读取 `/getSingerHotsong` 摊平后的 singer_info + singer_brief，或一份已正规化的歌手缓存。
const normalizeQqArtist = (item: any, existing: any): ProviderCollection => {
    const singerMid = text(pick(item, 'singerMID', 'singermid', 'singerMid', 'mid') ?? pick(existing, 'singerMid'));
    const name = text(pick(item, 'singerName', 'singername', 'singer_name', 'name', 'title'));
    const coverUrl = text(pick(item, 'coverUrl', 'singerPic', 'singerpic', 'picUrl')) || getQqSingerAvatarUrl(singerMid);
    const description = text(pick(item, 'singer_brief', 'singerBrief', 'desc', 'description'));
    const trackCount = Number(pick(item, 'total_song', 'totalSong', 'song_num', 'songNum', 'trackCount'));
    const albumCount = Number(pick(item, 'total_album', 'totalAlbum', 'album_num', 'albumNum', 'albumCount'));

    return {
        providerId: 'qq',
        id: (singerMid || '') as MediaId,
        name,
        type: 'artist',
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(Number.isFinite(albumCount) && albumCount >= 0 ? { albumCount } : {}),
        providerData: jsonData([['singerMid', singerMid]]),
    };
};

const COLLECTION_TYPES = ['playlist', 'album', 'artist'];

// Reads a GetPlaylistByUin `v_playlist` entry or a cached ProviderCollection.
export const normalizeQqCollection = (raw: unknown, type = 'playlist'): ProviderCollection => {
    const item = record(raw);
    const existing = record(item.providerData);

    // omni.normalizeCachedCollection 会把已正规化的缓存再喂回来，所以先按 type 分流；
    // 上游原始条目的 type 可能是数字，只有已知的集合类型才允许覆盖调用方传入的 type。
    const declaredType = text(item.type);
    const resolvedType = COLLECTION_TYPES.includes(declaredType) ? declaredType : type;
    if (resolvedType === 'album') return normalizeQqAlbum(item, existing);
    if (resolvedType === 'artist') return normalizeQqArtist(item, existing);

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
