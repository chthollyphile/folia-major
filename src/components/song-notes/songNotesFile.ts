import type { LocalSong, SongResult } from '../../types';
import { readFoliaFileSong, writeFoliaFileSong, type FoliaFileSong } from '../../services/foliaPlaylist/foliaPlaylistFile';
import {
    SONG_NOTE_MAX_TEXT,
    normalizeCommentAt,
    normalizeCommentText,
    normalizeTagName,
    tagKeyOf,
    type SongNoteComment,
    type SongNoteRow,
    type SongNoteTag,
} from './songNotesModel';

// src/components/song-notes/songNotesFile.ts
// 「时刻」的文件：自己的 JSON 格式（导出、导入，说明在 docs/song-notes-file.md），以及 setobox 的「音乐笔记」模组
// （folium-compound#177）的数据——它导出的 JSON（format: "music-notes"，v1 / v2）和它 IndexedDB 里的记录。
// 全是纯函数，不碰数据库、不碰 DOM：读出来的都先变成同一种「要导入的东西」（SongNotesImport），认歌、补快照、写库在别处。
//
// 文件是不可信的数据：歌照歌单文件的白名单重新拼（readFoliaFileSong，凭据、内网地址都不收）；标签、评论逐条规整、截到上限；
// 不成样子的跳过并计数，不让一条坏记录挡住整个文件。

export const SONG_NOTES_FILE_FORMAT = 'folia-song-notes';
export const SONG_NOTES_FILE_VERSION = 1;
export const SONG_NOTES_FILE_EXTENSION = '.folia-notes.json';
/** 读入的上限：文件大小与歌数。导出超过它的不导出（自己导出的文件一定读得回来）。 */
export const SONG_NOTES_FILE_MAX_BYTES = 256 * 1024 * 1024;
export const SONG_NOTES_FILE_MAX_SONGS = 200_000;

type Json = Record<string, unknown>;
const isRecord = (value: unknown): value is Json => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const timestamp = (value: unknown): number => (
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 8.64e15 ? Math.floor(value) : 0
);

/** 要导入的一条评论（还没有 id 和 songKey，写库时再给）。 */
export type SongNotesImportComment = { text: string; at?: number; createdAt: number; editedAt?: number };
/** 要导入的一首歌：`song` 是什么由来源定（文件里的歌、模组的身份，认过之后是 SongResult）。标签按打上的先后。 */
export type SongNotesImportSong<S> = {
    song: S;
    tags: Array<{ name: string; addedAt: number }>;
    comments: SongNotesImportComment[];
    updatedAt: number;
};
/** 读出来、要导入的全部：标签按先后（新标签按这个顺序排在已有标签之后），歌，以及读的时候丢掉了几条。 */
export type SongNotesImport<S> = {
    tags: Array<{ name: string; createdAt: number }>;
    songs: Array<SongNotesImportSong<S>>;
    /** 不成样子、没收的歌。 */
    invalidCount: number;
    /** 在线歌的 id 和它的来源说的不是同一首、没收的（只有自己的文件会有）。 */
    mismatchedIdCount: number;
};

/** newer-version：更新版本的 Folia 写的；mod-newer-version：更新版本的模组写的（这一版 Folia 还不认）。 */
export type SongNotesFileError = 'not-json' | 'unknown-format' | 'newer-version' | 'mod-newer-version' | 'damaged' | 'too-large';
export type SongNotesFileReading =
    | { kind: 'folia'; data: SongNotesImport<FoliaFileSong> }
    | { kind: 'music-notes'; data: SongNotesImport<MusicNotesSong> }
    | { kind: 'error'; error: SongNotesFileError };

// ---- 规整 ----

/** 一串标签：规整写法，按 key 去重，截到 limit 个。 */
const cleanTagRefs = (refs: ReadonlyArray<{ name: unknown; addedAt: unknown }>, fallbackAt: number): SongNotesImportSong<never>['tags'] => {
    const seen = new Set<string>();
    const tags: SongNotesImportSong<never>['tags'] = [];
    for (const ref of refs) {
        const name = typeof ref.name === 'string' ? normalizeTagName(ref.name) : null;
        if (!name) continue;
        const key = tagKeyOf(name);
        if (seen.has(key)) continue;
        seen.add(key);
        tags.push({ name, addedAt: timestamp(ref.addedAt) || fallbackAt });
    }
    return tags;
};

/** 一条评论：字规整，时刻规整；两样都没有的不要。 */
const cleanComment = (value: { text: unknown; at?: unknown; createdAt: unknown; editedAt?: unknown }, fallbackAt: number): SongNotesImportComment | null => {
    const text = typeof value.text === 'string' ? normalizeCommentText(value.text) : '';
    const at = typeof value.at === 'number' ? normalizeCommentAt(value.at) : undefined;
    if (!text && at === undefined) return null;
    const editedAt = timestamp(value.editedAt);
    return {
        text,
        ...(at !== undefined ? { at } : {}),
        createdAt: timestamp(value.createdAt) || fallbackAt,
        ...(editedAt ? { editedAt } : {}),
    };
};

/** 长于一条评论上限的正文切成几条（模组的正文最长五万字），不截掉。 */
export const splitLongText = (text: string): string[] => {
    const chars = Array.from(text);
    if (chars.length <= SONG_NOTE_MAX_TEXT) return [text];
    const parts: string[] = [];
    for (let start = 0; start < chars.length; start += SONG_NOTE_MAX_TEXT) parts.push(chars.slice(start, start + SONG_NOTE_MAX_TEXT).join(''));
    return parts;
};

const NOT_JSON = Symbol('not-json');
const parseJson = (content: string): unknown => {
    try {
        return JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content) as unknown;
    } catch {
        return NOT_JSON;
    }
};

// ---- 自己的格式 ----

export type SongNotesFileExport = {
    content: string;
    /** 写进文件的歌。 */
    exportedCount: number;
    /** 没写进去的：曲库里找不到的本地歌（没有能让别处认回它的东西）、认不出来源的歌。 */
    skippedCount: number;
};

/**
 * 全部时刻写成一个文件。标签按先后，各带写法；一首歌带它的标签（写法与打上的时间）、全部评论（按写的时间）与最近改动的时间。
 * 歌照歌单文件的写法（writeFoliaFileSong）：本地歌只写认回文件的线索，Navidrome 的不写地址。
 */
export const serializeSongNotesFile = (
    data: { rows: readonly SongNoteRow[]; tags: readonly SongNoteTag[]; comments: readonly SongNoteComment[] },
    localSongs: readonly LocalSong[],
    now = Date.now(),
): SongNotesFileExport => {
    const localById = new Map(localSongs.map(song => [song.id, song]));
    const tagNames = new Map(data.tags.map(tag => [tag.key, tag.name]));
    const commentsBySong = new Map<string, SongNoteComment[]>();
    for (const comment of data.comments) {
        const list = commentsBySong.get(comment.songKey);
        if (list) list.push(comment);
        else commentsBySong.set(comment.songKey, [comment]);
    }
    let skippedCount = 0;
    const songs = data.rows.flatMap((row): Json[] => {
        const written = writeFoliaFileSong({ key: row.key, song: row.song }, localById);
        if (!written) {
            skippedCount += 1;
            return [];
        }
        const comments = [...(commentsBySong.get(row.key) ?? [])]
            .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
            .map(comment => ({
                text: comment.text,
                ...(comment.at !== undefined ? { at: comment.at } : {}),
                createdAt: comment.createdAt,
                ...(comment.editedAt ? { editedAt: comment.editedAt } : {}),
            }));
        const tags = row.tags.map(key => ({ name: tagNames.get(key) ?? key, addedAt: row.tagAddedAt[key] ?? row.updatedAt }));
        return [{ ...written, tags, comments, updatedAt: row.updatedAt }];
    });
    const file = {
        format: SONG_NOTES_FILE_FORMAT,
        version: SONG_NOTES_FILE_VERSION,
        exportedAt: now,
        tags: [...data.tags].sort((a, b) => a.order - b.order).map(tag => ({ name: tag.name, createdAt: tag.createdAt })),
        songs,
    };
    return { content: `${JSON.stringify(file, null, 1)}\n`, exportedCount: songs.length, skippedCount };
};

const parseFoliaNotes = (data: Json): SongNotesFileReading => {
    const version = data.version;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { kind: 'error', error: 'damaged' };
    if (version > SONG_NOTES_FILE_VERSION) return { kind: 'error', error: 'newer-version' };
    if (!Array.isArray(data.songs) || !Array.isArray(data.tags)) return { kind: 'error', error: 'damaged' };
    if (data.songs.length > SONG_NOTES_FILE_MAX_SONGS) return { kind: 'error', error: 'too-large' };
    const tags = cleanTagRefs(
        (data.tags as unknown[]).filter(isRecord).map(tag => ({ name: tag.name, addedAt: tag.createdAt })),
        0,
    ).map(tag => ({ name: tag.name, createdAt: tag.addedAt }));
    const songs: SongNotesImport<FoliaFileSong>['songs'] = [];
    let invalidCount = 0;
    let mismatchedIdCount = 0;
    for (const raw of data.songs as unknown[]) {
        const song = readFoliaFileSong(raw);
        if (song === 'mismatched-id') {
            mismatchedIdCount += 1;
            continue;
        }
        if (!song || !isRecord(raw)) {
            invalidCount += 1;
            continue;
        }
        const updatedAt = timestamp(raw.updatedAt);
        const tagRefs = Array.isArray(raw.tags) ? (raw.tags as unknown[]).filter(isRecord).map(tag => ({ name: tag.name, addedAt: tag.addedAt })) : [];
        const comments = Array.isArray(raw.comments)
            ? (raw.comments as unknown[]).filter(isRecord).flatMap(comment => cleanComment(comment as Parameters<typeof cleanComment>[0], updatedAt) ?? [])
            : [];
        songs.push({ song, tags: cleanTagRefs(tagRefs, updatedAt), comments, updatedAt });
    }
    return { kind: 'folia', data: { tags, songs, invalidCount, mismatchedIdCount } };
};

// ---- 「音乐笔记」模组 ----

/** 模组里一首歌的身份：在线歌是音源 id 加媒体 id（就是本体的 sourceRef.mediaId），本地歌是曲库里的 id。 */
export type MusicNotesSong =
    | { kind: 'online'; providerId: string; mediaId: string; title: string; artist: string; album?: string }
    | { kind: 'local'; songId: string; title: string; artist: string; album?: string };

/** 和歌单文件同一条音源 id 的规则。 */
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const HAS_UNPRINTABLE = /[\p{Cc}‪-‮⁦-⁩]/u;
const text = (value: unknown, max: number): string | null => (typeof value === 'string' && value.length <= max ? value : null);

/** 模组的一首歌的身份；不认得的来源（舞台、Navidrome 它本来就不收）回 null。 */
const musicNotesSongOf = (value: unknown): MusicNotesSong | null => {
    if (!isRecord(value)) return null;
    const source = text(value.source, 512);
    const id = text(value.id, 512)?.trim();
    const title = text(value.title, 2000)?.trim();
    if (!source || !id || HAS_UNPRINTABLE.test(id) || !title) return null;
    const artist = text(value.artist, 2000)?.trim() ?? '';
    const album = text(value.album, 2000)?.trim();
    const meta = { title, artist, ...(album ? { album } : {}) };
    if (source === 'local') return { kind: 'local', songId: id, ...meta };
    if (!source.startsWith('online:')) return null;
    const providerId = source.slice('online:'.length);
    return SOURCE_ID.test(providerId) ? { kind: 'online', providerId, mediaId: id, ...meta } : null;
};

/** 模组规整标签 key 的写法（trim 后转小写）：它的 tagOrder 用这个 key。 */
const modTagKey = (name: string): string => name.trim().toLowerCase();

/**
 * 模组的记录（导出的 JSON 里的 notes，或者它库里 notes 表的行）变成要导入的东西：
 * - 正文 → 一条普通评论（太长的切成几条），写的时间取模组的 updatedAt；
 * - 书签 → 带时刻的评论；
 * - 标签照它的写法，打上的时间取这首笔记的 createdAt；
 * - 标签的先后：`tagOrder`（模组标签 key 的列表）给了就照它，没给（v1 的文件）照模组旧版的规则：用得多的在前，一样多按名字。
 */
export const musicNotesImportOf = (records: readonly unknown[], tagOrder: readonly string[] | null): SongNotesImport<MusicNotesSong> => {
    const songs: SongNotesImport<MusicNotesSong>['songs'] = [];
    const tagInfo = new Map<string, { name: string; createdAt: number; count: number }>();
    let invalidCount = 0;
    for (const raw of records) {
        const song = isRecord(raw) ? musicNotesSongOf(raw.song) : null;
        if (!song || !isRecord(raw)) {
            invalidCount += 1;
            continue;
        }
        const createdAt = timestamp(raw.createdAt);
        const updatedAt = timestamp(raw.updatedAt) || createdAt;
        const names = Array.isArray(raw.tags) ? (raw.tags as unknown[]).filter((tag): tag is string => typeof tag === 'string') : [];
        const tags = cleanTagRefs(names.map(name => ({ name, addedAt: createdAt })), updatedAt);
        for (const name of names) {
            const key = modTagKey(name);
            if (!key) continue;
            const info = tagInfo.get(key);
            if (info) {
                info.count += 1;
                // 没写时间（0）的不算：取写了的里最早的。
                if (createdAt > 0) info.createdAt = info.createdAt > 0 ? Math.min(info.createdAt, createdAt) : createdAt;
            } else {
                tagInfo.set(key, { name: name.trim(), createdAt, count: 1 });
            }
        }
        const comments: SongNotesImportComment[] = [];
        // 同一个时间写进来的几条，按这里的先后各差一毫秒，「按写的时间」排时顺序不乱。
        let step = 0;
        const note = typeof raw.note === 'string' ? raw.note : '';
        for (const part of note.trim() ? splitLongText(note.trim()) : []) {
            const comment = cleanComment({ text: part, createdAt: updatedAt + step }, updatedAt);
            step += 1;
            if (comment) comments.push(comment);
        }
        const bookmarks = Array.isArray(raw.bookmarks) ? (raw.bookmarks as unknown[]).filter(isRecord) : [];
        for (const bookmark of bookmarks) {
            const comment = cleanComment({ text: bookmark.text, at: bookmark.positionSeconds, createdAt: updatedAt + step }, updatedAt);
            step += 1;
            if (comment && comment.at !== undefined) comments.push(comment);
        }
        songs.push({ song, tags, comments, updatedAt });
    }
    const entries = [...tagInfo.entries()].map(([key, info]) => ({ key, ...info }));
    const byKey = new Map(entries.map(entry => [entry.key, entry]));
    const ordered = tagOrder
        ? [...tagOrder.flatMap(key => byKey.get(key) ?? []), ...entries.filter(entry => !tagOrder.includes(entry.key))]
        : [...entries].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    const tags = cleanTagRefs(ordered.map(entry => ({ name: entry.name, addedAt: entry.createdAt })), 0)
        .map(tag => ({ name: tag.name, createdAt: tag.addedAt }));
    return { tags, songs, invalidCount, mismatchedIdCount: 0 };
};

/**
 * 模组导出的 JSON。v2 的 tagOrder 是一串下标：指向按记录先后第一次出现的标签 key（模组的写法），不是 key 本身。
 * 下标不对的当没给（照 v1 的规则排）。
 */
const parseMusicNotes = (data: Json): SongNotesFileReading => {
    if (data.version !== 1 && data.version !== 2) {
        return { kind: 'error', error: typeof data.version === 'number' && data.version > 2 ? 'mod-newer-version' : 'damaged' };
    }
    if (!Array.isArray(data.notes)) return { kind: 'error', error: 'damaged' };
    if (data.notes.length > SONG_NOTES_FILE_MAX_SONGS) return { kind: 'error', error: 'too-large' };
    const notes = data.notes as unknown[];
    let tagOrder: string[] | null = null;
    if (data.version === 2 && Array.isArray(data.tagOrder)) {
        const firstSeen: string[] = [];
        const seen = new Set<string>();
        for (const note of notes) {
            const tags = isRecord(note) && Array.isArray(note.tags) ? note.tags : [];
            for (const tag of tags) {
                const key = typeof tag === 'string' ? modTagKey(tag) : '';
                if (key && !seen.has(key)) {
                    seen.add(key);
                    firstSeen.push(key);
                }
            }
        }
        const order = (data.tagOrder as unknown[]).map(index => (
            typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < firstSeen.length ? firstSeen[index] : null
        ));
        if (order.every((key): key is string => key !== null)) tagOrder = order;
    }
    return { kind: 'music-notes', data: musicNotesImportOf(notes, tagOrder) };
};

/** 认一个文件：自己的格式，或者模组导出的 JSON。只读，不写任何东西。 */
export const readSongNotesFileText = (content: string): SongNotesFileReading => {
    if (content.length > SONG_NOTES_FILE_MAX_BYTES) return { kind: 'error', error: 'too-large' };
    const data = parseJson(content);
    if (data === NOT_JSON) return { kind: 'error', error: 'not-json' };
    if (!isRecord(data)) return { kind: 'error', error: 'unknown-format' };
    if (data.format === SONG_NOTES_FILE_FORMAT) return parseFoliaNotes(data);
    if (data.format === 'music-notes') return parseMusicNotes(data);
    return { kind: 'error', error: 'unknown-format' };
};

/** 一次导入一共多少：歌、评论、标签（预览的确认框里写）。标签只算会导入的歌用到的（没有歌用的标签导入后不留）。 */
export const countSongNotesImport = (data: SongNotesImport<unknown>): { songs: number; comments: number; tags: number } => ({
    songs: data.songs.length,
    comments: data.songs.reduce((sum, song) => sum + song.comments.length, 0),
    tags: new Set(data.songs.flatMap(song => song.tags.map(tag => tagKeyOf(tag.name)))).size,
});

export type ResolvedSongNotesImport = SongNotesImport<SongResult> & {
    /** 认不回来的本地歌（不导入），和前几首的名字。 */
    unmatched: number;
    unmatchedTitles: string[];
};
