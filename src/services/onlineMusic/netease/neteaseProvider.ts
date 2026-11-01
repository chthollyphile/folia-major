import type { SongResult, UnifiedSong } from '../../../types';
import { OnlineProviderError } from '../../../types/onlineMusic';
import type {
    AudioQualityPreference,
    LoginDiagnosticLine,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderLyricsResult,
    ProviderSongAvailability,
    ProviderSongReplacement,
    ProviderArtistSummary,
    ProviderUser,
} from '../../../types/onlineMusic';
import { getPersonalFmRequestOptions } from '../../../stores/usePersonalFmModeStore';
import { parseNeteaseChorusRanges, processNeteaseLyrics } from '../../../utils/lyrics/neteaseProcessing';
import { getPlaybackSourceRef } from '../../../utils/appPlaybackGuards';
import { toFiniteNumber } from '../../../utils/replayGain';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { NeteaseLoginHttpError, getNeteaseRemoteApiBase, httpErrorStatusOf, neteaseApi, resolveNeteaseSongAvailability } from './netease';
import i18n from '../../../i18n/config';
import { readProviderSessionValue, removeProviderSessionValue, writeProviderSessionValue } from '../providerStorage';
import { readNeteaseOldAccountCache, removeNeteaseOldAccountCache } from './neteaseOldAccountCache';
import { collectNeteaseLoginDiagnostics } from './neteaseLoginDiagnostics';
import { describeNeteaseLoginFailure, neteaseCheckFailure } from './neteaseLoginFailure';
import { describeNeteaseFailure, isRefusedNeteaseAnswer, neteaseAnswerError, neteaseNoUrlError } from './neteaseFailure';
import { neteaseLocalService, watchNeteaseLocalService } from './neteaseLocalService';
import { createNeteaseExplore } from './neteaseExplore';
import { neteaseRaw } from './neteaseRaw';
import { canRunLoginSelfCheck, runLoginSelfCheck } from '../loginSelfCheck';
import { diagnosticLine, formatDiagnosticClock } from '../login/loginDiagnosticReport';

// src/services/onlineMusic/netease/neteaseProvider.ts

export const toNeteaseId = (id: MediaId): number => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) throw new Error(`Invalid NetEase id: ${String(id)}`);
    return numericId;
};

// How many ids one `/song/detail` request of `playback.getSongDetails` carries.
export const NETEASE_SONG_DETAIL_BATCH = 50;

const mapQuality = (quality: AudioQualityPreference): string => {
    if (quality === 'standard') return 'standard';
    if (quality === 'high') return 'exhigh';
    return quality;
};

/**
 * The `level`/`bitrate` pair the listening report carries, which is NetEase's own client vocabulary
 * and therefore stays inside this adapter. Defaults match the documented ones for `/scrobble/v1`.
 */
const mapScrobbleQuality = (quality?: AudioQualityPreference): { level: string; bitrate: number } => {
    if (quality === 'standard') return { level: 'standard', bitrate: 128 };
    if (quality === 'lossless') return { level: 'lossless', bitrate: 999 };
    if (quality === 'hires') return { level: 'hires', bitrate: 1999 };
    return { level: 'exhigh', bitrate: 320 };
};

/** This provider's normalized view of a song, shared by `songMetadata` and the listening report. */
const getNeteaseSongMetadata = (song: SongResult) => createProviderSongMetadata(normalizeNeteaseSong(song));

const normalizeUser = (raw: any): ProviderUser => ({
    id: raw?.userId ?? raw?.id ?? 0,
    nickname: raw?.nickname || '',
    avatarUrl: raw?.avatarUrl,
    backgroundUrl: raw?.backgroundUrl,
    vipType: raw?.vipType,
});

const normalizeArtistSummary = (raw: any): ProviderArtistSummary | null => {
    const name = String(raw?.name || '');
    if (!name) return null;
    return {
        id: raw?.id ?? 0,
        name,
    };
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
const isOwnNeteaseLikedPlaylist = (raw: any, userId: MediaId): boolean => {
    if (Number(raw?.specialType) !== NETEASE_LIKED_PLAYLIST_SPECIAL_TYPE) return false;
    const creatorId = raw?.creator?.userId ?? raw?.userId;
    return creatorId !== undefined && creatorId !== null && String(creatorId) === String(userId);
};

const normalizeCollection = (raw: any, type = 'playlist'): ProviderCollection => {
    const artists = (Array.isArray(raw?.artists)
        ? raw.artists
        : raw?.artist
            ? [raw.artist]
            : [])
        .map(normalizeArtistSummary)
        .filter((artist: ProviderArtistSummary | null): artist is ProviderArtistSummary => Boolean(artist));
    const aliases = normalizeStringList(raw?.alias || raw?.aliases);
    const publishedAt = Number(raw?.publishedAt ?? raw?.publishTime);
    const playCount = Number(raw?.playCount);
    const updatedAt = Number(raw?.updatedAt ?? raw?.updateTime);
    const tracksUpdatedAt = Number(raw?.tracksUpdatedAt ?? raw?.trackUpdateTime);

    return {
        providerId: 'netease',
        id: raw?.id ?? 0,
        name: raw?.name || '',
        // 网易云的专辑对象自己带一个 `type`，是它的发行类型（「专辑」「EP/Single」这类），不是集合的种类：
        // 按专辑或歌手读到的就是专辑或歌手。别的照旧取 raw.type，已经正规化过的歌单再读一遍不变。
        type: type === 'album' || type === 'artist' ? type : raw?.type || (raw?.specialType === 'cloud' ? 'cloud' : type),
        coverUrl: raw?.coverUrl || raw?.coverImgUrl || raw?.picUrl,
        description: raw?.description || raw?.briefDesc || raw?.briefDescription || raw?.copywriter,
        trackCount: raw?.trackCount ?? raw?.size,
        ...(type === 'artist' && Number(raw?.albumSize) > 0 ? { albumCount: Number(raw.albumSize) } : {}),
        creator: raw?.creator ? normalizeUser(raw.creator) : undefined,
        ...(artists.length > 0 ? { artists } : {}),
        ...(aliases.length > 0 ? { aliases } : {}),
        ...(Number.isFinite(publishedAt) && publishedAt > 0 ? { publishedAt } : {}),
        ...(typeof (raw?.publisher || raw?.company) === 'string' && (raw.publisher || raw.company)
            ? { publisher: raw.publisher || raw.company }
            : {}),
        ...(Number.isFinite(playCount) && playCount >= 0 ? { playCount } : {}),
        ...(Number.isFinite(updatedAt) && updatedAt > 0 ? { updatedAt } : {}),
        ...(Number.isFinite(tracksUpdatedAt) && tracksUpdatedAt > 0 ? { tracksUpdatedAt } : {}),
        ...(raw?.specialType === 'liked' || raw?.isLiked === true ? { isLiked: true } : {}),
    };
};

// The cookie this page keeps is the sign-in. It goes at once, and with it what an older build kept
// of the account.
const dropNeteaseSignIn = async (): Promise<void> => {
    removeProviderSessionValue('netease', 'cookie', ['netease_cookie']);
    await removeNeteaseOldAccountCache();
};

// 最近一次读登录状态时页面里存着的 cookie，没有就是 null。登录失效时只删它（signInRanOut）。
let cookieAskedWith: string | null = null;

// 扫码的请求没有得到预期的回答时，给日志和失败的那一行：返回码和后端的原话。
const describeQrResponse = (response: any): string => (
    `code ${response?.code ?? 'none'}: ${response?.message || response?.msg || 'no message'}`
);

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

// 最近一次读登录状态的结论。扫码确认之后账号没读出来时，诊断报告靠它说是哪一个接口没给登录状态。
let lastLoginStatusCheck: LoginDiagnosticLine | null = null;
const noteLoginStatusCheck = (summary: LoginDiagnosticLine): void => {
    lastLoginStatusCheck = diagnosticLine`${formatDiagnosticClock(Date.now())} ${summary}`;
};

// 只有网易云明说的才算：回答的码是 301、401、403（没有登录），或是 200（有没有人看回答里的用户）。别的回答都是这一次
// 没问到谁登录着：本地后端连不上网易云时的 502、网易云的 5xx、风控的 -462，还有没有码的 HTTP 错误（比如远程 API 前面
// 网关自己的回答）。这时抛 'unavailable' 的错（neteaseAnswerError）：accountRead.ts 只把这次读记为失败，cookie 留着。
// 当成没有人登录，会删掉一个还有效的登录。
const throwIfLoginCheckRefused = (response: any, route: string): void => {
    const code = Number(response?.code ?? response?.data?.code);
    if ([301, 401, 403].includes(code) || (code === 200 && httpErrorStatusOf(response) === undefined)) return;
    noteLoginStatusCheck(diagnosticLine`${route} code=${code} refused`);
    throw neteaseAnswerError(response, route);
};

const extractCloudLyricText = (response: any): string => (
    response?.lrc || response?.data?.lrc || response?.lyric || response?.data?.lyric || ''
);

const neteaseChorusRangesCache = new Map<string, Promise<Array<{ startTime: number; endTime: number }>>>();

const getNeteaseChorusRanges = async (songId: MediaId): Promise<Array<{ startTime: number; endTime: number }>> => {
    const parsedId = toNeteaseId(songId);
    const cacheKey = String(parsedId);
    const cached = neteaseChorusRangesCache.get(cacheKey);
    if (cached) return cached;

    if (typeof neteaseApi.getChorus !== 'function') return [];

    const request = Promise.resolve(neteaseApi.getChorus(parsedId))
        .then(parseNeteaseChorusRanges)
        .catch(error => {
            console.warn(`[NeteaseProvider] Failed to fetch chorus ranges for song ${songId}:`, error);
            return [];
        });
    neteaseChorusRangesCache.set(cacheKey, request);
    return request;
};

// Provides a small canonical fallback for isolated runtimes that do not load the legacy transport normalizer.
const normalizeNeteaseSongFallback = (raw: unknown): UnifiedSong => {
    const record = raw && typeof raw === 'object' ? raw as Record<string, any> : {};
    const base = record.simpleSong && typeof record.simpleSong === 'object' ? record.simpleSong : record;
    const rawArtists = Array.isArray(base.ar) ? base.ar : (Array.isArray(base.artists) ? base.artists : []);
    const artists = rawArtists
        .map((artist: any, index: number) => ({ id: artist?.id ?? index, name: String(artist?.name || '') }))
        .filter((artist: { id: MediaId; name: string }) => artist.name);
    const rawAlbum = base.al || base.album || {};
    const duration = Number(base.durationMs ?? base.dt ?? base.duration ?? record.durationMs ?? record.duration ?? record.songLength ?? 0);
    const cloud = Number(base.t ?? record.t) === 1 || Number(base.t ?? record.t) === 2 || record.sourceType === 'cloud';

    return {
        id: base.id ?? record.id ?? 0,
        name: String(base.name || record.songName || record.fileName || 'Unknown Song'),
        artists,
        album: {
            id: rawAlbum.id ?? 0,
            name: String(rawAlbum.name || 'Unknown Album'),
            coverUrl: rawAlbum.coverUrl || rawAlbum.picUrl || record.cover,
        },
        durationMs: Number.isFinite(duration) ? duration : 0,
        aliases: Array.isArray(base.alia) ? base.alia : (Array.isArray(base.aliases) ? base.aliases : []),
        translatedNames: Array.isArray(base.tns) ? base.tns : (Array.isArray(base.translatedNames) ? base.translatedNames : []),
        isPureMusic: Boolean(base.isPureMusic),
        sourceRef: {
            kind: 'online',
            providerId: 'netease',
            mediaId: String(base.id ?? record.id ?? 0),
            ...(cloud ? { variant: 'cloud' } : {}),
        },
    };
};

export const normalizeNeteaseSong = (raw: unknown): UnifiedSong => {
    const normalized = typeof neteaseApi.normalizeSongResult === 'function'
        ? neteaseApi.normalizeSongResult(raw)
        : normalizeNeteaseSongFallback(raw);
    const isCloud = normalized.t === 1 || normalized.t === 2 || normalized.sourceType === 'cloud';
    return {
        id: normalized.id,
        name: normalized.name,
        artists: normalized.artists,
        album: normalized.album,
        durationMs: normalized.durationMs,
        aliases: normalized.aliases || [],
        translatedNames: normalized.translatedNames || [],
        isPureMusic: normalized.isPureMusic,
        fee: normalized.fee,
        noCopyrightRcmd: normalized.noCopyrightRcmd,
        resourceState: normalized.resourceState,
        privilege: normalized.privilege,
        sourceRef: {
            kind: 'online',
            providerId: 'netease',
            mediaId: String(normalized.id),
            ...(isCloud ? { variant: 'cloud' } : {}),
        },
    };
};

const getLyrics = async (
    song: SongResult,
    context?: { userId?: MediaId | null },
): Promise<ProviderLyricsResult> => {
    if (song.sourceRef?.kind === 'online' && song.sourceRef.variant === 'cloud' && context?.userId != null) {
        const response = await neteaseApi.getCloudLyric(toNeteaseId(context.userId), toNeteaseId(song.id));
        const mainText = extractCloudLyricText(response);
        const processed = await processNeteaseLyrics({ type: 'netease', lrc: { lyric: mainText } });
        return {
            lyrics: processed.lyrics,
            mainText,
            wordByWordText: null,
            translationText: null,
            romanizationText: null,
            isPureMusic: processed.isPureMusic,
            chorusRanges: await getNeteaseChorusRanges(song.id),
        };
    }

    const response = await neteaseApi.getLyric(toNeteaseId(song.id));
    const processed = await processNeteaseLyrics(
        typeof neteaseApi.getProcessedLyricPayload === 'function'
            ? neteaseApi.getProcessedLyricPayload(response)
            : response,
    );
    return {
        lyrics: processed.lyrics,
        mainText: processed.mainLrc,
        wordByWordText: processed.yrcLrc,
        translationText: processed.transLrc,
        romanizationText: processed.romanizationLrc,
        isPureMusic: processed.isPureMusic,
        chorusRanges: await getNeteaseChorusRanges(song.id),
    };
};

export const neteaseProvider: OnlineMusicProvider = {
    id: 'netease',
    displayName: 'NetEase Cloud Music',
    shortName: '网易云',
    mark: { letter: '云', color: '#dc2626' },
    watch: watchNeteaseLocalService,
    describeFailure: describeNeteaseFailure,
    getAvailability: () => ({ configured: true }),
    capabilities: {
        search: true,
        playback: true,
        lyrics: true,
        auth: true,
        userLibrary: true,
        playlists: true,
        albums: true,
        artists: true,
        recommendations: true,
        mutations: true,
        personalFmModes: true,
        wordByWordLyrics: true,
        userCloud: true,
        historyRecommendations: true,
        playlistSubscription: true,
        playlistTrackMutations: true,
        likes: true,
        userAlbums: true,
        playbackReports: true,
        explore: true,
    },
    normalizeSong: normalizeNeteaseSong,
    normalizeUser,
    normalizeCollection,
    songMetadata: {
        getSongMetadata: getNeteaseSongMetadata,
    },
    getSongPageUrl(song) {
        return song.id ? `https://music.163.com/#/song?id=${encodeURIComponent(String(song.id))}` : null;
    },
    search: {
        async searchSongs(query, limit, offset) {
            const response = await neteaseApi.cloudSearch(query, limit, offset);
            const items = (response.result?.songs || []).map(normalizeNeteaseSong);
            const total = Number(response.result?.songCount || items.length);
            return { items, total, hasMore: offset + items.length < total, nextOffset: offset + items.length };
        },
        // 专辑和歌单的条目与 `/album`、`/playlist/detail` 读到的同一套字段（2026-10-31 实测），按同样的规则正规化。
        async searchAlbums(query, limit, offset) {
            const response = await neteaseApi.cloudSearch(query, limit, offset, 10);
            const items = (response.result?.albums || []).map((raw: any) => normalizeCollection(raw, 'album'));
            const total = Number(response.result?.albumCount || items.length);
            return { items, total, hasMore: items.length > 0 && offset + items.length < total, nextOffset: offset + items.length };
        },
        async searchPlaylists(query, limit, offset) {
            const response = await neteaseApi.cloudSearch(query, limit, offset, 1000);
            const items = (response.result?.playlists || []).map((raw: any) => normalizeCollection(raw, 'playlist'));
            const total = Number(response.result?.playlistCount || items.length);
            return { items, total, hasMore: items.length > 0 && offset + items.length < total, nextOffset: offset + items.length };
        },
    },
    playback: {
        async getSongDetail(id) {
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
        async getSongDetails(ids) {
            const numericIds = ids.map(id => {
                const numericId = Number(id);
                return Number.isFinite(numericId) && String(id).trim() !== '' ? numericId : null;
            });
            const asked = [...new Set(numericIds.filter((id): id is number => id !== null))];
            const found = new Map<number, UnifiedSong>();
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
        songDetailsPerRequest: NETEASE_SONG_DETAIL_BATCH,
        async getAudioSource(song, quality) {
            const response = await neteaseApi.getSongUrl(toNeteaseId(song.id), mapQuality(quality));
            if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the song URL');
            const raw = response?.data?.[0];
            const rawUrl = raw?.url;
            if (!rawUrl) throw neteaseNoUrlError(raw?.code, raw?.fee);
            // 这个账号只能听一段试听（会员歌曲）：网易云给的是那一段的地址，freeTrialInfo 里是它在整首里的起止。
            // 地址照给，标成试听：播放照放并提示，缓存不收它（wholeSongCheck.ts）。
            // 只认一个对象。上游的两条解锁路都写成别的，那是整首：server.js 的通用解锁写 JS 的 null，
            // module/song_url_v1.js 带 unblock=true 时写字符串 'null'。
            const preview = typeof raw?.freeTrialInfo === 'object' && raw.freeTrialInfo !== null;
            const trackGain = toFiniteNumber(raw?.gain);
            return {
                url: String(rawUrl).replace(/^http:/, 'https:'),
                fetchedAt: Date.now(),
                quality,
                ...(preview ? { preview } : {}),
                ...(trackGain === undefined ? {} : { replayGain: { trackGain } }),
            };
        },
        getAvailability(song): ProviderSongAvailability {
            return resolveNeteaseSongAvailability(song);
        },
        async getReplacement(song): Promise<ProviderSongReplacement | null> {
            const replacement = await neteaseApi.getUnavailableSongReplacement(song);
            if (!replacement?.replacementSong) return null;
            return {
                song: normalizeNeteaseSong(replacement.replacementSong),
                label: replacement.typeDesc,
            };
        },
    },
    playbackReports: {
        // Cloud-disk tracks are excluded outright: an unmatched upload carries a cloud id that names
        // no track in the catalogue, and reporting one is reporting a play of a song that does not
        // exist. So is an id that is not a positive number.
        canReport(song) {
            const source = getPlaybackSourceRef(song);
            if (source.kind !== 'online' || source.variant === 'cloud') return false;
            return /^\d+$/.test(source.mediaId) && Number(source.mediaId) > 0;
        },
        async reportPlayback(song, report) {
            const metadata = getNeteaseSongMetadata(song);
            const { level, bitrate } = mapScrobbleQuality(report.quality);
            const response = await neteaseApi.scrobbleV1({
                id: toNeteaseId(song.id),
                time: Math.round(report.playedSeconds),
                name: song.name || undefined,
                artist: metadata.artists.map(artist => artist.name).filter(Boolean).join(', ') || undefined,
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
                throw new OnlineProviderError('unavailable', 'NetEase returned no status code for the listening report', 'netease');
            }
            if ([301, 401, 403].includes(code)) {
                throw new OnlineProviderError('auth-required', 'NetEase rejected the listening report: not signed in', 'netease');
            }
            if (code !== 200) {
                throw new OnlineProviderError('unavailable', `NetEase rejected the listening report: code ${code}`, 'netease');
            }
        },
    },
    lyrics: { getLyrics, getChorusRanges: getNeteaseChorusRanges },
    auth: {
        getLoginTexts: () => ({ title: 'home.loginTitle', note: 'home.loginNote' }),
        localService: neteaseLocalService,
        async getLoginStatus() {
            cookieAskedWith = readProviderSessionValue('netease', 'cookie', ['netease_cookie']);
            const loginResponse = await neteaseApi.getLoginStatus();
            throwIfLoginCheckRefused(loginResponse, 'login/status');
            const loginProfile = loginResponse?.data?.profile;
            const loginCode = Number(loginResponse?.code ?? loginResponse?.data?.code);
            if (!loginProfile || [301, 401, 403].includes(loginCode)) {
                noteLoginStatusCheck(diagnosticLine`login/status code=${loginCode} profile=${yesNo(Boolean(loginProfile))}`);
                return null;
            }

            const accountResponse = await neteaseApi.getUserAccount();
            throwIfLoginCheckRefused(accountResponse, 'user/account');
            const accountCode = Number(accountResponse?.code ?? accountResponse?.data?.code);
            const accountProfile = accountResponse?.profile;
            const accountId = accountResponse?.account?.id ?? accountProfile?.userId;
            const loginId = loginProfile?.userId ?? loginProfile?.id;
            if (!accountProfile || [301, 401, 403].includes(accountCode) || !accountId || !loginId || String(accountId) !== String(loginId)) {
                noteLoginStatusCheck(diagnosticLine`user/account code=${accountCode} profile=${yesNo(Boolean(accountProfile))} same-user=${yesNo(Boolean(accountId && loginId && String(accountId) === String(loginId)))}`);
                return null;
            }

            // 这里不写 cookie：登录状态的回答不带 cookie（上游 login_status 的回答正文里没有），真带了也只会是
            // 那一次请求的 Set-Cookie，可能没有 MUSIC_U，会盖掉扫码时存下的登录。cookie 只在扫码确认时写（checkLogin）。
            noteLoginStatusCheck(diagnosticLine`signed in (login/status code=${loginCode}, user/account code=${accountCode})`);
            return normalizeUser({ ...loginProfile, ...accountProfile });
        },
        // The request to NetEase takes the cookie as it is when it is made (`neteaseApi.logout`),
        // and the cookie goes at once, before the first wait and whatever NetEase answers: what
        // asks whether an account is signed in (the explore page) finds none from then on.
        async logout() {
            const told = neteaseApi.logout();
            await Promise.all([dropNeteaseSignIn(), told]);
        },
        // 登录失效：读登录状态说没有人登录之后（accountRead.ts）。只删那一次问的 cookie，存着的已经换了就不删：
        // 回答还在路上时扫码登录写下的新 cookie，那个回答说的不是它，留着。
        async signInRanOut() {
            if (readProviderSessionValue('netease', 'cookie', ['netease_cookie']) === cookieAskedWith) {
                await dropNeteaseSignIn();
                return;
            }
            console.log('[NeteaseProvider] The sign-in that ran out was replaced meanwhile: the new cookie stays');
        },
        showsKeptAccountAtStart: true,
        oldKeptAccount: () => readNeteaseOldAccountCache({ user: normalizeUser, collection: normalizeCollection }),
        // 旧版本的四份缓存只交出一次：accountRead.ts 把交出的账号存成快照之后才删。留着的话，快照哪一次读不出来，它们又会被
        // 存成快照，盖掉更新的那一份；先删的话，快照没存上时账号就两处都没了。删不掉不碍事，下次启动有快照，不会再读它们。
        async forgetOldKeptAccount() {
            try {
                await removeNeteaseOldAccountCache();
                console.log('[NeteaseProvider] The account an older build kept is now the snapshot; its caches are removed');
            } catch (error) {
                console.warn('[NeteaseProvider] The caches an older build kept could not be removed:', error);
            }
        },
        // 扫码三步：要码（unikey）→ 生成二维码图片 → 检查。没拿到 key 或图片就在那一步失败：空 key 去检查只会
        // 被拒绝，空图片会让登录窗口一直转圈。失败带着网易云的回答（cause），日志里看得到它回了什么。
        async startLogin() {
            const response = await neteaseApi.getQrKey();
            const key = response?.data?.unikey;
            if (!key) throw new OnlineProviderError('invalid-response', `NetEase gave no QR key: ${describeQrResponse(response)}`, 'netease', response);
            return String(key);
        },
        async createQr(key) {
            const response = await neteaseApi.createQr(key);
            const image = String(response?.data?.qrimg || '');
            if (image) return image;
            throw new OnlineProviderError('invalid-response', `NetEase QR image request failed: ${describeQrResponse(response)}`, 'netease', response);
        },
        async checkLogin(key) {
            let response: any;
            try {
                response = await neteaseApi.checkQr(key);
            } catch (error) {
                // 本地后端没能连上网易云（它回 502）：这一次检查没拿到网易云的回答，码在网易云那边还有效，接着检查。
                if (error instanceof NeteaseLoginHttpError && error.httpStatus === 502) {
                    return {
                        state: 'error',
                        message: `HTTP 502: ${describeQrResponse(error.answer)}`,
                        failure: describeNeteaseLoginFailure('check', error) ?? undefined,
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
                        writeProviderSessionValue('netease', 'cookie', response.cookie);
                    }
                    return { state: 'confirmed' };
                // 带上原始状态码：只剩 state 的话，日志里看不出网易云回的是哪一个码（风控的 8821 等）。
                default: return { state: 'error', message: describeQrResponse(response), failure: neteaseCheckFailure(response) };
            }
        },
        describeLoginFailure: describeNeteaseLoginFailure,
        getLoginDiagnostics: () => collectNeteaseLoginDiagnostics(lastLoginStatusCheck),
        canRunLoginSelfCheck: () => canRunLoginSelfCheck(getNeteaseRemoteApiBase()),
        runLoginSelfCheck: () => runLoginSelfCheck('netease', getNeteaseRemoteApiBase()),
    },
    library: {
        async getUserPlaylists(userId, limit, offset) {
            const response = await neteaseApi.getUserPlaylists(toNeteaseId(userId), limit, offset);
            // 只有用户歌单列表知道「这是谁的歌单」，「我喜欢的音乐」在这里标 isLiked；归一化结果带着它进缓存，回灌时照样保留。
            const items = (response?.playlist || []).map((item: any) => normalizeCollection(
                isOwnNeteaseLikedPlaylist(item, userId) ? { ...item, isLiked: true } : item,
            ));
            return { items, hasMore: items.length === limit, nextOffset: offset + items.length };
        },
        async getLikedSongIds(userId) {
            const response = await neteaseApi.getLikedSongs(toNeteaseId(userId));
            // The API layer hands error bodies back instead of throwing. Answering one with an empty
            // list would tell the caller the account likes nothing.
            const code = Number(response?.code);
            if ([301, 401, 403].includes(code)) {
                throw new OnlineProviderError('auth-required', 'NetEase rejected the liked-songs request: not signed in', 'netease');
            }
            if (code !== 200 || !Array.isArray(response?.ids)) {
                throw new OnlineProviderError('unavailable', `NetEase returned no liked-songs list (code ${response?.code})`, 'netease');
            }
            // One request brings the whole list.
            return { ids: response.ids, whole: true };
        },
        // NetEase has no smaller request for the count that this adapter knows to be of the same
        // list: the count is the length of the list itself, read as above.
        async getLikedSongCount(userId) {
            return (await neteaseProvider.library!.getLikedSongIds!(userId)).ids.length;
        },
        async getUserAlbums(_userId, limit, offset) {
            const response = await neteaseApi.getFavoriteAlbums(limit, offset);
            const items = (response?.data || []).map((item: any) => normalizeCollection(item, 'album'));
            return { items, hasMore: Boolean(response?.hasMore), nextOffset: offset + items.length };
        },
        async getCloudCollection(user) {
            const response = await neteaseApi.getUserCloud(1, 0);
            const trackCount = Number(response?.count || 0);
            if (trackCount <= 0) return null;
            const firstSong = response?.songs?.[0] ? normalizeNeteaseSong(response.songs[0]) : null;
            // The entry is named in the app's language, as it is shown among the playlists.
            return normalizeCollection({
                id: -100,
                name: i18n.t('navidrome.cloudDrive'),
                description: i18n.t('navidrome.cloudDriveDesc'),
                specialType: 'cloud',
                coverImgUrl: firstSong?.album?.coverUrl || user?.avatarUrl,
                trackCount,
                creator: user,
            }, 'cloud');
        },
    },
    catalog: {
        async getPlaylistTracks(id, limit, offset) {
            const response = await neteaseApi.getPlaylistTracks(toNeteaseId(id), limit, offset);
            if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the playlist tracks');
            const items = (response?.songs || []).map(normalizeNeteaseSong);
            return { items, hasMore: items.length === limit, nextOffset: offset + items.length };
        },
        async getCloudTracks(limit, offset) {
            const response = await neteaseApi.getUserCloud(limit, offset);
            const items = (response?.songs || []).map((item: unknown) => {
                const song = normalizeNeteaseSong(item);
                return { ...song, sourceRef: { ...song.sourceRef, variant: 'cloud' } } as UnifiedSong;
            });
            return { items, total: response?.count, hasMore: Boolean(response?.hasMore), nextOffset: offset + items.length };
        },
        async getAlbumDetail(id, existingCollection) {
            const response = await neteaseApi.getAlbum(toNeteaseId(id));
            // A refusing answer (the local backend's 502, NetEase's -462) says nothing of whether the album
            // is there: it fails, rather than handing back the collection asked with, which an id alone
            // makes nameless and a caller reads as no such album.
            if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the album detail');
            const rawAlbum = response?.album;
            if (!rawAlbum) return existingCollection || null;

            const normalized = normalizeCollection({ ...rawAlbum, id: rawAlbum.id ?? id }, 'album');
            return {
                ...normalized,
                name: normalized.name || existingCollection?.name || '',
                coverUrl: normalized.coverUrl || existingCollection?.coverUrl,
                description: normalized.description || existingCollection?.description,
                trackCount: normalized.trackCount ?? existingCollection?.trackCount,
                artists: normalized.artists?.length ? normalized.artists : existingCollection?.artists,
                aliases: normalized.aliases?.length ? normalized.aliases : existingCollection?.aliases,
                publishedAt: normalized.publishedAt ?? existingCollection?.publishedAt,
                publisher: normalized.publisher || existingCollection?.publisher,
            };
        },
        async getAlbumTracks(id) {
            const response = await neteaseApi.getAlbum(toNeteaseId(id));
            if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the album tracks');
            const items = (response?.songs || []).map(normalizeNeteaseSong);
            return { items, hasMore: false, nextOffset: items.length };
        },
        async getArtistSongs(id, limit, offset) {
            const response = await neteaseApi.getArtistSongs(toNeteaseId(id), limit, offset);
            const items = (response?.songs || []).map(normalizeNeteaseSong);
            return { items, hasMore: Boolean(response?.more), nextOffset: offset + items.length };
        },
        async getArtistAlbums(id, limit, offset) {
            const response = await neteaseApi.getArtistAlbums(toNeteaseId(id), limit, offset);
            const items = (response?.hotAlbums || []).map((item: any) => normalizeCollection(item, 'album'));
            return { items, hasMore: Boolean(response?.more), nextOffset: offset + items.length };
        },
        async getArtistDetail(id) {
            const response = await neteaseApi.getArtistDetail(toNeteaseId(id));
            // As for the album: a refusal is a failure, not "no such artist".
            if (isRefusedNeteaseAnswer(response)) throw neteaseAnswerError(response, 'the artist detail');
            const artist = response?.data?.artist;
            if (!artist) return null;
            return {
                ...normalizeCollection(artist, 'artist'),
                coverUrl: artist.cover || artist.picUrl,
                trackCount: Number(artist.musicSize || 0),
                albumCount: Number(artist.albumSize || 0),
                providerData: {
                    musicSize: Number(artist.musicSize || 0),
                    albumSize: Number(artist.albumSize || 0),
                    transNames: Array.isArray(artist.transNames) ? artist.transNames.map(String) : [],
                },
                aliases: normalizeStringList(artist.transNames),
            };
        },
        async getSubscriptionStatus(type, id) {
            const response = type === 'playlist'
                ? await neteaseApi.getPlaylistDetailDynamic(toNeteaseId(id))
                : await neteaseApi.getAlbumDetailDynamic(toNeteaseId(id));
            return type === 'playlist' ? Boolean(response?.subscribed) : Boolean(response?.isSub);
        },
    },
    recommendations: {
        async getDailySongs(refresh) {
            const response = await neteaseApi.getDailyRecommendedSongs(refresh);
            return (response?.songs || []).map(normalizeNeteaseSong);
        },
        async getPersonalFm(options) {
            // Falling back to the stored selection keeps callers that predate FM modes — the home
            // card, the radio grid, the queue refill — on whatever mode the user picked.
            const response = await neteaseApi.getPersonalFm(options ?? getPersonalFmRequestOptions());
            return (response?.data || []).map(normalizeNeteaseSong);
        },
        async getRecommendedCollections(limit) {
            const response = await neteaseApi.getPersonalizedPlaylists(limit);
            return (response?.result || []).map((item: any) => normalizeCollection(item));
        },
        async getHistoryEntries() {
            const response = await neteaseApi.getDailyRecommendationHistoryDates();
            const dates = response?.data?.dates || response?.dates || [];
            return dates.map((date: string) => ({ id: date, label: date }));
        },
        async getHistoryDates() {
            const response = await neteaseApi.getDailyRecommendationHistoryDates();
            return response?.data?.dates || response?.dates || [];
        },
        async getHistorySongs(entry) {
            const response = await neteaseApi.getDailyRecommendationHistoryDetail(
                typeof entry === 'string' ? entry : entry.id,
            );
            return (response?.data?.songs || response?.songs || []).map(normalizeNeteaseSong);
        },
        async dislikeSong(id) {
            const response = await neteaseApi.dislikeDailyRecommendedSong(toNeteaseId(id));
            return {
                replacement: response?.song ? normalizeNeteaseSong(response.song) : undefined,
                limitReached: Number(response?.code) === 432,
            };
        },
    },
    // The explore page is in neteaseExplore.ts, which gets this file's normalizers handed in.
    explore: createNeteaseExplore({ song: normalizeNeteaseSong, collection: normalizeCollection }),
    mutations: {
        async likeSong(song, liked) {
            await neteaseApi.likeSong(toNeteaseId(typeof song === 'object' ? song.id : song), liked);
        },
        async updatePlaylistTracks(operation, playlist, tracks) {
            const playlistId = typeof playlist === 'object' ? playlist.id : playlist;
            const trackIds = tracks.map(track => typeof track === 'object' ? track.id : track);
            const response = await neteaseApi.updatePlaylistTracks(operation, toNeteaseId(playlistId), trackIds.map(toNeteaseId));
            // The API answers a refusal (a song already in the playlist, not the owner's list, signed out) with
            // HTTP 200 and NetEase's own body; a success comes wrapped as { status, body: { code } }.
            const code = Number(response?.body?.code ?? response?.code);
            if ([301, 401, 403].includes(code)) {
                throw new OnlineProviderError('auth-required', 'NetEase refused the playlist change: not signed in', 'netease');
            }
            if (code !== 200) {
                throw new OnlineProviderError('unavailable', `NetEase refused the playlist change: code ${code}`, 'netease');
            }
        },
        async subscribePlaylist(playlist, subscribed) {
            await neteaseApi.subscribePlaylist(toNeteaseId(typeof playlist === 'object' ? playlist.id : playlist), subscribed);
        },
        async subscribeAlbum(id, subscribed) { await neteaseApi.subscribeAlbum(toNeteaseId(id), subscribed); },
    },
    // The raw endpoints (Folium experimental platform.raw): the table and the request are in neteaseRaw.ts.
    raw: neteaseRaw,
};
