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

export type SongNoteWriteError = 'stage' | 'tooManyComments' | 'tooManyTags' | 'empty' | 'notFound' | 'failed';
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

const changed = (songKeys: readonly string[]) => {
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

const runWrite = async <T>(label: string, work: (db: SongNotesDatabase) => Promise<SongNoteResult<T>>, keys: () => readonly string[]): Promise<SongNoteResult<T>> => {
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
