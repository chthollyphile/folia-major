import type {
    FoliumJsonValue,
    FoliumSourceAudio,
    FoliumSourceAudioQuality,
    FoliumSourceCollection,
    FoliumSourceDef,
    FoliumSourceLyricAlias,
    FoliumSourceLyricsResult,
    FoliumSourceNamedRef,
    FoliumSourcePage,
    FoliumSourceSong,
    FoliumSourceUser,
    FoliumText,
} from '@folia/folium';
import { errorFields } from '@folia/folium-source-kit';
import { sizedKugouCover, kugouCovers } from './kugouCovers';
import type { KugouErrorFactory, KugouTransport } from './kugouTransport';
import { describeKugouLoginFailure, kugouCheckFailure } from './kugouLoginFailure';
import { describeKugouFailure, isKugouTimeout, kugouNoUrlError } from './kugouFailure';

// sources/kugou/core/kugouProvider.ts
// 酷狗音源的定义（folium.sources.register 收的那份）：迁之前 src/services/onlineMusic/kugou/kugouProvider.ts 的
// 宿主 provider，改成公开契约的能力族，读法和请求原样。宿主的开关由实现了哪些能力推导（适配层 parts.ts），和迁之前
// 手写的开关表一致。状态（推荐卡片、收藏歌单的行号、匿名搜索的回退记录……）都在 createKugouSource 的闭包里：
// 一次 createSource 一份。

/** What the definition needs of the host besides the transport. */
export interface KugouSourceTexts {
    /** A text of the mod's locale files, as a FoliumText (folium.i18n.key). */
    text(key: string): FoliumText;
    /** The same written out in the UI language now (folium.i18n.text): a collection's name is a string. */
    translate(key: string): string;
    error: KugouErrorFactory;
    isPureMusicText(text: string | null | undefined): boolean;
}

type KugouSongData = Record<string, FoliumJsonValue>;

const valueOf = (raw: any, ...keys: string[]) => {
    for (const key of keys) {
        if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
    }
    return undefined;
};

const KUGOU_CANONICAL_COVER_SIZE = 1024;

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

/*
 * The address the player is handed. KuGou's audio files come from `fs.*.kugou.com` over http as well as https. The
 * desktop plays the http address as given; the web build's page is https, where an http address is mixed content the
 * browser refuses, so there the same file is asked for over https. (The host did this for every platform's URL
 * before this source was a mod: appPlaybackHelpers.ts's toSafePlaybackUrl / toSafeRemoteUrl.)
 */
export const kugouPlaybackUrl = (url: string, runtime: 'electron' | 'web'): string => {
    if (runtime !== 'web') return url;
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' && parsed.hostname.startsWith('fs.') && parsed.hostname.endsWith('.kugou.com')
            ? url.replace(/^http:/i, 'https:')
            : url;
    } catch {
        return url;
    }
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
        ?? valueOf(raw, 'sizable_cover', 'Image', 'image', 'img', 'pic', 'picUrl', 'cover', 'coverUrl', 'sizable_avatar');
    if (!value) return undefined;
    const cover = String(value).trim().replace('{size}', String(KUGOU_CANONICAL_COVER_SIZE));
    if (/^\d{8,}\.(?:jpe?g|png|webp)$/i.test(cover)) {
        return `https://c1.kgimg.com/stdmusic/${KUGOU_CANONICAL_COVER_SIZE}/${cover.slice(0, 8)}/${cover}`;
    }
    const secureCover = cover.startsWith('//') ? `https:${cover}` : cover.replace(/^http:/i, 'https:');
    return sizedKugouCover(secureCover, KUGOU_CANONICAL_COVER_SIZE);
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

const jsonData = (entries: Array<[string, unknown]>): KugouSongData => Object.fromEntries(
    entries.filter((entry): entry is [string, FoliumJsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

/** An id as text ('' for none): ids are strings in the public contract. */
const idText = (value: unknown): string => (
    typeof value === 'string' || typeof value === 'number' || typeof value === 'bigint' ? String(value) : ''
);

/** The pieces of a song's own data as text ('' for none). */
const dataText = (data: KugouSongData | undefined, key: string): string => idText(data?.[key]);

// Artists without an id of KuGou's get one of their own, which opens nowhere (`ref: false`).
const normalizeArtists = (raw: unknown): FoliumSourceNamedRef[] => {
    const singers: unknown = valueOf(raw, 'Singers', 'singers', 'singerinfo', 'authors', 'artists');
    const usesSingerInfo = singers === valueOf(raw, 'singerinfo');
    if (Array.isArray(singers)) {
        return singers.map((artist: unknown, index: number): FoliumSourceNamedRef => {
            const base: unknown = valueOf(artist, 'base') ?? artist;
            const authorId = valueOf(base, 'author_id', 'authorId')
                ?? (usesSingerInfo ? valueOf(base, 'id') : undefined);
            const id = idText(authorId);
            return {
                id: id || `kugou-artist-${index}`,
                name: String(valueOf(base, 'name', 'author_name', 'singername') || ''),
                ...(id ? {} : { ref: false }),
            };
        }).filter(artist => artist.name);
    }
    const names = String(valueOf(raw, 'SingerName', 'singername', 'author_name', 'Singer') || '')
        .split(/[、,&/]/).map(name => name.trim()).filter(Boolean);
    return names.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name, ref: false }));
};

const normalizeTimestamp = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric > 0 && numeric < 10000) return Date.UTC(Math.round(numeric), 0, 1);
        return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(idText(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

// How names are compared to drop a duplicated artist prefix: the host's lyric-search rule (src/utils/lyrics/
// searchQuery.ts normalizeSongTitleForLyricSearch, matchScore.ts normalizeLyricMatchText): lower case, punctuation,
// symbols and spaces dropped (the prefix joins artists with 、 where the field is joined with ", "). Its romaji and
// simplified-Chinese steps are left out: a title that repeats the artist field word for word does not need them.
const normalizeArtistIdentity = (value: string): string => value.normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');

// Removes a duplicated "artist - title" prefix when the provider already supplies artists separately.
const normalizeSongTitleForLyricSearch = (title: string, artist: string): string => {
    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();
    if (!trimmedTitle || !trimmedArtist) return trimmedTitle;

    const separator = /^(.+?)\s+-\s+(.+)$/u.exec(trimmedTitle);
    if (!separator) return trimmedTitle;

    return normalizeArtistIdentity(separator[1]) === normalizeArtistIdentity(trimmedArtist)
        ? separator[2].trim()
        : trimmedTitle;
};

// A KRC line with its timing ([start,duration]): a text without one has tags only.
const KRC_TIMED_LINE = /^\s*\[\d+,\d+\]/mu;

// The title part of a structured "title - artist" query (src/utils/lyrics/searchQuery.ts buildKugouLyricSearchQuery).
const buildKugouLyricSearchQuery = (keyword: string): string => {
    const trimmedKeyword = keyword.trim();
    if (!trimmedKeyword) {
        return trimmedKeyword;
    }

    const structuredTitle = trimmedKeyword.split(/\s+-\s+/u)[0]?.trim();
    return structuredTitle || trimmedKeyword;
};

// Some KuGou collection endpoints only expose "artist - title" through audio_name.
const normalizeKugouTitleAndArtists = (rawTitle: string, rawArtists: FoliumSourceNamedRef[]) => {
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
        artists: artistNames.map((name, index): FoliumSourceNamedRef => ({ id: `kugou-artist-${index}-${name}`, name, ref: false })),
    };
};

/** A song as the source hands it: its id is the track hash, which other sources' lyric searches know it by too. */
export const normalizeKugouSong = (raw: unknown): FoliumSourceSong => {
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
    // 歌名可能带着后缀（括号里的译名或版本）：专辑曲目的 `base.audio_name` 是「夜に駆ける (向夜晚奔去)」，
    // 后缀另在 `trans_param.songname_suffix`；搜索条目的后缀在 `Suffix`，原名在 `OriSongName`
    // （2026-11-05 实测）。去掉后缀的原名和显示的歌名不同时存下，歌词搜索在歌名搜不到时用它再搜一次。
    const suffix = String(
        valueOf(item, 'Suffix', 'suffix')
        ?? valueOf(item?.trans_param ?? item?.transParam, 'songname_suffix')
        ?? valueOf(audioInfo?.trans_param ?? audioInfo?.transParam, 'songname_suffix')
        ?? '',
    ).trim();
    const originalName = String(
        valueOf(item, 'OriSongName', 'ori_song_name', 'oriSongName')
        ?? valueOf(base, 'OriSongName', 'ori_song_name', 'oriSongName')
        ?? (suffix && title.endsWith(suffix) ? title.slice(0, -suffix.length) : ''),
    ).trim();
    if (originalName && originalName !== title) providerData.originalName = originalName;

    const albumIdText = idText(albumId);
    const coverUrl = coverOf(item);
    return {
        id: hash,
        title,
        artists,
        album: {
            id: albumIdText,
            name: albumName,
            ...(coverUrl ? { coverUrl } : {}),
            ...(albumIdText ? {} : { ref: false }),
        },
        ...(duration > 0 ? { durationMs: duration } : {}),
        ...(hash ? { lyricIds: { kugou: hash } } : {}),
        data: providerData,
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

const getKugouRecommendationCardId = (collection: FoliumSourceCollection | undefined, id?: string): number | undefined => {
    const providerCardId = collection?.data?.cardId;
    const cardId = Number(providerCardId ?? /^kugou-card-(\d+)$/u.exec(id ?? '')?.[1]);
    return Number.isInteger(cardId) && cardId > 0 ? cardId : undefined;
};

const isKugouVirtualRecommendation = (collection: FoliumSourceCollection | undefined | null): boolean => (
    collection?.data?.virtualRecommendation === true
);

// Builds the playlist entry the radio surface shows for a song-card recommendation.
const createKugouRecommendationCollection = (
    card: (typeof KUGOU_RECOMMENDATION_CARDS)[number],
    response: any,
    songs: FoliumSourceSong[],
): FoliumSourceCollection => {
    const data = dataOf(response);
    const name = String(valueOf(data, 'card_name', 'cardName', 'module_name', 'moduleName', 'title', 'name') || card.name);
    const description = valueOf(data, 'description', 'desc', 'subtitle', 'sub_title');
    const coverUrl = songs[0]?.album?.coverUrl;

    return {
        id: `kugou-card-${card.id}`,
        name,
        type: 'playlist',
        ...(coverUrl ? { coverUrl } : {}),
        ...(description ? { description: String(description) } : {}),
        trackCount: songs.length,
        data: {
            virtualRecommendation: true,
            cardId: card.id,
        },
    };
};

const hasMatchingKugouHash = (metadata: unknown, song: FoliumSourceSong): boolean => {
    const expectedHash = (song.lyricIds?.kugou || dataText(song.data, 'hash')).toUpperCase();
    if (!expectedHash) return false;

    const audioInfo: unknown = valueOf(metadata, 'audio_info', 'audioInfo') ?? {};
    return [
        valueOf(audioInfo, 'hash', 'FileHash', 'fileHash'),
        valueOf(audioInfo, 'hash_128', 'hash128'),
    ].some(candidate => String(candidate || '').toUpperCase() === expectedHash);
};

const getKugouCatalogLookupId = (song: FoliumSourceSong): string => dataText(song.data, 'catalogLookupId');

// Maps the dedicated VIP response, including active product entries used by concept accounts.
const normalizeKugouVipType = (raw: any): number => {
    const data = dataOf(raw);
    const directVipType = Number(valueOf(data, 'vip_type', 'vipType', 'is_vip') || 0);
    if (directVipType > 0) return directVipType;

    const businessVips = Array.isArray(data?.busi_vip) ? data.busi_vip : [];
    return businessVips.some((entry: any) => Number(valueOf(entry, 'is_vip', 'vip_type') || 0) > 0) ? 1 : 0;
};

// Formats the claim date in KuGou's China-based calendar instead of the device's local timezone.
const getKugouReceiveDay = (date = new Date()): string => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(date);
    const value = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value || '';
    return `${value('year')}-${value('month')}-${value('day')}`;
};

const isSuccessfulKugouVipMutation = (raw: any): boolean => {
    const data = dataOf(raw);
    const errCode = Number(valueOf(raw, 'errcode', 'error_code') ?? valueOf(data, 'errcode', 'error_code') ?? 0);
    const rawStatus = valueOf(raw, 'status') ?? valueOf(data, 'status');
    const status = rawStatus === undefined ? 1 : Number(rawStatus);
    return errCode === 0 && status === 1;
};

const normalizeCollection = (raw: unknown, type = 'playlist', owned = false): FoliumSourceCollection => {
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
    const coverUrl = coverOf(raw);

    return {
        id: idText(id),
        name: String(valueOf(raw, 'name', 'listname', 'specialname', 'album_name', 'author_name') || ''),
        type,
        ...(coverUrl ? { coverUrl } : {}),
        ...(description === undefined || description === null ? {} : { description: String(description) }),
        ...(trackCount !== undefined && Number.isFinite(trackCount) ? { trackCount } : {}),
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
        ...(valueOf(raw, 'is_liked', 'isLiked') ? { isLiked: true } : {}),
        data: jsonData([
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
const canAddToKugouPlaylist = (playlist: FoliumSourceCollection): boolean => {
    if (playlist.type !== 'playlist' || playlist.isOwned !== true) return false;

    const listId = dataText(playlist.data, 'listId');
    const name = playlist.name.trim();
    return listId !== '2' && name !== '我喜欢' && name !== '我喜欢的音乐';
};

// Advances mixed user-library pagination with the raw response count, not the filtered item count.
const pageOfWithRawItemCount = <T>(
    items: T[],
    response: any,
    limit: number,
    offset: number,
    rawItemCount: number,
): FoliumSourcePage<T> => {
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

const pageOf = <T>(items: T[], raw: unknown, limit: number, offset: number): FoliumSourcePage<T> => {
    const data: unknown = dataOf(raw);
    const total = Number(valueOf(data, 'total') ?? valueOf(raw, 'total') ?? valueOf(data, 'total_count') ?? valueOf(raw, 'total_count')
        ?? valueOf(data, 'count') ?? items.length);
    return { items, total, hasMore: offset + items.length < total || items.length === limit, nextOffset: offset + items.length };
};

// Keeps one result per song (its hash) while preserving search ranking order.
const normalizeKugouSearchSongs = (rawItems: unknown[]): FoliumSourceSong[] => {
    const seenSongKeys = new Set<string>();
    return rawItems
        .map(normalizeKugouSong)
        .filter(song => {
            if (!song.id) return false;
            if (seenSongKeys.has(song.id)) return false;
            seenSongKeys.add(song.id);
            return true;
        });
};

const qualityValue = (quality: FoliumSourceAudioQuality): string => ({
    standard: '128', high: '320', ultra: '320', lossless: 'flac', hires: 'high',
})[quality];

const QUALITY_FALLBACKS: Record<FoliumSourceAudioQuality, FoliumSourceAudioQuality[]> = {
    standard: ['standard'],
    high: ['high', 'standard'],
    // For the type: KuGou is never asked at 'ultra' (it does not list it).
    ultra: ['high', 'standard'],
    lossless: ['lossless', 'high', 'standard'],
    hires: ['hires', 'lossless', 'high', 'standard'],
};

const qualityFallbacks = (quality: FoliumSourceAudioQuality): FoliumSourceAudioQuality[] => QUALITY_FALLBACKS[quality];

const KUGOU_QUALITY_RANK: Record<FoliumSourceAudioQuality, number> = { standard: 0, high: 1, ultra: 1, lossless: 2, hires: 3 };
// The privileged endpoint asks every quality at once ('128', '320', 'flac', 'high', …): a URL array is positional.
const KUGOU_INDEXED_QUALITIES: FoliumSourceAudioQuality[] = ['standard', 'high', 'lossless', 'hires'];
// A full track is never this small; a 30–60 s preview usually is.
const KUGOU_PREVIEW_MAX_BYTES = 200 * 1024;

/**
 * The quality an answer actually carries, which can be lower than what was asked (KuGou degrades silently). Its own
 * `quality` first, then fileSize / timeLength (seconds), then bitRate (bps or kbps); with none of them, the one asked.
 */
const actualKugouQuality = (payload: unknown, requested: FoliumSourceAudioQuality): FoliumSourceAudioQuality => {
    const explicit = String(valueOf(payload, 'quality') ?? '').toLowerCase();
    const named: Partial<Record<string, FoliumSourceAudioQuality>> = { '128': 'standard', '320': 'high', flac: 'lossless', high: 'hires' };
    const known = named[explicit];
    if (known) return known;
    const size = toFiniteNumber(valueOf(payload, 'fileSize', 'file_size'));
    const duration = toFiniteNumber(valueOf(payload, 'timeLength', 'time_length'));
    // A day or longer is a duration in milliseconds, which the size cannot be divided by.
    let bitrate = size && duration && duration < 86400 ? size * 8 / duration : undefined;
    if (!bitrate) {
        bitrate = toFiniteNumber(valueOf(payload, 'bitRate', 'bit_rate'));
        if (bitrate !== undefined && bitrate > 0 && bitrate < 1000) bitrate *= 1000;
    }
    if (!bitrate || bitrate <= 0) return requested;
    const kbps = bitrate / 1000;
    const ext = String(valueOf(payload, 'extName', 'extname') ?? '').toLowerCase();
    // A lossy container is never lossless, whatever its figures say.
    if (['ogg', 'mp3', 'aac', 'm4a', 'wma'].includes(ext)) return kbps <= 200 ? 'standard' : 'high';
    if (kbps <= 200) return 'standard';
    if (kbps <= 500) return 'high';
    return kbps > 1500 ? 'hires' : 'lossless';
};

const kugouReplayGain = (payload: unknown): FoliumSourceAudio['replayGain'] => {
    const trackGain = toFiniteNumber(valueOf(payload, 'volume'));
    const trackPeak = decibelsToLinearPeak(valueOf(payload, 'volume_peak'));
    return trackGain === undefined && trackPeak === undefined
        ? undefined
        : {
            ...(trackGain === undefined ? {} : { trackGain }),
            ...(trackPeak === undefined ? {} : { trackPeak }),
        };
};

const isTooSmallForTrack = (payload: unknown): boolean => {
    const size = toFiniteNumber(valueOf(payload, 'fileSize', 'file_size'));
    return size !== undefined && size > 0 && size < KUGOU_PREVIEW_MAX_BYTES;
};

// The privileged answer is trusted only when nothing says it is a preview: any fail_process (buy, pkg…) is one,
// and KuGou does not always mark it, so a file too small for a track is one too.
const isKugouPrivilegedPreview = (payload: unknown): boolean => {
    const failProcess: unknown = valueOf(payload, 'fail_process');
    if (Array.isArray(failProcess) ? failProcess.length > 0 : Boolean(failProcess)) return true;
    return isTooSmallForTrack(payload);
};

// A /song/url answer is a preview when it is marked for purchase or is too small to be the track.
const isKugouPurchasePreview = (payload: unknown): boolean => {
    const failProcess: unknown = valueOf(payload, 'fail_process');
    if (Array.isArray(failProcess) ? failProcess.includes('buy') : failProcess === 'buy') return true;
    return isTooSmallForTrack(payload);
};

// KuGou's encrypted containers (the privileged endpoint can answer with them): the player cannot decode these. The
// answer's extName is read only for a single URL: it says nothing about which entry of an array it describes.
const KUGOU_ENCRYPTED_EXTENSIONS = new Set(['kgm', 'kgma', 'vpr', 'mflac', 'mgg']);
const isKugouEncryptedAudio = (url: string, payload: unknown): boolean => {
    const ext = String(valueOf(payload, 'extName', 'extname') ?? '').toLowerCase();
    if (KUGOU_ENCRYPTED_EXTENSIONS.has(ext)) return true;
    const path = url.split(/[?#]/)[0] ?? '';
    const dot = path.lastIndexOf('.');
    return dot >= 0 && KUGOU_ENCRYPTED_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
};

/** The better of two sources by the quality they carry; the first when they are level. */
const betterKugouSource = (a: FoliumSourceAudio | undefined, b: FoliumSourceAudio): FoliumSourceAudio => (
    a && KUGOU_QUALITY_RANK[a.quality ?? 'standard'] >= KUGOU_QUALITY_RANK[b.quality ?? 'standard'] ? a : b
);

const getId = (value: string | FoliumSourceCollection | FoliumSourceSong) => typeof value === 'object' ? value.id : value;

// Converts KuGou's millisecond climax payload into the shared second-based range model.
const parseKugouChorusRanges = (response: unknown): Array<{ startTime: number; endTime: number }> => {
    const ranges = (response as any)?.data;
    if (!Array.isArray(ranges)) return [];

    return ranges
        .map((range: any) => ({
            startTime: Number(range?.start_time) / 1000,
            endTime: Number(range?.end_time) / 1000,
        }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};

// Identifies KuGou's built-in "我喜欢" playlist, which is the provider's song-like collection.
const isKugouLikedPlaylist = (raw: any): boolean => {
    if (getKugouUserCollectionType(raw) !== 'playlist') return false;
    const name = String(valueOf(raw, 'name', 'listname') || '').trim();
    return name === '我喜欢' || name === '我喜欢的音乐' || valueOf(raw, 'listid', 'list_id') === 2;
};

type KugouLikedPlaylistRef = { listId: string; globalCollectionId?: string };

const getKugouTrackHash = (track: string | FoliumSourceSong): string => {
    if (typeof track !== 'object') return track.toUpperCase();
    return (dataText(track.data, 'hash') || track.lyricIds?.kugou || track.id).toUpperCase();
};

const getKugouTrackAddData = (track: string | FoliumSourceSong): string => {
    if (typeof track !== 'object') return `|${track.toUpperCase()}|0|0`;
    return [
        track.title,
        getKugouTrackHash(track),
        dataText(track.data, 'albumId') || track.album?.id || '0',
        dataText(track.data, 'mixSongId') || '0',
    ].join('|');
};

const getKugouTrackFileId = (track: string | FoliumSourceSong): string => {
    if (typeof track !== 'object') return track;
    return dataText(track.data, 'fileId') || track.id;
};

// 20000 首是保护上限，不是业务上限：到顶还有下一页就报错，不能把截断结果当成完整收藏列表存下去。
const KUGOU_LIKED_TRACK_MAX_PAGES = 200;
const KUGOU_LIKED_TRACK_CACHE_TTL_MS = 10_000;

// 首页带凭据搜索空、匿名有结果后，后续页仍会走带凭据搜索；记住关键词，别让列表断在第一页。
// 首页带凭据搜索重新有结果时再忘掉它；上限只防长期运行累积，登出（含会话失效）时整组清掉。
// 换号不另清：记录只在翻后续页时查，换号后新搜一个词的第一页照样先走带凭据搜索，记录跟着更新。
const KUGOU_ANONYMOUS_SEARCH_FALLBACK_LIMIT = 100;

// `/user/listen`'s type a span (docs/ku-go-api-docs.md): 0 is the last week, 1 all time, each the top 120.
const KUGOU_LISTENING_RANK_TYPES: Record<'week' | 'all', 0 | 1> = { week: 0, all: 1 };
const LISTENING_RANK_RANGES = ['week', 'all'] as const;

/** A play count the platform gave, on the row read from its ranking; anything else leaves the song as it is. */
const withListenCount = (song: FoliumSourceSong, count: unknown): FoliumSourceSong => {
    const value = Number(count);
    return count !== null && count !== undefined && count !== '' && Number.isFinite(value) && value >= 0
        ? { ...song, row: { ...song.row, listenCount: Math.floor(value) } }
        : song;
};

/** A ranking comes whole from the platform: a page of it is a slice. */
const listeningRankPage = (songs: readonly FoliumSourceSong[], limit: number, offset: number): FoliumSourcePage<FoliumSourceSong> => {
    const items = songs.slice(offset, offset + limit);
    return { items, total: songs.length, hasMore: offset + items.length < songs.length, nextOffset: offset + items.length };
};

/** The source of the manifest's `sources[0]` (id `kugou`). */
export const createKugouSource = (env: KugouSourceTexts, transport: KugouTransport): FoliumSourceDef => {
    const requestKugou = <T = unknown>(...args: Parameters<KugouTransport['request']>) => transport.request<T>(...args);
    const getKugouUserId = (): string => transport.userId();

    const kugouRecommendationTrackCache = new Map<number, FoliumSourceSong[]>();
    const kugouCatalogMetadataRequests = new Map<string, Promise<unknown>>();
    const kugouAnonymousSearchFallbackKeywords = new Set<string>();
    const kugouChorusRangesCache = new Map<string, Promise<Array<{ startTime: number; endTime: number }>>>();
    const kugouLikedPlaylistRefCache = new Map<string, KugouLikedPlaylistRef>();
    let lastSeenKugouUserId: string | null = null;
    // The row (`fileid`) each liked song has in the liked playlist, by track hash, as the last read of
    // the account's liked songs brought it. An unlike sends the row, and looks it up in the list where
    // none is noted (see likeSong). A song's row goes as soon as a like or an unlike is sent for it,
    // taken or not: a like gives no new row, an unlike ends the old one, and after a failure the row
    // may be gone. Rows are not kept across sessions: an old row would take another song out.
    const kugouLikedRowIds = new Map<string, string>();
    // When a like or an unlike was last sent for a song, by track hash. A read of the liked songs
    // begun before that may show the song's row as it was, and notes none for it.
    const kugouLikedRowsSentAt = new Map<string, number>();
    let kugouLikedRowReads = 0;
    const kugouLikedTrackCache = new Map<string, { fetchedAt: number; songs: FoliumSourceSong[] }>();
    const kugouHistoryNameByDate = new Map<string, string>();

    // Loads one KuGou recommendation card and keeps its normalized songs for the virtual playlist.
    const getKugouRecommendationCard = async (cardId: number, pagesize = KUGOU_RECOMMENDATION_PAGE_SIZE) => {
        const response = await requestKugou('top_card_youth', { card_id: cardId, pagesize });
        const songs = songListOf(response)
            .map(normalizeKugouSong)
            .filter(song => song.id);
        kugouRecommendationTrackCache.set(cardId, songs);
        return { response, songs };
    };

    const getKugouRecommendationPage = async (
        collection: FoliumSourceCollection | undefined,
        limit: number,
        offset: number,
    ): Promise<FoliumSourcePage<FoliumSourceSong> | null> => {
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

    const requestKugouCatalogMetadata = (lookupId: string): Promise<unknown> => {
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
            (error: unknown) => {
                if (kugouCatalogMetadataRequests.get(lookupId) === request) {
                    kugouCatalogMetadataRequests.delete(lookupId);
                }
                throw error;
            },
        );
        kugouCatalogMetadataRequests.set(lookupId, request);
        return request;
    };

    // Hydrates canonical KuGou album/artist ids only after KRM metadata matches the song hash.
    const resolveKugouSongCatalogRefs = async (song: FoliumSourceSong): Promise<FoliumSourceSong> => {
        const lookupId = getKugouCatalogLookupId(song);
        if (!lookupId) return song;

        const metadata = await requestKugouCatalogMetadata(lookupId);
        if (!metadata || !hasMatchingKugouHash(metadata, song)) return song;

        const base: unknown = valueOf(metadata, 'base') ?? {};
        const albumInfo: unknown = valueOf(metadata, 'album_info', 'albumInfo') ?? {};
        const albumId = valueOf(albumInfo, 'album_id', 'albumId')
            ?? valueOf(base, 'album_id', 'albumId');
        const albumName = String(
            valueOf(albumInfo, 'album_name', 'albumName', 'name')
            ?? valueOf(base, 'album_name', 'albumName')
            ?? song.album?.name ?? '',
        );
        const resolvedArtists = normalizeArtists(metadata);
        const artists = resolvedArtists.length > 0 ? resolvedArtists : song.artists;
        const coverUrl = coverOf(albumInfo) || song.album?.coverUrl;
        const resolvedAlbumId = idText(albumId) || song.album?.id || '';

        return {
            ...song,
            artists,
            album: {
                id: resolvedAlbumId,
                name: albumName,
                ...(coverUrl ? { coverUrl } : {}),
                ...(resolvedAlbumId && (idText(albumId) || song.album?.ref !== false) ? {} : { ref: false }),
            },
        };
    };

    const normalizeUser = (raw: unknown): FoliumSourceUser => {
        const data: unknown = dataOf(raw);
        const profile: unknown = valueOf(data, 'user_info', 'userinfo', 'profile') ?? data;
        const avatarUrl: unknown = coverOf(profile) || valueOf(profile, 'avatar', 'pic');
        const backgroundUrl: unknown = valueOf(profile, 'background', 'backgroundUrl', 'bg_pic');
        return {
            id: idText(valueOf(profile, 'userid', 'user_id', 'id', 'uid')) || getKugouUserId(),
            nickname: String(valueOf(profile, 'nickname', 'nick_name', 'username', 'name') || ''),
            ...(typeof avatarUrl === 'string' && avatarUrl ? { avatarUrl } : {}),
            ...(typeof backgroundUrl === 'string' && backgroundUrl ? { backgroundUrl } : {}),
            vipType: Number(valueOf(profile, 'vip_type', 'vipType', 'is_vip') || 0),
        };
    };

    const ensureKugouYouthVip = async (userId?: string): Promise<boolean> => {
        try {
            const token = transport.sessionToken();
            const params = {
                ...(userId ? { userid: userId } : {}),
                ...(token ? { token } : {}),
            };
            const unionResponse: any = await requestKugou('youth_union_vip', params);
            const unionData = dataOf(unionResponse);
            const errCode = Number(valueOf(unionResponse, 'errcode', 'error_code') ?? valueOf(unionData, 'errcode', 'error_code') ?? 0);

            if (errCode !== 0 || !unionData || typeof unionData !== 'object') {
                console.warn('[KugouProvider] youth-union-vip:api-error', { errCode });
                return false;
            }

            const isUnionVip = normalizeKugouVipType(unionResponse) > 0;
            if (!isUnionVip) {
                console.info('[KugouProvider] youth-union-vip:not-vip, requesting youth_day_vip');
                const claimResponse = await requestKugou('youth_day_vip', {
                    ...params,
                    receive_day: getKugouReceiveDay(),
                });
                if (!isSuccessfulKugouVipMutation(claimResponse)) {
                    console.warn('[KugouProvider] youth-day-vip:api-error', {
                        status: valueOf(claimResponse, 'status') ?? valueOf(dataOf(claimResponse), 'status'),
                        errCode: valueOf(claimResponse, 'errcode', 'error_code')
                            ?? valueOf(dataOf(claimResponse), 'errcode', 'error_code'),
                    });
                    return false;
                }

                const upgradeResponse = await requestKugou('youth_day_vip_upgrade', params);
                if (!isSuccessfulKugouVipMutation(upgradeResponse)) {
                    console.warn('[KugouProvider] youth-day-vip-upgrade:api-error', {
                        status: valueOf(upgradeResponse, 'status') ?? valueOf(dataOf(upgradeResponse), 'status'),
                        errCode: valueOf(upgradeResponse, 'errcode', 'error_code')
                            ?? valueOf(dataOf(upgradeResponse), 'errcode', 'error_code'),
                    });
                    return false;
                }
                return true;
            }
            console.info('[KugouProvider] youth-union-vip:already-vip, skipping youth_day_vip');
        } catch (error) {
            // Runs while the account is read after a sign-in: the error is logged whole.
            console.warn('[KugouProvider] youth-vip-check:failed', error);
        }
        return false;
    };

    // 搜专辑（`/search?type=album`）和歌单（`type=special`）。2026-10-31 实测两种不带账号也有结果，条目在 data.lists：
    // 专辑给 albumid / albumname / singers / img / publish_time / songcount，歌单给 specialid / specialname / gid /
    // nickname / img / song_count / total_play_count。歌单按 gid（global_collection_id）读歌（`/playlist/track/all`），
    // specialid 读不出来，所以把 gid 当成 global_collection_id 交给 normalizeCollection。
    const searchKugouCollections = async (
        kind: 'album' | 'playlist',
        query: string,
        limit: number,
        offset: number,
    ): Promise<FoliumSourcePage<FoliumSourceCollection>> => {
        if (!query.trim()) return { items: [], hasMore: false, nextOffset: offset };
        const page = Math.floor(offset / limit) + 1;
        const response = await requestKugou('search', {
            keywords: query, keyword: query, type: kind === 'album' ? 'album' : 'special', page, pagesize: limit,
        });
        const rawItems = listOf(response);
        const items = rawItems.flatMap((item: unknown): FoliumSourceCollection[] => {
            const raw: Record<string, unknown> = item && typeof item === 'object' ? item as Record<string, unknown> : {};
            const collection = kind === 'album'
                ? normalizeCollection({ ...raw, album_id: raw.albumid, album_name: raw.albumname, song_count: raw.songcount }, 'album')
                : normalizeCollection({ ...raw, global_collection_id: raw.gid, play_count: raw.total_play_count ?? raw.play_count }, 'playlist');
            if (collection.id === '') return [];
            // 歌单的创建者只有一个昵称（nickname / suid），normalizeCollection 不读它。
            const nickname = kind === 'playlist' && typeof raw.nickname === 'string' ? raw.nickname.trim() : '';
            return [nickname ? { ...collection, creator: { id: idText(raw.suid), nickname } } : collection];
        });
        const paged = pageOfWithRawItemCount(items, response, limit, offset, rawItems.length);
        // 按页码翻：一页不满 limit 条时，offset + 条数会让下一次又落回这一页。
        return { ...paged, hasMore: paged.hasMore && rawItems.length > 0, nextOffset: rawItems.length > 0 ? page * limit : offset };
    };

    const rememberKugouAnonymousSearchFallback = (keyword: string): void => {
        kugouAnonymousSearchFallbackKeywords.delete(keyword);
        kugouAnonymousSearchFallbackKeywords.add(keyword);
        while (kugouAnonymousSearchFallbackKeywords.size > KUGOU_ANONYMOUS_SEARCH_FALLBACK_LIMIT) {
            const oldest = kugouAnonymousSearchFallbackKeywords.values().next().value;
            if (oldest === undefined) break;
            kugouAnonymousSearchFallbackKeywords.delete(oldest);
        }
    };

    const forgetKugouAnonymousSearchFallback = (keyword: string): void => {
        kugouAnonymousSearchFallbackKeywords.delete(keyword);
    };

    const anonymousSearchPage = async (query: string, page: number, limit: number, offset: number) => {
        const response = await transport.anonymousSearch(buildKugouLyricSearchQuery(query), page, limit);
        const rawItems = listOf(response);
        return pageOfWithRawItemCount(
            normalizeKugouSearchSongs(rawItems),
            response,
            limit,
            offset,
            rawItems.length,
        );
    };

    const getKugouChorusRanges = async (songId: string): Promise<Array<{ startTime: number; endTime: number }>> => {
        const hash = songId.trim().toUpperCase();
        if (!hash) return [];

        const cached = kugouChorusRangesCache.get(hash);
        if (cached) return cached;

        const request = requestKugou('song_climax', { hash })
            .then(parseKugouChorusRanges)
            .catch((error: unknown) => {
                console.warn(`[KugouProvider] Failed to fetch chorus ranges for song ${hash}:`, error);
                return [];
            });
        kugouChorusRangesCache.set(hash, request);
        return request;
    };

    const getKugouLyricCandidate = async (song: FoliumSourceSong): Promise<unknown> => {
        const albumAudioId = song.data?.albumAudioId
            ?? song.data?.mixSongId
            ?? song.data?.catalogLookupId;
        const response = await requestKugou('search_lyric', {
            hash: (song.lyricIds?.kugou ?? song.id).toUpperCase(),
            duration: song.durationMs,
            man: 'no',
            ...(albumAudioId !== undefined ? { album_audio_id: idText(albumAudioId) } : {}),
        });
        const candidates: unknown = valueOf(response, 'candidates');
        return Array.isArray(candidates) ? candidates[0] as unknown ?? null : null;
    };

    // Fetches the server-decoded KRC payload: the host parses it (line- and word-timed both), the chorus comes
    // with it where the song has words, and the instrumental notice is read by the host's own rule.
    const getKugouLyrics = async (song: FoliumSourceSong): Promise<FoliumSourceLyricsResult | null> => {
        const candidate = await getKugouLyricCandidate(song);
        const candidateId = idText(valueOf(candidate, 'id'));
        const accessKey = idText(valueOf(candidate, 'accesskey'));
        if (!candidateId || !accessKey) return null;

        const response = await requestKugou('lyric', {
            id: candidateId,
            accesskey: accessKey,
            fmt: 'krc',
            decode: true,
        });
        const decoded: unknown = valueOf(response, 'decodeContent');
        const lyricText = typeof decoded === 'string' ? decoded : '';
        if (!lyricText) return null;
        const track = { format: 'krc' as const, text: lyricText };
        if (env.isPureMusicText(lyricText)) return { main: track, wordByWord: track, isPureMusic: true };
        // Only tags ([id:], [ar:]) and no timed line: the host parses nothing out of it, and the chorus is not asked
        // for (as before the move, when such a text was not renderable).
        if (!KRC_TIMED_LINE.test(lyricText)) return { main: track, wordByWord: track };
        const chorusRanges = await getKugouChorusRanges(song.lyricIds?.kugou ?? song.id);
        return { main: track, wordByWord: track, ...(chorusRanges.length > 0 ? { chorusRanges } : {}) };
    };

    // 歌名的原名（normalizeKugouSong 存下的 `OriSongName`，或去掉后缀的歌名）配上同一组歌手，供歌词搜索换个名字再搜。
    const getKugouLyricSearchAlias = (song: FoliumSourceSong): Promise<FoliumSourceLyricAlias | null> => {
        const originalName = dataText(song.data, 'originalName').trim();
        if (!originalName || originalName === song.title) return Promise.resolve(null);
        return Promise.resolve({
            title: originalName,
            artist: song.artists.map(artist => artist.name).join(', '),
            ...(song.album?.name ? { album: song.album.name } : {}),
        });
    };

    const getKugouUserPlaylistItems = async (userId: string): Promise<unknown[]> => {
        const response = await requestKugou('user_playlist', {
            userid: userId,
            page: 1,
            pagesize: 100,
        });
        return listOf(response);
    };

    // Loads the raw album metadata needed by KuGou's playlist-based album subscription endpoint.
    const getKugouAlbumDetailRaw = async (id: string): Promise<unknown> => {
        const response = await requestKugou('album_detail', { id });
        const data = dataOf(response);
        const rawAlbum = listOf(response)[0] ?? data?.album ?? data;
        return rawAlbum && typeof rawAlbum === 'object' && !Array.isArray(rawAlbum) ? rawAlbum : null;
    };

    // 登出、切号和会话失效都要清：歌单引用和行号都只对写下它们的那个账号有效。
    const clearKugouLikedCaches = (): void => {
        kugouLikedPlaylistRefCache.clear();
        kugouLikedTrackCache.clear();
        kugouLikedRowIds.clear();
        kugouLikedRowsSentAt.clear();
    };

    // Notes the rows a read of the liked songs brought; the rows of songs it does not show go.
    const noteKugouLikedRows = (songs: FoliumSourceSong[], readBeganAt: number): void => {
        kugouLikedRowIds.clear();
        for (const song of songs) {
            const fileId = dataText(song.data, 'fileId');
            if (fileId === '') continue;
            const hash = getKugouTrackHash(song);
            if ((kugouLikedRowsSentAt.get(hash) ?? Number.NEGATIVE_INFINITY) >= readBeganAt) continue;
            kugouLikedRowIds.set(hash, fileId);
        }
    };

    // 收藏相关入口在动缓存之前先对一次账号，换号就把上一个账号的引用和行号丢掉。
    const syncKugouSessionUser = (): void => {
        const userId = getKugouUserId();
        if (lastSeenKugouUserId === userId) return;
        lastSeenKugouUserId = userId;
        clearKugouLikedCaches();
    };

    // 只缓存完整的引用：缺 global_collection_id 的残缺状态会一直粘到登出，取消收藏从此必失败。
    const rememberKugouLikedPlaylistRef = (userId: string, ref: KugouLikedPlaylistRef): void => {
        if (!ref.globalCollectionId) return;
        kugouLikedPlaylistRefCache.set(userId, ref);
    };

    // Finds KuGou's built-in "我喜欢" playlist, which is the provider's song-like collection.
    const getKugouLikedPlaylist = async (userId: string): Promise<unknown> => {
        const items = await getKugouUserPlaylistItems(userId);
        return items.find(isKugouLikedPlaylist) ?? null;
    };

    // KuGou's playlist entry `fileid` is local to one playlist, unlike the global audio hash. The
    // liked-song mutations must therefore look up the row id inside the liked playlist itself.
    const getKugouPlaylistTrackSongs = async (
        globalCollectionId: string,
        options: { forceRefresh?: boolean } = {},
    ): Promise<FoliumSourceSong[]> => {
        const cached = kugouLikedTrackCache.get(globalCollectionId);
        if (!options.forceRefresh && cached && Date.now() - cached.fetchedAt < KUGOU_LIKED_TRACK_CACHE_TTL_MS) {
            return cached.songs;
        }

        const songs: FoliumSourceSong[] = [];
        let completed = false;
        for (let page = 1; page <= KUGOU_LIKED_TRACK_MAX_PAGES; page += 1) {
            const response = await requestKugou('playlist_track_all', {
                id: globalCollectionId,
                page,
                pagesize: KUGOU_MAX_PAGE_SIZE,
            });
            const rawItems = listOf(response);
            songs.push(...rawItems.map(normalizeKugouSong));
            // 字段顺序和 pageOf 保持一致。只有明显大于一页时才当总数用：有的响应里 count 是本页条数，
            // 拿它当总数会在第一页就判定读完，又变回只读 100 首的老问题。
            const total = Number(valueOf(dataOf(response), 'total', 'total_count', 'count') ?? Number.NaN);
            const countsWholeList = Number.isFinite(total) && total > KUGOU_MAX_PAGE_SIZE;
            if (rawItems.length === 0 || rawItems.length < KUGOU_MAX_PAGE_SIZE) {
                // 短页当作末尾。读到的比响应自己报的总数少时记一行：没有抓到过这种响应，
                // 真实账号的日志才能说明是列表里有读不出来的歌，还是中途断了。
                if (countsWholeList && songs.length < total) {
                    console.warn(`[KuGou] A playlist ended on a short page: ${songs.length} songs read, its answer counts ${total}`);
                }
                completed = true;
                break;
            }
            if (countsWholeList && songs.length >= total) {
                completed = true;
                break;
            }
        }

        if (!completed) {
            throw env.error(
                'invalid-response',
                `KuGou playlist ${globalCollectionId} exceeded ${KUGOU_LIKED_TRACK_MAX_PAGES} pages`,
            );
        }

        kugouLikedTrackCache.set(globalCollectionId, { fetchedAt: Date.now(), songs });
        return songs;
    };

    // 解析失败一律抛错：返回空数组会被上层写成"这个账号一首收藏都没有"，连快照一起清掉。
    const getKugouLikedPlaylistTracks = async (userId: string): Promise<FoliumSourceSong[]> => {
        syncKugouSessionUser();
        const playlist = await getKugouLikedPlaylist(userId);
        const listId = idText(valueOf(playlist, 'listid', 'list_id'));
        const globalCollectionId = idText(valueOf(playlist, 'global_collection_id', 'globalCollectionId'));
        if (!listId || !globalCollectionId) {
            throw env.error(
                'invalid-response',
                'KuGou liked playlist could not be resolved',
            );
        }
        rememberKugouLikedPlaylistRef(userId, { listId, globalCollectionId });
        // 账号的收藏要读平台此刻的：10 秒内的那份缓存是给取消收藏找行号用的，里面没有别处刚做的改动。
        return getKugouPlaylistTrackSongs(globalCollectionId, { forceRefresh: true });
    };

    // Uses the newest song's observed cover when KuGou leaves a user playlist cover empty.
    const getKugouPlaylistFallbackCover = async (rawPlaylist: any): Promise<string | undefined> => {
        const globalCollectionId = idText(valueOf(rawPlaylist, 'global_collection_id', 'globalCollectionId'));
        if (!globalCollectionId) return undefined;

        const response = await requestKugou('playlist_track_all', {
            id: globalCollectionId,
            page: 1,
            pagesize: 1,
        });
        return listOf(response)
            .map(normalizeKugouSong)
            .map(song => song.album?.coverUrl)
            .find((cover): cover is string => Boolean(cover));
    };

    const removeKugouPlaylistTrackCacheEntry = (globalCollectionId: string, hash: string): void => {
        const cached = kugouLikedTrackCache.get(globalCollectionId);
        if (!cached) return;
        kugouLikedTrackCache.set(globalCollectionId, {
            // 保留原时间戳：每删一首就续命 10 秒的话，连续操作能让这份缓存永不过期。
            fetchedAt: cached.fetchedAt,
            songs: cached.songs.filter(song => getKugouTrackHash(song) !== hash),
        });
    };

    const normalizeKugouHistoryEntries = (response: unknown) => {
        const entries = listOf(response).map((item: unknown) => ({
            id: String(valueOf(item, 'date', 'history_name', 'id') || ''),
            label: String(valueOf(item, 'history_name', 'date', 'name') || ''),
            data: jsonData([['date', valueOf(item, 'date')], ['historyName', valueOf(item, 'history_name')]]),
        }));

        entries.forEach(entry => {
            const date = dataText(entry.data, 'date') || entry.id;
            const historyName = dataText(entry.data, 'historyName') || entry.label;
            if (date && historyName) kugouHistoryNameByDate.set(date, historyName);
        });
        return entries;
    };

    // Resolves the provider's internal history name when the caller only has a display date.
    const getKugouHistoryName = async (date: string): Promise<string> => {
        const cached = kugouHistoryNameByDate.get(date);
        if (cached) return cached;

        const response = await requestKugou('everyday_history', { mode: 'list' });
        normalizeKugouHistoryEntries(response);
        return kugouHistoryNameByDate.get(date) || date;
    };

    /**
     * A user's listening ranking over a span, in KuGou's order; without a user, the signed-in account's.
     * The answer is `data.lists` beside `total_week` / `total_history` (read 2026-11-03, an account with
     * none). A row is a song with its play count in `listen_count`: seen by another client of the same
     * module on a real account, not yet by us.
     */
    const readKugouListeningRank = async (range: 'week' | 'all', userId?: string): Promise<FoliumSourceSong[]> => {
        const response = await requestKugou('user_listen', {
            userid: userId || getKugouUserId() || undefined,
            type: KUGOU_LISTENING_RANK_TYPES[range],
        });
        const rows = dataOf(response)?.lists;
        if (!Array.isArray(rows)) throw env.error('invalid-response', 'KuGou returned no listening ranking (data.lists)');
        return rows
            .map((item: any) => withListenCount(normalizeKugouSong(item), item?.listen_count))
            .filter(song => song.id);
    };

    /**
     * The entry for one span of a user's ranking. Its id names the user: the songs of one account's
     * ranking are never shown, or kept, as another's. Named in the app's language, as it is shown among the playlists.
     */
    const listeningRankCollection = (user: FoliumSourceUser, range: 'week' | 'all', songs: readonly FoliumSourceSong[]): FoliumSourceCollection => {
        const coverUrl = songs.find(song => song.album?.coverUrl)?.album?.coverUrl || user.avatarUrl;
        return {
            id: `listening-rank-${range}-${user.id}`,
            type: 'listening_rank',
            listeningRank: range,
            name: env.translate(`listeningRank.${range}`),
            description: env.translate('listeningRank.description'),
            ...(coverUrl ? { coverUrl } : {}),
            trackCount: songs.length,
            isOwned: false,
            creator: user,
        };
    };

    // The session and what was read with it go at once, before the first wait and whatever KuGou answers.
    const logout = async (): Promise<void> => {
        const told = requestKugou('logout').catch(() => undefined);
        transport.forgetAccount();
        clearKugouLikedCaches();
        kugouAnonymousSearchFallbackKeywords.clear();
        lastSeenKugouUserId = null;
        await told;
    };

    return {
        id: 'kugou',
        // The full name stays as the built-in provider wrote it, in every language; the short one is the mod's own.
        displayName: 'KuGou Music',
        shortName: env.text('name.short'),
        mark: { letter: 'K', color: '#2563eb' },
        getAvailability: () => transport.getAvailability(),
        describeFailure: describeKugouFailure,
        capabilities: {
            // Searching needs no account, but the federated search lists a source with sign-in only once signed in,
            // as it did the built-in provider (crossSource.ts: a platform with auth and no declaration).
            'search@1': {
                access: 'account',
                async searchSongs(query, limit, offset) {
                    const page = Math.floor(offset / limit) + 1;
                    const fallbackKey = query.trim();
                    if (!transport.hasAuthenticatedSearchSession()) return anonymousSearchPage(query, page, limit, offset);
                    // 首页已确认会拿到空清单时，后续页直接走匿名，别让列表又断在第一页。
                    if (offset > 0 && kugouAnonymousSearchFallbackKeywords.has(fallbackKey)) {
                        return anonymousSearchPage(query, page, limit, offset);
                    }
                    const response = await requestKugou('search', { keywords: query, keyword: query, type: 'song', page, pagesize: limit });
                    const rawItems = listOf(response);
                    // 过期登录态会继续走带凭据搜索，上游回空清单且不报错；首页空时退回匿名再搜一次。
                    if (offset === 0 && rawItems.length === 0) {
                        console.warn('[KugouProvider] authenticated search returned no items, retrying anonymously');
                        rememberKugouAnonymousSearchFallback(fallbackKey);
                        try {
                            const anonymous = await anonymousSearchPage(query, page, limit, offset);
                            // Its next offset moves on with the rows KuGou gave (pageOfWithRawItemCount): it gave some.
                            if ((anonymous.nextOffset ?? offset) > offset) return anonymous;
                        } catch (error) {
                            console.warn('[KugouProvider] anonymous search retry failed', error);
                        }
                    } else if (offset === 0) {
                        forgetKugouAnonymousSearchFallback(fallbackKey);
                    }
                    return pageOfWithRawItemCount(
                        normalizeKugouSearchSongs(rawItems),
                        response,
                        limit,
                        offset,
                        rawItems.length,
                    );
                },
                searchAlbums: (query, limit, offset) => searchKugouCollections('album', query, limit, offset),
                searchPlaylists: (query, limit, offset) => searchKugouCollections('playlist', query, limit, offset),
            },
            'songs@1': {
                // Local songs get online details from KuGou (the metadata match), as from the built-in provider.
                metadataMatch: true,
                async getSong(id) {
                    const response = await requestKugou('audio', { hash: id });
                    const item = listOf(response)[0] ?? dataOf(response);
                    return hashOf(item) ? normalizeKugouSong(item) : null;
                },
            },
            'playback.audio@1': {
                async getAudioSource(song, quality): Promise<FoliumSourceAudio | null> {
                    const isCloud = song.variant === 'cloud';
                    const hash = (dataText(song.data, 'hash') || song.lyricIds?.kugou || song.id).toUpperCase();
                    const qualities = isCloud ? [quality] : qualityFallbacks(quality);
                    const albumId = dataText(song.data, 'albumId');
                    const albumAudioId = dataText(song.data, 'albumAudioId');
                    // What is said when no URL comes: the last /song/url answer without one (it carries KuGou's error
                    // code), else the legacy endpoint's, else the first request that failed.
                    let noUrlSeen: { status?: unknown; errorCode?: unknown } | undefined;
                    let firstFailure: unknown;
                    // A request that ran out of time stops the remaining /song/url qualities and variants: they would wait
                    // as long. The legacy endpoint is still asked once.
                    let songUrlChainStopped = false;
                    // The best full track an answer below the quality asked for brought: kept while a better one is
                    // looked for, returned when none comes.
                    let bestSource: FoliumSourceAudio | undefined;
                    // A purchase preview /song/url gave at the standard quality: played as a clip only when nothing
                    // else gives the full track.
                    let previewSource: FoliumSourceAudio | undefined;
                    const resolved = (source: FoliumSourceAudio, requestVariant: string): FoliumSourceAudio => {
                        console.info('[KugouProvider] playback:url-resolved', {
                            hash,
                            requestedQuality: quality,
                            resolvedQuality: source.quality,
                            requestVariant,
                            ...(source.preview ? { preview: true } : {}),
                        });
                        return source;
                    };

                    // The privileged endpoint (/song/url/new) first, for an account that may have a VIP credential:
                    // it gives full tracks /song/url answers with a preview or no URL for.
                    if (!isCloud && transport.hasVipSession()) {
                        try {
                            const response = await requestKugou('song_url_new', {
                                hash: hash.toLowerCase(), album_id: albumId, album_audio_id: albumAudioId,
                            });
                            const data: unknown = dataOf(response);
                            const payload: unknown = Array.isArray(data) ? data[0] : data;
                            const urls: unknown = valueOf(payload, 'url', 'play_url');
                            const urlList: unknown[] = Array.isArray(urls) ? urls : [urls];
                            const indexed = urlList.length > 1;
                            // The asked quality's place, or the nearest lower one with a URL the player can decode.
                            const playable = (at: number): string | undefined => {
                                const candidate = audioUrlOf(urlList[at]);
                                return candidate && !isKugouEncryptedAudio(candidate, indexed ? undefined : payload) ? candidate : undefined;
                            };
                            let index = indexed ? Math.min(KUGOU_QUALITY_RANK[quality], urlList.length - 1) : 0;
                            while (indexed && index > 0 && !playable(index)) index--;
                            const url = playable(index);
                            const privilege: unknown = valueOf(payload, 'priv_status');
                            // Only a positive priv_status says KuGou took the VIP credential; 0 or none is a preview.
                            const entitled = (toFiniteNumber(privilege) ?? 0) > 0;
                            if (url && entitled && !isKugouPrivilegedPreview(payload)) {
                                // A single URL carries its own figures; an array's place says its quality.
                                const actual = indexed ? KUGOU_INDEXED_QUALITIES[index] : actualKugouQuality(payload, quality);
                                const replayGain = kugouReplayGain(payload);
                                const source: FoliumSourceAudio = {
                                    url: kugouPlaybackUrl(url, transport.runtime),
                                    quality: actual,
                                    ...(replayGain ? { replayGain } : {}),
                                };
                                if (KUGOU_QUALITY_RANK[actual] >= KUGOU_QUALITY_RANK[quality]) return resolved(source, 'privileged');
                                bestSource = source;
                            } else if (urlList.some(entry => audioUrlOf(entry))) {
                                console.info('[KugouProvider] playback:privileged-refused', { hash, requestedQuality: quality, privilege, decodable: Boolean(url) });
                            }
                        } catch (error) {
                            // A sign-in that has ended is said by /song/url below as well: this optional request does
                            // not hide the ordinary way.
                            console.warn('[KugouProvider] playback:privileged-failed', { hash, requestedQuality: quality, ...errorFields(error) });
                        }
                    }

                    // Tries the preferred KuGou quality first and degrades until a playable URL is returned.
                    for (const candidateQuality of qualities) {
                        if (songUrlChainStopped) break;
                        // A lower quality cannot beat a full track already found at it or above.
                        if (bestSource && KUGOU_QUALITY_RANK[candidateQuality] <= KUGOU_QUALITY_RANK[bestSource.quality ?? 'standard']) break;
                        const requestVariants = isCloud
                            ? [{ name: 'cloud', operation: 'user_cloud_url' as const, params: {
                                hash, id: dataText(song.data, 'fileId'),
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
                                const payload = Array.isArray(data) ? data[0] : data;
                                const url = audioUrlOf(
                                    valueOf(payload, 'play_url', 'playUrl', 'url')
                                    ?? valueOf(data?.[0], 'url', 'play_url'),
                                );
                                const purchasePreview = url !== undefined && !isCloud && isKugouPurchasePreview(payload);
                                if (url && purchasePreview && candidateQuality !== 'standard') {
                                    // A preview at this quality: a lower one may be the full track.
                                    console.info('[KugouProvider] playback:purchase-preview', { hash, candidateQuality, requestVariant: requestVariant.name });
                                    break;
                                }
                                if (url) {
                                    const replayGain = kugouReplayGain(payload);
                                    const source: FoliumSourceAudio = {
                                        // The upstream candidate, over https on the web (kugouPlaybackUrl).
                                        url: kugouPlaybackUrl(url, transport.runtime),
                                        quality: isCloud ? candidateQuality : actualKugouQuality(payload, candidateQuality),
                                        ...(replayGain ? { replayGain } : {}),
                                    };
                                    if (purchasePreview) {
                                        previewSource ??= { ...source, preview: true };
                                        break;
                                    }
                                    const best = betterKugouSource(bestSource, source);
                                    // Degraded below what was asked: kept, and the next (lower) quality only asked if it
                                    // could still be better.
                                    if (KUGOU_QUALITY_RANK[source.quality ?? 'standard'] < KUGOU_QUALITY_RANK[candidateQuality]) {
                                        bestSource = best;
                                        break;
                                    }
                                    // The loop's start skips qualities a held source already beats: this one is the better.
                                    return resolved(best, requestVariant.name);
                                }
                                noUrlSeen = {
                                    status: valueOf(data, 'status') ?? valueOf(response, 'status'),
                                    errorCode: valueOf(data, 'errcode', 'error_code') ?? valueOf(response, 'errcode', 'error_code'),
                                };
                                console.warn('[KugouProvider] playback:no-url', {
                                    hash,
                                    requestedQuality: quality,
                                    candidateQuality,
                                    requestVariant: requestVariant.name,
                                    ...noUrlSeen,
                                });
                            } catch (error) {
                                // A full track (or a clip) already found plays rather than a failure that stops the chain.
                                const held = bestSource ?? previewSource;
                                // A sign-in that has ended is said at once: another quality would be refused the same way.
                                if ((error as { code?: unknown } | null)?.code === 'auth-required') {
                                    if (held) return resolved(held, 'held');
                                    throw error;
                                }
                                firstFailure ??= error;
                                console.warn('[KugouProvider] playback:quality-failed', {
                                    hash,
                                    requestedQuality: quality,
                                    candidateQuality,
                                    requestVariant: requestVariant.name,
                                    ...errorFields(error),
                                });
                                // Asked to wait, or nowhere to ask (the local service is not loaded, the web build has no
                                // address): every other request would be answered the same, the legacy one too.
                                const said = describeKugouFailure('audio', error);
                                if (said?.case === 'local-service-stopped' || said?.case === 'not-configured'
                                    || said?.httpStatus === 429 || (error as { retryAfterMs?: unknown } | null)?.retryAfterMs !== undefined) {
                                    if (held) return resolved(held, 'held');
                                    throw error;
                                }
                                if (isKugouTimeout(error)) {
                                    songUrlChainStopped = true;
                                    break;
                                }
                            }
                        }
                    }

                    if (bestSource) return resolved(bestSource, 'degraded');

                    // The collection page's context (ppage_id 356753938, the first of the lite client's defaults alone)
                    // gives some songs the account saved a full track that the default context refuses. KuGouMusicApi reads
                    // ppage_id only on the lite platform, which the desktop main entry sets; a web service may not.
                    if (!isCloud && !songUrlChainStopped && transport.runtime === 'electron') {
                        try {
                            const response = await requestKugou('song_url', {
                                hash, quality: qualityValue('standard'), album_id: albumId, album_audio_id: albumAudioId, ppage_id: '356753938',
                            });
                            const data: unknown = dataOf(response);
                            const payload: unknown = Array.isArray(data) ? data[0] : data;
                            const url = audioUrlOf(valueOf(payload, 'play_url', 'playUrl', 'url'));
                            if (url) {
                                const replayGain = kugouReplayGain(payload);
                                const source: FoliumSourceAudio = {
                                    url: kugouPlaybackUrl(url, transport.runtime),
                                    quality: 'standard',
                                    ...(replayGain ? { replayGain } : {}),
                                };
                                if (!isKugouPurchasePreview(payload)) return resolved(source, 'collection');
                                previewSource ??= { ...source, preview: true };
                            }
                        } catch (error) {
                            firstFailure ??= error;
                            console.warn('[KugouProvider] playback:collection-failed', { hash, requestedQuality: quality, ...errorFields(error) });
                        }
                    }

                    // KuGou's current /song/url can mark certain hashes as unavailable (status: 3)
                    // even though the same hash is still playable through the old mobile endpoint.
                    // Only use this as a last resort after every quality and hash variant above has failed.
                    if (!isCloud) {
                        try {
                            const legacyResponse = await transport.legacyPlayInfo(hash);
                            const legacyUrl = audioUrlOf(valueOf(legacyResponse, 'url') ?? valueOf(dataOf(legacyResponse), 'url'))
                                ?? audioUrlOf(valueOf(legacyResponse, 'backup_url') ?? valueOf(dataOf(legacyResponse), 'backup_url'));
                            if (legacyUrl) {
                                console.info('[KugouProvider] playback:url-resolved-legacy', {
                                    hash,
                                    requestedQuality: quality,
                                });
                                return {
                                    url: kugouPlaybackUrl(legacyUrl, transport.runtime),
                                    quality: 'standard',
                                };
                            }
                            const legacyStatus = valueOf(legacyResponse, 'status') ?? valueOf(dataOf(legacyResponse), 'status');
                            noUrlSeen ??= { status: legacyStatus };
                            console.warn('[KugouProvider] playback:no-url-legacy', {
                                hash,
                                requestedQuality: quality,
                                status: legacyStatus,
                            });
                        } catch (error) {
                            firstFailure ??= error;
                            console.warn('[KugouProvider] playback:legacy-failed', {
                                hash,
                                requestedQuality: quality,
                                ...errorFields(error),
                            });
                        }
                    }

                    // Nothing gave the full track: the purchase preview plays as a clip (the host says so and keeps none).
                    if (previewSource) return resolved(previewSource, 'preview');

                    console.warn('[KugouProvider] playback:unavailable', { hash, requestedQuality: quality, attemptedQualities: qualities });
                    if (noUrlSeen || firstFailure === undefined) throw kugouNoUrlError(env.error, noUrlSeen, !transport.hasAuthenticatedSearchSession());
                    // What failed first, as it was thrown (narrowed to `{} | null` by the check above, which says nothing new).
                    throw firstFailure as unknown;
                },
            },
            'lyrics@1': {
                // A lyric source of other songs too (the match windows, the automatic pick), under its full name.
                crossSource: { name: env.text('name.lyrics') },
                getLyrics: song => getKugouLyrics(song),
                getChorusRanges: songId => getKugouChorusRanges(songId),
                getSearchAlias: song => getKugouLyricSearchAlias(song),
            },
            'auth@1': {
                getLoginTexts: () => ({ title: env.text('login.title'), note: env.text('login.note') }),
                async getLoginStatus() {
                    const userId = getKugouUserId();
                    console.info('[KugouProvider] login-status:start', {
                        transport: transport.runtime,
                        hasWebUserId: Boolean(userId),
                    });
                    if (!userId && transport.runtime === 'web') return null;
                    try {
                        const response = await requestKugou('user_detail', { userid: userId || undefined });
                        let user = normalizeUser(response);
                        if (user.id && user.nickname) {
                            try {
                                const claimedYouthVip = await ensureKugouYouthVip(user.id);
                                const vipResponse = await requestKugou('user_vip_detail', { userid: user.id });
                                user = { ...user, vipType: normalizeKugouVipType(vipResponse) };
                                if (claimedYouthVip && user.vipType === 0) {
                                    user = { ...user, vipType: 1 };
                                }
                            } catch (error) {
                                console.warn('[KugouProvider] login-status:vip-error', error);
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
                        console.warn('[KugouProvider] login-status:error', error);
                        throw error;
                    }
                },
                logout,
                // The session KuGou no longer takes goes the same way as at a sign-out.
                signInRanOut: logout,
                showsKeptAccountAtStart: true,
                async startLogin() {
                    const response = await requestKugou('login_qr_key');
                    const data = dataOf(response);
                    return String(valueOf(data, 'qrcode', 'qrkey', 'key', 'ticket') || '');
                },
                async createQr(key) {
                    const response = await requestKugou('login_qr_create', { key, qrimg: true });
                    const data = dataOf(response);
                    return String(valueOf(data, 'base64', 'qrimg', 'qrcode', 'url') || '');
                },
                async checkLogin(key) {
                    const response = await requestKugou('login_qr_check', { key, qrcode: key });
                    const data = dataOf(response);
                    const status = Number(valueOf(data, 'status', 'code') ?? valueOf(response, 'status', 'code'));
                    if (status === 0) return { state: 'expired' };
                    if (status === 1) return { state: 'waiting' };
                    if (status === 2 || status === 3) return { state: 'scanned' };
                    if (status === 4 || data?.token) return { state: 'confirmed' };
                    const message = String(valueOf(data, 'message', 'msg', 'error') || '');
                    return { state: 'error', message, failure: kugouCheckFailure(status, message) };
                },
                describeLoginFailure: describeKugouLoginFailure,
            },
            'library@1': {
                async getUserPlaylists(userId, limit, offset) {
                    const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
                    const response = await requestKugou('user_playlist', { userid: userId, page: Math.floor(offset / requestLimit) + 1, pagesize: requestLimit });
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
                    return pageOfWithRawItemCount(items, response, requestLimit, offset, rawItems.length);
                },
                async getUserAlbums(userId, limit, offset) {
                    const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
                    const response = await requestKugou('user_playlist', { userid: userId, page: Math.floor(offset / requestLimit) + 1, pagesize: requestLimit });
                    const rawItems = listOf(response);
                    const items = rawItems
                        .filter(item => getKugouUserCollectionType(item) === 'album')
                        .map(item => normalizeCollection(item, 'album'))
                        .filter(collection => collection.id !== '');
                    return pageOfWithRawItemCount(items, response, requestLimit, offset, rawItems.length);
                },
                async getLikedSongIds(userId) {
                    const order = ++kugouLikedRowReads;
                    const beganAt = performance.now();
                    // The liked list is read to its end or the read throws (getKugouPlaylistTrackSongs).
                    const songs = await getKugouLikedPlaylistTracks(userId);
                    // The rows of the newest read stand: an older one that ends after it notes none.
                    if (order === kugouLikedRowReads) noteKugouLikedRows(songs, beganAt);
                    return { ids: songs.map(song => song.id).filter(Boolean), whole: true };
                },
                // The count KuGou's list of the account's playlists gives for the liked list, read the way
                // a playlist card's count is: one request, the one the read above begins with. It is not
                // the count of the rows that read brings, so the two may differ.
                async getLikedSongCount(userId) {
                    const playlist = await getKugouLikedPlaylist(userId);
                    return playlist ? normalizeCollection(playlist).trackCount ?? null : null;
                },
                // The cloud drive stands among the collections as one entry; nothing is asked for it.
                getCloudCollection(user) {
                    return Promise.resolve({
                        id: 'cloud', name: env.translate('cloud.name'), type: 'cloud',
                        ...(user?.avatarUrl ? { coverUrl: user.avatarUrl } : {}),
                    });
                },
                async getListeningRankCollections(user) {
                    const ranked = await Promise.all(LISTENING_RANK_RANGES.map(async range => ({ range, songs: await readKugouListeningRank(range, user.id) })));
                    const entries = ranked
                        .filter(({ songs }) => songs.length > 0)
                        .map(({ range, songs }) => listeningRankCollection(user, range, songs));
                    console.info('[KugouProvider] Listening ranking read', { entries: entries.map(entry => `${entry.listeningRank}:${entry.trackCount}`) });
                    return entries;
                },
            },
            'catalog@1': {
                canResolveSongCatalogRefs: song => Boolean(getKugouCatalogLookupId(song)),
                resolveSongCatalogRefs: resolveKugouSongCatalogRefs,
                async getPlaylistTracks(id, limit, offset, collection) {
                    const recommendationPage = await getKugouRecommendationPage(collection, limit, offset);
                    if (recommendationPage) return recommendationPage;

                    const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
                    const response = await requestKugou('playlist_track_all', { id, pagesize: requestLimit, page: Math.floor(offset / requestLimit) + 1 });
                    return pageOf(listOf(response).map(normalizeKugouSong), response, requestLimit, offset);
                },
                async getListeningRankTracks(range, limit, offset, collection) {
                    return listeningRankPage(await readKugouListeningRank(range, collection?.creator?.id), limit, offset);
                },
                async getCloudTracks(limit, offset) {
                    const requestLimit = Math.min(Math.max(1, limit), KUGOU_MAX_PAGE_SIZE);
                    const response = await requestKugou('user_cloud', {
                        userid: getKugouUserId() || undefined,
                        page: Math.floor(offset / requestLimit) + 1,
                        pagesize: requestLimit,
                    });
                    const items = listOf(response).map((item): FoliumSourceSong => ({ ...normalizeKugouSong(item), variant: 'cloud' }));
                    return pageOf(items, response, requestLimit, offset);
                },
                async getPlaylistDetail(id, existingCollection) {
                    if (existingCollection && isKugouVirtualRecommendation(existingCollection)) return existingCollection;

                    const response = await requestKugou('playlist_detail', { ids: id });
                    const data = dataOf(response);
                    const rawPlaylist = listOf(response)[0] ?? data?.info?.[0] ?? data;
                    if (!rawPlaylist || typeof rawPlaylist !== 'object' || Array.isArray(rawPlaylist)) {
                        return existingCollection || null;
                    }
                    const normalized = normalizeCollection({
                        ...rawPlaylist,
                        global_collection_id: valueOf(rawPlaylist, 'global_collection_id') ?? id,
                    }, 'playlist', Boolean(existingCollection?.isOwned));
                    const coverUrl = normalized.coverUrl || existingCollection?.coverUrl;
                    const description = normalized.description || existingCollection?.description;
                    const trackCount = normalized.trackCount !== undefined && normalized.trackCount > 0
                        ? normalized.trackCount
                        : existingCollection?.trackCount;
                    const creator = normalized.creator || existingCollection?.creator;
                    return {
                        ...normalized,
                        name: normalized.name || existingCollection?.name || '',
                        ...(coverUrl ? { coverUrl } : {}),
                        ...(description ? { description } : {}),
                        ...(trackCount !== undefined ? { trackCount } : {}),
                        ...(creator ? { creator } : {}),
                        data: { ...existingCollection?.data, ...normalized.data },
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
                    const coverUrl = normalized.coverUrl || existingCollection?.coverUrl;
                    const description = normalized.description || existingCollection?.description;
                    const trackCount = normalized.trackCount !== undefined && normalized.trackCount > 0
                        ? normalized.trackCount
                        : existingCollection?.trackCount;
                    const artists = normalized.artists?.length ? normalized.artists : existingCollection?.artists;
                    const aliases = normalized.aliases?.length ? normalized.aliases : existingCollection?.aliases;
                    const publishedAt = normalized.publishedAt ?? existingCollection?.publishedAt;
                    const publisher = normalized.publisher || existingCollection?.publisher;
                    return {
                        ...normalized,
                        name: normalized.name || existingCollection?.name || '',
                        ...(coverUrl ? { coverUrl } : {}),
                        ...(description ? { description } : {}),
                        ...(trackCount !== undefined ? { trackCount } : {}),
                        ...(artists ? { artists } : {}),
                        ...(aliases ? { aliases } : {}),
                        ...(publishedAt !== undefined ? { publishedAt } : {}),
                        ...(publisher ? { publisher } : {}),
                    };
                },
                async getAlbumTracks(id, limit = 30, offset = 0, collection) {
                    const pageSize = Math.min(Math.max(1, limit), 30);
                    const response = await requestKugou('album_songs', {
                        id,
                        page: Math.floor(offset / pageSize) + 1,
                        pagesize: pageSize,
                    });
                    const items = listOf(response).map((raw): FoliumSourceSong => {
                        const song = normalizeKugouSong(raw);
                        if (song.album?.name || !collection?.name) return song;
                        return {
                            ...song,
                            album: { id: song.album?.id ?? '', ...song.album, name: collection.name },
                        };
                    });
                    return pageOf(items, response, pageSize, offset);
                },
                async getArtistSongs(id, limit, offset) {
                    const response = await requestKugou('artist_audios', { id, page: Math.floor(offset / limit) + 1, pagesize: limit });
                    return pageOf(listOf(response).map(normalizeKugouSong), response, limit, offset);
                },
                async getArtistAlbums(id, limit, offset) {
                    const response = await requestKugou('artist_albums', { id, page: Math.floor(offset / limit) + 1, pagesize: limit });
                    const items = listOf(response)
                        .map(item => normalizeCollection(item, 'album'))
                        .filter(collection => collection.id !== '');
                    return pageOf(items, response, limit, offset);
                },
                async getArtistDetail(id) {
                    const response = await requestKugou('artist_detail', { id });
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
                            return idText(valueOf(item, 'global_collection_id', 'globalCollectionId')) === id
                                || idText(valueOf(item, 'listid', 'list_id')) === id;
                        }
                        return idText(valueOf(item, 'musiclib_id', 'musicLibId', 'album_id', 'albumId', 'list_create_listid')) === id;
                    });
                },
            },
            'recommendations@1': {
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
                                ...errorFields(error),
                            });
                            return null;
                        }
                    }));
                    return collections.filter((collection): collection is FoliumSourceCollection => Boolean(collection));
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
                        .map(entry => dataText(entry.data, 'date') || entry.id)
                        .filter(Boolean);
                },
                async getHistorySongs(entry) {
                    const id = typeof entry === 'string' ? entry : entry.id;
                    const historyName = typeof entry === 'string'
                        ? await getKugouHistoryName(id)
                        : dataText(entry.data, 'historyName') || entry.label || id;
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
                        hash: id,
                        songid: id,
                    });
                    const replacement = songListOf(response).map(normalizeKugouSong).find(song => song.id);
                    return replacement ? { replacement } : {};
                },
            },
            'mutations@1': {
                canAddToPlaylist: canAddToKugouPlaylist,
                async likeSong(song, liked) {
                    syncKugouSessionUser();
                    const userId = getKugouUserId();
                    // 这里静默 return 的话，omni 会把它当成 mutation 成功并翻转 likedSongIds，心形跟着变。
                    if (!userId) {
                        throw env.error('auth-required', 'KuGou session has no user id');
                    }
                    const targetHash = getKugouTrackHash(song);
                    // The row noted for the song is used once and goes, whatever becomes of the request.
                    const cachedLikedFileId = kugouLikedRowIds.get(targetHash);
                    kugouLikedRowIds.delete(targetHash);
                    kugouLikedRowsSentAt.set(targetHash, performance.now());
                    let likedPlaylistRef = kugouLikedPlaylistRefCache.get(userId);
                    if (!likedPlaylistRef) {
                        const playlist = await getKugouLikedPlaylist(userId);
                        const listId = idText(valueOf(playlist, 'listid', 'list_id'));
                        if (!listId) {
                            throw env.error(
                                'invalid-response',
                                'KuGou liked playlist has no listid',
                            );
                        }
                        const globalCollectionId = idText(valueOf(playlist, 'global_collection_id', 'globalCollectionId'));
                        likedPlaylistRef = {
                            listId,
                            ...(globalCollectionId ? { globalCollectionId } : {}),
                        };
                        // 库刷新会写这份缓存，mutation 先到的时候也要写，否则每次收藏都要重新拉一次歌单列表。
                        rememberKugouLikedPlaylistRef(userId, likedPlaylistRef);
                    }
                    const { listId, globalCollectionId } = likedPlaylistRef;
                    if (liked) {
                        await requestKugou('playlist_tracks_add', {
                            listid: listId,
                            data: getKugouTrackAddData(song),
                        });
                        if (globalCollectionId) kugouLikedTrackCache.delete(globalCollectionId);
                        return;
                    }

                    if (cachedLikedFileId !== undefined) {
                        await requestKugou('playlist_tracks_del', {
                            listid: listId,
                            fileids: cachedLikedFileId,
                        });
                        if (globalCollectionId) removeKugouPlaylistTrackCacheEntry(globalCollectionId, targetHash);
                        return;
                    }

                    if (!globalCollectionId) {
                        throw env.error(
                            'invalid-response',
                            'KuGou liked playlist is missing global_collection_id',
                        );
                    }

                    // The song's data.fileId belongs to the playlist it was played from. Looking it
                    // up in the liked playlist by hash is required; sending another playlist's row id deletes
                    // whichever liked song happens to share that id.
                    const likedCollectionId = globalCollectionId;
                    const findLikedFileId = async (forceRefresh: boolean): Promise<string | undefined> => {
                        const likedTracks = await getKugouPlaylistTrackSongs(likedCollectionId, { forceRefresh });
                        const likedTrack = likedTracks.find(track => getKugouTrackHash(track) === targetHash);
                        const fileId = likedTrack ? dataText(likedTrack.data, 'fileId') : '';
                        return fileId === '' ? undefined : fileId;
                    };

                    // 缓存里没有就强制重拉一次再下结论，避免 10 秒窗口内的旧快照误判。
                    const likedFileId = await findLikedFileId(false) ?? await findLikedFileId(true);
                    if (likedFileId === undefined) {
                        // 服务端的收藏歌单里本来就没有这首歌，目标状态已经达成。抛错只会让心形永远亮着、
                        // 每点一次报一次错；直接返回，让上层把本地的陈旧点赞状态清掉。
                        console.info('[KugouProvider] unlike:already-absent', { hash: targetHash });
                        removeKugouPlaylistTrackCacheEntry(likedCollectionId, targetHash);
                        return;
                    }

                    await requestKugou('playlist_tracks_del', {
                        listid: listId,
                        fileids: likedFileId,
                    });
                    removeKugouPlaylistTrackCacheEntry(likedCollectionId, targetHash);
                },
                async updatePlaylistTracks(operation, playlist, tracks) {
                    const collection = typeof playlist === 'object' ? playlist : null;
                    const listId = dataText(collection?.data, 'listId') || getId(playlist);
                    if (operation === 'add') {
                        const data = tracks.map(getKugouTrackAddData).join(',');
                        await requestKugou('playlist_tracks_add', { listid: listId, data });
                        return;
                    }
                    // fileid 是歌单内的行号：只有当 tracks 就是从这个歌单的详情里取出来的时，它才是对的。
                    // 传别的歌单里的同一首歌会删掉这个歌单里碰巧同号的另一首（"我喜欢"就踩过，见 likeSong）。
                    const fileids = tracks.map(getKugouTrackFileId).join(',');
                    await requestKugou('playlist_tracks_del', { listid: listId, fileids });
                },
                async subscribePlaylist(playlist, subscribed) {
                    const collection = typeof playlist === 'object' ? playlist : null;
                    if (isKugouVirtualRecommendation(collection)) return;

                    const providerData = collection?.data;
                    const listId = dataText(providerData, 'listId') || getId(playlist);
                    if (!subscribed) {
                        await requestKugou('playlist_del', { listid: listId });
                        return;
                    }
                    await requestKugou('playlist_add', {
                        name: collection?.name || '',
                        type: 1,
                        source: 1,
                        list_create_userid: dataText(providerData, 'creatorUserId'),
                        list_create_listid: dataText(providerData, 'creatorListId') || listId,
                        list_create_gid: dataText(providerData, 'creatorGid'),
                    });
                },
                async subscribeAlbum(id, subscribed) {
                    const userId = getKugouUserId();
                    if (!userId) return;

                    if (!subscribed) {
                        const album = (await getKugouUserPlaylistItems(userId)).find(item => (
                            getKugouUserCollectionType(item) === 'album'
                            && idText(valueOf(item, 'musiclib_id', 'musicLibId', 'album_id', 'albumId', 'list_create_listid')) === id
                        ));
                        const listId = idText(valueOf(album, 'listid', 'list_id'));
                        if (!listId) return;
                        await requestKugou('playlist_del', { listid: listId });
                        return;
                    }

                    const rawAlbum = await getKugouAlbumDetailRaw(id);
                    if (!rawAlbum) return;
                    const albumId = idText(valueOf(rawAlbum, 'album_id', 'AlbumID', 'albumId')) || id;
                    const authors: unknown = valueOf(rawAlbum, 'authors');
                    const firstAuthor: unknown = Array.isArray(authors) ? valueOf(authors[0], 'base') ?? authors[0] : undefined;
                    const creatorUserId = idText(valueOf(rawAlbum, 'list_create_userid', 'create_userid', 'author_id', 'authorId', 'userid')
                        ?? valueOf(firstAuthor, 'author_id', 'authorId', 'id'));
                    if (!creatorUserId) return;

                    await requestKugou('playlist_add', {
                        source: 2,
                        name: String(valueOf(rawAlbum, 'name', 'album_name', 'AlbumName') || ''),
                        type: 1,
                        list_create_userid: creatorUserId,
                        list_create_listid: albumId,
                    });
                },
            },
            'covers@1': kugouCovers,
        },
    };
};

/** A finite number of a number or a numeric string; undefined for anything else (src/utils/replayGain.ts). */
function toFiniteNumber(value: unknown): number | undefined {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value !== 'string' || value.trim() === '') return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

/** A peak in decibels as a linear ratio (src/utils/replayGain.ts decibelsToLinearPeak). */
function decibelsToLinearPeak(decibels: unknown): number | undefined {
    const value = toFiniteNumber(decibels);
    return value === undefined ? undefined : Math.pow(10, value / 20);
}
