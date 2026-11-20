import type {
    FoliumJsonValue,
    FoliumSourceAlbumRef,
    FoliumSourceCollection,
    FoliumSourceLyricAlias,
    FoliumSourceNamedRef,
    FoliumSourceSong,
    FoliumSourceUser,
} from '@folia/folium';
import { originalQqCover } from './qqCovers';

// sources/qq/core/qqNormalize.ts
// QQ 的歌、账号、歌单 / 专辑 / 歌手条目读成公开契约的形状（FoliumSourceSong、FoliumSourceUser、FoliumSourceCollection）。
// 迁之前读成宿主的 UnifiedSong 等，读法不变：
// - 歌的 `id` 是 songmid（以前是 `sourceRef.mediaId`，播放键），数字 songid 放进 `data.songId`（歌词与详情请求用），
//   也作 `publicId`：宿主的歌 id 与 folium.omni 给别的模组的 `FoliumSong.id` 照旧是数字 songid（维护者 2026-11-20 定）；
//   `lyricIds.qq` 也是 songmid（宿主写回顶层的 `qqMid`）。
// - 专辑与歌手的 id 是 mid；上游没给 mid 时 `ref: false`（以前不带 catalogRef），界面不把它当成能打开的。
// - 宿主交回来的歌和集合是同一个形状（`data` 就是以前的 providerData），所以这里也读它，缓存回填照样幂等。

// Album art rule already proven by the QQ lyric search (qqLyricProvider.ts).
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

const jsonData = (entries: Array<[string, unknown]>): Record<string, FoliumJsonValue> => Object.fromEntries(
    entries.filter((entry): entry is [string, FoliumJsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

export const getQqAlbumCoverUrl = (albumMid: string): string | undefined => (
    albumMid
        ? originalQqCover(`${ALBUM_COVER_BASE}${albumMid}.jpg?max_age=2592000`)
        : undefined
);

export const getQqSingerAvatarUrl = (singerMid: string): string | undefined => (
    singerMid
        ? originalQqCover(`${SINGER_AVATAR_BASE}${singerMid}.jpg?max_age=2592000`)
        : undefined
);

const normalizeQqCoverUrl = (coverUrl: unknown): string => (
    originalQqCover(text(coverUrl))
);

// 专辑与歌手的集合身份一律用 mid。上游同时给出数字 `albumid` / `singer.id`，但那两个不是
// `/getAlbumInfo` 与 `/getSingerHotsong` 认的参数：传数字进去会拿到 HTTP 200 加
// `code: 1101 para error`（歌手路由则是 `singer.code: 400`），页面只剩空白且难以定位。
// 没有 mid 的条目 `ref: false`：宿主不把它当成能打开的。

// 宿主交回来的歌手、专辑：`ref` 不是 false 的，id 就是 mid（只有这里写它们）。
const refMid = (raw: unknown): string => {
    const ref = raw as { ref?: unknown; id?: unknown } | null | undefined;
    return ref && ref.ref !== false && typeof ref.id === 'string' ? text(ref.id) : '';
};

const normalizeArtists = (raw: unknown): FoliumSourceNamedRef[] => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    if (!Array.isArray(singers)) return [];
    return singers
        .map((singer: unknown) => {
            // 数字 `singer.id` 不参与身份判定，上游完全不给 mid 时宁可不给 id，
            // 也不要放一个会被上游拒收的 id 进来假装可以导航。
            const singerMid = text(pick(singer, 'mid', 'singermid', 'singerMID', 'singerMid')) || refMid(singer);
            return {
                id: singerMid,
                name: text(pick(singer, 'name', 'title', 'singername')),
                ...(singerMid ? {} : { ref: false }),
            };
        })
        .filter(artist => artist.name);
};

// A song this file made, as the host hands it back: the title is `title`, the id the songmid, and `data` what it kept.
const isMadeSong = (item: Record<string, unknown>): boolean => (
    typeof item.title === 'string' && Array.isArray(item.artists) && typeof item.id === 'string'
    && item.data !== null && typeof item.data === 'object'
);

// Accepts the upstream `item_song` payload (the backend's, the lite search's) and a song this file made, as the host
// hands it back, so kept songs survive a round trip through this normalizer.
export const normalizeQqSong = (raw: unknown): FoliumSourceSong => {
    const item = record(raw);
    const made = isMadeSong(item);
    const data = made ? record(item.data) : {};
    const album = record(item.album);
    const file = record(item.file);

    // songmid is the stable playback identity; the numeric song id is only a lyric/detail request parameter.
    const songMid = made
        ? text(pick(data, 'songMid') ?? pick(record((item as { lyricIds?: unknown }).lyricIds), 'qq') ?? pick(item, 'id'))
        : text(pick(item, 'mid', 'songmid', 'qqMid'));
    const rawSongId = made ? pick(data, 'songId') : pick(item, 'songid', 'songId', 'id');
    const numericSongId = Number(rawSongId);
    const songId: number | string = Number.isFinite(numericSongId) && numericSongId > 0 ? numericSongId : songMid;
    // `/getAlbumInfo` 的曲目条目没有嵌套的 album 节点，albummid 平铺在顶层，所以两处都要看。
    const albumMid = text(
        pick(album, 'mid', 'albummid', 'albumMid', 'albumMID')
        ?? pick(item, 'albummid', 'albumMid')
        ?? pick(data, 'albumMid'),
    ) || (made ? refMid(album) : '');
    const mediaMid = text(
        pick(file, 'media_mid', 'mediaMid')
        ?? pick(item, 'mediaMid')
        ?? pick(data, 'mediaMid'),
    );

    const durationMs = Number(item.durationMs);
    const intervalSeconds = Number(pick(item, 'interval', 'duration'));
    const coverUrl = normalizeQqCoverUrl(pick(album, 'coverUrl', 'picUrl')) || getQqAlbumCoverUrl(albumMid);
    // 上游的 `title` 带括号里的译名或版本（「夜に駆ける (向夜晚奔去)」），显示用它；同一条里的 `name`
    // 是不带这些的原名，留给歌词搜索在标题搜不到时再搜一次。只有同时给了 `title` 的条目，`name`
    // 才是原名：这里做过的歌（缓存回填）原名从 data 取回。
    const name = text(pick(item, 'title', 'name', 'songname')) || 'Unknown Song';
    const upstreamName = !made && pick(item, 'title') !== undefined ? text(pick(item, 'name')) : '';
    const originalName = upstreamName && upstreamName !== name
        ? upstreamName
        : text(pick(data, 'originalName'));
    const duration = Number.isFinite(durationMs) && durationMs > 0
        ? durationMs
        : Number.isFinite(intervalSeconds) ? intervalSeconds * 1000 : 0;
    // albummid 优先于数字 albumid：后者只在上游一个 mid 都不给时留作显示用的键（`ref: false`）。
    const albumId = albumMid || text(pick(album, 'id', 'albumid'));
    const albumName = text(pick(album, 'name', 'title', 'albumname'));
    const albumRef: FoliumSourceAlbumRef = {
        id: albumId,
        name: albumName,
        ...(coverUrl ? { coverUrl } : {}),
        ...(albumMid ? {} : { ref: false }),
    };

    return {
        id: songMid || String(songId),
        // The id mods have always known a QQ song by (folium.omni's FoliumSong.id, since Folium 1.7): the numeric songid.
        ...(songMid && typeof songId === 'number' ? { publicId: String(songId) } : {}),
        title: name,
        artists: normalizeArtists(item),
        album: albumRef,
        ...(duration > 0 ? { durationMs: duration } : {}),
        ...(songMid ? { lyricIds: { qq: songMid } } : {}),
        data: jsonData([
            ['songId', songId],
            ['songMid', songMid],
            ['albumMid', albumMid],
            ['mediaMid', mediaMid],
            ['originalName', originalName && originalName !== name ? originalName : undefined],
        ]),
    };
};

// A song without a mid has its numeric id as its id (normalizeQqSong), and so do songs an older build kept.
const NUMERIC_ID = /^\d+$/;

/** The song's mid (its playback key): the data's, the lyric id, or the id where it is no number. */
export const qqSongMidOf = (song: FoliumSourceSong): string => {
    const id = text(song.id);
    return text(song.data?.songMid) || text(song.lyricIds?.qq) || (NUMERIC_ID.test(id) ? '' : id);
};

/** The song's numeric id (lyrics, details, playlist edits), where it has one: the data's, or the id where it is one. */
export const qqSongIdNumberOf = (song: FoliumSourceSong): number | null => {
    const value = Number(song.data?.songId ?? (NUMERIC_ID.test(text(song.id)) ? song.id : undefined));
    return Number.isSafeInteger(value) && value > 0 ? value : null;
};

// 歌名的原名（normalizeQqSong 存下的上游 `name`）配上同一组歌手，供歌词搜索换个名字再搜。
export const getQqLyricSearchAlias = async (song: FoliumSourceSong): Promise<FoliumSourceLyricAlias | null> => {
    const originalName = text(song.data?.originalName);
    if (!originalName || originalName === song.title) return null;
    return {
        title: originalName,
        artist: song.artists.map(artist => artist.name).join(', '),
        ...(song.album?.name ? { album: song.album.name } : {}),
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

// Reads `/login/status` (`{ data: { profile } }`), `/user/detail` (`{ profile }`) and a user this file made.
export const normalizeQqUser = (raw: unknown): FoliumSourceUser => {
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
    // 会员等级不在登录资料里，由 qqAccount.ts 另读 `/user/vip` 补上；这里只认回填的数字。
    const vipType = Number(pick(profile, 'vipType'));

    return {
        id: id === undefined ? '' : String(id),
        nickname,
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(Number.isSafeInteger(vipType) && vipType >= 0 ? { vipType } : {}),
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
const normalizeCollectionArtists = (raw: unknown): FoliumSourceNamedRef[] => {
    const singers = pick(raw, 'singer', 'singers', 'artists');
    const list = Array.isArray(singers)
        ? singers
        : [{
            mid: pick(raw, 'singerMID', 'singermid', 'singerMid'),
            name: pick(raw, 'singerName', 'singername', 'singer_name'),
        }];
    return list
        .map((singer: unknown) => {
            // 识别键一律用 mid，与歌曲的处理一致；数字 id 只是上游别处的请求参数，不是集合身份。
            const singerMid = text(pick(singer, 'mid', 'singerMID', 'singermid', 'singerMid')) || refMid(singer);
            return {
                id: singerMid,
                name: text(pick(singer, 'name', 'singerName', 'singername', 'title')),
                ...(singerMid ? {} : { ref: false }),
            };
        })
        .filter(artist => artist.name);
};

// 读取 `/getAlbumInfo` 的 data、`/getSingerAlbum` 的 albumList 条目，或一份这里做过的专辑。
const normalizeQqAlbum = (item: unknown, existing: Record<string, unknown>): FoliumSourceCollection => {
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
        id: albumMid,
        name,
        type: 'album',
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(artists.length > 0 ? { artists } : {}),
        ...(publishedAt === undefined ? {} : { publishedAt }),
        ...(publisher ? { publisher } : {}),
        data: jsonData([['albumMid', albumMid]]),
    };
};

// 读取 `/getSingerHotsong` 摊平后的 singer_info + singer_brief，或一份这里做过的歌手。
const normalizeQqArtist = (item: unknown, existing: Record<string, unknown>): FoliumSourceCollection => {
    const singerMid = text(pick(item, 'singerMID', 'singermid', 'singerMid', 'mid') ?? pick(existing, 'singerMid'));
    const name = text(pick(item, 'singerName', 'singername', 'singer_name', 'name', 'title'));
    const coverUrl = normalizeQqCoverUrl(pick(item, 'coverUrl', 'singerPic', 'singerpic', 'picUrl')) || getQqSingerAvatarUrl(singerMid);
    const description = text(pick(item, 'singer_brief', 'singerBrief', 'desc', 'description'));
    const trackCount = Number(pick(item, 'total_song', 'totalSong', 'song_num', 'songNum', 'trackCount'));
    const albumCount = Number(pick(item, 'total_album', 'totalAlbum', 'album_num', 'albumNum', 'albumCount'));

    return {
        id: singerMid,
        name,
        type: 'artist',
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(Number.isFinite(albumCount) && albumCount >= 0 ? { albumCount } : {}),
        data: jsonData([['singerMid', singerMid]]),
    };
};

const COLLECTION_TYPES = ['playlist', 'album', 'artist'];

// QQ 音乐「我喜欢」歌单的自建目录号。
const QQ_LIKED_DIR_ID = 201;

// What a collection this file made kept: its `data` (the host hands it back so). Upstream entries carry no `data` object.
const keptData = (item: unknown): Record<string, unknown> => record((item as { data?: unknown } | null)?.data) as Record<string, unknown>;

// Reads a GetPlaylistByUin `v_playlist` entry or a collection this file made.
export const normalizeQqCollection = (raw: unknown, type = 'playlist'): FoliumSourceCollection => {
    const item = record(raw);
    const existing = keptData(item);

    // 读账号的地方会把这里做过的条目再喂回来，所以先按 type 分流；
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
    // `dirType`）。回填时沿用已经判过的结果。
    const owned = pick(item, 'dirName') !== undefined ? true : pick(existing, 'owned');
    const rawId = pick(item, 'id');
    const dissid = pick(item, 'dissid')
        ?? pick(existing, 'dissid')
        ?? (tid === undefined && dirId === undefined && Object.keys(existing).length === 0 ? rawId : undefined);
    // 系统目录的类型标记（0 是普通歌单）。后端只允许往没有标记、目录号 1–199 的自建歌单里加歌删歌。
    const dirType = pick(item, 'dirType') ?? pick(existing, 'dirType');
    const name = text(pick(item, 'dirName', 'dirname', 'dissname', 'title', 'name'));
    // GetPlaylistByUin exposes both cover sizes and songNum; kept keys remain fallbacks.
    const coverUrl = normalizeQqCoverUrl(pick(item, 'bigpicUrl', 'picUrl', 'picurl', 'coverUrl'));
    const trackCount = Number(pick(item, 'songNum', 'songnum', 'trackCount'));
    // `/recommend/playlists` 的条目带 `desc`、`play_cnt` 与 `creator.nick`；上游没给的数字不出现，不补 0。
    const description = text(pick(item, 'desc', 'description'));
    const playCount = Number(pick(item, 'play_cnt', 'listennum', 'playCount'));
    const creator = record(item.creator);
    const creatorName = text(pick(creator, 'nick', 'nickname', 'name'));
    const creatorId = pick(creator, 'encrypt_uin', 'uin', 'id');
    // 「我喜欢」是自建目录 201（GetPlaylistByUin 实测；getPlaylistTracks 也按它走 liked-songs 路由）。收藏条目的
    // dirId 是创建者账号里的目录号，所以还要 owned，别把收藏来的别人的「我喜欢」标成自己的。
    const isLiked = owned === true && Number(dirId) === QQ_LIKED_DIR_ID;
    // GetPlaylistByUin gives seconds; collections this file made already carry milliseconds. The empty
    // liked folder reports a different updateTime on every read, so it has no reliable version.
    const updateTime = Number(item.updateTime);
    const keptUpdatedAt = Number(item.updatedAt);
    const updatedAt = isLiked && trackCount === 0 ? undefined
        : Number.isFinite(keptUpdatedAt) && keptUpdatedAt > 0 ? keptUpdatedAt
            : owned === true && Number.isFinite(updateTime) && updateTime > 0 ? updateTime * 1000
                : undefined;

    return {
        id: text(tid ?? dissid ?? rawId ?? dirId ?? ''),
        name,
        type: text(item.type) || type,
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
        ...(Number.isFinite(playCount) && playCount >= 0 ? { playCount } : {}),
        ...(creatorName ? { creator: { id: text(creatorId ?? ''), nickname: creatorName } } : {}),
        // 歌单界面靠 isOwned 决定给不给编辑、给不给收藏按钮；只在判得出自建时写，收藏的条目不冒充。
        ...(owned === true ? { isOwned: true } : {}),
        data: jsonData([
            ['tid', tid],
            ['dirId', dirId],
            ['dirType', dirType],
            ['dissid', dissid],
            ['dirShow', dirShow],
            ['owned', owned],
            // 排行榜和电台不是歌单：探索页的卡片记下自己是哪一种（`list`）、对应的 id 和期数，
            // getPlaylistTracks 按它改走对应的路由（qqLists.ts）。回填时照样留着。
            ['list', pick(existing, 'list')],
            ['listId', pick(existing, 'listId')],
            ['period', pick(existing, 'period')],
        ]),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(isLiked ? { isLiked: true } : {}),
    };
};
