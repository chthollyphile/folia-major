import type {
    FoliumJsonValue,
    FoliumSourceAudioQuality,
    FoliumSourceCollection,
    FoliumSourceDef,
    FoliumSourceLyricsResult,
    FoliumSourceLyricsTrack,
    FoliumSourceNamedRef,
    FoliumSourcePage,
    FoliumSourceSong,
    FoliumSourceUser,
} from '@folia/folium';
import { errorFields } from '@folia/folium-source-kit';
import {
    NeteaseLoginHttpError,
    httpErrorStatusOf,
    neteaseApi,
    resolveNeteaseSongAvailability,
    type NeteaseAnswer,
    type NeteaseNoCopyrightRecommendation,
    type NeteaseSongPrivilege,
} from './netease';
import { isNeteaseDesktop, neteaseEnv, neteaseError, neteaseTextKey, readNeteaseCookie } from './neteaseEnv';
import { collectNeteaseLoginDiagnostics } from './neteaseLoginDiagnostics';
import { describeNeteaseLoginFailure, neteaseCheckFailure } from './neteaseLoginFailure';
import { describeNeteaseFailure, isRefusedNeteaseAnswer, neteaseAnswerError, neteaseNoUrlError } from './neteaseFailure';
import { neteaseLocalService } from './neteaseLocalService';
import { createNeteaseExplore } from './neteaseExplore';
import { neteaseRaw } from './neteaseRaw';
import { neteaseCovers } from './neteaseCovers';
import { neteaseFmCatalog } from './neteaseFmCatalog';
import { canRunNeteaseSelfCheck, runNeteaseSelfCheck } from './neteaseSelfCheck';

// sources/netease/core/neteaseProvider.ts
// 网易云音乐的音源定义（folium.sources.register 收的那份）：每个能力族一组成员，形状是公开契约的。宿主的开关由实现了
// 哪些能力推导（适配层 parts.ts），和迁之前手写的开关表一致。
// 歌的 id 是网易云的数字 id 写成的文字（`String(id)`）：folium.omni 交给第三方模组的还是迁之前那个样子。网易云自己的
// 字段（fee、privilege、noCopyrightRcmd、resourceState、t，以及歌手的另一种写法）放在歌的 data 上，宿主连同歌一起存。

/** A NetEase id from the text the host hands: a finite number, or a refusal. */
export const toNeteaseId = (id: string | number): number => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId) || String(id).trim() === '') throw new Error(`Invalid NetEase id: ${String(id)}`);
    return numericId;
};

// How many ids one `/song/detail` request of `songs@1.getSongs` carries.
export const NETEASE_SONG_DETAIL_BATCH = 50;

const mapQuality = (quality: FoliumSourceAudioQuality): string => {
    if (quality === 'standard') return 'standard';
    if (quality === 'high') return 'exhigh';
    return quality;
};

/**
 * The `level`/`bitrate` pair the listening report carries, which is NetEase's own client vocabulary
 * and therefore stays inside this adapter. Defaults match the documented ones for `/scrobble/v1`.
 */
const mapScrobbleQuality = (quality?: FoliumSourceAudioQuality): { level: string; bitrate: number } => {
    if (quality === 'standard') return { level: 'standard', bitrate: 128 };
    if (quality === 'lossless') return { level: 'lossless', bitrate: 999 };
    if (quality === 'hires') return { level: 'hires', bitrate: 1999 };
    return { level: 'exhigh', bitrate: 320 };
};

const toFiniteNumber = (value: unknown): number | undefined => {
    if (value === null || value === undefined || value === '') return undefined;
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
};

/** One group of the style recommendation's styles (`{ categoryId, categoryName, tagVOList }`); tags without an id are left out. */
const normalizeDailyStyleGroup = (value: unknown): { id: string; name: string; tags: Array<{ id: string; name: string }> } => {
    const raw = value as NeteaseAnswer | null | undefined;
    return {
        id: raw?.categoryId != null ? String(raw.categoryId) : '',
        name: typeof raw?.categoryName === 'string' ? raw.categoryName : '',
        tags: (Array.isArray(raw?.tagVOList) ? raw.tagVOList : [])
            .filter((tag: any) => tag?.tagId != null)
            .map((tag: any) => ({ id: String(tag.tagId), name: typeof tag.tagName === 'string' ? tag.tagName : String(tag.tagId) })),
    };
};

const optionalText = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined);
/** A part of an answer as fields to read (none when it is no object). */
const asAnswer = (value: unknown): NeteaseAnswer => (value && typeof value === 'object' ? value : {});

/** The dates of the daily recommendations' history, in `data.dates` or `dates`. */
const datesIn = (response: unknown): unknown[] => {
    const answer = asAnswer(response);
    const dates: unknown = asAnswer(answer.data).dates || answer.dates;
    return Array.isArray(dates) ? dates : [];
};

const normalizeUser = (value: unknown): FoliumSourceUser => {
    const raw = value as NeteaseAnswer | null | undefined;
    const vipType = toFiniteNumber(raw?.vipType);
    const avatarUrl = optionalText(raw?.avatarUrl);
    const backgroundUrl = optionalText(raw?.backgroundUrl);
    return {
        id: String(raw?.userId ?? raw?.id ?? 0),
        nickname: String(raw?.nickname || ''),
        ...(avatarUrl ? { avatarUrl } : {}),
        ...(backgroundUrl ? { backgroundUrl } : {}),
        ...(vipType === undefined ? {} : { vipType }),
    };
};

// An artist or album NetEase gives without an id (a cloud upload's, a name in a string) is named, never opened.
const namedRef = (id: unknown, name: string): FoliumSourceNamedRef => {
    const numeric = Number(id);
    return Number.isFinite(numeric) && numeric > 0 ? { id: String(numeric), name } : { id: '', name, ref: false };
};

const normalizeArtistSummary = (value: unknown): FoliumSourceNamedRef | null => {
    const raw = value as NeteaseAnswer | null | undefined;
    const name = String(raw?.name || '');
    return name ? namedRef(raw?.id, name) : null;
};

const normalizeStringList = (value: unknown): string[] => (
    Array.isArray(value)
        ? value.map(item => String(item || '')).filter(Boolean)
        : []
);

// 网易云 `/user/playlist` 给「我喜欢的音乐」的标记：`specialType: 5`（普通歌单是 0）。
const NETEASE_LIKED_PLAYLIST_SPECIAL_TYPE = 5;

/**
 * `/user/playlist` 的条目是不是这个账号自己的「我喜欢的音乐」：`specialType: 5` 且创建者就是这个账号。
 * 收藏的别人的「喜欢的音乐」也是 5，标成 isLiked 会让「从歌单移除」变成取消自己账号的喜欢，所以必须比对创建者。
 */
const isOwnNeteaseLikedPlaylist = (value: unknown, userId: string): boolean => {
    const raw = value as NeteaseAnswer | null | undefined;
    if (Number(raw?.specialType) !== NETEASE_LIKED_PLAYLIST_SPECIAL_TYPE) return false;
    const creatorId = raw?.creator?.userId ?? raw?.userId;
    return creatorId !== undefined && creatorId !== null && String(creatorId) === userId;
};

export const normalizeNeteaseCollection = (value: unknown, type = 'playlist'): FoliumSourceCollection => {
    const raw = value as NeteaseAnswer | null | undefined;
    const artists = (Array.isArray(raw?.artists)
        ? raw.artists
        : raw?.artist
            ? [raw.artist]
            : [])
        .map(normalizeArtistSummary)
        .filter((artist: FoliumSourceNamedRef | null): artist is FoliumSourceNamedRef => Boolean(artist));
    const aliases = normalizeStringList(raw?.alias || raw?.aliases);
    const publishedAt = Number(raw?.publishedAt ?? raw?.publishTime);
    const playCount = Number(raw?.playCount);
    const updatedAt = Number(raw?.updatedAt ?? raw?.updateTime);
    const tracksUpdatedAt = Number(raw?.tracksUpdatedAt ?? raw?.trackUpdateTime);
    const coverUrl = optionalText(raw?.coverUrl || raw?.coverImgUrl || raw?.picUrl);
    const description = optionalText(raw?.description || raw?.briefDesc || raw?.briefDescription || raw?.copywriter);
    const trackCount = toFiniteNumber(raw?.trackCount ?? raw?.size);
    const publisher: unknown = raw?.publisher || raw?.company;
    // 网易云的专辑对象自己带一个 `type`，是它的发行类型（「专辑」「EP/Single」这类），不是集合的种类：
    // 按专辑或歌手读到的就是专辑或歌手。别的取 raw.type（文字的才算：网易云有的列表里它是数字），没有就看 specialType。
    const kind = type === 'album' || type === 'artist'
        ? type
        : (typeof raw?.type === 'string' && raw.type) || (raw?.specialType === 'cloud' ? 'cloud' : type);

    return {
        id: String(raw?.id ?? 0),
        name: String(raw?.name || ''),
        type: kind,
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description } : {}),
        ...(trackCount === undefined ? {} : { trackCount }),
        ...(type === 'artist' && Number(raw?.albumSize) > 0 ? { albumCount: Number(raw?.albumSize) } : {}),
        ...(raw?.creator ? { creator: normalizeUser(raw.creator) } : {}),
        ...(artists.length > 0 ? { artists } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(Number.isFinite(publishedAt) && publishedAt > 0 ? { publishedAt } : {}),
        ...(typeof publisher === 'string' && publisher ? { publisher } : {}),
        ...(Number.isFinite(playCount) && playCount >= 0 ? { playCount } : {}),
        ...(Number.isFinite(updatedAt) && updatedAt > 0 ? { updatedAt } : {}),
        ...(Number.isFinite(tracksUpdatedAt) && tracksUpdatedAt > 0 ? { tracksUpdatedAt } : {}),
        ...(raw?.specialType === 'liked' || raw?.isLiked === true ? { isLiked: true } : {}),
    };
};

// cloudsearch 给每位歌手附上的译名（`tns`）和别名（`alias`）：Oasis 的 tns 是「绿洲乐队」，陈奕迅的
// alias 是「Eason Chan」，而别的歌词源常只认其中一种写法。名字里有非拉丁字母的歌手取第一个拉丁字母
// 的写法，否则取第一个带非拉丁字母的写法：王菲的 alias 先列旧名「王靖雯」，再列「Faye Wong」。
// 一位歌手都没有另一种写法时为空。song_detail 的歌手不带这两个字段，那里来的歌就没有。
const NON_LATIN_LETTER = /[^\p{Script=Latin}\p{Script=Common}\p{Script=Inherited}]/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const otherArtistNamesOf = (raw: unknown): string => {
    const record = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
    const base = record.simpleSong && typeof record.simpleSong === 'object' ? record.simpleSong : record;
    const rawArtists = Array.isArray(base.ar) ? base.ar : (Array.isArray(base.artists) ? base.artists : []);
    const names: Array<{ name: string; other?: string }> = (rawArtists as Array<NeteaseAnswer | null>).map((artist: NeteaseAnswer | null) => {
        const name = String(artist?.name || '').trim();
        if (!name) return { name };
        const wantsLatin = NON_LATIN_LETTER.test(name);
        const other = [artist?.tns, artist?.alias]
            .flatMap(list => Array.isArray(list) ? list : [])
            .map(value => String(value ?? '').trim())
            .find(value => value && value !== name && (wantsLatin
                ? LATIN_LETTER.test(value) && !NON_LATIN_LETTER.test(value)
                : NON_LATIN_LETTER.test(value)));
        return other ? { name, other } : { name };
    });
    return names.some(entry => entry.other)
        ? names.map(entry => entry.other ?? entry.name).filter(Boolean).join(', ')
        : '';
};

const asJson = (value: unknown): FoliumJsonValue => JSON.parse(JSON.stringify(value)) as FoliumJsonValue;

/** The source's song from NetEase's answer (a raw song, a cloud entry, or one this transport already read). */
export const normalizeNeteaseSong = (raw: unknown): FoliumSourceSong => {
    const song = neteaseApi.normalizeSongResult(raw);
    const isCloud = song.t === 1 || song.t === 2 || song.sourceType === 'cloud';
    const otherArtistNames = otherArtistNamesOf(raw);
    const data: Record<string, FoliumJsonValue> = {};
    if (typeof song.fee === 'number') data.fee = song.fee;
    if (song.privilege) data.privilege = asJson(song.privilege);
    if (song.noCopyrightRcmd) data.noCopyrightRcmd = asJson(song.noCopyrightRcmd);
    if (typeof song.resourceState === 'boolean') data.resourceState = song.resourceState;
    if (song.t === 1 || song.t === 2) data.t = song.t;
    if (otherArtistNames) data.otherArtistNames = otherArtistNames;
    const albumName = song.album.name || '';
    return {
        id: String(song.id),
        title: song.name,
        artists: song.artists.map(artist => namedRef(artist.id, artist.name)),
        album: {
            ...namedRef(song.album.id, albumName),
            ...(song.album.coverUrl ? { coverUrl: song.album.coverUrl } : {}),
        },
        durationMs: Number.isFinite(song.durationMs) && song.durationMs > 0 ? song.durationMs : 0,
        ...(song.aliases.length ? { aliases: song.aliases.map(String) } : {}),
        ...(song.translatedNames.length ? { translatedTitles: song.translatedNames.map(String) } : {}),
        ...(isCloud ? { variant: 'cloud' } : {}),
        ...(Object.keys(data).length > 0 ? { data } : {}),
    };
};

/** What NetEase said of the song's rights, as it was kept on the song's data. */
const neteaseFieldsOf = (song: FoliumSourceSong): { privilege?: NeteaseSongPrivilege; noCopyrightRcmd?: NeteaseNoCopyrightRecommendation | null } => {
    const data = song.data ?? {};
    const privilege = data.privilege && typeof data.privilege === 'object' && !Array.isArray(data.privilege)
        ? data.privilege as NeteaseSongPrivilege
        : undefined;
    const noCopyrightRcmd = data.noCopyrightRcmd && typeof data.noCopyrightRcmd === 'object' && !Array.isArray(data.noCopyrightRcmd)
        ? data.noCopyrightRcmd as NeteaseNoCopyrightRecommendation
        : null;
    return { ...(privilege ? { privilege } : {}), noCopyrightRcmd };
};

// `/user/record`'s type and the field its rows come in, a span each.
type ListeningRankRange = 'week' | 'all';
const LISTENING_RANK_RANGES: readonly ListeningRankRange[] = ['week', 'all'];
const NETEASE_LISTENING_RANK: Record<ListeningRankRange, { type: 0 | 1; rows: 'weekData' | 'allData' }> = {
    week: { type: 1, rows: 'weekData' },
    all: { type: 0, rows: 'allData' },
};

/** A play count NetEase gave, on the row read from its ranking; anything else leaves the song as it is. */
const withListenCount = (song: FoliumSourceSong, count: unknown): FoliumSourceSong => {
    const value = Number(count);
    return count !== null && count !== undefined && count !== '' && Number.isFinite(value) && value >= 0
        ? { ...song, row: { ...song.row, listenCount: Math.floor(value) } }
        : song;
};

/**
 * A user's listening ranking over a span, in NetEase's order. Only the signed-in account's own is
 * read: NetEase answers -2 (无权限访问) where the asker may not see it, which for one's own ranking
 * is a request that came without the sign-in (an anonymous one is answered so). It fails like any
 * other refusal, rather than reading as a ranking with no songs.
 */
const readNeteaseListeningRank = async (userId: string, range: ListeningRankRange): Promise<FoliumSourceSong[]> => {
    const { type, rows } = NETEASE_LISTENING_RANK[range];
    const response = await neteaseApi.getUserRecord(toNeteaseId(userId), type);
    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the listening ranking');
    const list = response?.[rows];
    if (!Array.isArray(list)) throw neteaseError('invalid-response', `NetEase returned no listening ranking (${rows})`);
    return list
        .filter((row: any) => row?.song && typeof row.song === 'object')
        .map((row: any) => withListenCount(normalizeNeteaseSong(row.song), row.playCount));
};

/**
 * The entry for one span of a user's ranking. Its id names the user: the songs of one account's
 * ranking are never shown, or kept, as another's. Named in the app's language, as it is shown among the playlists.
 */
const listeningRankCollection = (user: FoliumSourceUser, range: ListeningRankRange, songs: readonly FoliumSourceSong[]): FoliumSourceCollection => {
    const coverUrl = songs.find(song => song.album?.coverUrl)?.album?.coverUrl || user.avatarUrl;
    return {
        id: `listening-rank-${range}-${user.id}`,
        type: 'listening_rank',
        listeningRank: range,
        name: neteaseEnv().translate(`listeningRank.${range}`),
        description: neteaseEnv().translate('listeningRank.description'),
        ...(coverUrl ? { coverUrl } : {}),
        trackCount: songs.length,
        isOwned: false,
        creator: user,
    };
};

// The sign-in is the cookie the page store keeps (neteaseEnv.ts). It goes at once. dev/dedicatus/credentialWriters.mjs
// lists this function and checkLogin as the only writers of `cookie`.
const dropNeteaseSignIn = (): void => {
    neteaseEnv().pageStore('netease').set('cookie', null);
};

// 最近一次读登录状态时页面里存着的 cookie，没有就是 null。登录失效时只删它（signInRanOut）。
let cookieAskedWith: string | null = null;

// 扫码的请求没有得到预期的回答时，给日志和失败的那一行：返回码和后端的原话。
const describeQrResponse = (response: any): string => (
    `code ${response?.code ?? 'none'}: ${response?.message || response?.msg || 'no message'}`
);

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

// 最近一次读登录状态的结论。扫码确认之后账号没读出来时，诊断报告靠它说是哪一个接口没给登录状态。
let lastLoginStatusCheck: string | null = null;
const noteLoginStatusCheck = (summary: string): void => {
    lastLoginStatusCheck = `${new Date().toISOString().slice(11, 23)} ${summary}`;
};

// 只有网易云明说的才算：回答的码是 301、401、403（没有登录），或是 200（有没有人看回答里的用户）。别的回答都是这一次
// 没问到谁登录着：本地后端连不上网易云时的 502、网易云的 5xx、风控的 -462，还有没有码的 HTTP 错误（比如远程 API 前面
// 网关自己的回答）。这时抛 'unavailable' 的错（neteaseAnswerError）：宿主只把这次读记为失败，cookie 留着。
// 当成没有人登录，会删掉一个还有效的登录。
const throwIfLoginCheckRefused = (response: any, route: string): void => {
    const code = Number(response?.code ?? response?.data?.code);
    if ([301, 401, 403].includes(code) || (code === 200 && httpErrorStatusOf(response) === undefined)) return;
    noteLoginStatusCheck(`${route} code=${code} refused`);
    throw neteaseAnswerError(response, route);
};

const extractCloudLyricText = (response: any): string => (
    response?.lrc || response?.data?.lrc || response?.lyric || response?.data?.lyric || ''
);

type ChorusRange = { startTime: number; endTime: number };

/** `/song/chorus`'s spans, in seconds; none for an answer that is no success. */
export const parseNeteaseChorusRanges = (value: unknown): ChorusRange[] => {
    const chorusRes = value as NeteaseAnswer | null | undefined;
    if (!chorusRes || chorusRes.code !== 200) return [];
    const ranges: unknown = chorusRes.chorus || chorusRes.data || [];
    if (!Array.isArray(ranges) || ranges.length === 0) return [];
    return ranges
        .map((range: NeteaseAnswer) => ({ startTime: (range.startTime ?? 0) / 1000, endTime: (range.endTime ?? 0) / 1000 }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};

const neteaseChorusRangesCache = new Map<string, Promise<ChorusRange[]>>();

const getNeteaseChorusRanges = async (songId: string): Promise<ChorusRange[]> => {
    const parsedId = toNeteaseId(songId);
    const cacheKey = String(parsedId);
    const cached = neteaseChorusRangesCache.get(cacheKey);
    if (cached) return cached;

    const request = Promise.resolve(neteaseApi.getChorus(parsedId))
        .then(parseNeteaseChorusRanges)
        .catch((error) => {
            console.warn(`[NeteaseProvider] Failed to fetch chorus ranges for song ${songId}:`, errorFields(error));
            return [];
        });
    neteaseChorusRangesCache.set(cacheKey, request);
    return request;
};

// 网易云的 lrc 里有时是逐字的增强 LRC（用户上传的歌词）：宿主不替音源猜格式（lyrics@1），迁之前宿主看 lrc 的正文
// 分 lrc 和增强 LRC，这里照那两条规则说出来。
const ENHANCED_LRC_ANGLE = /<\d{2}:\d{2}[.:]\d{2,3}>/;
const ENHANCED_LRC_INLINE_BRACKET = /(?:^|\n)\s*\[\d{2}:\d{2}[.:]\d{2,3}\][^[\]\n]+(?:\[\d{2}:\d{2}[.:]\d{2,3}\][^[\]\n]*)+/m;
export const neteaseLrcFormatOf = (text: string): 'lrc' | 'enhanced-lrc' => (
    ENHANCED_LRC_ANGLE.test(text) || ENHANCED_LRC_INLINE_BRACKET.test(text) ? 'enhanced-lrc' : 'lrc'
);

const branchText = (branch: unknown): string => {
    const lyric = branch && typeof branch === 'object' ? (branch as { lyric?: unknown }).lyric : undefined;
    return typeof lyric === 'string' ? lyric : '';
};

/**
 * `/lyric/new`'s answer as the source's tracks: the line-timed `lrc` with `tlyric` and `romalrc`, the word-timed `yrc`
 * with its own `ytlrc` and `yromalrc` (without them it borrows the line-timed ones, as the host's reading did).
 */
export const neteaseLyricsOf = (payload: unknown): FoliumSourceLyricsResult => {
    const source = (payload ?? {}) as NeteaseAnswer;
    const mainText = branchText(source.lrc);
    const lrc = asAnswer(source.lrc);
    const yrcText = branchText(source.yrc) || branchText(lrc.yrc);
    const ytlrc = branchText(source.ytlrc) || branchText(lrc.ytlrc);
    const yromalrc = branchText(source.yromalrc) || branchText(lrc.yromalrc);
    const tlyric = branchText(source.tlyric);
    const romalrc = branchText(source.romalrc) || branchText(lrc.romalrc);
    const flagged = Boolean(source.pureMusic || lrc.pureMusic || asAnswer(source.yrc).pureMusic || asAnswer(source.ytlrc).pureMusic || asAnswer(source.tlyric).pureMusic);
    const isPureMusic = flagged || (mainText ? neteaseEnv().isPureMusicText(mainText) : false);
    // An instrumental song has no lyrics to show, whatever line its text carries ("纯音乐，请欣赏"): no tracks, as the
    // host's reading handed no lyrics for it (folium.omni.getLyrics tells it as no lines).
    if (isPureMusic) return { isPureMusic: true };
    const main: FoliumSourceLyricsTrack | undefined = mainText ? {
        format: neteaseLrcFormatOf(mainText),
        text: mainText,
        ...(tlyric ? { translationText: tlyric } : {}),
        ...(romalrc ? { romanizationText: romalrc } : {}),
    } : undefined;
    const wordByWord: FoliumSourceLyricsTrack | undefined = yrcText ? {
        format: 'yrc',
        text: yrcText,
        ...(ytlrc ? { translationText: ytlrc } : {}),
        ...(yromalrc ? { romanizationText: yromalrc } : {}),
    } : undefined;
    return {
        ...(main ? { main } : {}),
        ...(wordByWord ? { wordByWord } : {}),
    };
};

const getLyrics = async (song: FoliumSourceSong, context?: { userId?: string | null }): Promise<FoliumSourceLyricsResult> => {
    if (song.variant === 'cloud' && context?.userId != null) {
        const response = await neteaseApi.getCloudLyric(toNeteaseId(context.userId), toNeteaseId(song.id));
        const result = neteaseLyricsOf({ lrc: { lyric: extractCloudLyricText(response) } });
        return { ...result, chorusRanges: await getNeteaseChorusRanges(song.id) };
    }

    const response = await neteaseApi.getLyric(toNeteaseId(song.id));
    const result = neteaseLyricsOf(neteaseApi.getProcessedLyricPayload(response));
    return { ...result, chorusRanges: await getNeteaseChorusRanges(song.id) };
};

// 歌手的另一种写法（normalizeNeteaseSong 从 cloudsearch 的 tns / alias 里挑出存在 data 上的），和现在的
// 写法一样时不算另一个名字。
const getNeteaseAlternateArtistName = (song: FoliumSourceSong): Promise<string | null> => {
    const other = song.data?.otherArtistNames;
    if (typeof other !== 'string' || !other) return Promise.resolve(null);
    return Promise.resolve(other === song.artists.map(artist => artist.name).join(', ') ? null : other);
};

// A NetEase song's id: a positive whole number, written as text. Lyrics of a local song matched to one are fetched by it.
const songIdOf = (id: string): string | null => {
    const text = id.trim();
    if (!/^\d+$/.test(text)) return null;
    const value = Number(text);
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
};

/** NetEase's list of songs as the source's songs; none where it gave no list. */
const songsIn = (list: unknown): FoliumSourceSong[] => (Array.isArray(list) ? list.map(normalizeNeteaseSong) : []);

/** NetEase's list of playlists, albums or artists as the source's collections; none where it gave no list. */
const collectionsIn = (list: unknown, type?: string): FoliumSourceCollection[] => (
    Array.isArray(list) ? list.map(raw => normalizeNeteaseCollection(raw, type)) : []
);

const pageOf = <T>(items: T[], offset: number, hasMore: boolean, total?: number): FoliumSourcePage<T> => ({
    items, hasMore, nextOffset: offset + items.length, ...(total === undefined ? {} : { total }),
});

const idOf = (value: string | { id: string }): string => (typeof value === 'object' ? value.id : value);

/** The source (`netease`). */
export const createNeteaseSource = (): FoliumSourceDef => {
    const getLikedSongIds = async (userId: string) => {
        const response = await neteaseApi.getLikedSongs(toNeteaseId(userId));
        // The API layer hands error bodies back instead of throwing. Answering one with an empty
        // list would tell the caller the account likes nothing.
        const code = Number(response?.code);
        if ([301, 401, 403].includes(code)) {
            throw neteaseError('auth-required', 'NetEase rejected the liked-songs request: not signed in', { code });
        }
        if (code !== 200 || !Array.isArray(response.ids)) {
            throw neteaseError('unavailable', `NetEase returned no liked-songs list (code ${response.code})`, { code });
        }
        // One request brings the whole list.
        return { ids: response.ids.map((id: unknown) => String(id)), whole: true };
    };

    return {
        id: 'netease',
        displayName: neteaseTextKey('name.lyrics'),
        shortName: neteaseTextKey('name.short'),
        mark: { letter: '云', color: '#dc2626' },
        describeFailure: describeNeteaseFailure,
        capabilities: {
            'search@1': {
                async searchSongs(query, limit, offset) {
                    const response = await neteaseApi.cloudSearch(query, limit, offset);
                    const items = songsIn(asAnswer(response.result).songs);
                    const total = Number(asAnswer(response.result).songCount || items.length);
                    return pageOf(items, offset, offset + items.length < total, total);
                },
                // 专辑和歌单的条目与 `/album`、`/playlist/detail` 读到的同一套字段（2026-10-31 实测），按同样的规则正规化。
                async searchAlbums(query, limit, offset) {
                    const response = await neteaseApi.cloudSearch(query, limit, offset, 10);
                    const items = collectionsIn(asAnswer(response.result).albums, 'album');
                    const total = Number(asAnswer(response.result).albumCount || items.length);
                    return pageOf(items, offset, items.length > 0 && offset + items.length < total, total);
                },
                async searchPlaylists(query, limit, offset) {
                    const response = await neteaseApi.cloudSearch(query, limit, offset, 1000);
                    const items = collectionsIn(asAnswer(response.result).playlists, 'playlist');
                    const total = Number(asAnswer(response.result).playlistCount || items.length);
                    return pageOf(items, offset, items.length > 0 && offset + items.length < total, total);
                },
            },
            'songs@1': {
                metadataMatch: true,
                async getSong(id) {
                    const response = await neteaseApi.getSongDetail(toNeteaseId(id));
                    const raw = response?.songs?.[0];
                    return raw ? normalizeNeteaseSong(raw) : null;
                },
                // `/song/detail` takes many ids at once. Asked NETEASE_SONG_DETAIL_BATCH at a time, one
                // request after another; its songs are matched to the ids by id, since it leaves out an id
                // it has no song by. An id that is no number names no NetEase song: null, without asking.
                // An answer with another code than 200 (the local backend's 502 where it cannot reach
                // NetEase, NetEase refusing or limiting the request) says nothing of which songs exist: the
                // whole call rejects, as getAudioSource does, instead of answering null for every id.
                async getSongs(ids) {
                    const numericIds = ids.map((id) => {
                        const numericId = Number(id);
                        return Number.isFinite(numericId) && id.trim() !== '' ? numericId : null;
                    });
                    const asked = [...new Set(numericIds.filter((id): id is number => id !== null))];
                    const found = new Map<number, FoliumSourceSong>();
                    for (let start = 0; start < asked.length; start += NETEASE_SONG_DETAIL_BATCH) {
                        const response = await neteaseApi.getSongDetail(asked.slice(start, start + NETEASE_SONG_DETAIL_BATCH));
                        if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the song details');
                        for (const raw of response?.songs ?? []) {
                            const songId = Number(raw?.id);
                            if (Number.isFinite(songId)) found.set(songId, normalizeNeteaseSong(raw));
                        }
                    }
                    return numericIds.map(id => (id === null ? null : found.get(id) ?? null));
                },
                songsPerRequest: NETEASE_SONG_DETAIL_BATCH,
                getAvailability(song) {
                    return resolveNeteaseSongAvailability(neteaseFieldsOf(song));
                },
                async getReplacement(song) {
                    const replacement = await neteaseApi.getUnavailableSongReplacement({ id: toNeteaseId(song.id), ...neteaseFieldsOf(song) });
                    if (!replacement?.replacementSong) return null;
                    return {
                        song: normalizeNeteaseSong(replacement.replacementSong),
                        ...(replacement.typeDesc ? { label: replacement.typeDesc } : {}),
                    };
                },
                getPageUrl(song) {
                    return song.id ? `https://music.163.com/#/song?id=${encodeURIComponent(song.id)}` : null;
                },
            },
            'playback.audio@1': {
                async getAudioSource(song, quality) {
                    const response = await neteaseApi.getSongUrl(toNeteaseId(song.id), mapQuality(quality));
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the song URL');
                    const raw = response?.data?.[0];
                    const rawUrl = raw?.url;
                    if (!rawUrl) throw neteaseNoUrlError(raw?.code, raw?.fee);
                    // 这个账号只能听一段试听（会员歌曲）：网易云给的是那一段的地址，freeTrialInfo 里是它在整首里的起止。
                    // 地址照给，标成试听：播放照放并提示，缓存不收它。
                    // 只认一个对象。上游的两条解锁路都写成别的，那是整首：server.js 的通用解锁写 JS 的 null，
                    // module/song_url_v1.js 带 unblock=true 时写字符串 'null'。
                    const preview = typeof raw?.freeTrialInfo === 'object' && raw.freeTrialInfo !== null;
                    const trackGain = toFiniteNumber(raw?.gain);
                    return {
                        url: String(rawUrl).replace(/^http:/, 'https:'),
                        quality,
                        ...(preview ? { preview } : {}),
                        ...(trackGain === undefined ? {} : { replayGain: { trackGain } }),
                    };
                },
            },
            'reports@1': {
                // Cloud-disk tracks are excluded outright: an unmatched upload carries a cloud id that names
                // no track in the catalogue, and reporting one is reporting a play of a song that does not
                // exist. So is an id that is not a positive number.
                canReport(song) {
                    if (song.variant === 'cloud') return false;
                    return /^\d+$/.test(song.id) && Number(song.id) > 0;
                },
                async report(song, report) {
                    const { level, bitrate } = mapScrobbleQuality(report.quality);
                    const response = await neteaseApi.scrobbleV1({
                        id: toNeteaseId(song.id),
                        time: Math.round(report.playedSeconds),
                        name: song.title || undefined,
                        artist: song.artists.map(artist => artist.name).filter(Boolean).join(', ') || undefined,
                        level,
                        bitrate,
                        ...(report.totalSeconds ? { total: Math.round(report.totalSeconds) } : {}),
                    });
                    // Absence of a status code is a failure, not a success. `fetchWithCreds` does not check
                    // `res.ok`, so a gateway error page or an API build without this route comes back as
                    // perfectly valid JSON with no `code` at all - and defaulting that to 200 would print
                    // "reported a play" for a play that no server ever accepted.
                    const code = Number(response?.code);
                    if (!Number.isFinite(code)) {
                        throw neteaseError('unavailable', 'NetEase returned no status code for the listening report');
                    }
                    if ([301, 401, 403].includes(code)) {
                        throw neteaseError('auth-required', 'NetEase rejected the listening report: not signed in', { code });
                    }
                    if (code !== 200) {
                        throw neteaseError('unavailable', `NetEase rejected the listening report: code ${code}`, { code });
                    }
                },
            },
            'lyrics@1': {
                crossSource: { name: neteaseTextKey('name.lyrics') },
                getLyrics,
                getChorusRanges: getNeteaseChorusRanges,
                getAlternateArtistName: getNeteaseAlternateArtistName,
                songIdOf,
            },
            'auth@1': {
                getLoginTexts: () => ({ title: neteaseTextKey('login.title'), note: neteaseTextKey('login.note') }),
                // Only the desktop app runs the API itself; the web build sends to its configured address.
                ...(isNeteaseDesktop() ? { localService: neteaseLocalService } : {}),
                async getLoginStatus() {
                    cookieAskedWith = readNeteaseCookie() || null;
                    const loginResponse = await neteaseApi.getLoginStatus();
                    throwIfLoginCheckRefused(loginResponse, 'login/status');
                    const loginProfile = loginResponse?.data?.profile;
                    const loginCode = Number(loginResponse?.code ?? loginResponse?.data?.code);
                    if (!loginProfile || [301, 401, 403].includes(loginCode)) {
                        noteLoginStatusCheck(`login/status code=${loginCode} profile=${yesNo(Boolean(loginProfile))}`);
                        return null;
                    }

                    const accountResponse = await neteaseApi.getUserAccount();
                    throwIfLoginCheckRefused(accountResponse, 'user/account');
                    const accountCode = Number(accountResponse?.code ?? accountResponse?.data?.code);
                    const accountProfile = accountResponse?.profile;
                    const accountId = accountResponse?.account?.id ?? accountProfile?.userId;
                    const loginId = loginProfile?.userId ?? loginProfile?.id;
                    const sameUser = Boolean(accountId && loginId && String(accountId) === String(loginId));
                    if (!accountProfile || [301, 401, 403].includes(accountCode) || !sameUser) {
                        noteLoginStatusCheck(`user/account code=${accountCode} profile=${yesNo(Boolean(accountProfile))} same-user=${yesNo(sameUser)}`);
                        return null;
                    }

                    // 这里不写 cookie：登录状态的回答不带 cookie（上游 login_status 的回答正文里没有），真带了也只会是
                    // 那一次请求的 Set-Cookie，可能没有 MUSIC_U，会盖掉扫码时存下的登录。cookie 只在扫码确认时写（checkLogin）。
                    noteLoginStatusCheck(`signed in (login/status code=${loginCode}, user/account code=${accountCode})`);
                    return normalizeUser({ ...loginProfile, ...accountProfile });
                },
                // The request to NetEase takes the cookie as it is when it is made (`neteaseApi.logout`),
                // and the cookie goes at once, before the first wait and whatever NetEase answers: what
                // asks whether an account is signed in (the explore page) finds none from then on.
                async logout() {
                    const told = neteaseApi.logout();
                    dropNeteaseSignIn();
                    await told;
                },
                // 登录失效：读登录状态说没有人登录之后。只删那一次问的 cookie，存着的已经换了就不删：
                // 回答还在路上时扫码登录写下的新 cookie，那个回答说的不是它，留着。
                signInRanOut() {
                    if ((readNeteaseCookie() || null) === cookieAskedWith) {
                        dropNeteaseSignIn();
                        return;
                    }
                    console.log('[NeteaseProvider] The sign-in that ran out was replaced meanwhile: the new cookie stays');
                },
                showsKeptAccountAtStart: true,
                // 扫码三步：要码（unikey）→ 生成二维码图片 → 检查。没拿到 key 或图片就在那一步失败：空 key 去检查只会
                // 被拒绝，空图片会让登录窗口一直转圈。失败带着网易云的回答（cause），日志里看得到它回了什么。
                async startLogin() {
                    const response = await neteaseApi.getQrKey();
                    const key = response?.data?.unikey;
                    if (!key) throw neteaseError('invalid-response', `NetEase gave no QR key: ${describeQrResponse(response)}`, response);
                    return String(key);
                },
                async createQr(key) {
                    const response = await neteaseApi.createQr(key);
                    const image = String(response?.data?.qrimg || '');
                    if (image) return image;
                    throw neteaseError('invalid-response', `NetEase QR image request failed: ${describeQrResponse(response)}`, response);
                },
                async checkLogin(key) {
                    let response: any;
                    try {
                        response = await neteaseApi.checkQr(key);
                    } catch (error) {
                        // 本地后端没能连上网易云（它回 502）：这一次检查没拿到网易云的回答，码在网易云那边还有效，接着检查。
                        if (error instanceof NeteaseLoginHttpError && error.httpStatus === 502) {
                            const failure = describeNeteaseLoginFailure('check', error);
                            return {
                                state: 'error',
                                message: `HTTP 502: ${describeQrResponse(error.answer)}`,
                                ...(failure ? { failure } : {}),
                                transient: true,
                            };
                        }
                        throw error;
                    }
                    switch (response?.code) {
                        case 800: return { state: 'expired' };
                        case 801: return { state: 'waiting' };
                        case 802: return { state: 'scanned' };
                        case 803:
                            if (typeof response?.cookie === 'string' && response.cookie) {
                                neteaseEnv().pageStore('netease').set('cookie', String(asAnswer(response).cookie));
                            }
                            return { state: 'confirmed' };
                        // 带上原始状态码：只剩 state 的话，日志里看不出网易云回的是哪一个码（风控的 8821 等）。
                        default: return { state: 'error', message: describeQrResponse(response), failure: neteaseCheckFailure(response) };
                    }
                },
                describeLoginFailure: describeNeteaseLoginFailure,
                getLoginDiagnostics: () => collectNeteaseLoginDiagnostics(lastLoginStatusCheck),
                canRunLoginSelfCheck: canRunNeteaseSelfCheck,
                runLoginSelfCheck: runNeteaseSelfCheck,
            },
            'library@1': {
                async getUserPlaylists(userId, limit, offset) {
                    const response = await neteaseApi.getUserPlaylists(toNeteaseId(userId), limit, offset);
                    // 只有用户歌单列表知道「这是谁的歌单」，「我喜欢的音乐」在这里标 isLiked；归一化结果带着它进缓存，回灌时照样保留。
                    const items = collectionsIn(Array.isArray(response.playlist)
                        ? response.playlist.map((item: NeteaseAnswer) => (isOwnNeteaseLikedPlaylist(item, userId) ? { ...item, isLiked: true } : item))
                        : []);
                    return pageOf(items, offset, items.length === limit);
                },
                getLikedSongIds,
                // NetEase has no smaller request for the count that this adapter knows to be of the same
                // list: the count is the length of the list itself, read as above.
                async getLikedSongCount(userId) {
                    return (await getLikedSongIds(userId)).ids.length;
                },
                async getUserAlbums(_userId, limit, offset) {
                    const response = await neteaseApi.getFavoriteAlbums(limit, offset);
                    const items = collectionsIn(response.data, 'album');
                    return pageOf(items, offset, Boolean(response.hasMore));
                },
                async getCloudCollection(user) {
                    const response = await neteaseApi.getUserCloud(1, 0);
                    const trackCount = Number(response?.count || 0);
                    if (trackCount <= 0) return null;
                    const firstSong = response?.songs?.[0] ? normalizeNeteaseSong(response.songs[0]) : null;
                    // The entry is named in the app's language, as it is shown among the playlists.
                    return normalizeNeteaseCollection({
                        id: -100,
                        name: neteaseEnv().translate('cloud.name'),
                        description: neteaseEnv().translate('cloud.description'),
                        specialType: 'cloud',
                        coverImgUrl: firstSong?.album?.coverUrl || user?.avatarUrl,
                        trackCount,
                        ...(user ? { creator: { userId: user.id, nickname: user.nickname, avatarUrl: user.avatarUrl, vipType: user.vipType } } : {}),
                    }, 'cloud');
                },
                async getListeningRankCollections(user) {
                    const ranked = await Promise.all(LISTENING_RANK_RANGES.map(async range => ({ range, songs: await readNeteaseListeningRank(user.id, range) })));
                    const entries = ranked
                        .filter(({ songs }) => songs.length > 0)
                        .map(({ range, songs }) => listeningRankCollection(user, range, songs));
                    console.info('[NeteaseProvider] Listening ranking read', { entries: entries.map(entry => `${entry.listeningRank}:${entry.trackCount}`) });
                    return entries;
                },
            },
            'catalog@1': {
                async getPlaylistTracks(id, limit, offset) {
                    const response = await neteaseApi.getPlaylistTracks(toNeteaseId(id), limit, offset);
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the playlist tracks');
                    const items = songsIn(response.songs);
                    return pageOf(items, offset, items.length === limit);
                },
                async getCloudTracks(limit, offset) {
                    const response = await neteaseApi.getUserCloud(limit, offset);
                    const items = songsIn(response.songs).map(song => ({ ...song, variant: 'cloud' }));
                    const total = toFiniteNumber(response.count);
                    return pageOf(items, offset, Boolean(response.hasMore), total);
                },
                async getListeningRankTracks(range, limit, offset, collection) {
                    const userId = collection?.creator?.id;
                    if (!userId) {
                        throw neteaseError('invalid-response', 'The listening ranking entry names no user');
                    }
                    const songs = await readNeteaseListeningRank(userId, range);
                    const items = songs.slice(offset, offset + limit);
                    return pageOf(items, offset, offset + items.length < songs.length, songs.length);
                },
                async getAlbumDetail(id, existingCollection) {
                    const response = await neteaseApi.getAlbum(toNeteaseId(id));
                    // A refusing answer (the local backend's 502, NetEase's -462) says nothing of whether the album
                    // is there: it fails, rather than handing back the collection asked with, which an id alone
                    // makes nameless and a caller reads as no such album.
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the album detail');
                    const rawAlbum = response?.album;
                    if (!rawAlbum) return existingCollection || null;

                    const normalized = normalizeNeteaseCollection({ ...asAnswer(rawAlbum), id: (asAnswer(rawAlbum).id as unknown) ?? id }, 'album');
                    const keep = <K extends keyof FoliumSourceCollection>(key: K, value: FoliumSourceCollection[K] | undefined) => (
                        value === undefined || value === '' ? {} : { [key]: value }
                    );
                    return {
                        ...normalized,
                        name: normalized.name || existingCollection?.name || '',
                        ...keep('coverUrl', normalized.coverUrl || existingCollection?.coverUrl),
                        ...keep('description', normalized.description || existingCollection?.description),
                        ...keep('trackCount', normalized.trackCount ?? existingCollection?.trackCount),
                        ...keep('artists', normalized.artists?.length ? normalized.artists : existingCollection?.artists),
                        ...keep('aliases', normalized.aliases?.length ? normalized.aliases : existingCollection?.aliases),
                        ...keep('publishedAt', normalized.publishedAt ?? existingCollection?.publishedAt),
                        ...keep('publisher', normalized.publisher || existingCollection?.publisher),
                    };
                },
                async getAlbumTracks(id) {
                    const response = await neteaseApi.getAlbum(toNeteaseId(id));
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the album tracks');
                    const items = songsIn(response.songs);
                    return pageOf(items, 0, false);
                },
                async getArtistSongs(id, limit, offset) {
                    const response = await neteaseApi.getArtistSongs(toNeteaseId(id), limit, offset);
                    const items = songsIn(response.songs);
                    // /artist/songs answers the artist's whole song count: the "all songs" page syncs up to it.
                    const total = Number(response?.total);
                    return pageOf(items, offset, Boolean(response.more), Number.isFinite(total) && total > 0 ? total : undefined);
                },
                async getArtistAlbums(id, limit, offset) {
                    const response = await neteaseApi.getArtistAlbums(toNeteaseId(id), limit, offset);
                    const items = collectionsIn(response.hotAlbums, 'album');
                    return pageOf(items, offset, Boolean(response.more));
                },
                async getArtistDetail(id) {
                    const response = await neteaseApi.getArtistDetail(toNeteaseId(id));
                    // As for the album: a refusal is a failure, not "no such artist".
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the artist detail');
                    const artist = response?.data?.artist;
                    if (!artist) return null;
                    const artistFields = asAnswer(artist);
                    const coverUrl = optionalText(artistFields.cover || artistFields.picUrl);
                    const transNames = normalizeStringList(artistFields.transNames);
                    const { aliases: _aliases, ...normalized } = normalizeNeteaseCollection(artist, 'artist');
                    return {
                        ...normalized,
                        ...(coverUrl ? { coverUrl } : {}),
                        trackCount: Number(artist.musicSize || 0),
                        albumCount: Number(artist.albumSize || 0),
                        data: {
                            musicSize: Number(artist.musicSize || 0),
                            albumSize: Number(artist.albumSize || 0),
                            transNames,
                        },
                        ...(transNames.length > 0 ? { aliases: transNames } : {}),
                    };
                },
                async getSubscriptionStatus(type, id) {
                    const response = type === 'playlist'
                        ? await neteaseApi.getPlaylistDetailDynamic(toNeteaseId(id))
                        : await neteaseApi.getAlbumDetailDynamic(toNeteaseId(id));
                    return type === 'playlist' ? Boolean(response?.subscribed) : Boolean(response?.isSub);
                },
            },
            'recommendations@1': {
                // The personal FM takes NetEase's modes and scenes: the host hands the stored pick when none is asked.
                personalFmModes: true,
                // NetEase has no extra radios, so a station is none of its own.
                getPersonalFmCatalog(station) {
                    if (station) return Promise.reject(neteaseError('unsupported', 'NetEase has no such station'));
                    return Promise.resolve(neteaseFmCatalog());
                },
                async getDailySongs(refresh) {
                    const response = await neteaseApi.getDailyRecommendedSongs(refresh);
                    return songsIn(response.songs);
                },
                async getPersonalFm(options) {
                    const response = await neteaseApi.getPersonalFm(options ? { mode: options.mode, submode: options.submode ?? null } : undefined);
                    return songsIn(response.data);
                },
                async getRecommendedCollections(limit) {
                    const response = await neteaseApi.getPersonalizedPlaylists(limit);
                    return collectionsIn(response.result);
                },
                async getHistoryEntries() {
                    const response = await neteaseApi.getDailyRecommendationHistoryDates();
                    const dates = datesIn(response);
                    return dates.map(date => ({ id: String(date), label: String(date) }));
                },
                async getHistoryDates() {
                    const response = await neteaseApi.getDailyRecommendationHistoryDates();
                    const dates = datesIn(response);
                    return dates.map(String);
                },
                async getHistorySongs(entry) {
                    const response = await neteaseApi.getDailyRecommendationHistoryDetail(typeof entry === 'string' ? entry : entry.id);
                    return songsIn(asAnswer(response.data).songs || response.songs);
                },
                async dislikeSong(id) {
                    const response = await neteaseApi.dislikeDailyRecommendedSong(toNeteaseId(id));
                    return {
                        ...(response.song ? { replacement: normalizeNeteaseSong(response.song) } : {}),
                        limitReached: Number(response?.code) === 432,
                    };
                },
                async getDailyStyleGroups() {
                    const response = await neteaseApi.getDailyStyleConfigs();
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the daily style groups');
                    const categorys: unknown = asAnswer(asAnswer(response).data).categorys;
                    return (Array.isArray(categorys) ? categorys : [])
                        .map(normalizeDailyStyleGroup)
                        .filter((group: { id: string; tags: unknown[] }) => group.id && group.tags.length > 0);
                },
                async getDailyStyleSongs() {
                    const response = await neteaseApi.getDailyStyleSongs();
                    if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the daily style songs');
                    const picked = normalizeDailyStyleGroup(response?.data?.tags);
                    return {
                        songs: songsIn(response.songs),
                        selection: picked.id && picked.tags.length > 0
                            ? { groupId: picked.id, tagIds: picked.tags.map(tag => tag.id) }
                            : null,
                    };
                },
                async setDailyStyle(selection) {
                    const response = await neteaseApi.setDailyStyle(Number(selection.groupId), selection.tagIds.map(Number));
                    if (isRefusedNeteaseAnswer(response) || response?.data?.saveSuccess === false) {
                        throw neteaseAnswerError(response, 'the daily style');
                    }
                },
            },
            // The explore page is in neteaseExplore.ts, which gets this file's normalizers handed in.
            'explore@1': createNeteaseExplore({ song: normalizeNeteaseSong, collection: normalizeNeteaseCollection }),
            'mutations@1': {
                async likeSong(song, liked) {
                    await neteaseApi.likeSong(toNeteaseId(idOf(song)), liked);
                },
                async updatePlaylistTracks(operation, playlist, tracks) {
                    const response = await neteaseApi.updatePlaylistTracks(operation, toNeteaseId(idOf(playlist)), tracks.map(track => toNeteaseId(idOf(track))));
                    // The API answers a refusal (a song already in the playlist, not the owner's list, signed out) with
                    // HTTP 200 and NetEase's own body; a success comes wrapped as { status, body: { code } }.
                    const code = Number(response?.body?.code ?? response?.code);
                    if ([301, 401, 403].includes(code)) {
                        throw neteaseError('auth-required', 'NetEase refused the playlist change: not signed in', { code });
                    }
                    if (code !== 200) {
                        throw neteaseError('unavailable', `NetEase refused the playlist change: code ${code}`, { code });
                    }
                },
                async subscribePlaylist(playlist, subscribed) {
                    await neteaseApi.subscribePlaylist(toNeteaseId(idOf(playlist)), subscribed);
                },
                async subscribeAlbum(id, subscribed) {
                    await neteaseApi.subscribeAlbum(toNeteaseId(id), subscribed);
                },
            },
            'covers@1': neteaseCovers,
            // The raw endpoints (platform.raw): the table and the request are in neteaseRaw.ts.
            'raw@1': neteaseRaw,
        },
    };
};

/** What the module keeps between requests: dropped when the source is made again or stops. */
export const resetNeteaseProviderRuntimeCache = (): void => {
    neteaseChorusRangesCache.clear();
    cookieAskedWith = null;
    lastLoginStatusCheck = null;
};
