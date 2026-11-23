import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SongNotesDatabase, setSongNotesDatabaseForTest } from '@/components/song-notes/songNotesDatabase';
import { SONG_NOTE_MAX_COMMENTS, SONG_NOTE_MAX_TAGS } from '@/components/song-notes/songNotesModel';
import {
    addSongComment,
    addSongTag,
    countSongNotes,
    deleteSongComment,
    editSongComment,
    getSongNote,
    listRecentSongNotes,
    listSongNoteTags,
    removeSongTag,
    subscribeSongNotes,
} from '@/components/song-notes/songNotesService';
import { resetSongNotesBroadcast } from '@/components/song-notes/songNotesBroadcast';
import type { SongResult } from '@/types';

// test/unit/song-notes/songNotesService.test.ts
// 歌曲评论的数据层（FoliaSongNotesDB）：写、改、删评论，打标签、去标签；一首歌的摘要行跟着评论走，
// 标签和评论都没了这一行就删掉，没有歌用的标签从标签表里删掉；外部播放器的歌不收。

const song = (id: number, name = `song ${id}`): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);
const KEY_1 = 'online:netease:1';
const KEY_2 = 'online:netease:2';
const stageSong = { ...song(9), sourceRef: { kind: 'stage', mediaId: '9' } } as SongResult;

let dbIndex = 0;
let database: SongNotesDatabase;

beforeEach(async () => {
    resetSongNotesBroadcast(null);
    dbIndex += 1;
    database = new SongNotesDatabase(`FoliaSongNotesDB-test-${dbIndex}`);
    setSongNotesDatabaseForTest(database);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
    setSongNotesDatabaseForTest(null);
});

const unwrap = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    return result.value;
};

describe('comments', () => {
    it('writes a comment and keeps a summary row for the song', async () => {
        const written = unwrap(await addSongComment(song(1), { text: '  副歌进来了 ', at: 43.26 }, 1000));
        expect(written).toMatchObject({ songKey: KEY_1, text: '副歌进来了', at: 43.3, createdAt: 1000 });
        const detail = await getSongNote(KEY_1);
        expect(detail.comments).toHaveLength(1);
        expect(detail.row).toMatchObject({ key: KEY_1, commentCount: 1, timedCount: 1, tags: [], updatedAt: 1000 });
        expect(detail.row?.song.name).toBe('song 1');
        expect(detail.row?.latestComment?.text).toBe('副歌进来了');
        expect(await countSongNotes()).toBe(1);
    });

    it('takes a bare mark but not an empty comment without a time', async () => {
        expect((await addSongComment(song(1), { text: '', at: 12 })).ok).toBe(true);
        expect(await addSongComment(song(1), { text: '   ' })).toEqual({ ok: false, error: 'empty' });
        expect((await getSongNote(KEY_1)).comments).toHaveLength(1);
    });

    it('refuses songs from an external player', async () => {
        expect(await addSongComment(stageSong, { text: 'x' })).toEqual({ ok: false, error: 'stage' });
        expect(await addSongTag(stageSong, 'x')).toEqual({ ok: false, error: 'stage' });
        expect(await countSongNotes()).toBe(0);
    });

    it('returns comments in the order they were written', async () => {
        await addSongComment(song(1), { text: '第二条' }, 2000);
        await addSongComment(song(1), { text: '第一条' }, 1000);
        expect((await getSongNote(KEY_1)).comments.map(entry => entry.text)).toEqual(['第一条', '第二条']);
    });

    it('edits the words and marks the comment as edited', async () => {
        const written = unwrap(await addSongComment(song(1), { text: '旧的' }, 1000));
        const edited = unwrap(await editSongComment(written.id, '新的', 2000));
        expect(edited).toMatchObject({ text: '新的', editedAt: 2000, createdAt: 1000 });
        expect((await getSongNote(KEY_1)).row).toMatchObject({ updatedAt: 2000, latestComment: { text: '新的' } });
    });

    it('editing to nothing removes an untimed comment and keeps a timed one as a bare mark', async () => {
        const untimed = unwrap(await addSongComment(song(1), { text: '没挂时刻' }, 1000));
        const timed = unwrap(await addSongComment(song(1), { text: '挂着', at: 30 }, 1100));
        expect(unwrap(await editSongComment(untimed.id, '  ', 2000))).toBeNull();
        expect(unwrap(await editSongComment(timed.id, '', 2100))).toMatchObject({ text: '', at: 30 });
        const detail = await getSongNote(KEY_1);
        expect(detail.comments.map(entry => entry.id)).toEqual([timed.id]);
        expect(detail.row).toMatchObject({ commentCount: 1, timedCount: 1 });
    });

    it('deletes the row once the last comment goes and there are no tags', async () => {
        const written = unwrap(await addSongComment(song(1), { text: '唯一一条' }));
        unwrap(await deleteSongComment(written.id));
        expect(await getSongNote(KEY_1)).toEqual({ row: null, comments: [] });
        expect(await countSongNotes()).toBe(0);
        expect(await deleteSongComment(written.id)).toEqual({ ok: false, error: 'notFound' });
        expect(await editSongComment(written.id, 'x')).toEqual({ ok: false, error: 'notFound' });
    });

    it('stops at the comment limit for one song', async () => {
        await database.songs.put({
            key: KEY_1, song: song(1), tags: [], tagAddedAt: {}, commentCount: SONG_NOTE_MAX_COMMENTS, timedCount: 0, updatedAt: 1,
        });
        expect(await addSongComment(song(1), { text: 'one more' })).toEqual({ ok: false, error: 'tooManyComments' });
    });

    it('lists recently noted songs newest first', async () => {
        await addSongComment(song(1), { text: 'a' }, 1000);
        await addSongComment(song(2), { text: 'b' }, 2000);
        await addSongComment(song(1), { text: 'c' }, 3000);
        expect((await listRecentSongNotes(10)).map(row => row.key)).toEqual([KEY_1, KEY_2]);
        expect((await listRecentSongNotes(1)).map(row => row.key)).toEqual([KEY_1]);
    });
});

describe('tags', () => {
    it('tags a song, reuses the first spelling of a tag and finds songs by tag', async () => {
        const first = unwrap(await addSongTag(song(1), '#City Pop', 1000));
        expect(first).toMatchObject({ key: 'city pop', name: 'City Pop', order: 1 });
        const again = unwrap(await addSongTag(song(2), 'city pop', 2000));
        expect(again.name).toBe('City Pop');
        unwrap(await addSongTag(song(2), '夜车', 3000));
        expect((await listSongNoteTags()).map(tag => tag.name)).toEqual(['City Pop', '夜车']);
        const tagged = await database.songs.where('tags').equals('city pop').primaryKeys();
        expect(tagged.sort()).toEqual([KEY_1, KEY_2]);
        expect((await getSongNote(KEY_2)).row).toMatchObject({ tags: ['city pop', '夜车'], tagAddedAt: { 'city pop': 2000, '夜车': 3000 } });
    });

    it('adding the same tag twice keeps it once and keeps when it was first added', async () => {
        await addSongTag(song(1), 'rock', 1000);
        await addSongTag(song(1), 'Rock', 2000);
        expect((await getSongNote(KEY_1)).row).toMatchObject({ tags: ['rock'], tagAddedAt: { rock: 1000 } });
    });

    it('a song with only tags keeps its row, and loses it with the last tag', async () => {
        await addSongTag(song(1), 'rock', 1000);
        expect((await getSongNote(KEY_1)).row).toMatchObject({ commentCount: 0, tags: ['rock'] });
        unwrap(await removeSongTag(KEY_1, 'rock', 2000));
        expect((await getSongNote(KEY_1)).row).toBeNull();
    });

    it('keeps the row while comments remain after the tags go', async () => {
        await addSongTag(song(1), 'rock', 1000);
        await addSongComment(song(1), { text: '还在' }, 1100);
        unwrap(await removeSongTag(KEY_1, 'rock', 2000));
        expect((await getSongNote(KEY_1)).row).toMatchObject({ tags: [], tagAddedAt: {}, commentCount: 1 });
    });

    it('drops a tag from the tag list only when no song uses it any more', async () => {
        await addSongTag(song(1), 'rock', 1000);
        await addSongTag(song(2), 'rock', 1000);
        await removeSongTag(KEY_1, 'rock');
        expect((await listSongNoteTags()).map(tag => tag.key)).toEqual(['rock']);
        await removeSongTag(KEY_2, 'rock');
        expect(await listSongNoteTags()).toEqual([]);
    });

    it('rejects an empty tag and stops at the tag limit', async () => {
        expect(await addSongTag(song(1), ' # ')).toEqual({ ok: false, error: 'empty' });
        for (let index = 0; index < SONG_NOTE_MAX_TAGS; index += 1) unwrap(await addSongTag(song(1), `t${index}`));
        expect(await addSongTag(song(1), 'one more')).toEqual({ ok: false, error: 'tooManyTags' });
        // A tag the song already has is still fine at the limit.
        expect((await addSongTag(song(1), 't0')).ok).toBe(true);
    });
});

describe('change notices', () => {
    it('tells listeners which song changed, only after a successful write', async () => {
        const seen: (readonly string[] | 'all')[] = [];
        const stop = subscribeSongNotes(keys => seen.push(keys));
        const written = unwrap(await addSongComment(song(1), { text: 'a' }));
        await addSongComment(song(1), { text: '' });
        await addSongTag(song(2), 'rock');
        await deleteSongComment(written.id);
        stop();
        await addSongComment(song(1), { text: 'after stop' });
        expect(seen).toEqual([[KEY_1], [KEY_2], [KEY_1]]);
    });

    it('reports a failed write instead of throwing', async () => {
        setSongNotesDatabaseForTest({
            ...database,
            transaction: () => Promise.reject(new Error('quota')),
        } as unknown as SongNotesDatabase);
        expect(await addSongComment(song(1), { text: 'x' })).toEqual({ ok: false, error: 'failed' });
    });
});
