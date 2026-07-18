import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderLyricsResult,
    ProviderUser,
} from '../../types/onlineMusic';
import { processNeteaseLyrics } from '../../utils/lyrics/neteaseProcessing';
import { neteaseApi } from '../netease';
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

const normalizeCollection = (raw: any, type = 'playlist'): ProviderCollection => ({
    providerId: 'netease',
    id: raw?.id ?? 0,
    name: raw?.name || '',
    type: raw?.specialType === 'cloud' ? 'cloud' : type,
    coverUrl: raw?.coverImgUrl || raw?.picUrl,
    description: raw?.description,
    trackCount: raw?.trackCount ?? raw?.size,
    creator: raw?.creator ? normalizeUser(raw.creator) : undefined,
});

const extractCloudLyricText = (response: any): string => (
    response?.lrc || response?.data?.lrc || response?.lyric || response?.data?.lyric || ''
);

export const normalizeNeteaseSong = (raw: unknown): UnifiedSong => {
    const normalized = neteaseApi.normalizeSongResult(raw);
    const isCloud = normalized.t === 1 || normalized.t === 2 || normalized.sourceType === 'cloud';
    return {
        ...normalized,
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
        const processed = await processNeteaseLyrics({ type: 'netease', lrc: { lyric: mainText } }, { songId: toNeteaseId(song.id) });
        return {
            lyrics: processed.lyrics,
            mainText,
            wordByWordText: null,
            translationText: null,
            isPureMusic: processed.isPureMusic,
            chorusRanges: processed.chorusRanges,
        };
    }

    const response = await neteaseApi.getLyric(toNeteaseId(song.id));
    const processed = await processNeteaseLyrics(neteaseApi.getProcessedLyricPayload(response), { songId: toNeteaseId(song.id) });
    return {
        lyrics: processed.lyrics,
        mainText: processed.mainLrc,
        wordByWordText: processed.yrcLrc,
        translationText: processed.transLrc,
        isPureMusic: processed.isPureMusic,
        chorusRanges: processed.chorusRanges,
    };
};

export const neteaseProvider: OnlineMusicProvider = {
    id: 'netease',
    displayName: 'NetEase Cloud Music',
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
    },
    normalizeSong: normalizeNeteaseSong,
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
    },
    lyrics: { getLyrics },
    auth: {
        async getLoginStatus() {
            const response = await neteaseApi.getLoginStatus();
            const profile = response?.data?.profile;
            return profile ? normalizeUser(profile) : null;
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
                providerData: {
                    musicSize: Number(artist.musicSize || 0),
                    albumSize: Number(artist.albumSize || 0),
                    transNames: Array.isArray(artist.transNames) ? artist.transNames.map(String) : [],
                },
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
        async getHistoryDates() {
            const response = await neteaseApi.getDailyRecommendationHistoryDates();
            return response?.data?.dates || response?.dates || [];
        },
        async getHistorySongs(date) {
            const response = await neteaseApi.getDailyRecommendationHistoryDetail(date);
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
        async likeSong(id, liked) { await neteaseApi.likeSong(toNeteaseId(id), liked); },
        async updatePlaylistTracks(operation, playlistId, trackIds) {
            await neteaseApi.updatePlaylistTracks(operation, toNeteaseId(playlistId), trackIds.map(toNeteaseId));
        },
        async subscribePlaylist(id, subscribed) { await neteaseApi.subscribePlaylist(toNeteaseId(id), subscribed); },
        async subscribeAlbum(id, subscribed) { await neteaseApi.subscribeAlbum(toNeteaseId(id), subscribed); },
    },
};
