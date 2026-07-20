import type { SongResult, UnifiedSong } from '../../types';
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
} from '../../types/onlineMusic';
import { parseNeteaseChorusRanges, processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { isSongMarkedUnavailable, neteaseApi } from '../netease';
import { writeProviderSessionValue } from './providerStorage';

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
        mutations: true,
        wordByWordLyrics: true,
        userCloud: true,
        historyRecommendations: true,
        playlistSubscription: true,
        playlistTrackMutations: true,
        likes: true,
        userAlbums: true,
    },
    normalizeSong: normalizeNeteaseSong,
    normalizeUser,
    normalizeCollection,
    songMetadata: {
        getSongMetadata(song) {
            return createProviderSongMetadata(normalizeNeteaseSong(song));
        },
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
            const rawUrl = response?.data?.[0]?.url;
            if (!rawUrl) return null;
            return {
                url: String(rawUrl).replace(/^http:/, 'https:'),
                fetchedAt: Date.now(),
                quality,
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
    lyrics: { getLyrics, getChorusRanges: getNeteaseChorusRanges },
    auth: {
        async getLoginStatus() {
            const loginResponse = await neteaseApi.getLoginStatus();
            const loginProfile = loginResponse?.data?.profile;
            const loginCode = Number(loginResponse?.code ?? loginResponse?.data?.code);
            if (!loginProfile || [301, 401, 403].includes(loginCode)) return null;

            const accountResponse = await neteaseApi.getUserAccount();
            const accountCode = Number(accountResponse?.code ?? accountResponse?.data?.code);
            const accountProfile = accountResponse?.profile;
            const accountId = accountResponse?.account?.id ?? accountProfile?.userId;
            const loginId = loginProfile?.userId ?? loginProfile?.id;
            if (!accountProfile || [301, 401, 403].includes(accountCode) || !accountId || !loginId || String(accountId) !== String(loginId)) {
                return null;
            }

            if (typeof loginResponse?.cookie === 'string' && loginResponse.cookie) {
                writeProviderSessionValue('netease', 'cookie', loginResponse.cookie);
            }
            return normalizeUser({ ...loginProfile, ...accountProfile });
        },
        async logout() { await neteaseApi.logout(); },
        async getQrKey() {
            const response = await neteaseApi.getQrKey();
            return String(response?.data?.unikey || '');
        },
        async createQr(key) {
            const response = await neteaseApi.createQr(key);
            return String(response?.data?.qrimg || '');
        },
        async checkQr(key) {
            const response = await neteaseApi.checkQr(key);
            if (response?.code === 800) return { state: 'expired' };
            if (response?.code === 802) return { state: 'scanned' };
            if (response?.code === 803) {
                if (typeof response?.cookie === 'string' && response.cookie) {
                    writeProviderSessionValue('netease', 'cookie', response.cookie);
                }
                return { state: 'confirmed' };
            }
            if (response?.code === 801) return { state: 'waiting' };
            return { state: 'error', message: response?.message };
        },
    },
    library: {
        async getUserPlaylists(userId, limit, offset) {
            const response = await neteaseApi.getUserPlaylists(toNeteaseId(userId), limit, offset);
            const items = (response?.playlist || []).map((item: any) => normalizeCollection(item));
            return { items, hasMore: items.length === limit, nextOffset: offset + items.length };
        },
        async getLikedSongIds(userId) {
            const response = await neteaseApi.getLikedSongs(toNeteaseId(userId));
            return response?.ids || [];
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
        async getPersonalFm() {
            const response = await neteaseApi.getPersonalFm();
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
