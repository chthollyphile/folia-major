import type { SongResult } from '../../types';
import { getPlaybackSongKey, isStagePlaybackSong } from '../../utils/appPlaybackGuards';
import { toStoredSongSnapshot } from '../../utils/songSnapshot';
import { announceSongNotesChange } from './songNotesBroadcast';
import { songNotesDatabase, type SongNotesDatabase } from './songNotesDatabase';
import {
    SONG_NOTE_MAX_COMMENTS,
    SONG_NOTE_MAX_TAGS,
    isKeepableComment,
    newCommentId,
    normalizeCommentAt,
    normalizeCommentText,
    normalizeTagName,
    summarizeComments,
    tagKeyOf,
    type SongNoteComment,
    type SongNoteRow,
    type SongNoteTag,
} from './songNotesModel';

// src/components/song-notes/songNotesService.ts
// 读写歌曲评论（FoliaSongNotesDB）。每个写操作一个读写事务：改评论或标签，再按这首歌现在的评论重算摘要（几条、几条挂着时刻、
// 最新一条），标签和评论都删光了就删掉这一行。事务提交之后告诉本窗口的订阅者（useSongNotesStore）和别的窗口（songNotesBroadcast）。
// 写不进去（库打不开、配额满）返回 failed，由界面报错；这里只记日志，不弹提示。

/** conflict：改名改成了另一个已有的标签（界面问过要不要合并，再带 merge 重来）。 */
export type SongNoteWriteError = 'stage' | 'tooManyComments' | 'tooManyTags' | 'empty' | 'notFound' | 'conflict' | 'failed';
export type SongNoteResult<T> = { ok: true; value: T } | { ok: false; error: SongNoteWriteError };

/** 一首歌的评论：这一行（没写过就是 null）和它的全部评论（按写的时间）。 */
export type SongNoteDetail = { row: SongNoteRow | null; comments: SongNoteComment[] };

type Listener = (songKeys: readonly string[] | 'all') => void;
const listeners = new Set<Listener>();

/** 本窗口的改动（写事务提交之后）和别的窗口传来的改动都经这里交给订阅者。 */
export const subscribeSongNotes = (listener: Listener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

export const emitSongNotesChange = (songKeys: readonly string[] | 'all'): void => {
    for (const listener of listeners) listener(songKeys);
};

const changed = (songKeys: readonly string[] | 'all') => {
    emitSongNotesChange(songKeys);
    announceSongNotesChange(songKeys);
};

const fail = <T>(error: SongNoteWriteError): SongNoteResult<T> => ({ ok: false, error });

/** 按这首歌现在的评论重算这一行；标签、评论都没了就删掉它。song 给了就顺手换上最新的快照。 */
const refreshRow = async (db: SongNotesDatabase, key: string, now: number, row: SongNoteRow | undefined, song?: SongResult): Promise<void> => {
    const comments = await db.comments.where('songKey').equals(key).toArray();
    const tags = row?.tags ?? [];
    if (comments.length === 0 && tags.length === 0) {
        if (row) await db.songs.delete(key);
        return;
    }
    const base = row ?? (song ? { key, song: toStoredSongSnapshot(song), tags: [], tagAddedAt: {} } : null);
    if (!base) return;
    await db.songs.put({
        ...base,
        ...(song ? { song: toStoredSongSnapshot(song) } : {}),
        ...summarizeComments(comments),
        updatedAt: now,
    });
};

const runWrite = async <T>(
    label: string,
    work: (db: SongNotesDatabase) => Promise<SongNoteResult<T>>,
    keys: () => readonly string[] | 'all',
): Promise<SongNoteResult<T>> => {
    const db = songNotesDatabase();
    try {
        const result = await db.transaction('rw', db.songs, db.comments, db.tags, () => work(db));
        if (result.ok) changed(keys());
        return result;
    } catch (error) {
        console.warn(`[SongNotes] ${label} failed`, error);
        return fail('failed');
    }
};

/** 读一首歌的评论。库打不开时当没写过（界面照样能显示、能写；写的时候再报错）。 */
export const getSongNote = async (key: string): Promise<SongNoteDetail> => {
    try {
        const db = songNotesDatabase();
        const [row, comments] = await Promise.all([db.songs.get(key), db.comments.where('songKey').equals(key).sortBy('createdAt')]);
        return { row: row ?? null, comments };
    } catch (error) {
        console.warn('[SongNotes] read failed', error);
        return { row: null, comments: [] };
    }
};

/** 最近评论过（写评论、打标签）的歌，新的在前。 */
export const listRecentSongNotes = async (limit: number): Promise<SongNoteRow[]> => {
    try {
        return await songNotesDatabase().songs.orderBy('updatedAt').reverse().limit(limit).toArray();
    } catch (error) {
        console.warn('[SongNotes] list failed', error);
        return [];
    }
};

/** 一共有几首歌写过评论或打过标签（信息条上的计数）。 */
export const countSongNotes = async (): Promise<number> => {
    try {
        return await songNotesDatabase().songs.count();
    } catch {
        return 0;
    }
};

/** 全部写过评论或打过标签的歌的 key（只读主键）。 */
export const listSongNoteKeys = async (): Promise<Set<string>> => {
    try {
        return new Set(await songNotesDatabase().songs.toCollection().primaryKeys());
    } catch (error) {
        console.warn('[SongNotes] key list failed', error);
        return new Set();
    }
};

/** 全部标签，按先后。 */
export const listSongNoteTags = async (): Promise<SongNoteTag[]> => {
    try {
        return await songNotesDatabase().tags.orderBy('order').toArray();
    } catch (error) {
        console.warn('[SongNotes] tag list failed', error);
        return [];
    }
};

/** 写一条评论。text 可以是空的，只要挂着时刻（图钉按 Esc：只留一道刻痕）。 */
export const addSongComment = (song: SongResult, input: { text: string; at?: number | null }, now = Date.now()): Promise<SongNoteResult<SongNoteComment>> => {
    if (isStagePlaybackSong(song)) return Promise.resolve(fail('stage'));
    const key = getPlaybackSongKey(song);
    const text = normalizeCommentText(input.text);
    const at = normalizeCommentAt(input.at);
    if (!isKeepableComment(text, at)) return Promise.resolve(fail('empty'));
    return runWrite('add comment', async db => {
        const row = await db.songs.get(key);
        if ((row?.commentCount ?? 0) >= SONG_NOTE_MAX_COMMENTS) return fail('tooManyComments');
        const comment: SongNoteComment = { id: newCommentId(now), songKey: key, text, ...(at !== undefined ? { at } : {}), createdAt: now };
        await db.comments.add(comment);
        await refreshRow(db, key, now, row, song);
        return { ok: true, value: comment };
    }, () => [key]);
};

/** 改一条评论的字。改成空的：挂着时刻的留一道空的刻痕，没挂的就删掉（返回 null）。 */
export const editSongComment = async (id: string, rawText: string, now = Date.now()): Promise<SongNoteResult<SongNoteComment | null>> => {
    let key = '';
    return runWrite('edit comment', async db => {
        const comment = await db.comments.get(id);
        if (!comment) return fail('notFound');
        key = comment.songKey;
        const text = normalizeCommentText(rawText);
        if (text === comment.text) return { ok: true, value: comment };
        if (!isKeepableComment(text, comment.at)) {
            await db.comments.delete(id);
            await refreshRow(db, key, now, await db.songs.get(key));
            return { ok: true, value: null };
        }
        const next: SongNoteComment = { ...comment, text, editedAt: now };
        await db.comments.put(next);
        await refreshRow(db, key, now, await db.songs.get(key));
        return { ok: true, value: next };
    }, () => [key]);
};

export const deleteSongComment = async (id: string, now = Date.now()): Promise<SongNoteResult<void>> => {
    let key = '';
    return runWrite('delete comment', async db => {
        const comment = await db.comments.get(id);
        if (!comment) return fail('notFound');
        key = comment.songKey;
        await db.comments.delete(id);
        await refreshRow(db, key, now, await db.songs.get(key));
        return { ok: true, value: undefined };
    }, () => [key]);
};

/** 给一首歌打一个标签（已经有了就什么都不做）。标签第一次出现时记下它的写法，排在所有标签的最后。 */
export const addSongTag = (song: SongResult, rawName: string, now = Date.now()): Promise<SongNoteResult<SongNoteTag>> => {
    if (isStagePlaybackSong(song)) return Promise.resolve(fail('stage'));
    const name = normalizeTagName(rawName);
    if (!name) return Promise.resolve(fail('empty'));
    const key = getPlaybackSongKey(song);
    const tagKey = tagKeyOf(name);
    return runWrite('add tag', async db => {
        const row = await db.songs.get(key);
        let tag = await db.tags.get(tagKey);
        if (row?.tags.includes(tagKey) && tag) return { ok: true, value: tag };
        if ((row?.tags.length ?? 0) >= SONG_NOTE_MAX_TAGS) return fail('tooManyTags');
        if (!tag) {
            const last = await db.tags.orderBy('order').last();
            tag = { key: tagKey, name, order: (last?.order ?? 0) + 1, createdAt: now };
            await db.tags.put(tag);
        }
        const base: SongNoteRow = row ?? {
            key, song: toStoredSongSnapshot(song), tags: [], tagAddedAt: {}, commentCount: 0, timedCount: 0, updatedAt: now,
        };
        const tagged: SongNoteRow = row?.tags.includes(tagKey)
            ? base
            : { ...base, tags: [...base.tags, tagKey], tagAddedAt: { ...base.tagAddedAt, [tagKey]: now } };
        await db.songs.put(tagged);
        await refreshRow(db, key, now, tagged, song);
        return { ok: true, value: tag };
    }, () => [key]);
};

/** 从一首歌上去掉一个标签；没有别的歌用这个标签了，就把它从标签表里也删掉。 */
export const removeSongTag = async (songKey: string, tagKey: string, now = Date.now()): Promise<SongNoteResult<void>> => (
    runWrite('remove tag', async db => {
        const row = await db.songs.get(songKey);
        if (!row || !row.tags.includes(tagKey)) return { ok: true, value: undefined };
        const { [tagKey]: _removed, ...tagAddedAt } = row.tagAddedAt;
        const next: SongNoteRow = { ...row, tags: row.tags.filter(key => key !== tagKey), tagAddedAt };
        await db.songs.put(next);
        await refreshRow(db, songKey, now, next);
        if (await db.songs.where('tags').equals(tagKey).count() === 0) await db.tags.delete(tagKey);
        return { ok: true, value: undefined };
    }, () => [songKey])
);

/** 每个标签下几首（走 tags 的 multiEntry 索引，只读 key，不读歌的快照）。命令 #标签 用。 */
export const countSongNoteTags = async (): Promise<Map<string, number>> => {
    const counts = new Map<string, number>();
    try {
        const keys = await songNotesDatabase().songs.orderBy('tags').keys();
        for (const key of keys) if (typeof key === 'string') counts.set(key, (counts.get(key) ?? 0) + 1);
    } catch (error) {
        console.warn('[SongNotes] tag count failed', error);
    }
    return counts;
};

/** 全部写过评论或打过标签的歌（新的在前）：「时刻」展开整页按标签分组、首页的标签页签、另外三页卡片上的标签小条都从它来。 */
export const listAllSongNotes = async (): Promise<SongNoteRow[]> => {
    try {
        return await songNotesDatabase().songs.orderBy('updatedAt').reverse().toArray();
    } catch (error) {
        console.warn('[SongNotes] list all failed', error);
        return [];
    }
};

/**
 * 搜：歌名、歌手、专辑、标签的写法、评论的字里有这段话的歌（不分大小写）。返回这些歌的 key。
 * 评论表整张扫一遍（一首最多 1000 条，库里通常几千条）：只在展开整页的搜索框里用，打字停下来才搜。
 */
export const searchSongNoteKeys = async (query: string): Promise<Set<string>> => {
    // 标签处处写成「#标签」：搜「#rock」也找得到 rock。
    const needle = query.trim().replace(/^[#＃]+/u, '').trim().toLocaleLowerCase();
    const found = new Set<string>();
    if (!needle) return found;
    try {
        const db = songNotesDatabase();
        const [rows, tags] = await Promise.all([db.songs.toArray(), db.tags.toArray()]);
        const tagHits = new Set(tags.filter(tag => tag.name.toLocaleLowerCase().includes(needle)).map(tag => tag.key));
        for (const row of rows) {
            const song = row.song;
            const text = [song.name, ...song.artists.map(artist => artist.name), song.album.name].join('\n').toLocaleLowerCase();
            if (text.includes(needle) || row.tags.some(key => tagHits.has(key) || key.includes(needle))) found.add(row.key);
        }
        await db.comments.each(comment => {
            if (!found.has(comment.songKey) && comment.text.toLocaleLowerCase().includes(needle)) found.add(comment.songKey);
        });
    } catch (error) {
        console.warn('[SongNotes] search failed', error);
    }
    return found;
};

/** 把一批歌上的 fromKey 换成 intoKey（合并）；intoKey 已经在的只去掉 fromKey，打上的时间取早的那个。 */
const replaceTagOnSongs = async (db: SongNotesDatabase, fromKey: string, intoKey: string): Promise<void> => {
    const rows = await db.songs.where('tags').equals(fromKey).toArray();
    for (const row of rows) {
        const { [fromKey]: fromAt, ...rest } = row.tagAddedAt;
        const has = row.tags.includes(intoKey);
        const tags = has ? row.tags.filter(key => key !== fromKey) : row.tags.map(key => (key === fromKey ? intoKey : key));
        const times = [has ? rest[intoKey] : undefined, fromAt].filter((at): at is number => typeof at === 'number');
        await db.songs.put({ ...row, tags, tagAddedAt: times.length > 0 ? { ...rest, [intoKey]: Math.min(...times) } : rest });
    }
};

/**
 * 给一个标签改名。只改大小写、空白（规整后 key 不变）就只换写法；新名字是另一个已有的标签时，不带 merge 返回 conflict
 * （界面问「合并到那个标签？」），带 merge 就把这个标签并进那个（歌上换过去，这个标签删掉，那个的先后不变）。
 * 改成一个新名字：换 key，先后不变。不动歌的 updatedAt（改标签不算新评论）。
 */
export const renameSongNoteTag = async (tagKey: string, rawName: string, options: { merge?: boolean } = {}): Promise<SongNoteResult<SongNoteTag>> => {
    const name = normalizeTagName(rawName);
    if (!name) return fail('empty');
    const nextKey = tagKeyOf(name);
    return runWrite('rename tag', async db => {
        const tag = await db.tags.get(tagKey);
        if (!tag) return fail('notFound');
        if (nextKey === tagKey) {
            const renamed = { ...tag, name };
            await db.tags.put(renamed);
            return { ok: true, value: renamed };
        }
        const existing = await db.tags.get(nextKey);
        if (existing && !options.merge) return fail('conflict');
        await replaceTagOnSongs(db, tagKey, nextKey);
        await db.tags.delete(tagKey);
        if (existing) return { ok: true, value: existing };
        const moved = { ...tag, key: nextKey, name };
        await db.tags.put(moved);
        return { ok: true, value: moved };
    }, () => 'all');
};

/** 删掉一个标签：从所有歌上去掉；标签和评论都没了的歌，这一行也删掉。评论不动。 */
export const deleteSongNoteTag = async (tagKey: string): Promise<SongNoteResult<void>> => runWrite('delete tag', async db => {
    const rows = await db.songs.where('tags').equals(tagKey).toArray();
    for (const row of rows) {
        const { [tagKey]: _removed, ...tagAddedAt } = row.tagAddedAt;
        const tags = row.tags.filter(key => key !== tagKey);
        if (tags.length === 0 && row.commentCount === 0) await db.songs.delete(row.key);
        else await db.songs.put({ ...row, tags, tagAddedAt });
    }
    await db.tags.delete(tagKey);
    return { ok: true, value: undefined };
}, () => 'all');

/** 把一个标签往前（-1）或往后（1）挪一位：和挨着的那个换先后。已经在头上、尾上时什么都不做。 */
export const moveSongNoteTag = async (tagKey: string, step: -1 | 1): Promise<SongNoteResult<void>> => runWrite('move tag', async db => {
    const tags = await db.tags.orderBy('order').toArray();
    const index = tags.findIndex(tag => tag.key === tagKey);
    if (index < 0) return fail('notFound');
    const target = index + step;
    if (target < 0 || target >= tags.length) return { ok: true, value: undefined };
    // 先后重新编成 1、2、3…（以前删过标签留下的空号一起补上），再对调这两个。
    const order = [...tags];
    [order[index], order[target]] = [order[target], order[index]];
    await db.tags.bulkPut(order.map((tag, position) => ({ ...tag, order: position + 1 })));
    return { ok: true, value: undefined };
}, () => 'all');

/**
 * 给一批歌打同一个标签（速记簿多选的「打标签」）。外部播放器的歌、标签已经满了的歌跳过，算进 skipped；
 * 已经有这个标签的不算跳过，也不重打。
 */
export const tagSongs = (
    songs: readonly SongResult[],
    rawName: string,
    now = Date.now(),
): Promise<SongNoteResult<{ tag: SongNoteTag | null; tagged: number; skipped: number }>> => {
    const name = normalizeTagName(rawName);
    if (!name) return Promise.resolve(fail('empty'));
    const tagKey = tagKeyOf(name);
    const keys: string[] = [];
    return runWrite('tag songs', async db => {
        let tag = await db.tags.get(tagKey);
        let tagged = 0;
        let skipped = 0;
        const seen = new Set<string>();
        for (const song of songs) {
            if (isStagePlaybackSong(song)) {
                skipped += 1;
                continue;
            }
            const key = getPlaybackSongKey(song);
            if (seen.has(key)) continue;
            seen.add(key);
            const row = await db.songs.get(key);
            if (row?.tags.includes(tagKey)) continue;
            if ((row?.tags.length ?? 0) >= SONG_NOTE_MAX_TAGS) {
                skipped += 1;
                continue;
            }
            if (!tag) {
                const last = await db.tags.orderBy('order').last();
                tag = { key: tagKey, name, order: (last?.order ?? 0) + 1, createdAt: now };
                await db.tags.put(tag);
            }
            const base: SongNoteRow = row ?? {
                key, song: toStoredSongSnapshot(song), tags: [], tagAddedAt: {}, commentCount: 0, timedCount: 0, updatedAt: now,
            };
            await db.songs.put({ ...base, tags: [...base.tags, tagKey], tagAddedAt: { ...base.tagAddedAt, [tagKey]: now }, updatedAt: now });
            keys.push(key);
            tagged += 1;
        }
        return { ok: true, value: { tag: tag ?? null, tagged, skipped } };
    }, () => keys);
};

/** 从一批歌上去掉同一个标签（速记簿多选、「时刻」整页的「移出这个标签」）。没有歌再用它时标签也删掉。返回去掉了几首。 */
export const untagSongs = async (songKeys: readonly string[], tagKey: string, now = Date.now()): Promise<SongNoteResult<number>> => {
    const keys: string[] = [];
    return runWrite('untag songs', async db => {
        for (const songKey of new Set(songKeys)) {
            const row = await db.songs.get(songKey);
            if (!row || !row.tags.includes(tagKey)) continue;
            const { [tagKey]: _removed, ...tagAddedAt } = row.tagAddedAt;
            const next: SongNoteRow = { ...row, tags: row.tags.filter(key => key !== tagKey), tagAddedAt };
            await db.songs.put(next);
            await refreshRow(db, songKey, now, next);
            keys.push(songKey);
        }
        if (keys.length > 0 && await db.songs.where('tags').equals(tagKey).count() === 0) await db.tags.delete(tagKey);
        return { ok: true, value: keys.length };
    }, () => keys);
};

/** 导出用：全部歌、标签、评论。读不出来回 null（界面报错，不导出一个空文件）。 */
export const readAllSongNotesForExport = async (): Promise<{ rows: SongNoteRow[]; tags: SongNoteTag[]; comments: SongNoteComment[] } | null> => {
    try {
        const db = songNotesDatabase();
        return await db.transaction('r', db.songs, db.comments, db.tags, async () => {
            const [rows, tags, comments] = await Promise.all([
                db.songs.orderBy('updatedAt').reverse().toArray(),
                db.tags.orderBy('order').toArray(),
                db.comments.toArray(),
            ]);
            return { rows, tags, comments };
        });
    } catch (error) {
        console.warn('[SongNotes] export read failed', error);
        return null;
    }
};

/** 一次导入的结果。songsAdded：新出现的歌；songsMerged：原来就有、这次添了东西的歌。 */
export type SongNotesImportResult = {
    songsAdded: number;
    songsMerged: number;
    commentsAdded: number;
    tagsAdded: number;
    /** 已经有了、没重复添加的评论（同一首歌、同样的字和时刻）。 */
    commentsDuplicate: number;
    /** 一首歌的评论、标签到了上限，没添进去的条数。 */
    overLimit: number;
};

const commentIdentity = (text: string, at: number | undefined) => `${text}\u0001${at ?? ''}`;

/**
 * 导入（自己的文件、模组的数据都走这里）：只添加缺少的，已有的不改——
 * - 标签：没有的按导入的先后排在已有标签之后，写法照导入的；已有的写法、先后不动；
 * - 歌：没有的新建一行（快照用导入的）；已有的留着自己的快照，只添标签与评论；
 * - 评论：同一首歌里字和时刻都一样的算已经有了，不重复添加；
 * - 上限照常：一首歌 32 个标签、1000 条评论，多出来的不添，计数报给界面。
 * 外部播放器的歌不导入。最近改动的时间取两边和这次添进来的最晚的那个。整个一个事务：写不进去就什么都不变。
 */
export const importSongNotes = (
    data: { tags: ReadonlyArray<{ name: string; createdAt: number }>; songs: ReadonlyArray<SongNotesImportSongInput> },
    now = Date.now(),
): Promise<SongNoteResult<SongNotesImportResult>> => runWrite('import', async db => {
    const result: SongNotesImportResult = { songsAdded: 0, songsMerged: 0, commentsAdded: 0, tagsAdded: 0, commentsDuplicate: 0, overLimit: 0 };
    // 文件说的时间不晚于现在：写着将来时间的歌会一直排在「最近」最前，之后正常写的评论也压不下它。没写（0）的当现在。
    const past = (at: number | undefined): number => (at && at > 0 ? Math.min(at, now) : now);
    let nextOrder = ((await db.tags.orderBy('order').last())?.order ?? 0) + 1;
    const knownTags = new Set(await db.tags.toCollection().primaryKeys());
    const addedTags: string[] = [];
    // 新标签要写的那一行；已有的回 null。只在真要写的时候 await 库（事务里等别的 promise，Dexie 会当事务已经结束）。
    const newTag = (name: string, createdAt: number): SongNoteTag | null => {
        const key = tagKeyOf(name);
        if (knownTags.has(key)) return null;
        knownTags.add(key);
        addedTags.push(key);
        const tag = { key, name, order: nextOrder, createdAt: createdAt || now };
        nextOrder += 1;
        return tag;
    };
    for (const tag of data.tags) {
        const name = normalizeTagName(tag.name);
        const added = name ? newTag(name, past(tag.createdAt)) : null;
        if (added) await db.tags.put(added);
    }

    for (const item of data.songs) {
        if (isStagePlaybackSong(item.song)) continue;
        const key = getPlaybackSongKey(item.song);
        const row = await db.songs.get(key);
        const tags = [...(row?.tags ?? [])];
        const tagAddedAt = { ...(row?.tagAddedAt ?? {}) };
        let changedSong = false;
        // 这次添进来的最晚的时间：「最近评论过」按 updatedAt 排，文件里 updatedAt 写早了也不让新添的评论沉底。
        let latestAdded = 0;
        for (const ref of item.tags) {
            const name = normalizeTagName(ref.name);
            if (!name) continue;
            const added = newTag(name, past(ref.addedAt));
            if (added) await db.tags.put(added);
            const tagKey = tagKeyOf(name);
            if (tags.includes(tagKey)) continue;
            if (tags.length >= SONG_NOTE_MAX_TAGS) {
                result.overLimit += 1;
                continue;
            }
            tags.push(tagKey);
            tagAddedAt[tagKey] = past(ref.addedAt);
            latestAdded = Math.max(latestAdded, tagAddedAt[tagKey]);
            changedSong = true;
        }
        const comments = await db.comments.where('songKey').equals(key).toArray();
        const seen = new Set(comments.map(comment => commentIdentity(comment.text, comment.at)));
        for (const input of item.comments) {
            const text = normalizeCommentText(input.text);
            const at = normalizeCommentAt(input.at);
            if (!isKeepableComment(text, at)) continue;
            const identity = commentIdentity(text, at);
            if (seen.has(identity)) {
                result.commentsDuplicate += 1;
                continue;
            }
            if (comments.length >= SONG_NOTE_MAX_COMMENTS) {
                result.overLimit += 1;
                continue;
            }
            seen.add(identity);
            const createdAt = past(input.createdAt);
            const comment: SongNoteComment = {
                id: newCommentId(createdAt),
                songKey: key,
                text,
                ...(at !== undefined ? { at } : {}),
                createdAt,
                ...(input.editedAt ? { editedAt: Math.max(createdAt, past(input.editedAt)) } : {}),
            };
            await db.comments.add(comment);
            comments.push(comment);
            result.commentsAdded += 1;
            latestAdded = Math.max(latestAdded, createdAt);
            changedSong = true;
        }
        if (!changedSong) continue;
        if (row) result.songsMerged += 1;
        else result.songsAdded += 1;
        await db.songs.put({
            key,
            song: row?.song ?? toStoredSongSnapshot(item.song),
            tags,
            tagAddedAt,
            ...summarizeComments(comments),
            updatedAt: Math.max(row?.updatedAt ?? 0, past(item.updatedAt), latestAdded),
        });
    }
    // 只有到了上限的歌用的新标签，最后没落到任何一首歌上：不留一个空标签。
    for (const key of addedTags) {
        if (await db.songs.where('tags').equals(key).count() === 0) await db.tags.delete(key);
        else result.tagsAdded += 1;
    }
    return { ok: true, value: result };
}, () => 'all');

/** 要导入的一首歌（已经认成了 SongResult）。和 songNotesFile 的 SongNotesImportSong<SongResult> 同形，这里不引它免得成环。 */
export type SongNotesImportSongInput = {
    song: SongResult;
    tags: ReadonlyArray<{ name: string; addedAt: number }>;
    comments: ReadonlyArray<{ text: string; at?: number; createdAt: number; editedAt?: number }>;
    updatedAt: number;
};
