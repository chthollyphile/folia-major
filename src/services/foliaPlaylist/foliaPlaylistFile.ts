import type { LocalSong, SongResult, UnifiedSong } from '../../types';
import type { FoliaPlaylist, FoliaPlaylistEntry, FoliaPlaylistOrigin } from '../../types/foliaPlaylist';
import type { JsonValue } from '../../types/onlineMusic';
import type { FoliaEntryAvailability, FoliaEntryAvailabilityDeps } from '../../library/core/foliaPlaylist/foliaPlaylist.contract';
import { resolveFoliaEntryAvailability } from '../../library/core/foliaPlaylist/foliaPlaylistAvailability';
import { getPlaybackSongKey, getPlaybackSourceRef } from '../../utils/appPlaybackGuards';
import { getFoliaEntryLocalSongId } from '../../utils/foliaPlaylistEntries';
import { buildLocalEntry } from './foliaPlaylistRows';
import { normalizeM3uPath } from './foliaPlaylistM3u';

// src/services/foliaPlaylist/foliaPlaylistFile.ts
// Folia 聚合歌单的 JSON 文件（一张歌单一个文件）：写出去的形状、读回来时的校验、本地歌怎么重新认、读入前的预览。
// 全是纯函数，不碰数据库、不碰 DOM；下载与读文件在 foliaPlaylistFileIo.ts。格式的说明在 docs/folia-playlist-file.md。
//
// 文件是不可信的数据。读的时候：
// - 先看大小、条目数的上限，再逐字段校验；歌的快照是照白名单重新拼出来的，文件里多出来的字段一律不要；
// - 条目的 key 不信文件写的，从拼出来的歌重新算；
// - 地址只认 http / https 的封面；别的地址、带凭据的东西既不写出去也不读进来；
// - 本地歌只凭路径、文件名、大小、时长去曲库里找同一个文件，找不到就不导入（不按歌名歌手猜）。

export const FOLIA_PLAYLIST_FILE_FORMAT = 'folia-playlist';
export const FOLIA_PLAYLIST_FILE_VERSION = 1;
export const FOLIA_PLAYLIST_FILE_EXTENSION = '.folia-playlist.json';
/** 读入的上限：文件大小与条目数。 */
export const FOLIA_PLAYLIST_FILE_MAX_BYTES = 32 * 1024 * 1024;
export const FOLIA_PLAYLIST_FILE_MAX_ENTRIES = 20_000;
/** 音源自己的数据（sourceRef.providerData）序列化后最多这么长，和音源契约里的上限一样。 */
const SOURCE_DATA_MAX_CHARS = 16_384;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const clip = (value: unknown, max: number): string => (typeof value === 'string' ? value.slice(0, max) : '');
const finite = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);
const timestamp = (value: unknown): number => {
    const number = finite(value);
    return number !== undefined && number > 0 ? Math.floor(number) : 0;
};
const mediaIdOf = (value: unknown): string | number | undefined => {
    if (typeof value === 'string') return value.length > 0 && value.length <= 256 ? value : undefined;
    return finite(value);
};
const httpUrl = (value: unknown): string | undefined => {
    const text = clip(value, 2048);
    return /^https?:\/\/[^\s"'<>]+$/i.test(text) ? text : undefined;
};
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const ITEM_KIND = /^[A-Za-z0-9._-]{1,64}$/;
const ENTRY_KEY = /^(online|navidrome|local):.{1,640}$/s;
const CATALOG_KINDS = new Set(['album', 'artist', 'playlist']);
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// ---- 写出去 ----

/** 文件里一条本地歌带的、用来在另一台机器的曲库里重新找到同一个文件的东西。 */
export type FoliaFileLocalHint = {
    /** 导入时的相对路径（含导入的那个文件夹的名字），用 `/` 分隔。 */
    path?: string;
    fileName?: string;
    fileSize?: number;
    durationMs?: number;
};

// 地址里可能带着令牌（查询串、片段），或者只在这台机器上有意义（blob、data、file）：不写出去。
const isCarryingUrl = (value: string): boolean => (
    /^(blob|data|file|filesystem):/i.test(value) || (/^[a-z][a-z0-9+.-]*:\/\//i.test(value) && /[?#]/.test(value))
);

const cleanSourceData = (value: unknown, depth = 0): JsonValue | undefined => {
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string') return isCarryingUrl(value) ? undefined : value;
    if (depth >= 6) return undefined;
    if (Array.isArray(value)) {
        return value.slice(0, 256).flatMap((item) => {
            const cleaned = cleanSourceData(item, depth + 1);
            return cleaned === undefined ? [] : [cleaned];
        });
    }
    if (!isRecord(value)) return undefined;
    const out: Record<string, JsonValue> = {};
    for (const [key, item] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(key) || key.length > 128) continue;
        const cleaned = cleanSourceData(item, depth + 1);
        if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
};

const sourceDataOf = (value: unknown): Record<string, JsonValue> | undefined => {
    const cleaned = cleanSourceData(value);
    if (!isRecord(cleaned) || Object.keys(cleaned).length === 0) return undefined;
    return JSON.stringify(cleaned).length <= SOURCE_DATA_MAX_CHARS ? cleaned : undefined;
};

const catalogRefOf = (value: unknown, sourceId: string): UnifiedSong['album']['catalogRef'] | undefined => {
    if (!isRecord(value) || value.providerId !== sourceId || typeof value.kind !== 'string' || !CATALOG_KINDS.has(value.kind)) return undefined;
    const id = mediaIdOf(value.id);
    return id === undefined ? undefined : { providerId: sourceId, kind: value.kind as 'album' | 'artist' | 'playlist', id };
};

const textList = (value: unknown): string[] | undefined => {
    if (!Array.isArray(value)) return undefined;
    const list = value.map(item => clip(item, 300)).filter(Boolean).slice(0, 16);
    return list.length > 0 ? list : undefined;
};

/**
 * 一首歌照白名单重新拼一遍：显示用的字段（歌名、歌手、专辑、封面、时长……）。写出去和读进来都过这一道。
 * `sourceId` 给了（在线歌）：专辑、歌手能打开的页面只认这个音源自己的。封面只留 http / https 的。
 */
const displayFieldsOf = (song: Json, sourceId: string | null, keepCover: boolean): Pick<SongResult, 'name' | 'artists' | 'album' | 'durationMs'> & Partial<SongResult> => {
    const album = isRecord(song.album) ? song.album : {};
    const coverUrl = keepCover ? httpUrl(album.coverUrl) : undefined;
    const albumRef = sourceId ? catalogRefOf(album.catalogRef, sourceId) : undefined;
    const artists = (Array.isArray(song.artists) ? song.artists : []).slice(0, 64).flatMap((artist: unknown) => {
        if (!isRecord(artist)) return [];
        const name = clip(artist.name, 300);
        if (!name) return [];
        const ref = sourceId ? catalogRefOf(artist.catalogRef, sourceId) : undefined;
        return [{ id: mediaIdOf(artist.id) ?? 0, name, ...(ref ? { catalogRef: ref } : {}) }];
    });
    const aliases = textList(song.aliases);
    const translatedNames = textList(song.translatedNames);
    const durationMs = finite(song.durationMs);
    return {
        name: clip(song.name, 500),
        artists,
        album: {
            id: mediaIdOf(album.id) ?? 0,
            name: clip(album.name, 500),
            ...(coverUrl ? { coverUrl } : {}),
            ...(albumRef ? { catalogRef: albumRef } : {}),
        },
        durationMs: durationMs !== undefined && durationMs > 0 ? Math.round(durationMs) : 0,
        ...(aliases ? { aliases } : {}),
        ...(translatedNames ? { translatedNames } : {}),
        ...(song.isPureMusic === true ? { isPureMusic: true } : {}),
        ...(song.isVideo === true ? { isVideo: true } : {}),
        ...(typeof song.itemKind === 'string' && ITEM_KIND.test(song.itemKind) ? { itemKind: song.itemKind } : {}),
    };
};

/** 在线歌：白名单字段加上它的来源（音源 id、歌的 id、音源自己的数据）。不成样子回 null。 */
const onlineSongOf = (song: Json): UnifiedSong | null => {
    const ref = isRecord(song.sourceRef) ? song.sourceRef : null;
    if (!ref || ref.kind !== 'online' || typeof ref.providerId !== 'string' || !SOURCE_ID.test(ref.providerId)) return null;
    const mediaId = typeof ref.mediaId === 'string' ? ref.mediaId : '';
    if (!mediaId || mediaId.length > 512) return null;
    const fields = displayFieldsOf(song, ref.providerId, true);
    if (!fields.name) return null;
    const variant = clip(ref.variant, 64);
    const providerData = sourceDataOf(ref.providerData);
    return {
        id: mediaIdOf(song.id) ?? mediaId,
        ...fields,
        sourceRef: {
            kind: 'online',
            providerId: ref.providerId,
            mediaId,
            ...(variant ? { variant } : {}),
            ...(providerData ? { providerData } : {}),
        },
    };
};

/** Navidrome 的歌在文件里的样子：没有任何地址（它们带着账号的令牌），封面只留图的 id。 */
type FoliaFileNavidromeSong = {
    id: string;
    albumId?: string;
    artistId?: string;
    path?: string;
    suffix?: string;
    contentType?: string;
    bitRate?: number;
    bitDepth?: number;
    samplingRate?: number;
    channelCount?: number;
    coverArtId?: string;
};

const coverArtIdOf = (url: unknown): string | undefined => {
    if (typeof url !== 'string') return undefined;
    try {
        return clip(new URL(url).searchParams.get('id'), 256) || undefined;
    } catch {
        return undefined;
    }
};

const navidromeFieldsOf = (data: Json, id: string, coverArtId: string | undefined): FoliaFileNavidromeSong => {
    const text = (key: string, max = 256) => clip(data[key], max) || undefined;
    const number = (key: string) => {
        const value = finite(data[key]);
        return value !== undefined && value >= 0 ? value : undefined;
    };
    const fields: FoliaFileNavidromeSong = {
        id,
        albumId: text('albumId'),
        artistId: text('artistId'),
        path: text('path', 1024),
        suffix: text('suffix', 16),
        contentType: text('contentType', 64),
        bitRate: number('bitRate'),
        bitDepth: number('bitDepth'),
        samplingRate: number('samplingRate'),
        channelCount: number('channelCount'),
        coverArtId,
    };
    return Object.fromEntries(Object.entries(fields).filter((pair: [string, unknown]) => pair[1] !== undefined)) as FoliaFileNavidromeSong;
};

const localHintOf = (song: LocalSong): FoliaFileLocalHint => {
    const path = normalizeM3uPath(song.filePath) ?? undefined;
    return {
        ...(path ? { path: path.slice(0, 1024) } : {}),
        ...(song.fileName ? { fileName: song.fileName.slice(0, 512) } : {}),
        ...(Number.isFinite(song.fileSize) && song.fileSize > 0 ? { fileSize: song.fileSize } : {}),
        ...(Number.isFinite(song.duration) && song.duration > 0 ? { durationMs: Math.round(song.duration) } : {}),
    };
};

export interface FoliaPlaylistFileExport {
    content: string;
    /** 写进文件的条目数。 */
    exportedCount: number;
    /** 没写进去的：曲库里找不到的本地歌（没有能让别处认回它的东西），和认不出来源的条目。 */
    skippedCount: number;
}

/**
 * 一张歌单写成 JSON 文件的内容。本地歌带上重新认回它的线索（路径、文件名、大小、时长）；在线歌带快照和它的来源；
 * Navidrome 的歌不带任何地址。自定义封面的图片不进文件。`name` 给了就用它（「我喜欢的音乐」存的名字不是给人看的）。
 */
export const serializeFoliaPlaylistFile = (
    playlist: FoliaPlaylist,
    localSongs: readonly LocalSong[],
    options: { name?: string; now?: number } = {},
): FoliaPlaylistFileExport => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    let skippedCount = 0;
    const entries = playlist.entries.flatMap((entry): Json[] => {
        const common = {
            addedAt: timestamp(entry.addedAt),
            ...(typeof entry.originalKey === 'string' && ENTRY_KEY.test(entry.originalKey) ? { originalKey: entry.originalKey } : {}),
            ...(entry.fromOrigin === true ? { fromOrigin: true } : {}),
        };
        const raw = entry.song as unknown as Json;
        const localSongId = getFoliaEntryLocalSongId(entry);
        if (localSongId !== null) {
            const localSong = songsById.get(localSongId);
            if (!localSong) {
                skippedCount += 1;
                return [];
            }
            // 显示用的字段取曲库此刻的记录（歌单里的快照只是引用）。
            const display = displayFieldsOf(buildLocalEntry(localSong, 0).song as unknown as Json, null, false);
            return [{ source: 'local', ...common, song: display, local: localHintOf(localSong) }];
        }
        const ref = getPlaybackSourceRef(entry.song);
        if (ref.kind === 'navidrome' && ref.mediaId) {
            const data = isRecord(raw.navidromeData) ? raw.navidromeData : {};
            const album = isRecord(raw.album) ? raw.album : {};
            const coverArtId = coverArtIdOf(data.coverArtUrl) ?? coverArtIdOf(album.coverUrl);
            return [{
                source: 'navidrome',
                ...common,
                song: displayFieldsOf(raw, null, false),
                navidrome: navidromeFieldsOf(data, ref.mediaId, coverArtId),
            }];
        }
        const online = ref.kind === 'online' ? onlineSongOf({ ...raw, sourceRef: ref }) : null;
        if (!online) {
            skippedCount += 1;
            return [];
        }
        return [{ source: 'online', ...common, song: online }];
    });
    const origin = playlist.origin;
    const file = {
        format: FOLIA_PLAYLIST_FILE_FORMAT,
        version: FOLIA_PLAYLIST_FILE_VERSION,
        exportedAt: options.now ?? Date.now(),
        playlist: {
            name: (options.name ?? playlist.name).slice(0, 200),
            ...(playlist.isFavorite ? { favorite: true } : {}),
            createdAt: timestamp(playlist.createdAt),
            ...(origin ? {
                origin: {
                    sourceId: origin.sourceId,
                    collectionId: origin.collectionId,
                    name: origin.name,
                    savedAt: timestamp(origin.savedAt),
                    ...(origin.playVia ? { playVia: origin.playVia } : {}),
                    ...(origin.refreshedAt ? { refreshedAt: timestamp(origin.refreshedAt) } : {}),
                },
            } : {}),
            entries,
        },
    };
    return { content: `${JSON.stringify(file, null, 1)}\n`, exportedCount: entries.length, skippedCount };
};

// ---- 读回来 ----

export type FoliaPlaylistFileEntry =
    | { source: 'online'; song: UnifiedSong; addedAt: number; originalKey?: string; fromOrigin?: true }
    | { source: 'navidrome'; song: SongResult; navidrome: FoliaFileNavidromeSong; addedAt: number; originalKey?: string; fromOrigin?: true }
    | { source: 'local'; title: string; local: FoliaFileLocalHint; addedAt: number; fromOrigin?: true };

export interface ParsedFoliaPlaylistFile {
    name: string;
    /** 导出的是「我喜欢的音乐」。 */
    favorite: boolean;
    origin?: FoliaPlaylistOrigin;
    entries: FoliaPlaylistFileEntry[];
    /** 文件里不成样子、被丢掉的条目数。 */
    invalidCount: number;
}

export type FoliaPlaylistFileError =
    /** 不是 JSON。 */
    | 'not-json'
    /** 是 JSON，但不是 Folia 歌单文件。 */
    | 'not-folia-playlist'
    /** 更新的版本写的，这一版读不了。 */
    | 'newer-version'
    /** 标着是 Folia 歌单文件，内容却不对。 */
    | 'damaged'
    /** 文件或条目数超过上限。 */
    | 'too-large';

export type FoliaPlaylistFileParse =
    | { ok: true; file: ParsedFoliaPlaylistFile }
    | { ok: false; error: FoliaPlaylistFileError };

const originOf = (value: unknown): FoliaPlaylistOrigin | undefined => {
    if (!isRecord(value)) return undefined;
    // Navidrome 的出处写的是 'navidrome'，也过得了这个样子。
    if (typeof value.sourceId !== 'string' || !SOURCE_ID.test(value.sourceId)) return undefined;
    const collectionId = clip(value.collectionId, 512);
    if (!collectionId || collectionId !== value.collectionId) return undefined;
    const playVia = typeof value.playVia === 'string' && SOURCE_ID.test(value.playVia) ? value.playVia : undefined;
    const refreshedAt = timestamp(value.refreshedAt);
    return {
        sourceId: value.sourceId,
        collectionId,
        name: clip(value.name, 200),
        savedAt: timestamp(value.savedAt),
        ...(playVia ? { playVia } : {}),
        ...(refreshedAt ? { refreshedAt } : {}),
    };
};

const localHintFrom = (value: unknown): FoliaFileLocalHint | null => {
    if (!isRecord(value)) return null;
    const path = typeof value.path === 'string' ? normalizeM3uPath(value.path.slice(0, 1024)) : null;
    const fileName = clip(value.fileName, 512);
    const fileSize = finite(value.fileSize);
    const durationMs = finite(value.durationMs);
    if (!path && !fileName) return null;
    return {
        ...(path ? { path } : {}),
        ...(fileName ? { fileName } : {}),
        ...(fileSize !== undefined && fileSize > 0 ? { fileSize } : {}),
        ...(durationMs !== undefined && durationMs > 0 ? { durationMs } : {}),
    };
};

const entryOf = (value: unknown): FoliaPlaylistFileEntry | null => {
    if (!isRecord(value) || !isRecord(value.song)) return null;
    const common = {
        addedAt: timestamp(value.addedAt),
        ...(value.fromOrigin === true ? { fromOrigin: true as const } : {}),
    };
    const originalKey = typeof value.originalKey === 'string' && ENTRY_KEY.test(value.originalKey) ? value.originalKey : undefined;
    if (value.source === 'online') {
        const song = onlineSongOf(value.song);
        return song ? { source: 'online', song, ...common, ...(originalKey ? { originalKey } : {}) } : null;
    }
    if (value.source === 'navidrome') {
        const data = isRecord(value.navidrome) ? value.navidrome : null;
        const id = data ? clip(data.id, 256) : '';
        if (!data || !id || id !== data.id) return null;
        const fields = displayFieldsOf(value.song, null, false);
        if (!fields.name) return null;
        const coverArtId = clip(data.coverArtId, 256) || undefined;
        return {
            source: 'navidrome',
            song: { id, ...fields },
            navidrome: navidromeFieldsOf(data, id, coverArtId),
            ...common,
            ...(originalKey ? { originalKey } : {}),
        };
    }
    if (value.source === 'local') {
        const local = localHintFrom(value.local);
        return local ? { source: 'local', title: clip(value.song.name, 500), local, ...common } : null;
    }
    return null;
};

/** 读一个 JSON 歌单文件的内容。什么都不写；不对的地方照实说是哪一种。 */
export const parseFoliaPlaylistFile = (text: string): FoliaPlaylistFileParse => {
    if (text.length > FOLIA_PLAYLIST_FILE_MAX_BYTES) return { ok: false, error: 'too-large' };
    let data: unknown;
    try {
        data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
        return { ok: false, error: 'not-json' };
    }
    if (!isRecord(data) || data.format !== FOLIA_PLAYLIST_FILE_FORMAT) return { ok: false, error: 'not-folia-playlist' };
    const version = finite(data.version);
    if (version === undefined || version < 1 || !Number.isInteger(version)) return { ok: false, error: 'damaged' };
    if (version > FOLIA_PLAYLIST_FILE_VERSION) return { ok: false, error: 'newer-version' };
    const playlist = data.playlist;
    if (!isRecord(playlist) || !Array.isArray(playlist.entries)) return { ok: false, error: 'damaged' };
    if (playlist.entries.length > FOLIA_PLAYLIST_FILE_MAX_ENTRIES) return { ok: false, error: 'too-large' };

    const entries: FoliaPlaylistFileEntry[] = [];
    let invalidCount = 0;
    for (const raw of playlist.entries as unknown[]) {
        const entry = entryOf(raw);
        if (entry) entries.push(entry);
        else invalidCount += 1;
    }
    const origin = originOf(playlist.origin);
    return {
        ok: true,
        file: {
            name: clip(typeof playlist.name === 'string' ? playlist.name.trim() : '', 200),
            favorite: playlist.favorite === true,
            ...(origin ? { origin } : {}),
            entries,
            invalidCount,
        },
    };
};

/** 一个歌单文件是哪种格式，只看内容：JSON 以 `{` 开头；M3U 有它的标记行，或者每一行都像一条路径。 */
export const detectPlaylistFileFormat = (text: string): 'json' | 'm3u' | 'unknown' => {
    const body = text.replace(/^\uFEFF/, '').trimStart();
    if (!body) return 'unknown';
    if (body.startsWith('{')) return 'json';
    // 别的结构化文本、二进制：不是歌单。
    if (/^[[<]/.test(body) || body.slice(0, 4096).includes('\u0000')) return 'unknown';
    const lines = body.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (lines.some(line => /^#(EXTM3U|EXTINF:|PLAYLIST:)/i.test(line))) return 'm3u';
    const paths = lines.filter(line => !line.startsWith('#'));
    return paths.length > 0 && paths.every(line => line.length <= 2048 && /\.[A-Za-z0-9]{2,5}$/.test(line)) ? 'm3u' : 'unknown';
};

// ---- 本地歌重新认 ----

export interface FoliaLocalMatchIndex {
    byPath: Map<string, LocalSong[]>;
    byRelativePath: Map<string, LocalSong[]>;
    byFileName: Map<string, LocalSong[]>;
}

const push = (map: Map<string, LocalSong[]>, key: string, song: LocalSong) => {
    const list = map.get(key);
    if (list) list.push(song);
    else map.set(key, [song]);
};
const withoutRoot = (path: string): string => {
    const at = path.indexOf('/');
    return at >= 0 ? path.slice(at + 1) : path;
};

export const buildFoliaLocalMatchIndex = (localSongs: readonly LocalSong[]): FoliaLocalMatchIndex => {
    const index: FoliaLocalMatchIndex = { byPath: new Map(), byRelativePath: new Map(), byFileName: new Map() };
    for (const song of localSongs) {
        const path = normalizeM3uPath(song.filePath)?.toLocaleLowerCase();
        if (path) {
            push(index.byPath, path, song);
            push(index.byRelativePath, withoutRoot(path), song);
        }
        const fileName = (song.fileName || path?.split('/').pop() || '').toLocaleLowerCase();
        if (fileName) push(index.byFileName, fileName, song);
    }
    return index;
};

/** 时长差在这以内算同一个文件（不同的解码器量出来的时长会差一点）。 */
const DURATION_TOLERANCE_MS = 1500;

// 候选里只剩一首才算认出来。路径对上的（requireEvidence 为 false）只有一首就认；不止一首、或只是文件名对上时，
// 要文件大小或时长作证：两样都对得上的优先，否则对得上其中一样的，唯一才认。
const single = (candidates: readonly LocalSong[] | undefined, hint: FoliaFileLocalHint, requireEvidence: boolean): LocalSong | null => {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1 && !requireEvidence) return candidates[0];
    const sizeOk = (song: LocalSong) => hint.fileSize !== undefined && song.fileSize === hint.fileSize;
    const durationOk = (song: LocalSong) => hint.durationMs !== undefined && Math.abs(song.duration - hint.durationMs) <= DURATION_TOLERANCE_MS;
    const both = candidates.filter(song => sizeOk(song) && durationOk(song));
    if (both.length > 0) return both.length === 1 ? both[0] : null;
    const either = candidates.filter(song => sizeOk(song) || durationOk(song));
    return either.length === 1 ? either[0] : null;
};

/**
 * 文件里的一条本地歌在这台机器的曲库里是哪一首；认不出来回 null。按顺序：
 * 1. 整条路径一样（不分大小写）；2. 去掉最前面那个导入文件夹的名字后一样（文件夹换了名字、换了位置）；
 * 3. 文件名一样，并且文件大小或时长对得上。每一步只在剩下唯一一首时才认。不按歌名、歌手找。
 */
export const matchFoliaLocalSong = (hint: FoliaFileLocalHint, index: FoliaLocalMatchIndex): LocalSong | null => {
    const path = hint.path?.toLocaleLowerCase();
    if (path) {
        const exact = single(index.byPath.get(path), hint, false);
        if (exact) return exact;
        const relative = single(index.byRelativePath.get(withoutRoot(path)), hint, false)
            ?? single(index.byRelativePath.get(path), hint, false);
        if (relative) return relative;
    }
    const fileName = (hint.fileName || path?.split('/').pop() || '').toLocaleLowerCase();
    return fileName ? single(index.byFileName.get(fileName), hint, true) : null;
};

// ---- 预览与落成条目 ----

/** Navidrome 的地址要用这台机器上的账号现拼；没配置就没有。 */
export interface FoliaFileNavidromeUrls {
    stream(songId: string): string;
    coverArt(coverArtId: string): string;
}

export type FoliaFileSourceUnavailable = Exclude<FoliaEntryAvailability['state'], 'available' | 'local-missing'>;

export interface FoliaPlaylistFilePreview {
    name: string;
    favorite: boolean;
    origin?: FoliaPlaylistOrigin;
    /** 文件里读得出来的条目数（含认不回来的本地歌）。 */
    total: number;
    /** 各来源各几首，按文件里第一次出现的先后。`key` 是 `online:<音源 id>`、`navidrome`、`local`。 */
    sources: Array<{ key: string; sourceId?: string; count: number; unavailable?: FoliaFileSourceUnavailable }>;
    /** 来源在这台机器上现在不可用的条目数（照样会导入，只是播不了）。 */
    unavailableCount: number;
    local: { matched: number; unmatched: number; /** 认不回来的那些，给界面列几个名字。 */ unmatchedTitles: string[] };
    /** 文件里不成样子、被丢掉的条目数。 */
    invalidCount: number;
    /** 文件里重复的（同一首只留第一条）。 */
    duplicateCount: number;
    /** 会写进歌单的条目，文件里的顺序。 */
    entries: FoliaPlaylistEntry[];
}

const navidromeSongOf = (entry: Extract<FoliaPlaylistFileEntry, { source: 'navidrome' }>, urls: FoliaFileNavidromeUrls | null): SongResult => {
    const { coverArtId, ...data } = entry.navidrome;
    const coverArtUrl = urls && coverArtId ? urls.coverArt(coverArtId) : undefined;
    const song = {
        ...entry.song,
        // 和 navidromeApi.toNavidromeSong 一样的 id 规则。
        id: -Math.abs(parseInt(data.id.replace(/\D/g, ''), 10) || 1),
        album: { ...entry.song.album, ...(coverArtUrl ? { coverUrl: coverArtUrl } : {}) },
        isNavidrome: true,
        sourceRef: { kind: 'navidrome', mediaId: data.id },
        navidromeData: {
            albumId: '',
            artistId: '',
            path: '',
            suffix: '',
            ...data,
            streamUrl: urls ? urls.stream(data.id) : '',
            ...(coverArtUrl ? { coverArtUrl } : {}),
        },
    };
    return song as unknown as SongResult;
};

/**
 * 读入前的预览：各来源各几首、哪些来源在这台机器上不可用、本地歌认回几首，以及真要写的话会写哪些条目。
 * 来源不可用的条目照样导入（歌单里本来就留得住它们，来源回来了就能播）；认不回来的本地歌不导入。
 */
export const previewFoliaPlaylistFile = (
    file: ParsedFoliaPlaylistFile,
    localSongs: readonly LocalSong[],
    deps: FoliaEntryAvailabilityDeps,
    navidromeUrls: FoliaFileNavidromeUrls | null,
    now: number = Date.now(),
): FoliaPlaylistFilePreview => {
    const index = buildFoliaLocalMatchIndex(localSongs);
    const sources = new Map<string, FoliaPlaylistFilePreview['sources'][number]>();
    const entries: FoliaPlaylistEntry[] = [];
    const keys = new Set<string>();
    const local = { matched: 0, unmatched: 0, unmatchedTitles: [] as string[] };
    let unavailableCount = 0;
    let duplicateCount = 0;

    // 一个来源现在可不可用只问一次（看的是来源，不是哪一首歌）。
    const count = (song: SongResult | null) => {
        const ref = song ? getPlaybackSourceRef(song) : null;
        const sourceId = ref?.kind === 'online' ? ref.providerId : undefined;
        const key = sourceId ? `online:${sourceId}` : ref ? 'navidrome' : 'local';
        let row = sources.get(key);
        if (!row) {
            const availability = song ? resolveFoliaEntryAvailability({ song }, deps) : { state: 'available' as const };
            const unavailable = availability.state !== 'available' && availability.state !== 'local-missing' ? availability.state : undefined;
            row = { key, ...(sourceId ? { sourceId } : {}), count: 0, ...(unavailable ? { unavailable } : {}) };
            sources.set(key, row);
        }
        row.count += 1;
        if (row.unavailable) unavailableCount += 1;
    };

    for (const item of file.entries) {
        let entry: FoliaPlaylistEntry;
        if (item.source === 'local') {
            count(null);
            const match = matchFoliaLocalSong(item.local, index);
            if (!match) {
                local.unmatched += 1;
                if (local.unmatchedTitles.length < 5) local.unmatchedTitles.push(item.title || item.local.fileName || item.local.path || '');
                continue;
            }
            local.matched += 1;
            entry = buildLocalEntry(match, item.addedAt || now);
        } else {
            const song = item.source === 'online' ? item.song : navidromeSongOf(item, navidromeUrls);
            count(song);
            const key = getPlaybackSongKey(song);
            entry = {
                key,
                song,
                addedAt: item.addedAt || now,
                ...(item.originalKey && item.originalKey !== key ? { originalKey: item.originalKey } : {}),
            };
        }
        if (keys.has(entry.key)) {
            duplicateCount += 1;
            continue;
        }
        keys.add(entry.key);
        entries.push(item.fromOrigin ? { ...entry, fromOrigin: true } : entry);
    }

    return {
        name: file.name,
        favorite: file.favorite,
        ...(file.origin ? { origin: file.origin } : {}),
        total: file.entries.length,
        sources: [...sources.values()],
        unavailableCount,
        local,
        invalidCount: file.invalidCount,
        duplicateCount,
        entries,
    };
};
