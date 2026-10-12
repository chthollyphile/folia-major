import type { SongResult, UnifiedSong } from '../../types';
import { OnlineProviderError } from '../../types/onlineMusic';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderLyricsResult,
    ProviderSongAvailability,
    ProviderSongReplacement,
    ProviderArtistSummary,
    ProviderUser,
    QrLoginState,
} from '../../types/onlineMusic';
import { getPersonalFmRequestOptions } from '../../stores/usePersonalFmModeStore';
import { parseNeteaseChorusRanges, processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { toFiniteNumber } from '../../utils/replayGain';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { getNeteaseRemoteApiBase, isSongMarkedUnavailable, neteaseApi } from '../netease';
import { readProviderSessionValue, writeProviderSessionValue } from './providerStorage';
import { collectLoginBackendDiagnostics } from './loginBackendDiagnostics';
import { canRunLoginSelfCheck, runLoginSelfCheck } from './loginSelfCheck';
import { formatDiagnosticClock } from '../../utils/qrLoginDiagnosticReport';
import { isConnectionResetMessage, isNetworkFailureMessage } from '../../../shared/networkErrorText.mjs';

// src/services/onlineMusic/neteaseProvider.ts

export const toNeteaseId = (id: MediaId): number => {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) throw new Error(`Invalid NetEase id: ${String(id)}`);
    return numericId;
};

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
        type: raw?.type || (raw?.specialType === 'cloud' ? 'cloud' : type),
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

// 扫码接口失败时给日志与诊断时间线的一行：返回码 + 后端原文。
const describeQrResponse = (response: any): string => (
    `code ${response?.code ?? 'none'}: ${response?.message || response?.msg || 'no message'}`
);

/**
 * 扫码接口没给出预期结果时交给会话的失败：原文与原始返回码；本地 API 把上游的网络错误转成 { code: 502, msg }，
 * 这类失败没拿到网易的回应、二维码仍然有效（transient，会话会接着轮询），其中连接被重置单独标出原因。
 */
const qrFailureOf = (response: any): Extract<QrLoginState, { state: 'error' }> => {
    const networkFailure = response?.code === 502 && isNetworkFailureMessage(response?.msg);
    return {
        state: 'error',
        message: describeQrResponse(response),
        ...(response?.code === 502 && isConnectionResetMessage(response?.msg) ? { reason: 'connection-reset' as const } : {}),
        ...(networkFailure ? { transient: true } : {}),
        detail: { code: response?.code ?? null, message: response?.message ?? response?.msg ?? null },
    };
};

const yesNo = (value: boolean): string => (value ? 'yes' : 'no');

// 最近一次登录态检查的结论。扫码确认后账户没加载出来（account-refresh-failed）时，报告靠它说明是哪个接口拿不到登录态。
let lastLoginStatusCheck: string | null = null;
const noteLoginStatusCheck = (summary: string): void => {
    lastLoginStatusCheck = `${formatDiagnosticClock(Date.now())} ${summary}`;
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
        heartbeatRecommendations: true,
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
    },
    playback: {
        async getSongDetail(id) {
            const response = await neteaseApi.getSongDetail(toNeteaseId(id));
            const raw = response?.songs?.[0];
            return raw ? normalizeNeteaseSong(raw) : null;
        },
        async getAudioSource(song, quality) {
            const response = await neteaseApi.getSongUrl(toNeteaseId(song.id), mapQuality(quality));
            const raw = response?.data?.[0];
            const rawUrl = raw?.url;
            if (!rawUrl) return null;
            const trackGain = toFiniteNumber(raw?.gain);
            return {
                url: String(rawUrl).replace(/^http:/, 'https:'),
                fetchedAt: Date.now(),
                quality,
                ...(trackGain === undefined ? {} : { replayGain: { trackGain } }),
            };
        },
        getAvailability(song): ProviderSongAvailability {
            if (!isSongMarkedUnavailable(song)) return { state: 'playable' };
            return {
                state: 'unavailable',
                label: typeof song.noCopyrightRcmd?.typeDesc === 'string'
                    ? song.noCopyrightRcmd.typeDesc
                    : undefined,
            };
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
        async getLoginStatus() {
            const loginResponse = await neteaseApi.getLoginStatus();
            const loginProfile = loginResponse?.data?.profile;
            const loginCode = Number(loginResponse?.code ?? loginResponse?.data?.code);
            if (!loginProfile || [301, 401, 403].includes(loginCode)) {
                noteLoginStatusCheck(`login/status code=${loginCode} profile=${yesNo(Boolean(loginProfile))}`);
                return null;
            }

            const accountResponse = await neteaseApi.getUserAccount();
            const accountCode = Number(accountResponse?.code ?? accountResponse?.data?.code);
            const accountProfile = accountResponse?.profile;
            const accountId = accountResponse?.account?.id ?? accountProfile?.userId;
            const loginId = loginProfile?.userId ?? loginProfile?.id;
            if (!accountProfile || [301, 401, 403].includes(accountCode) || !accountId || !loginId || String(accountId) !== String(loginId)) {
                noteLoginStatusCheck(`user/account code=${accountCode} profile=${yesNo(Boolean(accountProfile))} same-user=${yesNo(Boolean(accountId && loginId && String(accountId) === String(loginId)))}`);
                return null;
            }

            if (typeof loginResponse?.cookie === 'string' && loginResponse.cookie) {
                writeProviderSessionValue('netease', 'cookie', loginResponse.cookie);
            }
            noteLoginStatusCheck(`signed in (login/status code=${loginCode}, user/account code=${accountCode})`);
            return normalizeUser({ ...loginProfile, ...accountProfile });
        },
        async logout() { await neteaseApi.logout(); },
        // 扫码三步：要码（unikey）→ 生成二维码图片 → 轮询。没拿到 key 或图片就直接失败：空 key 去轮询只会换来
        // 一个看不出原因的 code 400，空图片会让界面一直转圈。失败带上原始响应（cause），时间线里看得到网易回了什么。
        async getQrKey() {
            const response = await neteaseApi.getQrKey();
            const unikey = String(response?.data?.unikey || '');
            if (unikey) return unikey;
            const failure = qrFailureOf(response);
            const error = new OnlineProviderError('invalid-response', `NetEase QR key request failed: ${failure.message}`, 'netease', response);
            throw Object.assign(error, {
                ...(failure.reason ? { qrLoginReason: failure.reason } : {}),
                ...(failure.transient ? { transient: true } : {}),
            });
        },
        async createQr(key) {
            const response = await neteaseApi.createQr(key);
            const image = String(response?.data?.qrimg || '');
            if (image) return image;
            throw new OnlineProviderError('invalid-response', `NetEase QR image request failed: ${describeQrResponse(response)}`, 'netease', response);
        },
        async checkQr(key) {
            const response = await neteaseApi.checkQr(key);
            switch (response?.code) {
                case 800: return { state: 'expired' };
                case 801: return { state: 'waiting' };
                case 802: return { state: 'scanned' };
                case 803:
                    if (typeof response?.cookie === 'string' && response.cookie) {
                        writeProviderSessionValue('netease', 'cookie', response.cookie);
                    }
                    return { state: 'confirmed' };
                // 风控（8821 等）、上游网络错误（502）与别的返回码都带着原始 code 与原文交给会话。
                default: return qrFailureOf(response);
            }
        },
        async getQrLoginDiagnostics() {
            return collectLoginBackendDiagnostics('netease', [
                `session: login cookie=${yesNo(Boolean(readProviderSessionValue('netease', 'cookie', ['netease_cookie'])))}, anonymous cookie=${yesNo(Boolean(readProviderSessionValue('netease', 'anonymous_cookie', ['netease_anonymous_cookie'])))}`,
                `last account check: ${lastLoginStatusCheck ?? 'none'}`,
            ], getNeteaseRemoteApiBase());
        },
        canRunQrLoginSelfCheck: () => canRunLoginSelfCheck(getNeteaseRemoteApiBase()),
        runQrLoginSelfCheck: () => runLoginSelfCheck('netease', getNeteaseRemoteApiBase()),
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
            // The API layer hands error bodies back instead of throwing. Answering one with [] would
            // tell the caller the account likes nothing: useNeteaseLibrary would clear every heart and
            // save that empty list into the account snapshot until the next good refresh.
            const code = Number(response?.code);
            if ([301, 401, 403].includes(code)) {
                throw new OnlineProviderError('auth-required', 'NetEase rejected the liked-songs request: not signed in', 'netease');
            }
            if (code !== 200 || !Array.isArray(response?.ids)) {
                throw new OnlineProviderError('unavailable', `NetEase returned no liked-songs list (code ${response?.code})`, 'netease');
            }
            return response.ids;
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
            return normalizeCollection({
                id: -100,
                name: 'cloud',
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
        async getHeartbeatSongs(options) {
            const ids = [options.seedSongId, options.playlistId, options.startSongId ?? options.seedSongId].map(Number);
            if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
                throw new OnlineProviderError('unavailable', 'Heartbeat recommendations require valid song and playlist IDs', 'netease');
            }
            const response = await neteaseApi.getHeartbeatSongs(ids[0], ids[1], options.startSongId === undefined ? undefined : ids[2]);
            const code = Number(response?.code);
            if (code !== 200) {
                const reason = code === 301 || code === 401 ? 'auth-required' : 'unavailable';
                throw new OnlineProviderError(reason, response?.message || `NetEase heartbeat request failed (code ${response?.code})`, 'netease', response);
            }
            if (!Array.isArray(response.data)) {
                throw new OnlineProviderError('invalid-response', 'NetEase returned no heartbeat recommendation list', 'netease', response);
            }
            // This endpoint wraps each ordinary song in songInfo; do not normalize the wrapper itself.
            const songs = response.data.flatMap((entry: any) => {
                const raw = entry?.songInfo;
                const id = Number(raw?.id ?? entry?.id);
                if (!raw || typeof raw !== 'object' || !Number.isSafeInteger(id) || id <= 0) return [];
                return [normalizeNeteaseSong({ ...raw, id })];
            });
            if (response.data.length > 0 && songs.length === 0) {
                throw new OnlineProviderError('invalid-response', 'NetEase returned no valid heartbeat songs', 'netease', response);
            }
            return songs;
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
    mutations: {
        async likeSong(song, liked) {
            await neteaseApi.likeSong(toNeteaseId(typeof song === 'object' ? song.id : song), liked);
        },
        async updatePlaylistTracks(operation, playlist, tracks) {
            const playlistId = typeof playlist === 'object' ? playlist.id : playlist;
            const trackIds = tracks.map(track => typeof track === 'object' ? track.id : track);
            await neteaseApi.updatePlaylistTracks(operation, toNeteaseId(playlistId), trackIds.map(toNeteaseId));
        },
        async subscribePlaylist(playlist, subscribed) {
            await neteaseApi.subscribePlaylist(toNeteaseId(typeof playlist === 'object' ? playlist.id : playlist), subscribed);
        },
        async subscribeAlbum(id, subscribed) { await neteaseApi.subscribeAlbum(toNeteaseId(id), subscribed); },
    },
};
