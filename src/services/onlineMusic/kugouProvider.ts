import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    JsonValue,
    MediaId,
    OnlineMusicProvider,
    ProviderCatalogRef,
    ProviderCollection,
    ProviderPage,
    ProviderUser,
} from '../../types/onlineMusic';
import { fetchKugouLyrics } from '../../utils/lyrics/providers/kugouLyricProvider';
import { createProviderSongMetadata } from '../../utils/songMetadata';
import { normalizeSongTitleForLyricSearch } from '../../utils/lyrics/searchQuery';
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
    const list = data?.lists ?? data?.list ?? data?.info ?? data?.songs ?? data?.audios ?? data?.albums ?? data;
    return Array.isArray(list) ? list : [];
};

const coverOf = (raw: any): string | undefined => {
    const value = valueOf(raw, 'Image', 'image', 'img', 'pic', 'picUrl', 'cover', 'coverUrl', 'sizable_cover', 'sizable_avatar')
        ?? valueOf(raw?.album_info, 'cover', 'sizable_cover')
        ?? valueOf(raw?.trans_param, 'union_cover');
    if (!value) return undefined;
    const cover = String(value).trim().replace('{size}', '400');
    if (/^\d{8,}\.(?:jpe?g|png|webp)$/i.test(cover)) {
        return `https://imge.kugou.com/soft/collection/400/${cover.slice(0, 8)}/${cover}`;
    }
    if (cover.startsWith('//')) return `https:${cover}`;
    return cover.replace(/^http:/i, 'https:');
};

const hashOf = (raw: any): string => String(
    valueOf(raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'audio_hash', 'audioHash', 'kgHash')
    ?? valueOf(raw?.audio_info, 'hash', 'hash_128')
    ?? '',
).toUpperCase();

const jsonData = (entries: Array<[string, unknown]>): Record<string, JsonValue> => Object.fromEntries(
    entries.filter((entry): entry is [string, JsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

const catalogRef = (
    kind: ProviderCatalogRef['kind'],
    id: unknown,
): ProviderCatalogRef | undefined => (
    id !== undefined && id !== null && String(id) !== ''
        ? { providerId: 'kugou', kind, id: id as MediaId }
        : undefined
);

const normalizeArtists = (raw: any) => {
    const singers = valueOf(raw, 'Singers', 'singers', 'singerinfo', 'authors', 'artists');
    const usesSingerInfo = singers === raw?.singerinfo;
    if (Array.isArray(singers)) {
        return singers.map((artist: any, index: number) => {
            const base = artist?.base ?? artist;
            const authorId = valueOf(base, 'author_id', 'authorId')
                ?? (usesSingerInfo ? valueOf(base, 'id') : undefined);
            return {
                id: authorId ?? `kugou-artist-${index}`,
                name: String(valueOf(base, 'name', 'author_name', 'singername') || ''),
                ...(catalogRef('artist', authorId) ? { catalogRef: catalogRef('artist', authorId) } : {}),
            };
        }).filter(artist => artist.name);
    }
    const names = String(valueOf(raw, 'SingerName', 'singername', 'author_name', 'Singer') || '')
        .split(/[、,&/]/).map(name => name.trim()).filter(Boolean);
    return names.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name }));
};

const normalizeTimestamp = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric > 0 && numeric < 10000) return Date.UTC(Math.round(numeric), 0, 1);
        return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

// Some KuGou collection endpoints only expose "artist - title" through audio_name.
const normalizeKugouTitleAndArtists = (rawTitle: string, rawArtists: ReturnType<typeof normalizeArtists>) => {
    if (rawArtists.length > 0) {
        return {
            title: normalizeSongTitleForLyricSearch(rawTitle, rawArtists.map(artist => artist.name).join(', ')),
            artists: rawArtists,
        };
    }

    const combined = rawTitle.match(/^(.+?)\s+-\s+(.+)$/u);
    if (!combined) {
        return { title: rawTitle.trim(), artists: rawArtists };
    }

    const artistNames = combined[1]
        .split(/[、,&/]|\s+(?:feat\.?|ft\.?|featuring)\s+/iu)
        .map(name => name.trim())
        .filter(Boolean);
    if (artistNames.length === 0) {
        return { title: rawTitle.trim(), artists: rawArtists };
    }

    return {
        title: combined[2].trim(),
        artists: artistNames.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name })),
    };
};

export const normalizeKugouSong = (raw: unknown): UnifiedSong => {
    const item = raw as any;
    const base = item?.base ?? {};
    const audioInfo = item?.audio_info ?? item?.audioInfo ?? {};
    const hash = hashOf(item);
    const rawArtists = normalizeArtists(item);
    const nestedAlbum = valueOf(item, 'album_info', 'albumInfo', 'albuminfo', 'album') ?? {};
    const albumId = valueOf(item, 'AlbumID', 'album_id', 'albumId')
        ?? valueOf(nestedAlbum, 'album_id', 'albumId')
        ?? valueOf(base, 'album_id', 'albumId')
        ?? '';
    const albumCatalogRef = catalogRef('album', albumId);
    const albumName = String(
        valueOf(item, 'AlbumName', 'album_name', 'albumName', 'albumname')
        ?? valueOf(nestedAlbum, 'name', 'album_name', 'albumName')
        ?? valueOf(base, 'album_name', 'albumName')
        ?? ''
    );
    const durationValue = Number(
        valueOf(item, 'Duration', 'duration', 'timelen', 'timeLength', 'timelength')
        ?? valueOf(audioInfo, 'duration', 'timelength', 'duration_128')
        ?? 0,
    );
    const duration = durationValue > 0 && durationValue < 10000 ? durationValue * 1000 : durationValue;
    const mixSongId = valueOf(item, 'MixSongID', 'mixsongid', 'mixSongId')
        ?? valueOf(base, 'MixSongID', 'mixsongid', 'mixSongId');
    const albumAudioId = valueOf(item, 'album_audio_id', 'albumAudioId')
        ?? valueOf(base, 'album_audio_id', 'albumAudioId');
    const providerData = jsonData([
        ['hash', hash],
        ['mixSongId', mixSongId],
        ['albumAudioId', albumAudioId],
        ['catalogLookupId', albumAudioId ?? mixSongId],
        ['albumId', albumId],
        ['fileId', valueOf(item, 'FileID', 'fileid', 'file_id')],
    ]);
    const rawTitle = String(valueOf(
        item,
        'SongName', 'songname', 'songName',
        'OriSongName', 'ori_song_name', 'oriSongName',
        'FileName', 'filename', 'fileName',
        'name', 'audio_name',
    ) ?? valueOf(base, 'SongName', 'songname', 'songName', 'audio_name', 'audioName') ?? '');
    const { title, artists } = normalizeKugouTitleAndArtists(rawTitle, rawArtists);

    const album = {
        id: albumId,
        name: albumName,
        coverUrl: coverOf(item),
        ...(albumCatalogRef ? { catalogRef: albumCatalogRef } : {}),
    };

    return {
        id: hash,
        name: title,
        artists,
        album,
        durationMs: duration,
        kgHash: hash,
        sourceRef: { kind: 'online', providerId: 'kugou', mediaId: hash, providerData },
    };
};

const kugouCatalogMetadataRequests = new Map<string, Promise<any | null>>();

const getKugouCatalogLookupId = (song: SongResult): string => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'kugou'
        ? song.sourceRef
        : null;
    return String(sourceRef?.providerData?.catalogLookupId || '');
};

const requestKugouCatalogMetadata = (lookupId: string): Promise<any | null> => {
    const cached = kugouCatalogMetadataRequests.get(lookupId);
    if (cached) return cached;

    const request = requestKugou('krm_audio', {
        album_audio_id: lookupId,
        fields: 'album_info,authors.base,base,audio_info',
    }).then(response => listOf(response)[0] ?? null).catch(error => {
        kugouCatalogMetadataRequests.delete(lookupId);
        throw error;
    });
    kugouCatalogMetadataRequests.set(lookupId, request);
    return request;
};

const hasMatchingKugouHash = (metadata: any, song: SongResult): boolean => {
    const expectedHash = String(song.kgHash || (
        song.sourceRef?.kind === 'online' ? song.sourceRef.providerData?.hash : ''
    ) || '').toUpperCase();
    if (!expectedHash) return false;

    const audioInfo = metadata?.audio_info ?? metadata?.audioInfo ?? {};
    return [
        valueOf(audioInfo, 'hash', 'FileHash', 'fileHash'),
        valueOf(audioInfo, 'hash_128', 'hash128'),
    ].some(candidate => String(candidate || '').toUpperCase() === expectedHash);
};

// Hydrates canonical KuGou album/artist ids only after KRM metadata matches the song hash.
export const resolveKugouSongCatalogRefs = async (song: UnifiedSong): Promise<UnifiedSong> => {
    const lookupId = getKugouCatalogLookupId(song);
    if (!lookupId) return song;

    const metadata = await requestKugouCatalogMetadata(lookupId);
    if (!metadata || !hasMatchingKugouHash(metadata, song)) return song;

    const base = metadata.base ?? {};
    const albumInfo = metadata.album_info ?? metadata.albumInfo ?? {};
    const albumId = valueOf(albumInfo, 'album_id', 'albumId')
        ?? valueOf(base, 'album_id', 'albumId');
    const albumName = String(
        valueOf(albumInfo, 'album_name', 'albumName', 'name')
        ?? valueOf(base, 'album_name', 'albumName')
        ?? song.album.name,
    );
    const albumRef = catalogRef('album', albumId);
    const resolvedArtists = normalizeArtists(metadata);
    const artists = resolvedArtists.length > 0 ? resolvedArtists : song.artists;
    const coverUrl = coverOf(albumInfo) || song.album.coverUrl;
    const resolvedAlbumId = albumId ?? song.album.id;

    return {
        ...song,
        artists,
        album: {
            ...song.album,
            id: resolvedAlbumId,
            name: albumName,
            coverUrl,
            ...(albumRef ? { catalogRef: albumRef } : {}),
        },
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

const normalizeCollection = (raw: any, type = 'playlist', owned = false): ProviderCollection => {
    const id = type === 'playlist'
        ? valueOf(raw, 'global_collection_id')
        : type === 'album'
            ? valueOf(raw, 'album_id', 'AlbumID', 'albumId')
            : type === 'artist'
                ? valueOf(raw, 'author_id', 'authorId')
                : undefined;
    const artists = normalizeArtists(raw);
    const aliases = valueOf(raw, 'aliases', 'alias');
    const publishedAt = normalizeTimestamp(valueOf(raw, 'publish_time', 'publishTime', 'release_date', 'releaseDate', 'year'));
    const updatedAt = normalizeTimestamp(valueOf(raw, 'update_time', 'updateTime'));
    const tracksUpdatedAt = normalizeTimestamp(valueOf(raw, 'track_update_time', 'trackUpdateTime'));
    const playCount = Number(valueOf(raw, 'play_count', 'playCount'));
    const description = valueOf(raw, 'intro', 'description', 'brief_desc', 'briefDesc', 'brief_description', 'desc');

    return {
        providerId: 'kugou',
        id: id ?? '',
        name: String(valueOf(raw, 'name', 'listname', 'specialname', 'album_name', 'author_name') || ''),
        type,
        coverUrl: coverOf(raw),
        description: description === undefined || description === null ? undefined : String(description),
        trackCount: Number(valueOf(raw, 'song_count', 'count', 'total', 'music_num') || 0),
        ...(owned ? { isOwned: true } : {}),
        ...(type === 'artist' ? { albumCount: Number(valueOf(raw, 'album_count', 'albumCount') || 0) } : {}),
        ...(artists.length > 0 ? { artists } : {}),
        ...(Array.isArray(aliases) && aliases.length > 0 ? { aliases: aliases.map(String).filter(Boolean) } : {}),
        ...(publishedAt !== undefined ? { publishedAt } : {}),
        ...(typeof valueOf(raw, 'company', 'publisher') === 'string' && valueOf(raw, 'company', 'publisher')
            ? { publisher: String(valueOf(raw, 'company', 'publisher')) }
            : {}),
        ...(Number.isFinite(playCount) && playCount >= 0 ? { playCount } : {}),
        ...(updatedAt !== undefined ? { updatedAt } : {}),
        ...(tracksUpdatedAt !== undefined ? { tracksUpdatedAt } : {}),
        ...(Boolean(valueOf(raw, 'is_liked', 'isLiked')) ? { isLiked: true } : {}),
        providerData: jsonData([
            ['listId', valueOf(raw, 'listid', 'list_id')],
            ['globalCollectionId', valueOf(raw, 'global_collection_id')],
            ['specialId', valueOf(raw, 'specialid')],
            ['owned', owned],
            ['creatorUserId', valueOf(raw, 'create_userid', 'list_create_userid', 'userid')],
            ['creatorListId', valueOf(raw, 'create_listid', 'list_create_listid', 'listid')],
            ['creatorGid', valueOf(raw, 'gid', 'list_create_gid', 'global_collection_id')],
            ['musicSize', type === 'artist' ? valueOf(raw, 'song_count', 'music_num') : undefined],
            ['albumSize', type === 'artist' ? valueOf(raw, 'album_count') : undefined],
        ]),
    };
};

const pageOf = <T>(items: T[], raw: any, limit: number, offset: number): ProviderPage<T> => {
    const data = dataOf(raw);
    const total = Number(data?.total ?? raw?.total ?? data?.total_count ?? raw?.total_count ?? data?.count ?? items.length);
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
    normalizeUser,
    normalizeCollection,
    songMetadata: {
        getSongMetadata(song) {
            return createProviderSongMetadata(song);
        },
    },
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
                            status: valueOf(data, 'status') ?? valueOf(response, 'status'),
                            errorCode: valueOf(data, 'errcode', 'error_code') ?? valueOf(response, 'errcode', 'error_code'),
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
            const items = listOf(response)
                .map(item => normalizeCollection(item, 'playlist', true))
                .filter(collection => collection.id !== '');
            return pageOf(items, response, limit, offset);
        },
    },
    catalog: {
        canResolveSongCatalogRefs: song => Boolean(getKugouCatalogLookupId(song)),
        resolveSongCatalogRefs: resolveKugouSongCatalogRefs,
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
        async getPlaylistDetail(id, existingCollection) {
            const response = await requestKugou('playlist_detail', { ids: String(id) });
            const data = dataOf(response);
            const rawPlaylist = listOf(response)[0] ?? data?.info?.[0] ?? data;
            if (!rawPlaylist || typeof rawPlaylist !== 'object' || Array.isArray(rawPlaylist)) {
                return existingCollection || null;
            }
            const normalized = normalizeCollection({
                ...rawPlaylist,
                global_collection_id: valueOf(rawPlaylist, 'global_collection_id') ?? id,
            }, 'playlist', Boolean(existingCollection?.isOwned));
            return {
                ...normalized,
                name: normalized.name || existingCollection?.name || '',
                coverUrl: normalized.coverUrl || existingCollection?.coverUrl,
                description: normalized.description || existingCollection?.description,
                trackCount: normalized.trackCount || existingCollection?.trackCount,
                creator: normalized.creator || existingCollection?.creator,
                providerData: { ...existingCollection?.providerData, ...normalized.providerData },
            };
        },
        async getAlbumDetail(id, existingCollection) {
            const response = await requestKugou('album_detail', { id: String(id) });
            const data = dataOf(response);
            const rawAlbum = listOf(response)[0] ?? data?.album ?? data;
            if (!rawAlbum || typeof rawAlbum !== 'object' || Array.isArray(rawAlbum)) {
                return existingCollection || null;
            }

            const normalized = normalizeCollection({
                ...rawAlbum,
                album_id: valueOf(rawAlbum, 'album_id', 'AlbumID', 'albumId') ?? id,
            }, 'album');
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
        async getAlbumTracks(id, limit = 30, offset = 0, collection) {
            const pageSize = Math.min(Math.max(1, limit), 30);
            const response = await requestKugou('album_songs', {
                id: String(id),
                page: Math.floor(offset / pageSize) + 1,
                pagesize: pageSize,
            });
            const items = listOf(response).map(raw => {
                const song = normalizeKugouSong(raw);
                if (song.album.name || !collection?.name) return song;
                return {
                    ...song,
                    album: { ...song.album, name: collection.name },
                };
            });
            return pageOf(items, response, pageSize, offset);
        },
        async getArtistSongs(id, limit, offset) {
            const response = await requestKugou('artist_audios', { id: String(id), page: Math.floor(offset / limit) + 1, pagesize: limit });
            return pageOf(listOf(response).map(normalizeKugouSong), response, limit, offset);
        },
        async getArtistAlbums(id, limit, offset) {
            const response = await requestKugou('artist_albums', { id: String(id), page: Math.floor(offset / limit) + 1, pagesize: limit });
            const items = listOf(response)
                .map(item => normalizeCollection(item, 'album'))
                .filter(collection => collection.id !== '');
            return pageOf(items, response, limit, offset);
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
