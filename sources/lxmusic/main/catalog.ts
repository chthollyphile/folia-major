import type { FoliumJsonValue, FoliumSourceCollection, FoliumSourcePage, FoliumSourceSong } from '@folia/folium';
import type { LxPlatform } from './scripts.ts';
import { isLxPlatform } from './scripts.ts';

// sources/lxmusic/main/catalog.ts
// 洛雪音源的曲库：酷我、酷狗、QQ、网易云的公开网页接口（不用登录、不带任何账号的 cookie），搜歌、搜歌单与专辑、
// 歌单 / 专辑 / 榜单里的歌、歌词、按 id 取一首歌，归一化成公开契约的 DTO。洛雪的自定义源脚本只管出播放地址，
// 曲库得模组自己有。它不经过 Folia 里这几家的音源模组，也不读它们的登录。
// 接口地址、字段名和各家的坑（酷我的单引号 JSON 与短路径封面、酷狗的 filename、QQ 的 comm 参数、网易云的风控码）
// 取自 PR #1177（作者 baixiao0919）的 lxmusicTransport.ts，是那里实测得来的；没有官方文档，平台改了就得跟着改。

type Raw = Record<string, unknown>;

/** 这里发请求用的：一个地址的回答文本（非 2xx 也算失败）。main 入口交 api.net.fetch 包成的。 */
export type CatalogFetch = (url: string, options?: { referer?: string; timeoutMs?: number }) => Promise<string>;

/** 曲库请求失败的种类；client 按它换成宿主的错误码。 */
export class CatalogError extends Error {
    readonly code: 'network' | 'invalid-response' | 'unavailable' | 'unsupported';
    constructor(code: CatalogError['code'], message: string) {
        super(message);
        this.name = 'CatalogError';
        this.code = code;
    }
}

const asRecord = (value: unknown): Raw | null => (value && typeof value === 'object' ? value as Raw : null);
const asArray = (value: unknown): Raw[] => (Array.isArray(value) ? value.filter((item): item is Raw => Boolean(asRecord(item))) : []);
const pick = (record: Raw | null | undefined, ...keys: string[]): unknown => {
    for (const key of keys) {
        const value = record?.[key];
        if (value !== undefined && value !== null && value !== '') return value;
    }
    return undefined;
};
const toText = (value: unknown): string => (typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : '').trim();
const toNumber = (value: unknown): number => {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
};

// 酷我的标题里带 &nbsp; 这类实体，酷狗带 <em> 高亮标签：一起清掉。
const decodeEntities = (value: string): string => value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
const stripTags = (value: unknown): string => decodeEntities(toText(value).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** 封面地址化成 https 的绝对地址：酷狗带 `{size}` 模板，还有协议相对和 http 的。 */
export const normalizeCover = (value: unknown, size = 240): string | undefined => {
    const raw = toText(value);
    if (!raw) return undefined;
    const sized = raw
        .replace('{size}', String(size))
        // 酷我的另一个 CDN（img1.kwcdn.kuwo.cn）桌面端 TLS 握手不过，同路径换成 img1.kuwo.cn。
        .replace(/^https?:\/\/(img\d+\.)?kwcdn\.kuwo\.cn/i, 'https://img1.kuwo.cn');
    if (sized.startsWith('//')) return `https:${sized}`;
    if (/^http:\/\//i.test(sized)) return `https://${sized.slice('http://'.length)}`;
    return /^https:\/\//i.test(sized) ? sized : undefined;
};

const KUWO_COVER_SHORT_PATH = /^\d+\/[\w.-]+\/[\w.-]+\/[\w.-]+\.(?:jpe?g|png|webp)$/i;
/** 酷我的搜索接口常只给 `120/85/1/4091887608.jpg` 这种短路径，拼在 albumcover 下面。 */
export const normalizeKuwoCover = (value: unknown): string | undefined => {
    const raw = toText(value);
    if (!raw) return undefined;
    const path = raw.replace(/^\/+/, '');
    if (/^star\//i.test(path) && !/^https?:/i.test(raw)) return `https://img1.kuwo.cn/${path}`;
    if (KUWO_COVER_SHORT_PATH.test(path)) return `https://img1.kuwo.cn/star/albumcover/${path}`;
    return normalizeCover(raw);
};

/** 酷我 r.s 回的是单引号 JSON；正经解析不了就把单引号换成双引号再试。 */
export const parseLooseJson = (text: string): unknown => {
    const trimmed = text.trim().replace(/^\uFEFF/, '');
    if (!trimmed) return null;
    try {
        return JSON.parse(trimmed);
    } catch {
        // 往下试。
    }
    try {
        return JSON.parse(trimmed.replace(/'/g, '"'));
    } catch {
        return null;
    }
};

const splitArtists = (value: unknown): string[] => toText(value)
    .split(/[、,&/]| feat\.? /i)
    .map(name => name.trim())
    .filter(Boolean);

// ---------------------------------------------------------------- id

/** 歌的 id：`<平台键>:<平台的歌曲 id>`。 */
export const songIdOf = (platform: LxPlatform, nativeId: string) => `${platform}:${nativeId}`;

/** 拆一首歌的 id；不是这个模组的写法回 null。 */
export const parseSongId = (id: string): { platform: LxPlatform; nativeId: string } | null => {
    const at = id.indexOf(':');
    const platform = id.slice(0, at);
    const nativeId = id.slice(at + 1);
    return at > 0 && isLxPlatform(platform) && nativeId && nativeId.length <= 128 ? { platform, nativeId } : null;
};

type CollectionKind = 'playlist' | 'chart' | 'album';
const KIND_TAGS: Record<CollectionKind, string> = { playlist: 'p', chart: 'c', album: 'a' };

/** 歌单、榜单、专辑的 id：`<平台键>:<p|c|a>:<平台的 id>`。 */
export const collectionIdOf = (platform: LxPlatform, kind: CollectionKind, nativeId: string) => `${platform}:${KIND_TAGS[kind]}:${nativeId}`;

export const parseCollectionId = (id: string): { platform: LxPlatform; kind: CollectionKind; nativeId: string } | null => {
    const [platform, tag, ...rest] = id.split(':');
    const kind = (Object.keys(KIND_TAGS) as CollectionKind[]).find(key => KIND_TAGS[key] === tag);
    const nativeId = rest.join(':');
    return isLxPlatform(platform) && kind && nativeId && nativeId.length <= 128 ? { platform, kind, nativeId } : null;
};

// ---------------------------------------------------------------- 归一化

interface SongParts {
    platform: LxPlatform;
    nativeId: string;
    title: string;
    artists: string[];
    albumId?: string;
    albumName?: string;
    coverUrl?: string;
    durationMs: number;
    extra?: Record<string, FoliumJsonValue>;
}

// 能按专辑列歌的三家；酷我没有不用登录的专辑接口。
const ALBUM_PLATFORMS: readonly LxPlatform[] = ['wy', 'kg', 'tx'];

const songOf = (parts: SongParts): FoliumSourceSong => {
    const albumOpens = Boolean(parts.albumId) && ALBUM_PLATFORMS.includes(parts.platform);
    return {
        id: songIdOf(parts.platform, parts.nativeId),
        title: parts.title,
        // 歌手页没有：名字只是名字，不开到哪里去。
        artists: parts.artists.map(name => ({ id: '', name, ref: false })),
        ...(parts.albumName || parts.coverUrl ? {
            album: {
                id: albumOpens ? collectionIdOf(parts.platform, 'album', parts.albumId as string) : '',
                name: parts.albumName ?? '',
                ...(albumOpens ? {} : { ref: false }),
                ...(parts.coverUrl ? { coverUrl: parts.coverUrl } : {}),
            },
        } : {}),
        ...(parts.durationMs > 0 ? { durationMs: parts.durationMs } : {}),
        ...(parts.coverUrl ? { coverUrl: parts.coverUrl } : {}),
        data: { platform: parts.platform, ...(parts.albumId ? { albumId: parts.albumId } : {}), ...parts.extra },
    };
};

const usable = (song: FoliumSourceSong | null): song is FoliumSourceSong => Boolean(song && song.title && parseSongId(song.id));

export const neteaseSong = (raw: Raw): FoliumSourceSong | null => {
    const album = asRecord(raw.album) ?? asRecord(raw.al);
    const cover = normalizeCover(pick(album, 'picUrl', 'coverUrl'));
    return {
        ...songOf({
            platform: 'wy',
            nativeId: toText(raw.id),
            title: toText(raw.name),
            artists: asArray(raw.artists ?? raw.ar).map(artist => toText(artist.name)).filter(Boolean),
            albumId: album?.id != null ? toText(album.id) : undefined,
            albumName: toText(album?.name),
            coverUrl: cover,
            durationMs: toNumber(pick(raw, 'duration', 'dt', 'durationMs')),
        }),
    };
};

/** 酷狗把「歌手 - 歌名」塞在 filename 里，缺字段时拿它拆。 */
const kugouNames = (raw: Raw): { title: string; artist: string } => {
    const title = stripTags(pick(raw, 'songname', 'song_name', 'name'));
    const artist = stripTags(pick(raw, 'singername', 'singer_name', 'author_name'));
    if (title && artist) return { title, artist };
    const filename = stripTags(pick(raw, 'filename', 'fileName'));
    const split = filename.split(' - ');
    if (split.length >= 2) return { title: title || split.slice(1).join(' - '), artist: artist || split[0] };
    return { title: title || filename, artist };
};

export const kugouSong = (raw: Raw): FoliumSourceSong | null => {
    const { title, artist } = kugouNames(raw);
    const trans = asRecord(raw.trans_param);
    const audioId = toText(pick(raw, 'audio_id', 'album_audio_id'));
    return songOf({
        platform: 'kg',
        // 脚本认的是 hash。
        nativeId: toText(pick(raw, 'hash', 'hash_128', 'FileHash')).toLowerCase(),
        title,
        artists: splitArtists(artist),
        albumId: toText(pick(raw, 'album_id', 'albumid')) || undefined,
        albumName: stripTags(pick(raw, 'album_name', 'albumname')),
        coverUrl: normalizeCover(pick(trans, 'union_cover', 'album_sizable_cover') ?? pick(raw, 'imgurl', 'album_sizable_cover')),
        // 酷狗的时长是秒。
        durationMs: toNumber(pick(raw, 'duration', 'timelength', 'timeLength')) * 1000,
        extra: audioId ? { audioId } : undefined,
    });
};

const kuwoIdOf = (value: unknown): string => toText(value).replace(/^MUSIC_/i, '');

export const kuwoSong = (raw: Raw): FoliumSourceSong | null => {
    // 榜单里的 duration 不是时长（有时是 2），song_duration 才是秒数；搜索结果是 DURATION。
    const seconds = Math.max(toNumber(pick(raw, 'DURATION', 'duration')), toNumber(pick(raw, 'song_duration')));
    return songOf({
        platform: 'kw',
        nativeId: kuwoIdOf(pick(raw, 'MUSICRID', 'musicrid', 'rid', 'id')),
        title: stripTags(pick(raw, 'SONGNAME', 'name', 'songname')),
        artists: splitArtists(stripTags(pick(raw, 'ARTIST', 'artist', 'aartist'))),
        albumId: kuwoIdOf(pick(raw, 'ALBUMID', 'albumid')) || undefined,
        albumName: stripTags(pick(raw, 'ALBUM', 'album')),
        coverUrl: normalizeKuwoCover(pick(raw, 'web_albumpic_short', 'web_album_short', 'albumpic', 'pic')),
        durationMs: seconds * 1000,
    });
};

const qqCover = (albumMid: string): string | undefined => (
    albumMid ? `https://y.qq.com/music/photo_new/T002R300x300M000${albumMid}.jpg` : undefined
);

export const qqSong = (raw: Raw): FoliumSourceSong | null => {
    const album = asRecord(raw.album);
    const albumMid = toText(pick(raw, 'albummid') ?? album?.mid);
    const mediaMid = toText(pick(raw, 'strMediaMid', 'media_mid') ?? asRecord(raw.file)?.media_mid);
    const numericId = toText(pick(raw, 'songid', 'id'));
    return songOf({
        platform: 'tx',
        // 脚本认 songmid，所以 id 用 mid，不是那个数字 id。
        nativeId: toText(pick(raw, 'mid', 'songmid')),
        title: stripTags(pick(raw, 'name', 'title', 'songname')),
        artists: asArray(raw.singer).map(singer => stripTags(singer.name)).filter(Boolean),
        albumId: toText(pick(raw, 'albumid') ?? album?.id) || undefined,
        albumName: stripTags(pick(raw, 'albumname') ?? album?.name),
        coverUrl: qqCover(albumMid) ?? normalizeCover(pick(raw, 'albumcover')),
        // QQ 的 interval 是秒。
        durationMs: toNumber(pick(raw, 'interval')) * 1000,
        extra: {
            ...(albumMid ? { albumMid } : {}),
            ...(mediaMid ? { mediaMid } : {}),
            ...(numericId && /^\d+$/.test(numericId) ? { songId: numericId } : {}),
        },
    });
};

interface CollectionParts {
    platform: LxPlatform;
    kind: CollectionKind;
    nativeId: string;
    name: string;
    coverUrl?: string;
    description?: string;
    trackCount?: number;
    playCount?: number;
    creatorName?: string;
    updatedAt?: number;
}

const collectionOf = (parts: CollectionParts): FoliumSourceCollection | null => {
    if (!parts.nativeId || !parts.name) return null;
    return {
        id: collectionIdOf(parts.platform, parts.kind, parts.nativeId),
        type: parts.kind === 'album' ? 'album' : 'playlist',
        name: parts.name,
        ...(parts.coverUrl ? { coverUrl: parts.coverUrl } : {}),
        ...(parts.description ? { description: parts.description.slice(0, 2000) } : {}),
        ...(parts.trackCount ? { trackCount: parts.trackCount } : {}),
        ...(parts.playCount ? { playCount: parts.playCount } : {}),
        ...(parts.kind === 'album' && parts.creatorName ? { artists: [{ id: '', name: parts.creatorName, ref: false }] } : {}),
        ...(parts.kind !== 'album' && parts.creatorName ? { creator: { id: '', nickname: parts.creatorName } } : {}),
        ...(parts.updatedAt ? { updatedAt: parts.updatedAt } : {}),
        data: { platform: parts.platform, kind: parts.kind },
    };
};

const present = <T>(items: Array<T | null>): T[] => items.filter((item): item is T => item !== null);

// 网易云没有榜单目录接口答不上时用的几张固定的榜（榜本身就是歌单）。
const NETEASE_CHARTS = [
    { id: '19723756', name: '飙升榜' },
    { id: '3779629', name: '新歌榜' },
    { id: '2884035', name: '原创榜' },
    { id: '3778678', name: '热歌榜' },
];

// 酷我的榜单 id 是固定编号（网页端一直在用），没有目录接口；名字照洛雪的 kw/leaderboard.js。
const KUWO_CHARTS = [
    { id: '93', name: '飙升榜' },
    { id: '17', name: '新歌榜' },
    { id: '16', name: '热歌榜' },
    { id: '265', name: '韩国Genie榜' },
    { id: '14', name: '韩国M-net榜' },
    { id: '8', name: '香港电台榜' },
    { id: '15', name: '日本公信榜' },
    { id: '151', name: '腾讯音乐人原创榜' },
];

const NETEASE_BASE = 'https://music.163.com';
const KUGOU_API = 'https://mobiles.kugou.com';
const KUGOU_WEB = 'https://m.kugou.com';
const QQ_CGI = 'https://c.y.qq.com';
const QQ_MUSICU = 'https://u.y.qq.com/cgi-bin/musicu.fcg';
const QQ_REFERER = 'https://y.qq.com/';

// musicu.fcg 只认一整套 comm 参数，少一个就回 500001。
const QQ_COMM = {
    cv: 4747474, ct: 24, format: 'json', inCharset: 'utf-8', outCharset: 'utf-8', notice: 0,
    platform: 'yqq.json', needNewCode: 1, uin: '0', g_tk_new_20200303: 5381, g_tk: 5381,
};

const lrcTime = (seconds: number): string => {
    const safe = Math.max(0, seconds);
    const minutes = Math.floor(safe / 60);
    return `[${String(minutes).padStart(2, '0')}:${(safe - minutes * 60).toFixed(2).padStart(5, '0')}]`;
};

export interface CatalogLyric {
    lyric: string;
    translation?: string;
    romanization?: string;
}

type SongPage = FoliumSourcePage<FoliumSourceSong>;
type CollectionPage = FoliumSourcePage<FoliumSourceCollection>;

/** 建曲库。`fetchText` 是唯一的联网途径。 */
export const createCatalog = (fetchText: CatalogFetch) => {
    const fetchJson = async (url: string, options?: { referer?: string; timeoutMs?: number }): Promise<Raw> => {
        const text = await fetchText(url, options);
        const parsed = asRecord(parseLooseJson(text));
        if (!parsed) throw new CatalogError('invalid-response', 'the platform answered something that is not JSON');
        return parsed;
    };
    // 网易云偶尔回 code: -462（风控要求验证）之类：不能当成「空歌单」糊过去。
    const netease = async (path: string): Promise<Raw> => {
        const payload = await fetchJson(`${NETEASE_BASE}${path}`, { referer: `${NETEASE_BASE}/` });
        const code = Number(payload.code);
        if (Number.isFinite(code) && code !== 200 && code !== 0) throw new CatalogError('unavailable', `NetEase answered ${code}`);
        return payload;
    };
    const qqMusicu = async (module: string, method: string, param: Raw): Promise<Raw | null> => {
        const data = encodeURIComponent(JSON.stringify({ comm: QQ_COMM, req_1: { module, method, param } }));
        return asRecord((await fetchJson(`${QQ_MUSICU}?format=json&data=${data}`, { referer: QQ_REFERER })).req_1);
    };

    const pageNumber = (offset: number, limit: number) => Math.floor(Math.max(0, offset) / Math.max(1, limit)) + 1;
    const songPage = (raws: Raw[], normalize: (raw: Raw) => FoliumSourceSong | null, limit: number, total?: unknown): SongPage => {
        const count = toNumber(total);
        return {
            items: raws.map(normalize).filter(usable).slice(0, limit),
            hasMore: raws.length >= limit,
            ...(count > 0 ? { total: count } : {}),
        };
    };
    // 一次给全的列表（网易云的歌单、QQ 的歌单）在本地切页。
    const slicePage = (songs: FoliumSourceSong[], limit: number, offset: number): SongPage => ({
        items: songs.slice(offset, offset + limit),
        total: songs.length,
        hasMore: songs.length > offset + limit,
    });
    const collectionPage = (items: Array<FoliumSourceCollection | null>, rawCount: number, limit: number): CollectionPage => ({
        items: present(items).slice(0, limit),
        hasMore: rawCount >= limit,
    });

    const playlistTracks = async (platform: LxPlatform, id: string, limit: number, offset: number): Promise<SongPage> => {
        const page = pageNumber(offset, limit);
        const encoded = encodeURIComponent(id);
        if (platform === 'wy') {
            const payload = await netease(`/api/playlist/detail?id=${encoded}`);
            // 歌单详情一次给全（上限 1000 首）。
            return slicePage(asArray(asRecord(payload.result)?.tracks).map(neteaseSong).filter(usable), limit, offset);
        }
        if (platform === 'kg') {
            const payload = await fetchJson(`${KUGOU_API}/api/v3/special/song?specialid=${encoded}&page=${page}&pagesize=${limit}&plat=0&version=8000`);
            const data = asRecord(payload.data);
            return songPage(asArray(data?.info), kugouSong, limit, data?.total);
        }
        if (platform === 'kw') {
            // 少了 vipver=1&mobi=1，total 有值但 musiclist 是空的。
            const payload = await fetchJson(
                `https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=${encoded}&pn=${page - 1}&rn=${limit}&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=1&mobi=1`,
                { referer: 'https://www.kuwo.cn/' },
            );
            return songPage(asArray(payload.musiclist), kuwoSong, limit, payload.total);
        }
        const payload = await fetchJson(`${QQ_CGI}/v8/fcg-bin/fcg_v8_playlist_cp.fcg?id=${encoded}&format=json&newsong=1&skin=1`, { referer: QQ_REFERER });
        const list = asArray(asRecord(payload.data)?.cdlist)[0]?.songlist;
        return slicePage(asArray(list).map(qqSong).filter(usable), limit, offset);
    };

    const chartTracks = async (platform: LxPlatform, id: string, limit: number, offset: number): Promise<SongPage> => {
        const page = pageNumber(offset, limit);
        const encoded = encodeURIComponent(id);
        // 网易云的榜单本身就是歌单。
        if (platform === 'wy') return playlistTracks(platform, id, limit, offset);
        if (platform === 'kg') {
            const payload = await fetchJson(`${KUGOU_WEB}/rank/info/?rankid=${encoded}&page=${page}&json=true`);
            const songs = asRecord(payload.songs);
            return songPage(asArray(songs?.list), kugouSong, limit, songs?.total);
        }
        if (platform === 'tx') {
            const payload = await fetchJson(
                `${QQ_CGI}/v8/fcg-bin/fcg_v8_toplist_cp.fcg?topid=${encoded}&format=json&page=detail&type=top&song_begin=${offset}&song_num=${limit}`,
                { referer: QQ_REFERER },
            );
            const raws = asArray(payload.songlist).map(item => asRecord(item.data)).filter((data): data is Raw => Boolean(data));
            return songPage(raws, qqSong, limit, payload.total_song_num);
        }
        const payload = await fetchJson(
            `https://kbangserver.kuwo.cn/ksong.s?from=pc&fmt=json&pn=${page - 1}&rn=${limit}&type=bang&data=content&id=${encoded}&show_copyright_off=1`,
        );
        return songPage(asArray(payload.musiclist), kuwoSong, limit, payload.num);
    };

    const albumTracks = async (platform: LxPlatform, id: string, limit: number, offset: number): Promise<SongPage> => {
        const page = pageNumber(offset, limit);
        const encoded = encodeURIComponent(id);
        if (platform === 'wy') {
            const payload = await netease(`/api/album/${encoded}`);
            return slicePage(asArray(asRecord(payload.album)?.songs).map(neteaseSong).filter(usable), limit, offset);
        }
        if (platform === 'kg') {
            const payload = await fetchJson(`${KUGOU_API}/api/v3/album/song?albumid=${encoded}&page=${page}&pagesize=${limit}&plat=0&version=8000`);
            const data = asRecord(payload.data);
            return songPage(asArray(data?.info), kugouSong, limit, data?.total);
        }
        if (platform === 'tx') {
            // 数字的 albumid 和 albummid 这个接口都认。
            const param = /^\d+$/.test(id) ? 'albumid' : 'albummid';
            const payload = await fetchJson(
                `${QQ_CGI}/v8/fcg-bin/fcg_v8_album_info_cp.fcg?${param}=${encoded}&format=json&song_begin=${offset}&song_num=${limit}`,
                { referer: QQ_REFERER },
            );
            const data = asRecord(payload.data);
            return songPage(asArray(data?.list), qqSong, limit, data?.total_song_num);
        }
        throw new CatalogError('unsupported', 'this platform has no public album endpoint');
    };

    return {
        async searchSongs(platform: LxPlatform, query: string, limit: number, offset: number): Promise<SongPage> {
            const page = pageNumber(offset, limit);
            const keyword = encodeURIComponent(query);
            if (platform === 'wy') {
                // 搜歌走 cloudsearch：search/get/web 的 songs 不带封面。
                const result = asRecord((await netease(`/api/cloudsearch/pc?s=${keyword}&type=1&limit=${limit}&offset=${offset}`)).result);
                return songPage(asArray(result?.songs), neteaseSong, limit, result?.songCount);
            }
            if (platform === 'kg') {
                const data = asRecord((await fetchJson(`${KUGOU_API}/api/v3/search/song?format=json&keyword=${keyword}&page=${page}&pagesize=${limit}&showtype=1`)).data);
                return songPage(asArray(data?.info), kugouSong, limit, data?.total);
            }
            if (platform === 'tx') {
                const payload = await fetchJson(`${QQ_CGI}/soso/fcgi-bin/client_search_cp?format=json&p=${page}&n=${limit}&w=${keyword}`, { referer: QQ_REFERER });
                const song = asRecord(asRecord(payload.data)?.song);
                return songPage(asArray(song?.list), qqSong, limit, song?.totalnum);
            }
            const payload = await fetchJson(
                `https://search.kuwo.cn/r.s?all=${keyword}&ft=music&itemset=web_2013&client=kt&pn=${page - 1}&rn=${limit}&rformat=json&encoding=utf8`,
            );
            return songPage(asArray(payload.abslist), kuwoSong, limit, payload.TOTAL);
        },

        /** 搜歌单；酷我没有公开的歌单搜索，回空页。 */
        async searchPlaylists(platform: LxPlatform, query: string, limit: number, offset: number): Promise<CollectionPage> {
            const page = pageNumber(offset, limit);
            const keyword = encodeURIComponent(query);
            if (platform === 'wy') {
                const raws = asArray(asRecord((await netease(`/api/search/get/web?s=${keyword}&type=1000&limit=${limit}&offset=${offset}`)).result)?.playlists);
                return collectionPage(raws.map(raw => collectionOf({
                    platform, kind: 'playlist', nativeId: toText(raw.id), name: toText(raw.name),
                    coverUrl: normalizeCover(pick(raw, 'coverImgUrl', 'picUrl')),
                    description: toText(raw.description),
                    trackCount: toNumber(raw.trackCount), playCount: toNumber(raw.playCount),
                    creatorName: toText(asRecord(raw.creator)?.nickname),
                })), raws.length, limit);
            }
            if (platform === 'kg') {
                const raws = asArray(asRecord((await fetchJson(`${KUGOU_API}/api/v3/search/special?format=json&keyword=${keyword}&page=${page}&pagesize=${limit}`)).data)?.info);
                return collectionPage(raws.map(raw => collectionOf({
                    platform, kind: 'playlist', nativeId: toText(pick(raw, 'specialid', 'specialId', 'id')),
                    name: stripTags(pick(raw, 'specialname', 'special_name', 'name')),
                    coverUrl: normalizeCover(pick(raw, 'imgurl', 'img_9', 'album_img_9', 'cover', 'img')),
                    description: stripTags(pick(raw, 'intro', 'description')),
                    trackCount: toNumber(pick(raw, 'songcount', 'song_count')), playCount: toNumber(pick(raw, 'playcount', 'play_count')),
                    creatorName: stripTags(pick(raw, 'nickname', 'username', 'create_user_name')),
                })), raws.length, limit);
            }
            if (platform === 'tx') {
                // t=8 是 QQ 的「歌单」搜索类型。
                const payload = await fetchJson(`${QQ_CGI}/soso/fcgi-bin/client_search_cp?format=json&p=${page}&n=${limit}&t=8&w=${keyword}`, { referer: QQ_REFERER });
                const raws = asArray(asRecord(asRecord(payload.data)?.special)?.list);
                return collectionPage(raws.map(raw => collectionOf({
                    platform, kind: 'playlist', nativeId: toText(pick(raw, 'dissid', 'disstid', 'id')),
                    name: stripTags(pick(raw, 'dissname', 'title')),
                    coverUrl: normalizeCover(pick(raw, 'imgurl', 'logo')),
                    description: stripTags(pick(raw, 'introduction', 'desc')),
                    trackCount: toNumber(pick(raw, 'song_count', 'cur_song_num')), playCount: toNumber(pick(raw, 'listennum', 'visitnum')),
                    creatorName: stripTags(asRecord(raw.creator)?.name),
                })), raws.length, limit);
            }
            return { items: [], hasMore: false };
        },

        /** 搜专辑；只有网易云有公开的专辑搜索。 */
        async searchAlbums(platform: LxPlatform, query: string, limit: number, offset: number): Promise<CollectionPage> {
            if (platform !== 'wy') return { items: [], hasMore: false };
            const raws = asArray(asRecord((await netease(`/api/search/get/web?s=${encodeURIComponent(query)}&type=10&limit=${limit}&offset=${offset}`)).result)?.albums);
            return collectionPage(raws.map(raw => collectionOf({
                platform, kind: 'album', nativeId: toText(raw.id), name: toText(raw.name),
                coverUrl: normalizeCover(pick(raw, 'picUrl', 'blurPicUrl')),
                trackCount: toNumber(raw.size),
                creatorName: toText(asRecord(raw.artist)?.name),
                updatedAt: toNumber(raw.publishTime),
            })), raws.length, limit);
        },

        /** 一家的榜单。 */
        async charts(platform: LxPlatform): Promise<FoliumSourceCollection[]> {
            const fixed = (list: Array<{ id: string; name: string }>) => present(list.map(chart => collectionOf({ platform, kind: 'chart', nativeId: chart.id, name: chart.name })));
            if (platform === 'kg') {
                const raws = asArray(asRecord((await fetchJson(`${KUGOU_WEB}/rank/list&json=true`)).rank)?.list);
                return present(raws.map(raw => collectionOf({
                    platform, kind: 'chart', nativeId: toText(pick(raw, 'rankid', 'rank_id', 'id')),
                    name: stripTags(pick(raw, 'rankname', 'rank_name', 'name')),
                    coverUrl: normalizeCover(pick(raw, 'imgurl', 'img_9', 'album_img_9', 'banner_9')),
                    description: stripTags(raw.intro),
                })));
            }
            if (platform === 'tx') {
                const groups = asArray(asRecord((await qqMusicu('musicToplist.ToplistInfoServer', 'GetAll', {}))?.data)?.group);
                return present(groups.flatMap(group => asArray(group.toplist)).map(raw => collectionOf({
                    platform, kind: 'chart', nativeId: toText(pick(raw, 'topId', 'topid', 'id')),
                    name: stripTags(pick(raw, 'title', 'name')),
                    coverUrl: normalizeCover(pick(raw, 'frontPicUrl', 'headPicUrl')),
                    description: stripTags(raw.intro),
                })));
            }
            if (platform === 'wy') {
                // 官方目录一次带回全部榜单的名字和图；答不上才退回固定的那几张。
                try {
                    const raws = asArray((await netease('/api/toplist')).list);
                    const charts = present(raws.map(raw => collectionOf({
                        platform, kind: 'chart', nativeId: toText(raw.id), name: toText(raw.name),
                        coverUrl: normalizeCover(raw.coverImgUrl), description: toText(raw.description),
                        trackCount: toNumber(raw.trackCount), playCount: toNumber(raw.playCount),
                    })));
                    if (charts.length > 0) return charts;
                } catch {
                    // 退回固定的。
                }
                return fixed(NETEASE_CHARTS);
            }
            return fixed(KUWO_CHARTS);
        },

        /** 一个歌单、榜单或专辑里的歌，`id` 是 collectionIdOf 的写法。 */
        async tracks(id: string, limit: number, offset: number): Promise<SongPage> {
            const parsed = parseCollectionId(id);
            if (!parsed) throw new CatalogError('unsupported', 'not a collection of this source');
            if (parsed.kind === 'chart') return chartTracks(parsed.platform, parsed.nativeId, limit, offset);
            if (parsed.kind === 'album') return albumTracks(parsed.platform, parsed.nativeId, limit, offset);
            return playlistTracks(parsed.platform, parsed.nativeId, limit, offset);
        },

        /** 按 id 取一首歌；酷我没有只凭 id 反查的公开接口，回 null。 */
        async song(id: string): Promise<FoliumSourceSong | null> {
            const parsed = parseSongId(id);
            if (!parsed) return null;
            const encoded = encodeURIComponent(parsed.nativeId);
            if (parsed.platform === 'wy') {
                const raw = asArray((await netease(`/api/song/detail?ids=[${encoded}]`)).songs)[0];
                const song = raw ? neteaseSong(raw) : null;
                return usable(song) ? song : null;
            }
            if (parsed.platform === 'kg') {
                const payload = await fetchJson(`${KUGOU_WEB}/app/i/getSongInfo.php?cmd=playInfo&hash=${encoded}`, { referer: `${KUGOU_WEB}/` });
                if (toText(payload.error)) return null;
                // 这个接口的键名和搜索的不同：songName / author_name / imgUrl。
                const song = kugouSong({ ...payload, hash: parsed.nativeId, songname: payload.songName, singername: payload.author_name, imgurl: payload.imgUrl });
                return usable(song) ? song : null;
            }
            if (parsed.platform === 'tx') {
                const payload = await fetchJson(`${QQ_CGI}/v8/fcg-bin/fcg_play_single_song.fcg?songmid=${encoded}&platform=yqq&format=json`, { referer: QQ_REFERER });
                const raw = asArray(payload.data)[0];
                const song = raw ? qqSong(raw) : null;
                return usable(song) ? song : null;
            }
            return null;
        },

        /** 公开接口给的歌词（网易云、酷我）；别家回 null，交给脚本。 */
        async lyric(id: string): Promise<CatalogLyric | null> {
            const parsed = parseSongId(id);
            if (!parsed) return null;
            const encoded = encodeURIComponent(parsed.nativeId);
            if (parsed.platform === 'wy') {
                const payload = await netease(`/api/song/lyric?id=${encoded}&lv=1&kv=1&tv=-1&rv=-1`);
                const lyric = toText(asRecord(payload.lrc)?.lyric);
                if (!lyric) return null;
                const translation = toText(asRecord(payload.tlyric)?.lyric);
                const romanization = toText(asRecord(payload.romalrc)?.lyric);
                return { lyric, ...(translation ? { translation } : {}), ...(romanization ? { romanization } : {}) };
            }
            if (parsed.platform === 'kw') {
                const payload = await fetchJson(`https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=${encoded}`);
                const lines = asArray(asRecord(payload.data)?.lrclist);
                if (lines.length === 0) return null;
                return { lyric: lines.map(line => `${lrcTime(toNumber(line.time))}${toText(line.lineLyric)}`).join('\n') };
            }
            return null;
        },
    };
};

export type Catalog = ReturnType<typeof createCatalog>;
