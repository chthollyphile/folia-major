import type { Artist, UnifiedSong } from '../../types';
import type {
    JsonValue,
    MediaId,
    ProviderCatalogRef,
    ProviderCollection,
    ProviderUser,
} from '../../types/onlineMusic';
import { getOriginalCoverUrl } from '../../utils/coverUrl';

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
    albumMid
        ? getOriginalCoverUrl(`${ALBUM_COVER_BASE}${albumMid}.jpg?max_age=2592000`)
        : undefined
);

export const getQqSingerAvatarUrl = (singerMid: string): string | undefined => (
    singerMid
        ? getOriginalCoverUrl(`${SINGER_AVATAR_BASE}${singerMid}.jpg?max_age=2592000`)
        : undefined
);

const normalizeQqCoverUrl = (coverUrl: unknown): string => (
    getOriginalCoverUrl(text(coverUrl))
);

// 专辑与歌手的集合身份一律用 mid。上游同时给出数字 `albumid` / `singer.id`，但那两个不是
// `/getAlbumInfo` 与 `/getSingerHotsong` 认的参数：传数字进去会拿到 HTTP 200 加
// `code: 1101 para error`（歌手路由则是 `singer.code: 400`），页面只剩空白且难以定位。
const qqCatalogRef = (
    kind: ProviderCatalogRef['kind'],
    mid: string,
): ProviderCatalogRef | undefined => (
    mid ? { providerId: 'qq', kind, id: mid } : undefined
);

// 正规化后的条目把 mid 同时写进 `id` 与 `catalogRef`。缓存水合会把结果再喂回来，
// 从 `catalogRef` 取回比去猜 `id` 里装的是 mid 还是数字可靠，幂等也不依赖字符串形状。
const catalogRefMid = (raw: any, kind: ProviderCatalogRef['kind']): string => {
    const ref = raw?.catalogRef;
    return ref?.providerId === 'qq' && ref?.kind === kind ? text(ref.id) : '';
};

const normalizeArtists = (raw: any): Artist[] => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    if (!Array.isArray(singers)) return [];
    return singers
        .map((singer: any, index: number) => {
            // 数字 `singer.id` 不参与身份判定，上游完全不给 mid 时宁可退回下标，
            // 也不要放一个会被上游拒收的 id 进来假装可以导航。
            const singerMid = text(pick(singer, 'mid', 'singermid', 'singerMID', 'singerMid'))
                || catalogRefMid(singer, 'artist');
            const ref = qqCatalogRef('artist', singerMid);
            return {
                id: (singerMid || index) as MediaId,
                name: text(pick(singer, 'name', 'title', 'singername')),
                ...(ref ? { catalogRef: ref } : {}),
            };
        })
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
    // `/getAlbumInfo` 的曲目条目没有嵌套的 album 节点，albummid 平铺在顶层，所以两处都要看。
    const albumMid = text(
        pick(album, 'mid', 'albummid', 'albumMid', 'albumMID')
        ?? pick(item, 'albummid', 'albumMid')
        ?? pick(providerData, 'albumMid'),
    ) || catalogRefMid(album, 'album');
    const albumRef = qqCatalogRef('album', albumMid);
    const mediaMid = text(
        pick(file, 'media_mid', 'mediaMid')
        ?? pick(item, 'mediaMid')
        ?? pick(providerData, 'mediaMid'),
    );

    const durationMs = Number(item.durationMs);
    const intervalSeconds = Number(pick(item, 'interval', 'duration'));
    const coverUrl = normalizeQqCoverUrl(pick(album, 'coverUrl', 'picUrl')) || getQqAlbumCoverUrl(albumMid);

    return {
        id: songId,
        name: text(pick(item, 'title', 'name', 'songname')) || 'Unknown Song',
        artists: normalizeArtists(item),
        album: {
            // albummid 优先于数字 albumid：后者只在上游一个 mid 都不给时留作显示用的键，
            // 而那种条目不会带 catalogRef，导航层也就不会把它当成可查询的专辑 id。
            id: (albumMid || pick(album, 'id', 'albumid') || '') as MediaId,
            name: text(pick(album, 'name', 'title', 'albumname')),
            ...(coverUrl ? { coverUrl } : {}),
            ...(albumRef ? { catalogRef: albumRef } : {}),
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

// 微信凭据的 `musicid` 是占位的 `0`，真正的账号 ID 只在 `str_musicid` 里 —— 后端每一条上游调用
// 认的都是后者，所以这里跟着同一个优先序，并且把占位值当成「这个字段没给」。
const ACCOUNT_ID_PLACEHOLDER = '0';

const accountId = (raw: any, ...keys: string[]): string | number | undefined => {
    for (const key of keys) {
        const value = pick(raw, key);
        if (value === undefined || text(value) === ACCOUNT_ID_PLACEHOLDER) continue;
        if (typeof value === 'string' || typeof value === 'number') return value;
    }
    return undefined;
};

// Reads `/login/status` (`{ data: { profile } }`), `/user/detail` (`{ profile }`) and a cached ProviderUser.
export const normalizeQqUser = (raw: unknown): ProviderUser => {
    const source = record(raw);
    const profile = record(source.data?.profile ?? source.profile ?? source.data ?? source);
    // GetLoginUserInfo keeps the account fields under `info`; its top level only carries banners and portals.
    const info = record(profile.info);

    const id = accountId(profile, 'str_musicid', 'musicid', 'uin', 'id')
        ?? accountId(info, 'str_musicid', 'musicid', 'uin');
    // Display-name candidates observed while probing the upstream API; the acceptance test account returned none of them.
    const nickname = text(
        pick(profile, 'nickname', 'nick', 'name', 'userName')
        ?? pick(info, 'nickname', 'nick', 'name', 'userName'),
    );
    // 头像在 `info.logo`，是一条完整的 https URL（`.../qqmusic/avatar/<hash>-<ts>/140`），
    // 上游整个响应里没有 `avatarUrl` 这个名字 —— 那是后端凭据兜底路径给的字段名，
    // 也是正规化结果自己回填时的字段名，所以两个都要认，缓存水合才不会把头像洗掉。
    const avatarUrl = text(pick(profile, 'avatarUrl') ?? pick(info, 'logo', 'avatarUrl'));

    return {
        id: (id ?? '') as MediaId,
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

// 收藏专辑那条 CGI 的 pubtime 是秒级 epoch，与其他专辑端点给的日期串、以及缓存回填的毫秒数
// 都不是同一种东西 —— 交给 timestamp() 会被当成毫秒，一律落到 1970 年。
const epochSeconds = (value: unknown): number | undefined => {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : undefined;
};

// 专辑条目的歌手可能是数组，也可能只在顶层给一组 singerMID / singerName。
const normalizeCollectionArtists = (raw: any): Artist[] => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    const list = Array.isArray(singers)
        ? singers
        : [{
            mid: pick(raw, 'singerMID', 'singermid', 'singerMid'),
            name: pick(raw, 'singerName', 'singername', 'singer_name'),
        }];
    return list
        .map((singer: any, index: number) => {
            // 识别键一律用 mid，与歌曲的处理一致；数字 id 只是上游别处的请求参数，不是集合身份。
            const singerMid = text(pick(singer, 'mid', 'singerMID', 'singermid', 'singerMid'))
                || catalogRefMid(singer, 'artist');
            const ref = qqCatalogRef('artist', singerMid);
            return {
                id: (singerMid || index) as MediaId,
                name: text(pick(singer, 'name', 'singerName', 'singername', 'title')),
                ...(ref ? { catalogRef: ref } : {}),
            };
        })
        .filter(artist => artist.name);
};

// 读取 `/getAlbumInfo` 的 data、`/getSingerAlbum` 的 albumList 条目，或一份已正规化的专辑缓存。
const normalizeQqAlbum = (item: any, existing: any): ProviderCollection => {
    const albumMid = text(pick(item, 'albumMID', 'albummid', 'albumMid', 'mid') ?? pick(existing, 'albumMid'));
    const name = text(pick(item, 'albumName', 'albumname', 'name', 'title'));
    // `pic` 是收藏专辑那条 CGI 给的完整 URL；拿得到就不必再按 mid 拼一个。
    const coverUrl = normalizeQqCoverUrl(pick(item, 'coverUrl', 'picUrl', 'albumPic', 'pic')) || getQqAlbumCoverUrl(albumMid);
    const description = text(pick(item, 'desc', 'description'));
    const publisher = text(pick(item, 'company', 'publisher'));
    // `ordertime` 是收藏时间不是发行时间，刻意不列入候选。
    const publishedAt = timestamp(pick(item, 'publishDate', 'publictime', 'publish_time', 'aDate', 'publishedAt'))
        ?? epochSeconds(pick(item, 'pubtime'));
    const trackCount = Number(pick(item, 'total_song_num', 'totalSongNum', 'song_num', 'songNum', 'songnum', 'cur_song_num', 'total', 'trackCount'));
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
    const coverUrl = normalizeQqCoverUrl(pick(item, 'coverUrl', 'singerPic', 'singerpic', 'picUrl')) || getQqSingerAvatarUrl(singerMid);
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

// QQ 音乐「我喜欢」歌单的自建目录号。
const QQ_LIKED_DIR_ID = 201;

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
    // 可见性：1 公开、2 不公开（实测值）。匿名的 `/getSongListDetail` 读不到非公开歌单，
    // 留着它才能把「歌单是空的」和「这条接口没资格读」分开。
    const dirShow = pick(item, 'dirShow', 'dir_show') ?? pick(existing, 'dirShow');
    // 自建还是收藏。`/user/playlist` 把两类合在同一个数组里，而收藏的条目**也带 `dirId`** —— 那是创建者
    // 账号里的目录号（实测收藏的他人歌单是 `dirId: 36`），所以不能拿 dirId 判断。自建条目来自
    // GetPlaylistByUin，带 `dirName` / `songNum`；收藏条目是另一套字段（`name` / `songnum` / `orderTime` /
    // `dirType`）。缓存回灌时沿用已经判过的结果。
    const owned = pick(item, 'dirName') !== undefined ? true : pick(existing, 'owned');
    const rawId = pick(item, 'id');
    const dissid = pick(item, 'dissid')
        ?? pick(existing, 'dissid')
        ?? (tid === undefined && dirId === undefined && Object.keys(existing).length === 0 ? rawId : undefined);
    const name = text(pick(item, 'dirName', 'dirname', 'dissname', 'title', 'name'));
    // GetPlaylistByUin exposes both cover sizes and songNum; cached normalized keys remain fallbacks.
    // `/getSongListCategories` 与 `/user/playlist` 那一族把封面给成 `picurl` / `picUrl` / `bigpicUrl`
    // 这样的平铺字符串，而推荐歌单广场（`GetRecommendFeed`）给的是 `cover` 对象
    //（`{ big_url, medium_url, small_url, ... }`，其中 `mid` 是空串）。两种形状都要认，
    // 否则推荐歌单会整片没有封面。类型搜索（item_songlist）的封面键是 `logo`。
    // 分类歌单（/getSongLists）又是另一套：实测 2026-10-11 抓真实响应，封面在
    // `imgurl`（单数字符串）。上面的候选里没有它，所以分类筛出来的歌单整片没有封面。
    const cover = record(item.cover);
    const coverUrl = normalizeQqCoverUrl(pick(item, 'bigpicUrl', 'imgurl', 'picUrl', 'picurl', 'coverUrl', 'logo'))
        || normalizeQqCoverUrl(pick(cover, 'big_url', 'medium_url', 'default_url', 'small_url'));
    // 曲数同样是两套拼法：推荐广场给 `song_cnt`，用户歌单给 `songNum` / `songnum`。
    const trackCount = Number(pick(item, 'songNum', 'songnum', 'song_cnt', 'trackCount'));
    // 播放量（实测 2026-10-11 抓 /getSongLists：原始次数，量级正常—800万、5000万——不需要换算）。
    // ProviderCollection 本来就有 playCount，网易云那侧也映射了，只是 QQ 一直缺失。
    const playCount = Number(pick(item, 'listennum', 'listennum_c', 'playCount'));
    // 「我喜欢」是自建目录 201（GetPlaylistByUin 实测；getPlaylistTracks 也按它走 liked-songs 路由）。收藏条目的
    // dirId 是创建者账号里的目录号，所以还要 owned，别把收藏来的别人的「我喜欢」标成自己的。
    const isLiked = owned === true && Number(dirId) === QQ_LIKED_DIR_ID;

    return {
        providerId: 'qq',
        id: (tid ?? dissid ?? rawId ?? dirId ?? '') as MediaId,
        name,
        type: text(item.type) || type,
        ...(coverUrl ? { coverUrl } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(Number.isFinite(playCount) && playCount >= 0 ? { playCount } : {}),
        providerData: jsonData([
            ['tid', tid],
            ['dirId', dirId],
            ['dissid', dissid],
            ['dirShow', dirShow],
            ['owned', owned],
        ]),
        ...(isLiked ? { isLiked: true } : {}),
    };
};
