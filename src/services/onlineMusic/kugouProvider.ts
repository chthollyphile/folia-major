import type { SongResult, UnifiedSong } from '../../types';
import type {
    AudioQualityPreference,
    ChorusRange,
    JsonValue,
    MediaId,
    OnlineMusicProvider,
    ProviderCatalogRef,
    ProviderCollection,
    ProviderHistoryEntry,
    ProviderPage,
    ProviderUser,
} from '../../types/onlineMusic';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../utils/lyrics/pureMusic';
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

// Unwrap the nested envelopes used by the different KuGou recommendation endpoints.
const listOf = (raw: any): any[] => {
    const queue: any[] = [dataOf(raw)];
    const listKeys = [
        'lists', 'list', 'info', 'songs', 'song_list', 'songlist', 'songList', 'audios', 'albums', 'items', 'records',
        'special', 'specials', 'special_list', 'playlist', 'playlists',
        'recommend_list', 'recommendations', 'data', 'result', 'response',
    ];
    const visited = new Set<object>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) return current;
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);

        for (const key of listKeys) {
            const value = current[key];
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object') queue.push(value);
        }
    }

    return [];
};

const coverOf = (raw: any): string | undefined => {
    // Youth card songs carry the album art in album_info/audio_info; user_pic is only the uploader avatar.
    const value = valueOf(raw?.album_info, 'sizable_cover', 'cover')
        ?? valueOf(raw?.albumInfo, 'sizable_cover', 'cover')
        ?? valueOf(raw?.audio_info?.trans_param, 'union_cover')
        ?? valueOf(raw?.audioInfo?.transParam, 'union_cover')
        ?? valueOf(raw?.trans_param, 'union_cover')
        ?? valueOf(raw, 'Image', 'image', 'img', 'pic', 'picUrl', 'cover', 'coverUrl', 'sizable_cover', 'sizable_avatar');
    if (!value) return undefined;
    const cover = String(value).trim().replace('{size}', '400');
    if (/^\d{8,}\.(?:jpe?g|png|webp)$/i.test(cover)) {
        return `https://c1.kgimg.com/stdmusic/400/${cover.slice(0, 8)}/${cover}`;
    }
    if (cover.startsWith('//')) return `https:${cover}`;
    return cover.replace(/^http:/i, 'https:');
};

const hashOf = (raw: any): string => String(
    valueOf(raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'audio_hash', 'audioHash', 'kgHash')
    ?? valueOf(raw?.audio_info, 'hash', 'hash_128')
    ?? '',
).toUpperCase();

const isKugouSongPayload = (raw: any): boolean => Boolean(
    valueOf(raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'songid', 'songId', 'SongName', 'songname', 'songName', 'ori_audio_name', 'audio_name')
    ?? valueOf(raw?.base, 'songid', 'songId', 'songname', 'songName')
);

// Finds song arrays even when KuGou wraps recommendations in several data/card envelopes.
const songListOf = (raw: any): any[] => {
    const queue: any[] = [dataOf(raw)];
    const listKeys = [
        'song_list', 'songlist', 'songList', 'songs', 'audios', 'list', 'lists', 'info', 'items',
        'records', 'song_info', 'songInfo', 'data', 'result', 'response',
    ];
    const visited = new Set<object>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            if (current.some(isKugouSongPayload)) return current;
            current.forEach(item => {
                if (item && typeof item === 'object') queue.push(item);
            });
            continue;
        }
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        if (isKugouSongPayload(current)) return [current];

        for (const key of listKeys) {
            const value = current[key];
            if (Array.isArray(value)) queue.push(value);
            else if (value && typeof value === 'object') queue.push(value);
        }
    }

    return [];
};

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
        valueOf(item, 'Duration', 'duration', 'timelen', 'timeLength', 'timelength', 'time_length')
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
        'ori_audio_name', 'oriAudioName',
        'OriSongName', 'ori_song_name', 'oriSongName',
        'FileName', 'filename', 'fileName',
        'name', 'audio_name',
    ) ?? valueOf(audioInfo, 'ori_audio_name', 'oriAudioName', 'audio_name', 'audioName')
        ?? valueOf(base, 'SongName', 'songname', 'songName', 'audio_name', 'audioName') ?? '');
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

const KUGOU_RECOMMENDATION_PAGE_SIZE = 30;
const KUGOU_MAX_PAGE_SIZE = 100;
const KUGOU_RECOMMENDATION_CARDS = [
    { id: 3006, name: 'VIP 专属推荐' },
    { id: 3001, name: '私人专属好歌' },
    { id: 3004, name: '小众宝藏佳作' },
    { id: 3014, name: '喜欢这首歌的 TA 也喜欢' },
    { id: 3101, name: '概念 er 新推' },
    { id: 3005, name: '潮流尝鲜' },
] as const;

const kugouRecommendationTrackCache = new Map<number, UnifiedSong[]>();

// Loads one KuGou recommendation card and keeps its normalized songs for the virtual playlist.
const getKugouRecommendationCard = async (cardId: number, pagesize = KUGOU_RECOMMENDATION_PAGE_SIZE) => {
    const response = await requestKugou('top_card_youth', { card_id: cardId, pagesize });
    const songs = songListOf(response)
        .map(normalizeKugouSong)
        .filter(song => song.id);
    kugouRecommendationTrackCache.set(cardId, songs);
    return { response, songs };
};

const getKugouRecommendationCardId = (collection: ProviderCollection | undefined, id?: MediaId): number | undefined => {
    const providerCardId = collection?.providerData?.cardId;
    const cardId = Number(providerCardId ?? String(id ?? '').match(/^kugou-card-(\d+)$/u)?.[1]);
    return Number.isInteger(cardId) && cardId > 0 ? cardId : undefined;
};

const isKugouVirtualRecommendation = (collection: ProviderCollection | undefined): boolean => (
    collection?.providerId === 'kugou' && collection.providerData?.virtualRecommendation === true
);

// Builds the Omni playlist object used by the radio surface for song-card recommendations.
const createKugouRecommendationCollection = (
    card: (typeof KUGOU_RECOMMENDATION_CARDS)[number],
    response: any,
    songs: UnifiedSong[],
): ProviderCollection => {
    const data = dataOf(response);
    const name = String(valueOf(data, 'card_name', 'cardName', 'module_name', 'moduleName', 'title', 'name') || card.name);
    const description = valueOf(data, 'description', 'desc', 'subtitle', 'sub_title');

    return {
        providerId: 'kugou',
        id: `kugou-card-${card.id}`,
        name,
        type: 'playlist',
        ...(songs[0]?.album.coverUrl ? { coverUrl: songs[0].album.coverUrl } : {}),
        ...(description ? { description: String(description) } : {}),
        trackCount: songs.length,
        providerData: {
            virtualRecommendation: true,
            cardId: card.id,
        },
    };
};

const getKugouRecommendationPage = async (
    collection: ProviderCollection | undefined,
    limit: number,
    offset: number,
): Promise<ProviderPage<UnifiedSong> | null> => {
    const cardId = getKugouRecommendationCardId(collection);
    if (!isKugouVirtualRecommendation(collection) || cardId === undefined) return null;

    const songs = kugouRecommendationTrackCache.get(cardId)
        ?? (await getKugouRecommendationCard(cardId)).songs;
    const items = songs.slice(offset, offset + limit);
    return {
        items,
        total: songs.length,
        hasMore: offset + items.length < songs.length,
        nextOffset: offset + items.length,
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
    }).then(
        response => {
            if (kugouCatalogMetadataRequests.get(lookupId) === request) {
                kugouCatalogMetadataRequests.delete(lookupId);
            }
            return listOf(response)[0] ?? null;
        },
        error => {
            if (kugouCatalogMetadataRequests.get(lookupId) === request) {
                kugouCatalogMetadataRequests.delete(lookupId);
            }
            throw error;
        },
    );
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

// Maps the dedicated VIP response, including active product entries used by concept accounts.
const normalizeKugouVipType = (raw: any): number => {
    const data = dataOf(raw);
    const directVipType = Number(valueOf(data, 'vip_type', 'vipType', 'is_vip') || 0);
    if (directVipType > 0) return directVipType;

    const businessVips = Array.isArray(data?.busi_vip) ? data.busi_vip : [];
    return businessVips.some((entry: any) => Number(valueOf(entry, 'is_vip', 'vip_type') || 0) > 0) ? 1 : 0;
};

const ensureKugouYouthVip = async (userId?: string): Promise<boolean> => {
    try {
        const token = readProviderSessionValue('kugou', 'token');
        const params = {
            ...(userId ? { userid: userId } : {}),
            ...(token ? { token } : {}),
        };
        const unionResponse: any = await requestKugou('youth_union_vip', params);
        const unionData = dataOf(unionResponse);
        const errCode = Number(valueOf(unionResponse, 'errcode', 'error_code') ?? valueOf(unionData, 'errcode', 'error_code') ?? 0);

        if (errCode !== 0 || !unionData || typeof unionData !== 'object') {
            console.warn('[KugouProvider] youth-union-vip:api-error', { errCode, response: unionResponse });
            return false;
        }

        const isUnionVip = normalizeKugouVipType(unionResponse) > 0;
        if (!isUnionVip) {
            console.info('[KugouProvider] youth-union-vip:not-vip, requesting youth_day_vip');
            await requestKugou('youth_day_vip', params);
            return true;
        }
        console.info('[KugouProvider] youth-union-vip:already-vip, skipping youth_day_vip');
    } catch (error) {
        const message = error instanceof Error ? error.message : typeof error === 'object' && error !== null ? JSON.stringify(error) : String(error);
        console.warn('[KugouProvider] youth-vip-check:failed', { error: message });
    }
    return false;
};

const normalizeCollection = (raw: any, type = 'playlist', owned = false): ProviderCollection => {
    const id = type === 'playlist'
        ? valueOf(raw, 'global_collection_id', 'globalCollectionId', 'specialid', 'specialId', 'id')
        : type === 'album'
            ? valueOf(raw, 'album_id', 'AlbumID', 'albumId', 'musiclib_id', 'musicLibId', 'list_create_listid')
            : type === 'artist'
                ? valueOf(raw, 'author_id', 'authorId')
                : undefined;
    const artists = normalizeArtists(raw);
    const aliases = valueOf(raw, 'aliases', 'alias');
    const publishedAt = normalizeTimestamp(valueOf(raw, 'publish_time', 'publishTime', 'release_date', 'releaseDate', 'year'));
    const updatedAt = normalizeTimestamp(valueOf(raw, 'update_time', 'updateTime'));
    const tracksUpdatedAt = normalizeTimestamp(valueOf(raw, 'track_update_time', 'trackUpdateTime', 'list_ver', 'listVer'));
    const playCount = Number(valueOf(raw, 'play_count', 'playCount'));
    const description = valueOf(raw, 'intro', 'description', 'brief_desc', 'briefDesc', 'brief_description', 'desc');
    const trackCountValue = valueOf(raw, 'song_count', 'count', 'm_count', 'total', 'music_num');
    const trackCount = trackCountValue === undefined ? undefined : Number(trackCountValue);

    return {
        providerId: 'kugou',
        id: id ?? '',
        name: String(valueOf(raw, 'name', 'listname', 'specialname', 'album_name', 'author_name') || ''),
        type,
        coverUrl: coverOf(raw),
        description: description === undefined || description === null ? undefined : String(description),
        ...(Number.isFinite(trackCount) ? { trackCount } : {}),
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

type KugouUserCollectionType = 'playlist' | 'album';

// Distinguishes KuGou's mixed user-library response before normalizing collection ids.
const getKugouUserCollectionType = (raw: any): KugouUserCollectionType => {
    const source = Number(valueOf(raw, 'source'));
    return source === 2 || valueOf(raw, 'musiclib_id', 'musicLibId') !== undefined
        ? 'album'
        : 'playlist';
};

const isKugouOwnedPlaylist = (raw: any): boolean => {
    const type = valueOf(raw, 'type');
    return type === undefined || type === null || Number(type) === 0;
};

// Restricts the player-panel destination list to KuGou playlists that accept user track mutations.
const canAddToKugouPlaylist = (playlist: ProviderCollection): boolean => {
    if (playlist.type !== 'playlist' || playlist.isOwned !== true) return false;

    const listId = String(playlist.providerData?.listId || '');
    const name = playlist.name.trim();
    return listId !== '2' && name !== '我喜欢' && name !== '我喜欢的音乐';
};

// Advances mixed user-library pagination with the raw response count, not the filtered item count.
const userCollectionPageOf = <T>(
    items: T[],
    response: any,
    limit: number,
    offset: number,
    rawItemCount: number,
): ProviderPage<T> => {
    const data = dataOf(response);
    const totalCandidate = [data?.total, data?.list_count, data?.total_count, data?.count]
        .map(value => Number(value))
        .find(value => Number.isFinite(value) && value >= 0);
    const nextOffset = offset + rawItemCount;
    return {
        items,
        ...(totalCandidate !== undefined ? { total: totalCandidate } : {}),
        hasMore: totalCandidate !== undefined ? nextOffset < totalCandidate : rawItemCount === limit,
        nextOffset,
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

const getKugouUserId = (): string => String(readProviderSessionValue('kugou', 'userid') || '');

const kugouChorusRangesCache = new Map<string, Promise<ChorusRange[]>>();

// Converts KuGou's millisecond climax payload into the shared second-based range model.
const parseKugouChorusRanges = (response: unknown): ChorusRange[] => {
    const ranges = (response as any)?.data;
    if (!Array.isArray(ranges)) return [];

    return ranges
        .map((range: any) => ({
            startTime: Number(range?.start_time) / 1000,
            endTime: Number(range?.end_time) / 1000,
        }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};

const getKugouChorusRanges = async (songId: MediaId): Promise<ChorusRange[]> => {
    const hash = String(songId).trim().toUpperCase();
    if (!hash) return [];

    const cached = kugouChorusRangesCache.get(hash);
    if (cached) return cached;

    const request = requestKugou('song_climax', { hash })
        .then(parseKugouChorusRanges)
        .catch(error => {
            console.warn(`[KugouProvider] Failed to fetch chorus ranges for song ${hash}:`, error);
            return [];
        });
    kugouChorusRangesCache.set(hash, request);
    return request;
};

const getKugouLyricCandidate = async (song: SongResult): Promise<any | null> => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'kugou'
        ? song.sourceRef
        : null;
    const albumAudioId = sourceRef?.providerData?.albumAudioId
        ?? sourceRef?.providerData?.mixSongId
        ?? sourceRef?.providerData?.catalogLookupId;
    const response = await requestKugou('search_lyric', {
        hash: String(song.kgHash ?? song.id).toUpperCase(),
        duration: song.durationMs,
        man: 'no',
        ...(albumAudioId !== undefined ? { album_audio_id: String(albumAudioId) } : {}),
    });
    const candidates = (response as any)?.candidates;
    return Array.isArray(candidates) ? candidates[0] ?? null : null;
};

// Fetches the server-decoded KRC payload exposed by the current KuGou provider API.
const getKugouLyrics = async (song: SongResult) => {
    const candidate = await getKugouLyricCandidate(song);
    if (!candidate?.id || !candidate?.accesskey) {
        return { lyrics: null, isPureMusic: false, chorusRanges: [] };
    }

    const response = await requestKugou('lyric', {
        id: String(candidate.id),
        accesskey: String(candidate.accesskey),
        fmt: 'krc',
        decode: true,
    });
    const lyricText = typeof (response as any)?.decodeContent === 'string'
        ? (response as any).decodeContent
        : '';
    if (isPureMusicLyricText(lyricText)) {
        return { lyrics: null, mainText: lyricText, wordByWordText: lyricText, isPureMusic: true, chorusRanges: [] };
    }
    const parsed = lyricText ? parseLyricsByFormat('krc', lyricText, '') : null;
    if (!parsed) {
        return { lyrics: null, mainText: lyricText || null, wordByWordText: lyricText || null, isPureMusic: false, chorusRanges: [] };
    }
    parsed.isWordByWord = true;
    const songId = song.kgHash ?? song.id;
    return {
        lyrics: parsed,
        mainText: lyricText,
        wordByWordText: lyricText,
        isPureMusic: false,
        chorusRanges: await getKugouChorusRanges(songId),
    };
};

const getKugouUserPlaylistItems = async (userId: MediaId): Promise<any[]> => {
    const response = await requestKugou('user_playlist', {
        userid: String(userId),
        page: 1,
        pagesize: 100,
    });
    return listOf(response);
};

// Loads the raw album metadata needed by KuGou's playlist-based album subscription endpoint.
const getKugouAlbumDetailRaw = async (id: MediaId): Promise<any | null> => {
    const response = await requestKugou('album_detail', { id: String(id) });
    const data = dataOf(response);
    const rawAlbum = listOf(response)[0] ?? data?.album ?? data;
    return rawAlbum && typeof rawAlbum === 'object' && !Array.isArray(rawAlbum) ? rawAlbum : null;
};

// Identifies KuGou's built-in "我喜欢" playlist, which is the provider's song-like collection.
const isKugouLikedPlaylist = (raw: any): boolean => {
    if (getKugouUserCollectionType(raw) !== 'playlist') return false;
    const name = String(valueOf(raw, 'name', 'listname') || '').trim();
    return name === '我喜欢' || name === '我喜欢的音乐' || valueOf(raw, 'listid', 'list_id') === 2;
};

// Finds KuGou's built-in "我喜欢" playlist, which is the provider's song-like collection.
const getKugouLikedPlaylist = async (userId: MediaId): Promise<any | null> => {
    const items = await getKugouUserPlaylistItems(userId);
    return items.find(isKugouLikedPlaylist) ?? null;
};

// Uses the newest song's observed cover when KuGou leaves a user playlist cover empty.
const getKugouPlaylistFallbackCover = async (rawPlaylist: any): Promise<string | undefined> => {
    const globalCollectionId = valueOf(rawPlaylist, 'global_collection_id', 'globalCollectionId');
    if (globalCollectionId === undefined || globalCollectionId === null) return undefined;

    const response = await requestKugou('playlist_track_all', {
        id: String(globalCollectionId),
        page: 1,
        pagesize: 1,
    });
    return listOf(response)
        .map(normalizeKugouSong)
        .map(song => song.album.coverUrl)
        .find((cover): cover is string => Boolean(cover));
};

const getKugouTrackAddData = (track: MediaId | SongResult): string => {
    if (typeof track !== 'object') return `|${String(track).toUpperCase()}|0|0`;
    const sourceData = track.sourceRef?.kind === 'online' ? track.sourceRef.providerData : undefined;
    return [
        track.name,
        String(sourceData?.hash || track.kgHash || track.id).toUpperCase(),
        String(sourceData?.albumId || track.album?.id || 0),
        String(sourceData?.mixSongId || 0),
    ].join('|');
};

const getKugouTrackFileId = (track: MediaId | SongResult): string => {
    if (typeof track !== 'object') return String(track);
    const sourceData = track.sourceRef?.kind === 'online' ? track.sourceRef.providerData : undefined;
    return String(sourceData?.fileId || track.id);
};

const kugouHistoryNameByDate = new Map<string, string>();

const normalizeKugouHistoryEntries = (response: any): ProviderHistoryEntry[] => {
    const entries = listOf(response).map((item: any) => ({
        id: String(valueOf(item, 'date', 'history_name', 'id') || ''),
        label: String(valueOf(item, 'history_name', 'date', 'name') || ''),
        providerData: jsonData([['date', valueOf(item, 'date')], ['historyName', valueOf(item, 'history_name')]]),
    }));

    entries.forEach(entry => {
        const date = String(entry.providerData?.date || entry.id);
        const historyName = String(entry.providerData?.historyName || entry.label);
        if (date && historyName) kugouHistoryNameByDate.set(date, historyName);
    });
    return entries;
};

// Resolves the provider's internal history name when the Omni caller only has a display date.
const getKugouHistoryName = async (date: string): Promise<string> => {
    const cached = kugouHistoryNameByDate.get(date);
    if (cached) return cached;

    const response = await requestKugou('everyday_history', { mode: 'list' });
    normalizeKugouHistoryEntries(response);
    return kugouHistoryNameByDate.get(date) || date;
};

export const kugouProvider: OnlineMusicProvider = {
    id: 'kugou',
    displayName: 'KuGou Music',
    shortName: '酷狗',
    getAvailability: getKugouTransportAvailability,
    capabilities: {
        search: true, playback: true, lyrics: true, auth: true, userLibrary: true,
        playlists: true, albums: true, artists: true, recommendations: true, mutations: true,
        wordByWordLyrics: true, userCloud: true, historyRecommendations: true,
        playlistSubscription: true, playlistTrackMutations: true, likes: true, userAlbums: true,
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
        getLyrics: getKugouLyrics,
        getChorusRanges: getKugouChorusRanges,
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
                let user = normalizeUser(response);
                if (user.id && user.nickname) {
                    try {
                        const claimedYouthVip = await ensureKugouYouthVip(String(user.id));
                        const vipResponse = await requestKugou('user_vip_detail', { userid: String(user.id) });
                        user = { ...user, vipType: normalizeKugouVipType(vipResponse) };
                        if (claimedYouthVip && user.vipType === 0) {
                            user = { ...user, vipType: 1 };
                        }
                    } catch (error) {
                        console.warn('[KugouProvider] login-status:vip-error', {
                            name: error instanceof Error ? error.name : 'Error',
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                }
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
                throw error;
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
            const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
            const response = await requestKugou('user_playlist', { userid: String(userId), page: Math.floor(offset / requestLimit) + 1, pagesize: requestLimit });
            const rawItems = listOf(response);
            const playlistItems = rawItems
                .filter(item => getKugouUserCollectionType(item) === 'playlist')
                .map(item => ({ raw: item, collection: normalizeCollection(item, 'playlist', isKugouOwnedPlaylist(item)) }))
                .filter(({ collection }) => collection.id !== '');
            const items = await Promise.all(playlistItems.map(async ({ raw, collection }) => {
                if (collection.coverUrl || !isKugouOwnedPlaylist(raw)) return collection;
                const fallbackCover = await getKugouPlaylistFallbackCover(raw).catch(() => undefined);
                return fallbackCover ? { ...collection, coverUrl: fallbackCover } : collection;
            }));
            return userCollectionPageOf(items, response, requestLimit, offset, rawItems.length);
        },
        async getUserAlbums(userId, limit, offset) {
            const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
            const response = await requestKugou('user_playlist', { userid: String(userId), page: Math.floor(offset / requestLimit) + 1, pagesize: requestLimit });
            const rawItems = listOf(response);
            const items = rawItems
                .filter(item => getKugouUserCollectionType(item) === 'album')
                .map(item => normalizeCollection(item, 'album'))
                .filter(collection => collection.id !== '');
            return userCollectionPageOf(items, response, requestLimit, offset, rawItems.length);
        },
        async getLikedSongIds(userId) {
            const playlist = await getKugouLikedPlaylist(userId);
            const globalCollectionId = valueOf(playlist, 'global_collection_id', 'globalCollectionId');
            if (!globalCollectionId) return [];
            const response = await requestKugou('playlist_track_all', {
                id: String(globalCollectionId),
                page: 1,
                pagesize: KUGOU_MAX_PAGE_SIZE,
            });
            return listOf(response)
                .map(normalizeKugouSong)
                .map(song => song.id)
                .filter(Boolean);
        },
    },
    catalog: {
        canResolveSongCatalogRefs: song => Boolean(getKugouCatalogLookupId(song)),
        resolveSongCatalogRefs: resolveKugouSongCatalogRefs,
        async getPlaylistTracks(id, limit, offset, collection) {
            const recommendationPage = await getKugouRecommendationPage(collection, limit, offset);
            if (recommendationPage) return recommendationPage;

            const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
            const response = await requestKugou('playlist_track_all', { id: String(id), pagesize: requestLimit, page: Math.floor(offset / requestLimit) + 1 });
            return pageOf(listOf(response).map(normalizeKugouSong), response, requestLimit, offset);
        },
        async getCloudTracks(limit, offset) {
            const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
            const response = await requestKugou('user_cloud', {
                userid: getKugouUserId() || undefined,
                page: Math.floor(offset / requestLimit) + 1,
                pagesize: requestLimit,
            });
            const items = listOf(response).map(item => {
                const song = normalizeKugouSong(item);
                return { ...song, sourceRef: { ...song.sourceRef, variant: 'cloud' } };
            });
            return pageOf(items, response, requestLimit, offset);
        },
        async getPlaylistDetail(id, existingCollection) {
            if (existingCollection && isKugouVirtualRecommendation(existingCollection)) return existingCollection;

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
                trackCount: normalized.trackCount !== undefined && normalized.trackCount > 0
                    ? normalized.trackCount
                    : existingCollection?.trackCount,
                creator: normalized.creator || existingCollection?.creator,
                providerData: { ...existingCollection?.providerData, ...normalized.providerData },
            };
        },
        async getAlbumDetail(id, existingCollection) {
            const rawAlbum = await getKugouAlbumDetailRaw(id);
            if (!rawAlbum) {
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
                trackCount: normalized.trackCount !== undefined && normalized.trackCount > 0
                    ? normalized.trackCount
                    : existingCollection?.trackCount,
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
        async getSubscriptionStatus(type, id, collection) {
            if (isKugouVirtualRecommendation(collection)) return false;

            const userId = getKugouUserId();
            if (!userId) return false;
            const response = await requestKugou('user_playlist', { userid: userId, page: 1, pagesize: 100 });
            return listOf(response).some(item => {
                if (getKugouUserCollectionType(item) !== type) return false;
                if (type === 'playlist') {
                    return String(valueOf(item, 'global_collection_id', 'globalCollectionId') || '') === String(id)
                        || String(valueOf(item, 'listid', 'list_id') || '') === String(id);
                }
                return String(valueOf(item, 'musiclib_id', 'musicLibId', 'album_id', 'albumId', 'list_create_listid') || '') === String(id);
            });
        },
    },
    recommendations: {
        async getDailySongs() {
            const response = await requestKugou('everyday_recommend');
            return songListOf(response).map(normalizeKugouSong).filter(song => song.id);
        },
        async getPersonalFm() {
            const response = await requestKugou('personal_fm');
            return songListOf(response).map(normalizeKugouSong).filter(song => song.id);
        },
        async getRecommendedCollections(limit) {
            const pagesize = Math.min(Math.max(Math.floor(limit) || KUGOU_RECOMMENDATION_PAGE_SIZE, 1), KUGOU_RECOMMENDATION_PAGE_SIZE);
            const collections = await Promise.all(KUGOU_RECOMMENDATION_CARDS.map(async card => {
                try {
                    const { response, songs } = await getKugouRecommendationCard(card.id, pagesize);
                    return songs.length > 0 ? createKugouRecommendationCollection(card, response, songs) : null;
                } catch (error) {
                    console.warn('[KugouProvider] recommendation-card:failed', {
                        cardId: card.id,
                        error: error instanceof Error ? error.message : String(error),
                    });
                    return null;
                }
            }));
            return collections.filter((collection): collection is ProviderCollection => Boolean(collection));
        },
        async getHistoryEntries() {
            const response = await requestKugou('everyday_history', { mode: 'list' });
            kugouHistoryNameByDate.clear();
            return normalizeKugouHistoryEntries(response);
        },
        async getHistoryDates() {
            const response = await requestKugou('everyday_history', { mode: 'list' });
            kugouHistoryNameByDate.clear();
            return normalizeKugouHistoryEntries(response)
                .map(entry => String(entry.providerData?.date || entry.id))
                .filter(Boolean);
        },
        async getHistorySongs(entry) {
            const id = typeof entry === 'string' ? entry : entry.id;
            const historyName = typeof entry === 'string'
                ? await getKugouHistoryName(id)
                : String(entry.providerData?.historyName || entry.label || id);
            const response = await requestKugou('everyday_history', {
                mode: 'song',
                date: id,
                history_name: historyName,
            });
            return songListOf(response).map(normalizeKugouSong).filter(song => song.id);
        },
        async dislikeSong(id) {
            const response = await requestKugou('personal_fm', {
                action: 'garbage',
                hash: String(id),
                songid: String(id),
            });
            const replacement = songListOf(response).map(normalizeKugouSong).find(song => song.id);
            return replacement ? { replacement } : {};
        },
    },
    mutations: {
        canAddToPlaylist: canAddToKugouPlaylist,
        async likeSong(song, liked) {
            const userId = getKugouUserId();
            if (!userId) return;
            const playlist = await getKugouLikedPlaylist(userId);
            const listId = valueOf(playlist, 'listid', 'list_id');
            if (listId === undefined || listId === null) return;
            if (liked) {
                await requestKugou('playlist_tracks_add', {
                    listid: String(listId),
                    data: getKugouTrackAddData(song),
                });
                return;
            }
            await requestKugou('playlist_tracks_del', {
                listid: String(listId),
                fileids: getKugouTrackFileId(song),
            });
        },
        async updatePlaylistTracks(operation, playlist, tracks) {
            const collection = typeof playlist === 'object' ? playlist : null;
            const listId = String(collection?.providerData?.listId || getId(playlist));
            if (operation === 'add') {
                const data = tracks.map(getKugouTrackAddData).join(',');
                await requestKugou('playlist_tracks_add', { listid: listId, data });
                return;
            }
            const fileids = tracks.map(getKugouTrackFileId).join(',');
            await requestKugou('playlist_tracks_del', { listid: listId, fileids });
        },
        async subscribePlaylist(playlist, subscribed) {
            const collection = typeof playlist === 'object' ? playlist : null;
            if (isKugouVirtualRecommendation(collection || undefined)) return;

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
        async subscribeAlbum(id, subscribed) {
            const userId = getKugouUserId();
            if (!userId) return;

            if (!subscribed) {
                const album = (await getKugouUserPlaylistItems(userId)).find(item => (
                    getKugouUserCollectionType(item) === 'album'
                    && String(valueOf(item, 'musiclib_id', 'musicLibId', 'album_id', 'albumId', 'list_create_listid') || '') === String(id)
                ));
                const listId = valueOf(album, 'listid', 'list_id');
                if (listId === undefined || listId === null) return;
                await requestKugou('playlist_del', { listid: String(listId) });
                return;
            }

            const rawAlbum = await getKugouAlbumDetailRaw(id);
            if (!rawAlbum) return;
            const albumId = valueOf(rawAlbum, 'album_id', 'AlbumID', 'albumId') ?? id;
            const firstAuthor = Array.isArray(rawAlbum.authors) ? rawAlbum.authors[0]?.base ?? rawAlbum.authors[0] : undefined;
            const creatorUserId = valueOf(rawAlbum, 'list_create_userid', 'create_userid', 'author_id', 'authorId', 'userid')
                ?? valueOf(firstAuthor, 'author_id', 'authorId', 'id');
            if (creatorUserId === undefined || creatorUserId === null) return;

            await requestKugou('playlist_add', {
                source: 2,
                name: String(valueOf(rawAlbum, 'name', 'album_name', 'AlbumName') || ''),
                type: 1,
                list_create_userid: String(creatorUserId),
                list_create_listid: String(albumId),
            });
        },
    },
};
