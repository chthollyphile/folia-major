import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    JsonValue,
    MediaId,
    OnlineMusicProvider,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '../../types/onlineMusic';
import { fetchKugouLyrics } from '../../utils/lyrics/providers/kugouLyricProvider';
import { removeProviderSessionValue, readProviderSessionValue } from './providerStorage';
import { getKugouTransportAvailability, requestKugou } from './kugouTransport';

// src/services/onlineMusic/kugouProvider.ts

const valueOf = (raw: any, ...keys: string[]) => {
    for (const key of keys) {
        if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
    }
    return undefined;
};

// Selects one playable URL without coercing KuGou's candidate URL arrays into a comma-joined path.
const audioUrlOf = (raw: unknown): string | undefined => {
    const values = Array.isArray(raw) ? raw : [raw];
    const candidates = values.flatMap(value => (
        typeof value === 'string' ? value.split(/,\s*(?=https?:\/\/)/i) : []
    ));

    return candidates.find(candidate => {
        try {
            const protocol = new URL(candidate.trim()).protocol;
            return protocol === 'http:' || protocol === 'https:';
        } catch {
            return false;
        }
    })?.trim();
};

const dataOf = (raw: any): any => raw?.data ?? raw?.body?.data ?? raw?.body ?? raw;
const listOf = (raw: any): any[] => {
    const data = dataOf(raw);
    const list = data?.lists ?? data?.list ?? data?.info ?? data?.songs ?? data?.audios ?? data;
    return Array.isArray(list) ? list : [];
};

const coverOf = (raw: any): string | undefined => {
    const value = valueOf(raw, 'Image', 'image', 'img', 'pic', 'picUrl', 'cover', 'coverUrl', 'sizable_cover');
    return value ? String(value).replace('{size}', '400') : undefined;
};

const hashOf = (raw: any): string => String(valueOf(
    raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'audio_hash', 'audioHash', 'kgHash',
) || '').toUpperCase();

const jsonData = (entries: Array<[string, unknown]>): Record<string, JsonValue> => Object.fromEntries(
    entries.filter((entry): entry is [string, JsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

const normalizeArtists = (raw: any) => {
    const singers = valueOf(raw, 'Singers', 'singers', 'authors', 'artists');
    if (Array.isArray(singers)) {
        return singers.map((artist: any, index: number) => ({
            id: valueOf(artist, 'id', 'author_id', 'singerid', 'singerId') ?? `kugou-artist-${index}`,
            name: String(valueOf(artist, 'name', 'author_name', 'singername') || ''),
        })).filter(artist => artist.name);
    }
    const names = String(valueOf(raw, 'SingerName', 'singername', 'author_name', 'Singer') || '')
        .split(/[、,&/]/).map(name => name.trim()).filter(Boolean);
    return names.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name }));
};

export const normalizeKugouSong = (raw: unknown): UnifiedSong => {
    const item = raw as any;
    const hash = hashOf(item);
    const artists = normalizeArtists(item);
    const albumId = valueOf(item, 'AlbumID', 'album_id', 'albumId') ?? '';
    const albumName = String(valueOf(item, 'AlbumName', 'album_name', 'albumName') || '');
    const durationValue = Number(valueOf(item, 'Duration', 'duration', 'timelen', 'timeLength') || 0);
    const duration = durationValue > 0 && durationValue < 10000 ? durationValue * 1000 : durationValue;
    const providerData = jsonData([
        ['hash', hash],
        ['mixSongId', valueOf(item, 'MixSongID', 'mixsongid', 'mixSongId')],
        ['albumAudioId', valueOf(item, 'ID', 'album_audio_id', 'albumAudioId', 'audio_id')],
        ['albumId', albumId],
        ['fileId', valueOf(item, 'FileID', 'fileid', 'file_id')],
    ]);
    const title = String(valueOf(item, 'SongName', 'songname', 'songName', 'name', 'audio_name') || '');

    return {
        id: hash,
        name: title,
        artists,
        album: { id: albumId, name: albumName, picUrl: coverOf(item) },
        duration,
        ar: artists,
        al: { id: Number(albumId) || 0, name: albumName, picUrl: coverOf(item) },
        dt: duration,
        kgHash: hash,
        sourceRef: { kind: 'online', providerId: 'kugou', mediaId: hash, providerData },
    };
};

const normalizeUser = (raw: any): ProviderUser => {
    const data = dataOf(raw);
    const profile = data?.user_info ?? data?.userinfo ?? data?.profile ?? data;
    return {
        id: valueOf(profile, 'userid', 'user_id', 'id', 'uid')
            ?? readProviderSessionValue('kugou', 'userid')
            ?? '',
        nickname: String(valueOf(profile, 'nickname', 'nick_name', 'username', 'name') || ''),
        avatarUrl: coverOf(profile) || valueOf(profile, 'avatar', 'pic'),
        backgroundUrl: valueOf(profile, 'background', 'backgroundUrl', 'bg_pic'),
        vipType: Number(valueOf(profile, 'vip_type', 'vipType', 'is_vip') || 0),
    };
};

const normalizeCollection = (raw: any, type = 'playlist', owned = false): ProviderCollection => ({
    providerId: 'kugou',
    id: valueOf(raw, 'global_collection_id', 'listid', 'list_id', 'specialid', 'id', 'album_id', 'author_id') ?? '',
    name: String(valueOf(raw, 'name', 'listname', 'specialname', 'album_name', 'author_name') || ''),
    type,
    coverUrl: coverOf(raw),
    description: valueOf(raw, 'intro', 'description', 'desc'),
    trackCount: Number(valueOf(raw, 'song_count', 'count', 'total', 'music_num') || 0),
    providerData: jsonData([
        ['listId', valueOf(raw, 'listid', 'list_id')],
        ['globalCollectionId', valueOf(raw, 'global_collection_id')],
        ['specialId', valueOf(raw, 'specialid')],
        ['owned', owned],
        ['creatorUserId', valueOf(raw, 'create_userid', 'list_create_userid', 'userid')],
        ['creatorListId', valueOf(raw, 'create_listid', 'list_create_listid', 'listid')],
        ['creatorGid', valueOf(raw, 'gid', 'list_create_gid', 'global_collection_id')],
    ]),
});

const pageOf = <T>(items: T[], raw: any, limit: number, offset: number): ProviderPage<T> => {
    const data = dataOf(raw);
    const total = Number(data?.total ?? data?.total_count ?? data?.count ?? items.length);
    return { items, total, hasMore: offset + items.length < total || items.length === limit, nextOffset: offset + items.length };
};

const qualityValue = (quality: AudioQualityPreference): string => ({
    standard: '128', high: '320', lossless: 'flac', hires: 'high',
})[quality];

const QUALITY_FALLBACKS: Record<AudioQualityPreference, AudioQualityPreference[]> = {
    standard: ['standard'],
    high: ['high', 'standard'],
    lossless: ['lossless', 'high', 'standard'],
    hires: ['hires', 'lossless', 'high', 'standard'],
};

const qualityFallbacks = (quality: AudioQualityPreference): AudioQualityPreference[] => QUALITY_FALLBACKS[quality];

const getId = (value: MediaId | ProviderCollection | SongResult) => typeof value === 'object' ? value.id : value;

export const kugouProvider: OnlineMusicProvider = {
    id: 'kugou',
    displayName: 'KuGou Music',
    shortName: '酷狗',
    getAvailability: getKugouTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, auth: true, userLibrary: true,
        playlists: true, albums: true, artists: true, recommendations: true, mutations: true,
        wordByWordLyrics: true, userCloud: true, historyRecommendations: true,
        playlistSubscription: true, playlistTrackMutations: true, likes: false, userAlbums: false,
    },
    normalizeSong: normalizeKugouSong,
    search: {
        async searchSongs(query, limit, offset) {
            const page = Math.floor(offset / limit) + 1;
            const response = await requestKugou('search', { keywords: query, keyword: query, type: 'song', page, pagesize: limit });
            return pageOf(listOf(response).map(normalizeKugouSong).filter(song => song.id), response, limit, offset);
        },
    },
    playback: {
        async getSongDetail(id) {
            const response = await requestKugou('audio', { hash: String(id) });
            const item = listOf(response)[0] ?? dataOf(response);
            return hashOf(item) ? normalizeKugouSong(item) : null;
        },
        async getAudioSource(song, quality) {
            const sourceRef = song.sourceRef?.kind === 'online' ? song.sourceRef : null;
            const hash = String(sourceRef?.providerData?.hash || sourceRef?.mediaId || song.kgHash || song.id).toUpperCase();
            const qualities = sourceRef?.variant === 'cloud' ? [quality] : qualityFallbacks(quality);
            const albumId = String(sourceRef?.providerData?.albumId || '');
            const albumAudioId = String(sourceRef?.providerData?.albumAudioId || '');

            // Tries the preferred KuGou quality first and degrades until a playable URL is returned.
            for (const candidateQuality of qualities) {
                const requestVariants = sourceRef?.variant === 'cloud'
                    ? [{ name: 'cloud', operation: 'user_cloud_url' as const, params: {
                        hash, id: String(sourceRef.providerData?.fileId || ''),
                    } }]
                    : [
                        { name: 'metadata', operation: 'song_url' as const, params: {
                            hash,
                            quality: qualityValue(candidateQuality),
                            album_id: albumId,
                            album_audio_id: albumAudioId,
                        } },
                        ...((albumId || albumAudioId) ? [{ name: 'hash-only', operation: 'song_url' as const, params: {
                            hash,
                            quality: qualityValue(candidateQuality),
                            album_id: '',
                            album_audio_id: '',
                        } }] : []),
                    ];

                // Search metadata can contain album IDs that do not belong to the returned hash, so retry the same quality by hash alone first.
                for (const requestVariant of requestVariants) {
                    try {
                        const response = await requestKugou(requestVariant.operation, requestVariant.params);
                        const data = dataOf(response);
                        const url = audioUrlOf(
                            valueOf(data, 'play_url', 'playUrl', 'url')
                            ?? valueOf(data?.[0], 'url', 'play_url'),
                        );
                        if (url) {
                            console.info('[KuGouProvider] playback:url-resolved', {
                                hash,
                                requestedQuality: quality,
                                resolvedQuality: candidateQuality,
                                requestVariant: requestVariant.name,
                            });
                            return {
                                // Preserve the upstream candidate here; the shared playback transport normalizes its scheme.
                                url,
                                fetchedAt: Date.now(),
                                quality: candidateQuality,
                            };
                        }
                        console.warn('[KuGouProvider] playback:no-url', {
                            hash,
                            requestedQuality: quality,
                            candidateQuality,
                            requestVariant: requestVariant.name,
                            status: data?.status ?? response?.status,
                            errorCode: data?.errcode ?? data?.error_code ?? response?.errcode ?? response?.error_code,
                        });
                    } catch (error) {
                        console.warn('[KuGouProvider] playback:quality-failed', {
                            hash,
                            requestedQuality: quality,
                            candidateQuality,
                            requestVariant: requestVariant.name,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
            }
            console.warn('[KuGouProvider] playback:unavailable', { hash, requestedQuality: quality, attemptedQualities: qualities });
            return null;
        },
    },
    lyrics: {
        async getLyrics(song) {
            const lyrics = await fetchKugouLyrics(song);
            return { lyrics, isPureMusic: Boolean(lyrics?.isPureMusic), wordByWordText: lyrics ? 'krc' : null };
        },
    },
    auth: {
        async getLoginStatus() {
            const userId = readProviderSessionValue('kugou', 'userid');
            const hasElectronTransport = typeof window !== 'undefined' && Boolean(window.electron?.kugouRequest);
            console.info('[KugouProvider] login-status:start', {
                transport: hasElectronTransport ? 'electron' : 'web',
                hasWebUserId: Boolean(userId),
            });
            if (!userId && !hasElectronTransport) return null;
            try {
                const response = await requestKugou('user_detail', { userid: userId || undefined });
                const user = normalizeUser(response);
                const responseKeys = Object.keys(dataOf(response) || {});
                console.info('[KugouProvider] login-status:profile', {
                    responseKeys: responseKeys.slice(0, 20),
                    responseKeyCount: responseKeys.length,
                    hasUserId: Boolean(user.id),
                    hasNickname: Boolean(user.nickname),
                    hasAvatar: Boolean(user.avatarUrl),
                });
                return user.id && user.nickname ? user : null;
            } catch (error) {
                console.warn('[KugouProvider] login-status:error', {
                    name: error instanceof Error ? error.name : 'Error',
                    message: error instanceof Error ? error.message : String(error),
                });
                return null;
            }
        },
        async logout() {
            await requestKugou('logout').catch(() => undefined);
            ['cookie', 'token', 'userid', 'dfid'].forEach(key => removeProviderSessionValue('kugou', key));
        },
        async getQrKey() {
            const response = await requestKugou('login_qr_key');
            const data = dataOf(response);
            return String(valueOf(data, 'qrcode', 'qrkey', 'key', 'ticket') || '');
        },
        async createQr(key) {
            const response = await requestKugou('login_qr_create', { key, qrimg: true });
            const data = dataOf(response);
            return String(valueOf(data, 'base64', 'qrimg', 'qrcode', 'url') || '');
        },
        async checkQr(key) {
            const response = await requestKugou('login_qr_check', { key, qrcode: key });
            const data = dataOf(response);
            const status = Number(valueOf(data, 'status', 'code') ?? valueOf(response, 'status', 'code'));
            if (status === 0) return { state: 'expired' };
            if (status === 1) return { state: 'waiting' };
            if (status === 2 || status === 3) return { state: 'scanned' };
            if (status === 4 || data?.token) return { state: 'confirmed' };
            return { state: 'error', message: String(valueOf(data, 'message', 'msg', 'error') || '') };
        },
    },
    library: {
        async getUserPlaylists(userId, limit, offset) {
            const response = await requestKugou('user_playlist', { userid: String(userId), page: Math.floor(offset / limit) + 1, pagesize: limit });
            return pageOf(listOf(response).map(item => normalizeCollection(item, 'playlist', true)), response, limit, offset);
        },
    },
    catalog: {
        async getPlaylistTracks(id, limit, offset) {
            const response = await requestKugou('playlist_track_all', { id: String(id), pagesize: limit, page: Math.floor(offset / limit) + 1 });
            return pageOf(listOf(response).map(normalizeKugouSong), response, limit, offset);
        },
        async getCloudTracks(limit, offset) {
            const response = await requestKugou('user_cloud', { page: Math.floor(offset / limit) + 1, pagesize: limit });
            const items = listOf(response).map(item => {
                const song = normalizeKugouSong(item);
                return { ...song, sourceRef: { ...song.sourceRef, variant: 'cloud' } };
            });
            return pageOf(items, response, limit, offset);
        },
        async getAlbumTracks(id, limit = 100, offset = 0) {
            const response = await requestKugou('album_songs', { id: String(id), page: Math.floor(offset / limit) + 1, pagesize: limit });
            return pageOf(listOf(response).map(normalizeKugouSong), response, limit, offset);
        },
        async getArtistSongs(id, limit, offset) {
            const response = await requestKugou('artist_audios', { id: String(id), page: Math.floor(offset / limit) + 1, pagesize: limit });
            return pageOf(listOf(response).map(normalizeKugouSong), response, limit, offset);
        },
        async getArtistAlbums(id, limit, offset) {
            const response = await requestKugou('artist_albums', { id: String(id), page: Math.floor(offset / limit) + 1, pagesize: limit });
            return pageOf(listOf(response).map(item => normalizeCollection(item, 'album')), response, limit, offset);
        },
        async getArtistDetail(id) {
            const response = await requestKugou('artist_detail', { id: String(id) });
            const data = dataOf(response);
            return data ? normalizeCollection(data, 'artist') : null;
        },
    },
    recommendations: {
        async getDailySongs() {
            const response = await requestKugou('everyday_recommend');
            return listOf(response).map(normalizeKugouSong);
        },
        async getPersonalFm() {
            const response = await requestKugou('personal_fm');
            return listOf(response).map(normalizeKugouSong);
        },
        async getHistoryEntries() {
            const response = await requestKugou('everyday_history');
            return listOf(response).map((item: any) => ({
                id: String(valueOf(item, 'date', 'history_name', 'id') || ''),
                label: String(valueOf(item, 'history_name', 'date', 'name') || ''),
                providerData: jsonData([['date', valueOf(item, 'date')], ['historyName', valueOf(item, 'history_name')]]),
            }));
        },
        async getHistorySongs(entry) {
            const id = typeof entry === 'string' ? entry : entry.id;
            const response = await requestKugou('everyday_history', { date: id, history_name: typeof entry === 'string' ? entry : String(entry.providerData?.historyName || entry.label) });
            return listOf(response).map(normalizeKugouSong);
        },
    },
    mutations: {
        async updatePlaylistTracks(operation, playlist, tracks) {
            const collection = typeof playlist === 'object' ? playlist : null;
            const listId = String(collection?.providerData?.listId || getId(playlist));
            if (operation === 'add') {
                const data = tracks.map(track => {
                    if (typeof track !== 'object') return `|${String(track).toUpperCase()}|0|0`;
                    const sourceData = track.sourceRef?.kind === 'online' ? track.sourceRef.providerData : undefined;
                    return [
                        track.name,
                        String(sourceData?.hash || track.kgHash || track.id).toUpperCase(),
                        String(sourceData?.albumId || track.album?.id || 0),
                        String(sourceData?.mixSongId || 0),
                    ].join('|');
                }).join(',');
                await requestKugou('playlist_tracks_add', { listid: listId, data });
                return;
            }
            const fileids = tracks.map(track => {
                if (typeof track !== 'object') return String(track);
                const sourceData = track.sourceRef?.kind === 'online' ? track.sourceRef.providerData : undefined;
                return String(sourceData?.fileId || track.id);
            }).join(',');
            await requestKugou('playlist_tracks_del', { listid: listId, fileids });
        },
        async subscribePlaylist(playlist, subscribed) {
            const collection = typeof playlist === 'object' ? playlist : null;
            const providerData = collection?.providerData;
            const listId = String(providerData?.listId || getId(playlist));
            if (!subscribed) {
                await requestKugou('playlist_del', { listid: listId });
                return;
            }
            await requestKugou('playlist_add', {
                name: collection?.name || '',
                type: 1,
                source: 1,
                list_create_userid: String(providerData?.creatorUserId || ''),
                list_create_listid: String(providerData?.creatorListId || listId),
                list_create_gid: String(providerData?.creatorGid || ''),
            });
        },
    },
};
