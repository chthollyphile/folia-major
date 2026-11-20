// src/services/onlineMusic/lxmusic/lxmusicProvider.ts
// 「洛雪音源」provider。
//
// 分工照 LX 客户端来：
//   · 搜索 / 歌单广场 / 榜单 / 歌单与专辑曲目 —— 走 lxmusicTransport 里各家的公开网页接口，不需要账号；
//   · 播放地址 / 歌词 —— 优先用公开接口（酷我有免费直链、网易云有公开歌词），取不到时交给导入的 LX 音源
//     （LX 自定义音源只干这件事：把 musicUrl / lyric / pic 续出来）。
//
// 歌曲 id 统一编成 `平台:原生 id`（wy:123 / kg:<hash> / kw:456），providerData 里再留一份，
// 换成别的 provider 也不会丢来源。

import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderPage,
} from '../../../types/onlineMusic';
import type { LyricData, SongResult, UnifiedSong } from '../../../types';
import { lxSourceStore } from './lxSourceStore';
import { FOLIA_QUALITY_TO_LX, type LxPlatformKey } from './lxTypes';
import { raceCandidates, type LxRaceTask } from './lxRace';
import { proxyNativeRemoteAudioUrl } from '../../nativeRemoteAudio';
import { hasNativeHttp, nativeHttpRequest } from '../../nativeAndroidBridge';
import { notePlaybackAttempt } from './lxDiagnostics';
import { getLxPreferences } from './lxPreferences';
import { installImportedAudioResolver } from '../importedAudioRouting';
import { hydrateLxLocalLikes, setLxLocalLiked } from './lxLocalLikes';
import {
    getLxLikedSongs,
    getLxLikedUnifiedSongs,
    LX_LIKED_PLAYLIST_ID,
    removeLxLikedSong,
    setLxLikedSong,
} from './lxLikedSongs';
import {
    addSongToLxPlaylist,
    createLxSavedPlaylist,
    fromSavedSong,
    getLxSavedPlaylists,
    removeSongFromLxPlaylist,
    type LxSavedPlaylist,
    type LxSavedSong,
} from './lxSavedPlaylists';
import { lxLyricBySearch, lxLyricFromKg, lxLyricFromTx } from './lxLyric';
import {
    lxApiAlbumSquare,
    lxApiAlbumTracks,
    lxApiChartTracks,
    lxApiCharts,
    lxApiFreeAudioUrl,
    lxApiLyric,
    lxApiPlaylistSquare,
    lxApiPlaylistTracks,
    lxApiRadioPrograms,
    lxApiSearchAlbums,
    lxApiSearchPlaylists,
    lxApiSearchSongs,
    LX_PUBLIC_PLATFORM_KEYS,
    LX_PUBLIC_PLATFORMS,
    type LxApiCollection,
    type LxApiPage,
    type LxApiSong,
    type LxPublicPlatform,
} from './lxmusicTransport';

// ---------------------------------------------------------------- id 编解码

type ParsedId = { platform: LxPlatformKey; nativeId: string };

const KNOWN_ID_PLATFORMS = new Set<string>(['wy', 'kg', 'kw', 'tx', 'mg']);

/** `wy:123` → { platform: 'wy', nativeId: '123' }；同时兼容上一版的 `netease|123`。 */
const parseSongId = (id: MediaId | string): ParsedId | null => {
    const raw = String(id ?? '');
    const sep = raw.indexOf(':');
    if (sep > 0) {
        const platform = raw.slice(0, sep);
        const nativeId = raw.slice(sep + 1);
        if (nativeId && KNOWN_ID_PLATFORMS.has(platform)) {
            return { platform: platform as LxPlatformKey, nativeId };
        }
        return null;
    }
    const [legacyProvider, legacyId] = raw.split('|');
    const legacyMap: Record<string, LxPlatformKey> = { netease: 'wy', kugou: 'kg', qq: 'tx', kuwo: 'kw' };
    const platform = legacyMap[legacyProvider];
    if (platform && legacyId) return { platform, nativeId: legacyId };
    return null;
};

const makeId = (platform: LxPlatformKey, nativeId: string): MediaId => `${platform}:${nativeId}` as MediaId;

/**
 * 首页「推荐」页那排榜单卡点下去，落的是 Folia 自己的集合页，不是洛雪工作台
 * （工作台是另一套界面，一点像换了个软件）。集合 id 带 `lxchart:` 前缀，
 * 把榜单和普通歌单分开：曲目按各家的榜单接口取，而网易云的榜本身就是一张歌单。
 */
export const LX_CHART_ID_PREFIX = 'lxchart:';

export const lxChartCollectionId = (platform: string, chartId: string): string => (
    `${LX_CHART_ID_PREFIX}${platform}:${chartId}`
);

const parseLxChartId = (id: MediaId | string): { platform: LxPublicPlatform; chartId: string } | null => {
    const raw = String(id ?? '');
    if (!raw.startsWith(LX_CHART_ID_PREFIX)) return null;
    const rest = raw.slice(LX_CHART_ID_PREFIX.length);
    const sep = rest.indexOf(':');
    if (sep <= 0) return null;
    const platform = rest.slice(0, sep);
    const chartId = rest.slice(sep + 1);
    if (!chartId || !(LX_PUBLIC_PLATFORM_KEYS as ReadonlyArray<string>).includes(platform)) return null;
    return { platform: platform as LxPublicPlatform, chartId };
};

const platformOfSong = (song: SongResult): ParsedId | null => {
    const ref = song.sourceRef;
    if (ref?.kind === 'online' && ref.providerData) {
        const data = ref.providerData as { platform?: LxPlatformKey; nativeId?: string };
        if (data.platform && data.nativeId) return { platform: data.platform, nativeId: data.nativeId };
    }
    return parseSongId(song.id);
};

/** 喜欢落在哪个 id：歌曲自带的 id 就是 `平台:原生 id`；没有时按 providerData 重建。 */
const likeMediaIdOf = (song: MediaId | SongResult): MediaId | null => {
    if (typeof song === 'object' && song !== null) {
        const parsed = platformOfSong(song);
        if (parsed) return makeId(parsed.platform, parsed.nativeId);
        return song.id ?? null;
    }
    return song;
};

// ---------------------------------------------------------------- 结构转换

/** 四家平台在界面上怎么称呼：搜索结果是四家混排的，每一行都要说清来自哪一家。 */
const platformLabelOf = (platform: string): string => (
    LX_PUBLIC_PLATFORMS.find((entry) => entry.key === platform)?.label ?? platform
);

const toUnifiedSong = (item: LxApiSong): UnifiedSong => {
    const id = makeId(item.platform, item.id);
    return {
        id,
        name: item.name,
        artists: item.artists.length > 0
            ? item.artists.map((artist, index) => ({
                id: (artist.id ?? `${item.platform}-artist-${index}-${artist.name}`) as MediaId,
                name: artist.name,
            }))
            : [{ id: `${item.platform}-artist-unknown` as MediaId, name: '未知歌手' }],
        album: {
            id: (item.album.id ?? `${item.platform}-album-unknown`) as MediaId,
            name: item.album.name || '未知专辑',
            coverUrl: item.album.coverUrl ?? item.coverUrl,
        },
        durationMs: item.durationMs,
        aliases: [],
        translatedNames: [],
        isPureMusic: false,
        sourceRef: {
            kind: 'online',
            providerId: 'lxmusic',
            mediaId: String(id),
            // platformLabel 是给通用列表用的：搜索结果四家混排，界面不认识平台 id，只读这个短名。
            providerData: { platform: item.platform, nativeId: item.id, platformLabel: platformLabelOf(item.platform) },
        },
    };
};

/** UnifiedSong 的原生身份（平台 + 平台侧 id），用来跟本机收藏对账。 */
const nativeKeyOfUnified = (song: UnifiedSong): string => {
    const ref = song.sourceRef;
    const data = ref?.kind === 'online'
        ? ref.providerData as Record<string, unknown> | undefined
        : undefined;
    return `${String(data?.platform ?? '')}:${String(data?.nativeId ?? '')}`;
};

/**
 * 「专辑」页里那些只存到专辑名、没存到平台专辑 id 的收藏，自己凑成一张虚拟专辑。
 * 集合 id 编成 `平台:saved:<专辑名>`——平台那侧根本没有这张专辑页可跳，只能看本机收藏。
 */
export const LX_SAVED_ALBUM_PREFIX = 'saved:';

export const lxSavedAlbumCollectionId = (platform: string, albumName: string): string => (
    `${platform}:${LX_SAVED_ALBUM_PREFIX}${encodeURIComponent(albumName)}`
);

/** 本机收藏（喜欢 + 自建歌单）里落在某张专辑下的歌，按 mediaId 去重。 */
const collectSavedForAlbum = (platform: string, albumId: string): LxSavedSong[] => {
    const seen = new Set<string>();
    const out: LxSavedSong[] = [];
    const push = (song: LxSavedSong): void => {
        if (!song?.mediaId || seen.has(song.mediaId)) return;
        if (song.platform !== platform || song.albumId !== albumId) return;
        seen.add(song.mediaId);
        out.push(song);
    };
    getLxLikedSongs().forEach(push);
    getLxSavedPlaylists().forEach((playlist) => playlist.songs.forEach(push));
    return out;
};

/** 本机收藏里「没有平台专辑 id、只能按专辑名认」的那批歌（同平台同名才算一张）。 */
const collectSavedByAlbumName = (platform: string, albumName: string): LxSavedSong[] => {
    const want = albumName.trim();
    const seen = new Set<string>();
    const out: LxSavedSong[] = [];
    const push = (song: LxSavedSong): void => {
        if (!song?.mediaId || seen.has(song.mediaId)) return;
        if (song.platform !== platform) return;
        // 有原生 id 的歌属于真专辑页，不混进这张虚拟专辑里重复出现。
        if (song.albumId) return;
        if ((song.albumName ?? '').trim() !== want) return;
        seen.add(song.mediaId);
        out.push(song);
    };
    getLxLikedSongs().forEach(push);
    getLxSavedPlaylists().forEach((playlist) => playlist.songs.forEach(push));
    return out;
};

/** 本机收藏列表 → 全站认的 ProviderCollection（收藏弹层与歌单列表都用这个形状）。 */
const lxSavedPlaylistToCollection = (playlist: LxSavedPlaylist): ProviderCollection => {
    const coverUrl = playlist.songs[0]?.coverUrl;
    return {
        providerId: 'lxmusic',
        id: playlist.id as MediaId,
        name: playlist.name,
        type: 'playlist',
        trackCount: playlist.songs.length,
        ...(coverUrl ? { coverUrl } : {}),
    };
};

const toProviderCollection = (item: LxApiCollection): ProviderCollection => ({
    providerId: 'lxmusic',
    id: makeId(item.platform, item.id),
    name: item.name,
    type: item.kind,
    coverUrl: item.coverUrl,
    description: item.description,
    trackCount: item.trackCount,
    playCount: item.playCount,
    creator: item.creatorName ? { id: `${item.platform}-creator` as MediaId, nickname: item.creatorName } : undefined,
    updatedAt: item.updatedAt,
    providerData: { platform: item.platform, nativeId: item.id, kind: item.kind },
});

const emptyPage = <T>(offset = 0): ProviderPage<T> => ({ items: [], nextOffset: offset, hasMore: false });

const toProviderPage = <T, U>(page: LxApiPage<T>, map: (item: T) => U, offset: number, limit: number): ProviderPage<U> => {
    const items = page.items.map(map);
    return { items, nextOffset: offset + items.length, hasMore: page.hasMore };
};

/** 多平台结果交替排列（wy, kg, kw, wy …），一屏里能同时看到各家，而不是先把网易云翻完。 */
const interleave = <T>(lists: T[][]): T[] => {
    const out: T[] = [];
    const max = Math.max(0, ...lists.map((list) => list.length));
    for (let index = 0; index < max; index += 1) {
        for (const list of lists) {
            if (index < list.length) out.push(list[index]);
        }
    }
    return out;
};

const dedupeSongs = (songs: UnifiedSong[]): UnifiedSong[] => {
    const seen = new Set<string>();
    const out: UnifiedSong[] = [];
    for (const song of songs) {
        const key = `${song.name}__${song.artists.map((a) => a.name).join('/')}`.toLowerCase();
        const idKey = String(song.id);
        if (seen.has(key) || seen.has(idKey)) continue;
        seen.add(key);
        seen.add(idKey);
        out.push(song);
    }
    return out;
};

/** 歌单 / 专辑搜索结果的去重：同一个集合 id 只留第一次出现的那家。 */
const dedupeCollections = (collections: ProviderCollection[]): ProviderCollection[] => {
    const seen = new Set<string>();
    return collections.filter((collection) => {
        const key = String(collection.id);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

// ---------------------------------------------------------------- 音源

const foliaQualityToLx = (quality: AudioQualityPreference, supported: string[]): string | null => {
    const order = FOLIA_QUALITY_TO_LX;
    const idx = Math.max(0, order.findIndex((entry) => entry.folia === quality));
    for (let i = idx; i < order.length; i += 1) {
        if (supported.includes(order[i].lx)) return order[i].lx;
    }
    for (let i = idx - 1; i >= 0; i -= 1) {
        if (supported.includes(order[i].lx)) return order[i].lx;
    }
    return supported[0] ?? null;
};

const sourceQualityFor = (platform: LxPlatformKey): string[] => {
    const supported = new Set<string>();
    for (const source of lxSourceStore.getSources()) {
        if (!source.enabled) continue;
        const info = source.sources[platform];
        if (!info?.actions.includes('musicUrl')) continue;
        info.qualitys.forEach((quality) => supported.add(quality));
    }
    return [...supported];
};

/** LX 音源要的 musicInfo：把各平台认的字段名都填上。 */
const buildMusicInfo = (platform: LxPlatformKey, nativeId: string, song: SongResult): Record<string, unknown> => {
    const artistNames = song.artists.map((artist) => artist.name).join(',');
    const durationSec = Math.round((song.durationMs ?? 0) / 1000);
    return {
        songid: nativeId,
        songmid: nativeId,
        musicId: nativeId,
        id: nativeId,
        mid: nativeId,
        // 酷狗自定义源普遍读 hash。
        hash: nativeId,
        // 酷我系音源会读这几个。
        rid: nativeId,
        songId: nativeId,
        copyrightId: nativeId,
        name: song.name,
        title: song.name,
        singer: artistNames,
        artist: artistNames,
        albumName: song.album?.name ?? '',
        album: song.album?.name ?? '',
        interval: durationSec,
        duration: durationSec,
        musicid: nativeId,
        platform,
    };
};

/** 把 LRC 文本转成 folia 的结构化歌词。 */
const parseLrcToLyricData = (lrc: string): LyricData => {
    const regex = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    const parsed: Array<{ time: number; text: string }> = [];
    for (const line of lrc.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const text = trimmed.replace(regex, '').trim();
        const matches = [...trimmed.matchAll(regex)];
        if (matches.length === 0) continue;
        for (const match of matches) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const fracRaw = match[3] ? match[3].padEnd(3, '0').slice(0, 3) : '000';
            parsed.push({ time: minutes * 60 + seconds + parseInt(fracRaw, 10) / 1000, text });
        }
    }
    parsed.sort((a, b) => a.time - b.time);
    const lines = parsed.map((entry, index) => {
        const start = entry.time;
        const end = index + 1 < parsed.length ? parsed[index + 1].time : start + 6;
        return {
            words: [{ text: entry.text, startTime: start, endTime: end }],
            startTime: start,
            endTime: end,
            fullText: entry.text,
            id: String(index),
        };
    });
    return { lines };
};

const isPublicPlatform = (platform: LxPlatformKey): platform is LxPublicPlatform => (
    platform === 'wy' || platform === 'kg' || platform === 'kw' || platform === 'tx'
);

/**
 * 「全都走音源」的实现（并发竞速）：
 *   1. 本平台所有音源**同时**出手，谁先给出「能播」的地址就用谁；
 *   2. 同时并行去别家平台搜同一首歌（各家一条链），用那家的 id 再让音源出地址；
 *   3. 公开免费直链**不参与竞速** —— 它几乎 0ms 就能算出地址，同场赛跑时每次都赢，
 *      结果就是「导入了音源，播的还是默认接口」。只有音源整轮都交不出地址时才用它兜底。
 *
 * 这样「一个源不行」不再是「等它超时再试下一个」，而是「别人早就跑在前面了」。
 * 死源会被记进健康度（lxSourceHealth），连续失败后进入冷却，下次直接排到最后。
 *
 * 缓存只记音源给的地址（带 via），按「平台:原生 id:音质」存：内存 30 分钟、落盘 3 小时。
 * key 换成 v2 是故意的：v1 里存的很可能是公开直链，不能让它们继续抢在音源前面命中。
 */
const PLAYBACK_CACHE_TTL = 30 * 60 * 1000;
const PERSISTED_CACHE_TTL = 3 * 60 * 60 * 1000;
const CACHE_STORAGE_KEY = 'lxmusic_playback_cache_v2';
const CACHE_LIMIT = 400;

type PlaybackCacheEntry = {
    url: string;
    at: number;
    persisted: boolean;
    headers?: Record<string, string>;
    /** 这个地址是谁给的。只缓存音源结果。 */
    via?: string;
};

const playbackCache = new Map<string, PlaybackCacheEntry>();
let persistedCacheLoaded = false;
let cacheSaveTimer: number | null = null;

const loadPersistedCache = (): void => {
    if (persistedCacheLoaded) return;
    persistedCacheLoaded = true;
    try {
        const raw = localStorage.getItem(CACHE_STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Record<string, {
            url?: string; at?: number; headers?: Record<string, string>; via?: string;
        }>;
        const now = Date.now();
        Object.entries(parsed).forEach(([key, value]) => {
            if (typeof value?.url !== 'string' || typeof value?.at !== 'number') return;
            if (now - value.at > PERSISTED_CACHE_TTL) return;
            // 旧格式 / 公开直链的缓存一律不复活，逼这次重新问音源。
            if (!value.via || value.via.startsWith('公开直链')) return;
            playbackCache.set(key, {
                url: value.url,
                at: value.at,
                persisted: true,
                via: value.via,
                ...(value.headers && typeof value.headers === 'object' ? { headers: value.headers } : {}),
            });
        });
    } catch {
        // 缓存坏了就当没有。
    }
};

const saveCacheSoon = (): void => {
    if (cacheSaveTimer !== null) return;
    cacheSaveTimer = window.setTimeout(() => {
        cacheSaveTimer = null;
        try {
            const now = Date.now();
            const entries = [...playbackCache.entries()]
                .filter(([, entry]) => now - entry.at < PERSISTED_CACHE_TTL)
                .sort((a, b) => b[1].at - a[1].at)
                .slice(0, CACHE_LIMIT);
            localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
        } catch {
            // 存不下就算了，下次多花几百毫秒。
        }
    }, 2000);
};

const readCachedUrl = (key: string): PlaybackCacheEntry | null => {
    loadPersistedCache();
    const entry = playbackCache.get(key);
    if (!entry) return null;
    const ttl = entry.persisted ? PERSISTED_CACHE_TTL : PLAYBACK_CACHE_TTL;
    if (Date.now() - entry.at > ttl || !entry.via || entry.via.startsWith('公开直链')) {
        playbackCache.delete(key);
        return null;
    }
    return entry;
};

const writeCachedUrl = (
    key: string,
    url: string,
    via: string | undefined,
    headers?: Record<string, string>,
): void => {
    // 公开直链是兜底，不写缓存：下次播放要先给音源一次机会。
    if (!via || via.startsWith('公开直链')) return;
    playbackCache.set(key, {
        url,
        at: Date.now(),
        persisted: false,
        via,
        ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    });
    saveCacheSoon();
};

/** 跨平台兜底时的尝试顺序：优先音源生态里最稳的酷狗 / 酷我，再网易云、QQ。 */
const FALLBACK_PLATFORM_ORDER: LxPublicPlatform[] = ['kg', 'kw', 'wy', 'tx'];

const simplifyText = (text: string): string => text
    .toLowerCase()
    .replace(/[\s\-_/\\()（）[\]【】<>《》·,，.。!！?？'"“”‘’&+]/g, '');

/** 在搜索结果里挑同名同歌手的那首，时长差太多的直接判负。 */
const pickBestMatch = (candidates: LxApiSong[], song: SongResult): LxApiSong | null => {
    const name = simplifyText(song.name);
    const artists = song.artists.map((artist) => simplifyText(artist.name));
    let best: { item: LxApiSong; score: number } | null = null;
    for (const item of candidates) {
        const itemName = simplifyText(item.name);
        let score = 0;
        if (itemName === name) score += 6;
        else if (itemName.includes(name) || name.includes(itemName)) score += 3;
        else continue;

        const itemArtists = item.artists.map((artist) => simplifyText(artist.name));
        if (itemArtists.some((artist) => artists.includes(artist))) score += 4;
        else if (itemArtists.some((artist) => artists.some((target) => artist.includes(target) || target.includes(artist)))) score += 2;

        if (song.durationMs && item.durationMs) {
            const diff = Math.abs(song.durationMs - item.durationMs);
            if (diff < 3000) score += 2;
            else if (diff > 20000) score -= 2;
        }
        if (!best || score > best.score) best = { item, score };
    }
    return best && best.score >= 6 ? best.item : null;
};

/**
 * 音源给的地址先探一下活。
 * 第三方音源的后端经常「地址给得出来、点开是 404 / 一段 HTML」，播放器只会静默失败。
 *
 * 探活方式分两条路：
 *   · 安卓：走原生 OkHttp 取第一个字节（`Range: bytes=0-0`），带上音源自己要求的头。
 *     这是唯一可靠的路子 —— 音频 CDN 基本都不下发 CORS 头，而播放器 <audio> 挂的是
 *     crossOrigin="anonymous"，用 <audio> 或 fetch 探活会把**所有**地址判成死链，
 *     于是 v15 的表现就是「一个都播不了」。
 *   · 网页端：没有原生桥，只能用 <audio> 走真正播放的路径（浏览器里 fetch 同样会被
 *     跨域挡掉，反而误判）。
 */
const PROBE_TIMEOUT_MS = 5000;

const PROBE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

/** 回包像不像音频：明确的 text/json/xml 就是「地址给错了」，其余一律放行。 */
const looksLikeAudio = (contentType: string | null): boolean => {
    const type = String(contentType || '').toLowerCase();
    if (!type) return true;
    return !(type.startsWith('text/') || type.includes('json') || type.includes('xml') || type.includes('html'));
};

const probeByNative = async (url: string, headers?: Record<string, string>): Promise<boolean> => {
    const response = await nativeHttpRequest(url, {
        method: 'GET',
        headers: { 'User-Agent': PROBE_USER_AGENT, Range: 'bytes=0-0', ...headers },
        timeoutMs: PROBE_TIMEOUT_MS,
    });
    // 416（拒绝这个 range）/ 405、501（压根不支持 Range）：服务器活着，
    // 普通 GET 照样能把整首歌取回来。音源给的 CDN 里这类很常见，别把好地址判死。
    if (response.status === 416 || response.status === 405 || response.status === 501) return true;
    if (!response.ok) return false;
    return looksLikeAudio(response.headers.get('content-type'));
};

/** 网页端：用隐藏的 <audio> 取 metadata（走的是真正播放的路径，不受 CORS 限制）。 */
const probeByAudioElement = (url: string): Promise<boolean> => new Promise((resolve) => {
    const audio = new Audio();
    let settled = false;
    const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        audio.removeEventListener('loadedmetadata', onLoaded);
        audio.removeEventListener('error', onError);
        // 主动释放，避免探活把连接一直挂着。
        try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
        } catch {
            // 忽略：只是清理。
        }
        resolve(ok);
    };
    const onLoaded = () => finish(true);
    const onError = () => finish(false);
    const timer = window.setTimeout(() => finish(false), PROBE_TIMEOUT_MS);

    audio.addEventListener('loadedmetadata', onLoaded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    audio.preload = 'metadata';
    audio.muted = true;
    audio.src = url;
    audio.load();
});

const probeAudioUrl = async (value: unknown): Promise<boolean> => {
    const candidate = (typeof value === 'string' ? { url: value } : value) as { url?: unknown; headers?: Record<string, string> } | null;
    const url = candidate?.url;
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false;

    if (hasNativeHttp()) {
        try {
            return await probeByNative(url, candidate?.headers);
        } catch (error) {
            // 连不上、超时、被上游拒绝：这个源这一刻确实交不出能用的地址。
            console.warn('[lxmusic] 探活失败：', url.slice(0, 60), error instanceof Error ? error.message : error);
            return false;
        }
    }
    return probeByAudioElement(url);
};

type AudioCandidate = { url: string; headers?: Record<string, string>; via?: string };

/** 诊断里只记主机名，不把带签名的完整 URL 落到本地。 */
const hostOf = (url: string): string | undefined => {
    try {
        return new URL(url).host;
    } catch {
        return undefined;
    }
};

const asCandidate = (value: string | AudioCandidate | null): AudioCandidate | null => {
    if (!value) return null;
    return typeof value === 'string' ? { url: value } : value;
};

/**
 * 把音源给的地址换成「播放器真的能播」的形式。
 *
 * 播放器是 `<audio crossOrigin="anonymous">`，而音源/各家 CDN 基本都不下发
 * `Access-Control-Allow-Origin` —— 直连时字节在最前面就被同源检查挡掉，报出来却是
 * 一句没有特征的 "Format error" / "The element has no supported sources"。
 * 安卓侧本来就有回环转发服务（LocalAudioServer），回包带 `ACAO: *`、Range 原样透传，
 * 顺手还能带上音源要求的请求头（Referer / UA）。非安卓、或注册失败时原样返回。
 */
const toPlayableSource = async (candidate: AudioCandidate): Promise<string> => {
    try {
        return await proxyNativeRemoteAudioUrl(candidate.url, {
            ...(candidate.headers ? { headers: candidate.headers } : {}),
            allowAnyHost: true,
        });
    } catch {
        return candidate.url;
    }
};

/**
 * 某个平台上所有可用音源，各建一条取地址的任务（内部已按健康度排好序）。
 * `probe=false` 时不验收地址 —— 留给「全都探活失败」时的最后一次机会。
 */
const sourceTasksFor = (
    platform: LxPlatformKey,
    nativeId: string,
    song: SongResult,
    quality: AudioQualityPreference,
    probe = true,
): LxRaceTask<AudioCandidate>[] => {
    const supported = sourceQualityFor(platform);
    if (supported.length === 0) return [];
    const lxQuality = foliaQualityToLx(quality, supported);
    if (!lxQuality) return [];
    return lxSourceStore
        .musicTasksFor(
            platform,
            lxQuality,
            buildMusicInfo(platform, nativeId, song),
            probe ? probeAudioUrl : undefined,
        )
        .map((task) => ({
            label: task.label,
            run: async () => {
                const candidate = asCandidate(await task.run());
                return candidate ? { ...candidate, via: task.label } : null;
            },
        }));
};

/** 去别家平台找同一首歌，返回那家的 id。 */
const findNativeIdOn = async (platform: LxPublicPlatform, song: SongResult): Promise<string | null> => {
    try {
        const query = `${song.name} ${song.artists[0]?.name ?? ''}`.trim();
        const page = await lxApiSearchSongs(platform, query, 8, 0);
        return pickBestMatch(page.items, song)?.id ?? null;
    } catch (error) {
        console.warn(`[lxmusic] 在 ${platform} 找同一首歌失败：`, error);
        return null;
    }
};

// ---------------------------------------------------------------- 「歌手」页
//
// 洛雪公开接口没有单独的歌手接口，只有搜索。所以歌手页用自造 id `lxartist:<平台>:<歌手名>`：
// 点歌手名时 resolveSongCatalogRefs 把每首歌的演唱者改成这个 ref，那一页再拿该平台的搜索
// 按名字取歌、只留这位歌手的。平台不提供歌手专辑，专辑区给空页（页面自然留白）。

const LX_ARTIST_ID_PREFIX = 'lxartist';

const lxArtistId = (platform: LxPublicPlatform, name: string): MediaId => `${LX_ARTIST_ID_PREFIX}:${platform}:${name}` as MediaId;

const parseLxArtistId = (id: MediaId): { platform: LxPublicPlatform; name: string } | null => {
    const raw = String(id ?? '');
    if (!raw.startsWith(`${LX_ARTIST_ID_PREFIX}:`)) return null;
    const rest = raw.slice(LX_ARTIST_ID_PREFIX.length + 1);
    const separator = rest.indexOf(':');
    if (separator <= 0) return null;
    const platform = rest.slice(0, separator) as LxPlatformKey;
    const name = rest.slice(separator + 1).trim();
    if (!name || !isPublicPlatform(platform)) return null;
    return { platform, name };
};

/** 搜索结果里判断一首歌是不是这位歌手唱的：名字相等，或一方包含另一方（「五月天」与「五月天 阿信」）。 */
const lxArtistNameMatches = (candidate: string, target: string): boolean => {
    const a = candidate.toLowerCase().replace(/\s+/g, '');
    const b = target.toLowerCase().replace(/\s+/g, '');
    if (!a || !b) return false;
    if (a === b) return true;
    return a.length > 1 && b.length > 1 && (a.includes(b) || b.includes(a));
};

// ---------------------------------------------------------------- provider

export const lxmusicProvider: OnlineMusicProvider = {
    id: 'lxmusic',
    displayName: '洛雪音源',
    shortName: '洛雪',
    shortNameKey: 'onlineProviderName.lxmusic',
    mark: { letter: '雪', color: '#7c3aed' },
    getAvailability: () => ({ configured: true }),
    /*
     * 洛雪不连账号：导入音源脚本就能用，没有扫码也没有表单。但宿主要求每个 provider 都答得出
     * 「谁登录了」，所以这里报一个本机的虚拟身份——账号区显示为可用，而不是「未登录」。
     * 登出不动已导入的音源与偏好（它们存在本机，见 lxSourceStore / lxPreferences）。
     */
    auth: {
        // 登录窗格按这个标题与说明展示；洛雪不用账号，说明写的是“导入音源脚本”。
        getLoginTexts: () => ({ title: 'home.loginTitleLxmusic', note: 'home.loginNoteLxmusic' }),
        async getLoginStatus() {
            return { id: 'lxmusic-local', nickname: '洛雪音源' };
        },
        async logout() {},
    },
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        // 免登录：导入音源就能用，不弹登录窗。
        auth: false,
        playlists: true,
        albums: true,
        artists: false,
        recommendations: false,
        userLibrary: false,
        // 喜欢是本机的：音源不连账号，但「这一颗心」要能按下去、要能记住（见 lxLocalLikes）。
        likes: true,
        mutations: true,
        // 收藏到歌单也落在本机（lxSavedPlaylists），所以「新建歌单 / 往歌单里加歌」这条也开。
        playlistTrackMutations: true,
        wordByWordLyrics: false,
    },
    normalizeSong: (raw: unknown) => raw as UnifiedSong,

    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return emptyPage<UnifiedSong>(offset);
            const results = await Promise.allSettled(
                LX_PUBLIC_PLATFORM_KEYS.map((platform) => lxApiSearchSongs(platform, query, limit, offset)),
            );
            const pages = results
                .filter((result): result is PromiseFulfilledResult<LxApiPage<LxApiSong>> => result.status === 'fulfilled')
                .map((result) => result.value);
            if (pages.length === 0) {
                const failure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
                console.warn('[lxmusic] 搜索全部平台失败：', failure?.reason);
                return emptyPage<UnifiedSong>(offset);
            }
            // `limit` 是「每个平台各取多少」，不是总数：各家的 offset 才能对齐，翻页不会漏歌。
            const songs = dedupeSongs(interleave(pages.map((page) => page.items.map(toUnifiedSong))));
            return {
                items: songs,
                nextOffset: offset + limit,
                hasMore: pages.some((page) => page.hasMore),
            };
        },
        /*
         * 歌单 / 专辑搜索：洛雪要像其它平台一样走主线的搜索页（专辑 / 歌单页签），
         * 而不是只在它自己的工作台里搜。四家交替排开，与 searchSongs 同一套规则；
         * 酷我没有歌单搜索、专辑只有一家公开接口给，交白卷的那几家照常跳过。
         * `limit` 同样是「每家各取多少」，翻页时各家的 offset 才能对齐。
         */
        async searchPlaylists(query, limit, offset) {
            if (!query.trim()) return emptyPage<ProviderCollection>(offset);
            const results = await Promise.allSettled(
                LX_PUBLIC_PLATFORM_KEYS.map((platform) => lxApiSearchPlaylists(platform, query, limit, offset)),
            );
            const pages = results
                .filter((result): result is PromiseFulfilledResult<LxApiPage<LxApiCollection>> => result.status === 'fulfilled')
                .map((result) => result.value);
            return {
                items: dedupeCollections(interleave(pages.map((page) => page.items.map(toProviderCollection)))),
                nextOffset: offset + limit,
                hasMore: pages.some((page) => page.hasMore),
            };
        },

        async searchAlbums(query, limit, offset) {
            if (!query.trim()) return emptyPage<ProviderCollection>(offset);
            const results = await Promise.allSettled(
                LX_PUBLIC_PLATFORM_KEYS.map((platform) => lxApiSearchAlbums(platform, query, limit, offset)),
            );
            const pages = results
                .filter((result): result is PromiseFulfilledResult<LxApiPage<LxApiCollection>> => result.status === 'fulfilled')
                .map((result) => result.value);
            return {
                items: dedupeCollections(interleave(pages.map((page) => page.items.map(toProviderCollection)))),
                nextOffset: offset + limit,
                hasMore: pages.some((page) => page.hasMore),
            };
        },
    },

    playback: {
        async getSongDetail() {
            // 这个 provider 的歌曲都带着完整元信息；拿不到单曲详情时不假装有。
            return null;
        },
        async getAudioSource(song, quality) {
            const startedAt = Date.now();
            const parsed = platformOfSong(song);
            if (!parsed) {
                notePlaybackAttempt({
                    platform: '?',
                    songId: String(song.id),
                    name: song.name,
                    quality,
                    ok: false,
                    ms: Date.now() - startedAt,
                    error: '歌曲没有可用的平台 id（providerData 丢了）',
                });
                return null;
            }

            const cacheKey = `${parsed.platform}:${parsed.nativeId}:${quality}`;
            const cached = readCachedUrl(cacheKey);
            if (cached) {
                // 落盘的地址可能过期，但「每次播放先探活」有两个代价：一次最多 5 秒的干等，
                // 以及不支持 Range 的 CDN 会被误判成死地址、白白丢掉本来能播的链接。
                // 直接交给播放器：真过期时播放器的在线恢复会重新取地址，比先探后播快得多。
                // 这里只可能命中音源给的地址（writeCachedUrl 不收公开直链）。
                notePlaybackAttempt({
                    platform: parsed.platform,
                    songId: parsed.nativeId,
                    name: song.name,
                    quality,
                    ok: true,
                    ms: Date.now() - startedAt,
                    via: `缓存/${cached.via ?? '音源'}`,
                    host: hostOf(cached.url),
                });
                return {
                    url: await toPlayableSource({ url: cached.url, headers: cached.headers }),
                    fetchedAt: cached.at,
                    quality,
                };
            }

            // 音源是异步初始化的（不少脚本要先探测接口才 send('inited')），
            // 刚打开 App 就点播放时它可能还没就绪，这里等一小会儿。
            await lxSourceStore.ensureReady();

            /**
             * 只用导入的音源取地址：本平台每个音源一条任务，外加「去别家搜同款、再用那家音源」
             * 的并行链。公开免费直链**故意不在这里** —— 它几乎 0ms 就能算出地址（网易云外链
             * 甚至不用发请求），同场竞速时每首歌都是它赢，用户导入的音源永远轮不上。
             * probe=false 时不验收地址，留给探活全被误判时的最后一次机会。
             */
            const raceSources = (
                targetQuality: AudioQualityPreference,
                probe: boolean,
                includeCrossPlatform = true,
            ): Promise<AudioCandidate | null> => {
                const tasks: LxRaceTask<AudioCandidate>[] = [];
                tasks.push(...sourceTasksFor(parsed.platform, parsed.nativeId, song, targetQuality, probe));

                if (includeCrossPlatform) {
                    for (const platform of FALLBACK_PLATFORM_ORDER) {
                        if (platform === parsed.platform) continue;
                        if (!lxSourceStore.canResolve(platform, 'musicUrl')) continue;
                        // 已知全在冷却的平台往后排：别让它们占着并发名额。
                        const priority = lxSourceStore.hasLiveSourceFor(platform, 'musicUrl') ? 0 : 1;
                        tasks.push({
                            label: `跨平台/${platform}`,
                            priority,
                            run: async () => {
                                const nativeId = await findNativeIdOn(platform, song);
                                if (!nativeId) return null;
                                const chain = sourceTasksFor(platform, nativeId, song, targetQuality, probe);
                                if (chain.length === 0) return null;
                                // 链内部也竞速，但别和外面抢太多并发：两个一起试就够。
                                return raceCandidates(chain, { initial: 2, staggerMs: 300, maxConcurrent: 2 });
                            },
                        });
                    }
                }

                if (tasks.length === 0) return Promise.resolve(null);
                tasks.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
                return raceCandidates(tasks, { initial: 3, staggerMs: 220, maxConcurrent: 6 });
            };

            /** 公开免费直链：只在音源整轮交不出地址时兜底，且不写缓存。 */
            const publicFallback = async (): Promise<AudioCandidate | null> => {
                const platform = parsed.platform;
                if (!isPublicPlatform(platform)) return null;
                const url = await lxApiFreeAudioUrl(platform, parsed.nativeId);
                if (!url || !(await probeAudioUrl(url))) return null;
                return { url, via: `公开直链/${platform}` };
            };

            let winner = await raceSources(quality, true);
            // 首选音质整轮都没成（源只给无损、而设备放不动，或这一档的链接全过期）时，
            // 再用标准音质试一轮：能出声比音质重要。
            if (!winner && quality !== 'standard') {
                console.warn(`[lxmusic] ${parsed.platform}:${parsed.nativeId} 在 ${quality} 没有可用地址，降到标准音质再试`);
                winner = await raceSources('standard', true);
            }

            if (!winner) {
                // 探活可能误判（CDN 不认 Range / 首包太慢 / 要求特殊头），
                // 让音源不验收再给一次地址，交给播放器直接试。
                console.warn(`[lxmusic] ${parsed.platform}:${parsed.nativeId} 探活全失败，取一个未验收的音源地址再试`);
                // 这一轮只问本平台的音源：跨平台要先搜同款，会再拖一轮请求。
                winner = await raceSources(quality, false, false);
            }

            // 到这里音源（含跨平台、两轮机会）都没交出地址，才轮到默认公开接口。
            if (!winner && getLxPreferences().allowPublicFallback) {
                console.warn(`[lxmusic] ${parsed.platform}:${parsed.nativeId} 音源全失败，改用公开直链兜底`);
                winner = await publicFallback();
            }
            if (!winner) {
                notePlaybackAttempt({
                    platform: parsed.platform,
                    songId: parsed.nativeId,
                    name: song.name,
                    quality,
                    ok: false,
                    ms: Date.now() - startedAt,
                    error: '所有导入音源都没给出可用地址（公开直链兜底已关闭或也失败）',
                });
                return null;
            }
            const via = winner.via ?? '音源';
            writeCachedUrl(cacheKey, winner.url, via, winner.headers);
            const playableUrl = await toPlayableSource(winner);
            notePlaybackAttempt({
                platform: parsed.platform,
                songId: parsed.nativeId,
                name: song.name,
                quality,
                ok: true,
                ms: Date.now() - startedAt,
                via,
                host: hostOf(winner.url),
            });
            return {
                url: playableUrl,
                fetchedAt: Date.now(),
                quality,
            };
        },
    },

    /*
     * 喜欢落在本机：洛雪不连账号，没有远端能收这一颗心。写本地一份、回灌账号缓存
     * （likedSongIds），播放器的心形和「我喜欢」都读那份缓存，重启后还在。
     */
    mutations: {
        async likeSong(song, liked) {
            const mediaId = likeMediaIdOf(song);
            if (!mediaId) return;
            setLxLocalLiked(mediaId, liked);
            // 光有 id 画不出「我的喜欢」那张卡：点喜欢时顺带留一份带歌名/歌手/封面的歌，
            // 取消喜欢时两边一起删（id 那份在 lxLocalLikes，元数据这份在 lxLikedSongs）。
            if (typeof song === 'object' && song !== null) {
                if (liked) setLxLikedSong(song as unknown as UnifiedSong, true);
                else removeLxLikedSong(String(mediaId));
            } else if (!liked) {
                removeLxLikedSong(String(mediaId));
            }
        },

        /*
         * 「收藏到歌单」。洛雪的歌单同样是本机的（lxSavedPlaylists）：没有账号、没有远端能收。
         * 这三支补齐后，全站的收藏弹层（AddToPlaylistHost）才认这是一家能建列表、能往里放歌的
         * provider —— 之前只留了 likeSong，于是弹层里永远只有「我喜欢」一行。
         */
        async createPlaylist(name) {
            const created = createLxSavedPlaylist(name);
            if (!created) throw new Error('lx-playlist-limit');
            return lxSavedPlaylistToCollection(created);
        },

        async updatePlaylistTracks(operation, playlist, tracks) {
            const playlistId = typeof playlist === 'object' && playlist !== null ? String(playlist.id) : String(playlist);
            for (const track of tracks) {
                const isSong = typeof track === 'object' && track !== null;
                const mediaId = isSong ? String((track as { id: unknown }).id) : String(track);
                if (operation === 'del') {
                    removeSongFromLxPlaylist(playlistId, mediaId);
                    continue;
                }
                // 只有 id 没有歌名/来源的歌存不进去（toSavedSong 会拒），跳过即可。
                if (!isSong) continue;
                addSongToLxPlaylist(playlistId, track as unknown as UnifiedSong);
            }
        },

        // 弹层里可选的歌单：本机那些，按最近创建在前。
        listPlaylists() {
            return getLxSavedPlaylists().map(lxSavedPlaylistToCollection);
        },
    },

    lyrics: {
        async getLyrics(song) {
            const parsed = platformOfSong(song);

            // 1) 公开歌词接口：wy / kw 直接有；tx / kg 各走自己的歌词服务。
            //    原来这两家落空，于是 tx 上的歌（周杰伦这类）一进来就没词。
            if (parsed && isPublicPlatform(parsed.platform)) {
                try {
                    const { main, translation } = await lxApiLyric(parsed.platform, parsed.nativeId);
                    if (main) {
                        return {
                            lyrics: parseLrcToLyricData(main),
                            mainText: main,
                            translationText: translation ?? undefined,
                            isPureMusic: false,
                        };
                    }
                } catch (error) {
                    console.warn('[lxmusic] 公开歌词接口失败，改走平台歌词：', error);
                }
                if (parsed.platform === 'tx' || parsed.platform === 'kg') {
                    try {
                        const side = parsed.platform === 'tx'
                            ? await lxLyricFromTx(parsed.nativeId)
                            : await lxLyricFromKg(parsed.nativeId, song.name);
                        if (side?.main) {
                            return {
                                lyrics: parseLrcToLyricData(side.main),
                                mainText: side.main,
                                translationText: side.translation ?? undefined,
                                isPureMusic: false,
                            };
                        }
                    } catch (error) {
                        console.warn('[lxmusic] 平台歌词接口失败，改走音源：', error);
                    }
                }
            }

            // 2) 音源（LX 自定义音源自己会续 lyric）。
            if (parsed) {
                try {
                    const raw = await lxSourceStore.resolveLyric(
                        parsed.platform,
                        buildMusicInfo(parsed.platform, parsed.nativeId, song),
                    );
                    const record = raw && typeof raw === 'object'
                        ? raw as { lyric?: string; tlyric?: string; rlyric?: string }
                        : null;
                    const main = record?.lyric ?? null;
                    if (main) {
                        return {
                            lyrics: parseLrcToLyricData(main),
                            mainText: main,
                            translationText: record?.tlyric ?? undefined,
                            romanizationText: record?.rlyric ?? undefined,
                            isPureMusic: false,
                        };
                    }
                } catch (error) {
                    console.warn('[lxmusic] 音源歌词失败，改走按歌名搜同款：', error);
                }
            }

            // 3) 按「歌名 + 歌手」在公开库里搜同款：别的平台的同一首歌也能有词。
            try {
                const fallback = await lxLyricBySearch(song.name, song.artists?.[0]?.name);
                if (fallback?.main) {
                    return {
                        lyrics: parseLrcToLyricData(fallback.main),
                        mainText: fallback.main,
                        translationText: fallback.translation ?? undefined,
                        isPureMusic: false,
                    };
                }
            } catch (error) {
                console.warn('[lxmusic] 按歌名找歌词失败：', error);
            }

            return { lyrics: null, isPureMusic: false };
        },
    },

    catalog: {
        // 歌手页：点一首歌的演唱者时现编 `lxartist:<平台>:<名字>` 的 ref（ref 只挂在歌曲上，
        // 集合里没有）。不声明 canResolveSongCatalogRefs —— 那是「集合里的歌手也都带 ref」的
        // 能力，声明了会把歌单/专辑页的歌手名变成不可点。
        async resolveSongCatalogRefs(song) {
            const parsed = platformOfSong(song);
            if (!parsed) return song;
            const platform = parsed.platform;
            if (!isPublicPlatform(platform)) return song;
            return {
                ...song,
                artists: song.artists.map((artist) => {
                    const name = artist.name.trim();
                    if (!name || name === '未知歌手') return artist;
                    return {
                        ...artist,
                        catalogRef: { providerId: 'lxmusic', kind: 'artist' as const, id: lxArtistId(platform, name) },
                    };
                }),
            };
        },
        async getArtistDetail(id) {
            const parsed = parseLxArtistId(id);
            if (!parsed) return null;
            return { providerId: 'lxmusic', id, name: parsed.name, type: 'artist' };
        },
        async getArtistSongs(id, limit, offset) {
            const parsed = parseLxArtistId(id);
            if (!parsed) return emptyPage(offset);
            const page = await lxApiSearchSongs(parsed.platform, parsed.name, limit, offset);
            const items = page.items
                .filter((item) => item.artists.some((artist) => lxArtistNameMatches(artist.name, parsed.name)))
                .map(toUnifiedSong);
            // nextOffset 按搜索这一页的原长度推进，过滤只会让这一页少几首，续页不会重复或跳。
            return { items, nextOffset: offset + page.items.length, hasMore: page.hasMore };
        },
        // 公开接口没有「歌手的专辑」，这一栏就是空的（歌手页自己会给空态）。
        async getArtistAlbums(_id, _limit, offset) {
            return emptyPage<ProviderCollection>(offset);
        },
        async getPlaylistTracks(id, limit, offset) {
            const take = limit ?? 50;
            const skip = offset ?? 0;
            // 「我的喜欢」是本机集合：不走平台，直接读点过喜欢的那份歌。
            if (String(id) === LX_LIKED_PLAYLIST_ID) {
                const all = getLxLikedUnifiedSongs();
                const items = all.slice(skip, skip + take);
                return { items, nextOffset: skip + items.length, hasMore: skip + items.length < all.length };
            }
            const chart = parseLxChartId(id);
            if (chart) {
                const page = await lxApiChartTracks(chart.platform, chart.chartId, take, skip);
                return toProviderPage(page, toUnifiedSong, skip, take);
            }
            const parsed = parseSongId(id);
            if (!parsed || !isPublicPlatform(parsed.platform)) return emptyPage<UnifiedSong>(offset);
            const page = await lxApiPlaylistTracks(parsed.platform, parsed.nativeId, limit, offset);
            return toProviderPage(page, toUnifiedSong, offset, limit);
        },
        async getPlaylistDetail(id, collection) {
            // 歌单卡片本身已经带着名字与封面；没有卡片时给一个能看的占位。
            if (collection) return collection;
            if (String(id) === LX_LIKED_PLAYLIST_ID) {
                return { providerId: 'lxmusic', id, name: '我的喜欢', type: 'playlist', trackCount: getLxLikedUnifiedSongs().length };
            }
            const parsed = parseSongId(id);
            if (!parsed) return null;
            return { providerId: 'lxmusic', id, name: '歌单', type: 'playlist' };
        },
        async getAlbumTracks(id, limit, offset) {
            const take = limit ?? 50;
            const skip = offset ?? 0;
            const parsed = parseSongId(id);
            if (!parsed || !isPublicPlatform(parsed.platform)) return emptyPage<UnifiedSong>(skip);
            if (parsed.nativeId.startsWith(LX_SAVED_ALBUM_PREFIX)) {
                // 这张「专辑」平台那侧没有 id 可查，只在本机收藏里存在：直接按专辑名取收藏。
                let albumName = '';
                try {
                    albumName = decodeURIComponent(parsed.nativeId.slice(LX_SAVED_ALBUM_PREFIX.length));
                } catch {
                    albumName = '';
                }
                const savedOnly = collectSavedByAlbumName(parsed.platform, albumName);
                const items = skip === 0 ? savedOnly.map(fromSavedSong) : [];
                return { items, nextOffset: skip + items.length, hasMore: false };
            }
            // 接口这层可能直接抛（平台拒绝、超时、返回结构不认识），一律不往上冒，
            // 否则整页会变成「加载失败 / 未知错误」——用户看到的就是"点进去没东西"。
            let raw: LxApiPage<LxApiSong> = { items: [], hasMore: false };
            try {
                raw = await lxApiAlbumTracks(parsed.platform, parsed.nativeId, take, skip);
            } catch {
                raw = { items: [], hasMore: false };
            }
            const page = { items: raw.items, hasMore: raw.hasMore };
            // 我在这个平台上收进本机、且属于这张专辑的歌（喜欢 + 自建歌单里都算）。
            const saved = collectSavedForAlbum(parsed.platform, parsed.nativeId);
            if (page.items.length === 0) {
                // 这家没有专辑曲目接口（酷我：几条公开路径全废）时别给一屏空白：
                // 同一张专辑的本地收藏直接兜住这一页。
                if (saved.length === 0) return toProviderPage(page, toUnifiedSong, skip, take);
                const items = saved.map(fromSavedSong);
                return { items, nextOffset: skip + items.length, hasMore: false };
            }
            const result = toProviderPage(page, toUnifiedSong, skip, take);
            if (skip > 0 || saved.length === 0) return result;
            // 接口给的专辑曲目未必含用户收藏的那个版本（不同版号、版权缺歌），
            // 收藏那几首提到最前，保证「从收藏进来」一定找得到自己那首。
            const shown = new Set(result.items.map(nativeKeyOfUnified));
            const extra = saved
                .filter((song) => !shown.has(`${song.platform}:${song.nativeId}`))
                .map(fromSavedSong);
            return extra.length === 0 ? result : { ...result, items: [...extra, ...result.items] };
        },
        async getAlbumDetail(id, collection) {
            if (collection) return collection;
            const parsed = parseSongId(id);
            if (!parsed) return null;
            if (parsed.nativeId.startsWith(LX_SAVED_ALBUM_PREFIX)) {
                try {
                    const albumName = decodeURIComponent(parsed.nativeId.slice(LX_SAVED_ALBUM_PREFIX.length));
                    if (albumName) return { providerId: 'lxmusic', id, name: albumName, type: 'album' };
                } catch {
                    // 名字解不开就走下面的兜底标题。
                }
            }
            return { providerId: 'lxmusic', id, name: '专辑', type: 'album' };
        },
    },
};

// 以下是给「洛雪工作台」页面用的：把平台侧的数据顺手暴露出去，页面不必再认识 lxmusicTransport。
export const lxBrowse = {
    platforms: LX_PUBLIC_PLATFORM_KEYS,
    charts: lxApiCharts,
    chartTracks: lxApiChartTracks,
    playlistSquare: lxApiPlaylistSquare,
    playlistTracks: lxApiPlaylistTracks,
    albumSquare: lxApiAlbumSquare,
    albumTracks: lxApiAlbumTracks,
    radioPrograms: lxApiRadioPrograms,
    searchSongs: lxApiSearchSongs,
    toSong: toUnifiedSong,
    toCollection: toProviderCollection,
};

// ---------------------------------------------------------------- 全局音源路由

/** 官方 provider 的 id → 洛雪自定义音源认的平台前缀。 */
const PROVIDER_TO_LX_PLATFORM: Record<string, LxPlatformKey> = {
    netease: 'wy',
    kugou: 'kg',
    qq: 'tx',
    kuwo: 'kw',
};

/**
 * 把任意在线歌曲临时包装成洛雪 provider 认的样子，只为「问音源要地址」这一次；
 * 队列里、界面上显示的仍是原来那首歌，sourceRef 不会被改写。
 */
const asLxSong = (song: SongResult): SongResult | null => {
    const ref = song.sourceRef;
    // 洛雪自己的歌本来就走这个 provider，别在这里重复问一次音源。
    if (ref?.kind !== 'online' || ref.providerId === 'lxmusic') return null;
    const platform = PROVIDER_TO_LX_PLATFORM[ref.providerId];
    if (!platform) return null;
    const raw = String(ref.mediaId ?? song.id);
    const separator = raw.indexOf(':');
    const nativeId = separator > 0 ? raw.slice(separator + 1) : raw;
    if (!nativeId) return null;
    const id = makeId(platform, nativeId);
    return {
        ...song,
        id,
        sourceRef: {
            kind: 'online',
            providerId: 'lxmusic',
            mediaId: String(id),
            providerData: { platform, nativeId },
        },
    };
};

/**
 * 装到 omni 的「取地址之前」扩展点：只要导入了音源，所有在线歌曲（不只是洛雪工作台里的）
 * 都先让音源续一次地址；音源交不出来就返回 null，官方 provider 照常接手。
 * 没导入音源、或用户在音源页关掉开关时，这一层几乎零开销地让路。
 */
export const installLxAudioRouting = (): void => {
    // 本机收藏灌回账号缓存：心形与「我喜欢」重启后还在。
    hydrateLxLocalLikes();
    installImportedAudioResolver(async (song, quality) => {
        if (!getLxPreferences().routeAllSongs) return null;
        const lxSong = asLxSong(song);
        if (!lxSong) return null;
        await lxSourceStore.ensureReady();
        if (!lxSourceStore.canResolveAny('musicUrl')) return null;
        console.info(`[lxmusic] 音源接管取地址：${song.name} (${song.sourceRef?.kind === 'online' ? song.sourceRef.providerId : '?'})`);
        return lxmusicProvider.playback?.getAudioSource(lxSong, quality) ?? null;
    });
};

// 不在模块加载时初始化音源仓库：providerRegistry 会被很多只做静态导入的模块拉进来
// （单测里还会 mock 掉本地数据库），顶层读存储会产生导入期副作用。音源页打开时调 init()，
// 真正取地址 / 取歌词前调 ensureReady()，两条路径都会按需把仓库准备好。
