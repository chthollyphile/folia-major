import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SongNotesDatabase, setSongNotesDatabaseForTest } from '@/components/song-notes/songNotesDatabase';
import { SONG_NOTE_MAX_TAGS } from '@/components/song-notes/songNotesModel';
import {
    addSongComment,
    addSongTag,
    deleteSongNoteTag,
    getSongNote,
    listAllSongNotes,
    listSongNoteTags,
    moveSongNoteTag,
    renameSongNoteTag,
    searchSongNoteKeys,
    tagSongs,
    untagSongs,
} from '@/components/song-notes/songNotesService';
import { resetSongNotesBroadcast } from '@/components/song-notes/songNotesBroadcast';
import type { SongResult } from '@/types';

// test/unit/song-notes/songNoteTags.test.ts
// 第二阶段的标签操作：改名（只改写法、改成新名字、撞上已有的要合并）、删除、换先后、批量打标签 / 去标签，以及搜索与列出全部。

const song = (id: number, name = `song ${id}`, artist = 'Singer'): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: artist }],
    album: { id: 2, name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);
const keyOf = (id: number) => `online:netease:${id}`;
const stageSong = { ...song(9), sourceRef: { kind: 'stage', mediaId: '9' } } as SongResult;

let dbIndex = 0;

beforeEach(() => {
    resetSongNotesBroadcast(null);
    dbIndex += 1;
    setSongNotesDatabaseForTest(new SongNotesDatabase(`FoliaSongNotesDB-tags-${dbIndex}`));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
    setSongNotesDatabaseForTest(null);
});

const names = async () => (await listSongNoteTags()).map(tag => tag.name);

describe('renameSongNoteTag', () => {
    it('changes only the spelling when the key stays the same', async () => {
        await addSongTag(song(1), 'rock', 1000);
        const result = await renameSongNoteTag('rock', 'Rock');
        expect(result).toMatchObject({ ok: true, value: { key: 'rock', name: 'Rock' } });
        expect((await getSongNote(keyOf(1))).row?.tags).toEqual(['rock']);
    });

    it('moves songs to the new key and keeps the order', async () => {
        await addSongTag(song(1), 'a', 1000);
        await addSongTag(song(1), 'b', 1100);
        await addSongTag(song(2), 'a', 1200);
        expect((await renameSongNoteTag('a', 'Night')).ok).toBe(true);
        expect(await names()).toEqual(['Night', 'b']);
        expect((await getSongNote(keyOf(1))).row).toMatchObject({ tags: ['night', 'b'], tagAddedAt: { night: 1000, b: 1100 } });
        expect((await getSongNote(keyOf(2))).row?.tags).toEqual(['night']);
    });

    it('asks before merging into a tag that exists, and merges when told to', async () => {
        await addSongTag(song(1), 'old', 1000);
        await addSongTag(song(2), 'old', 1100);
        await addSongTag(song(2), 'new', 900);
        expect(await renameSongNoteTag('old', 'NEW')).toEqual({ ok: false, error: 'conflict' });
        const merged = await renameSongNoteTag('old', 'NEW', { merge: true });
        expect(merged).toMatchObject({ ok: true, value: { key: 'new', name: 'new' } });
        expect(await names()).toEqual(['new']);
        expect((await getSongNote(keyOf(1))).row).toMatchObject({ tags: ['new'], tagAddedAt: { new: 1000 } });
        // Already had both: one tag left, the earlier time kept.
        expect((await getSongNote(keyOf(2))).row).toMatchObject({ tags: ['new'], tagAddedAt: { new: 900 } });
    });

    it('rejects an empty name and an unknown tag', async () => {
        expect(await renameSongNoteTag('x', ' # ')).toEqual({ ok: false, error: 'empty' });
        expect(await renameSongNoteTag('x', 'y')).toEqual({ ok: false, error: 'notFound' });
    });
});

describe('deleteSongNoteTag', () => {
    it('removes the tag everywhere, drops rows left empty and keeps commented ones', async () => {
        await addSongTag(song(1), 'gone', 1000);
        await addSongTag(song(2), 'gone', 1000);
        await addSongComment(song(2), { text: '留着' }, 1100);
        expect((await deleteSongNoteTag('gone')).ok).toBe(true);
        expect(await names()).toEqual([]);
        expect((await getSongNote(keyOf(1))).row).toBeNull();
        expect((await getSongNote(keyOf(2))).row).toMatchObject({ tags: [], commentCount: 1 });
    });
});

describe('moveSongNoteTag', () => {
    it('swaps with the neighbour and does nothing at the ends', async () => {
        await addSongTag(song(1), 'a', 1);
        await addSongTag(song(1), 'b', 2);
        await addSongTag(song(1), 'c', 3);
        await moveSongNoteTag('c', -1);
        expect(await names()).toEqual(['a', 'c', 'b']);
        await moveSongNoteTag('a', -1);
        await moveSongNoteTag('b', 1);
        expect(await names()).toEqual(['a', 'c', 'b']);
        expect((await listSongNoteTags()).map(tag => tag.order)).toEqual([1, 2, 3]);
    });
});

describe('tagSongs / untagSongs', () => {
    it('tags a batch once each, skipping stage songs and full ones', async () => {
        for (let index = 0; index < SONG_NOTE_MAX_TAGS; index += 1) await addSongTag(song(3), `t${index}`);
        await addSongTag(song(2), 'mix', 500);
        const result = await tagSongs([song(1), song(1), song(2), song(3), stageSong], 'Mix', 1000);
        expect(result).toMatchObject({ ok: true, value: { tagged: 1, skipped: 2, tag: { key: 'mix' } } });
        expect((await getSongNote(keyOf(1))).row?.tags).toEqual(['mix']);
        expect((await getSongNote(keyOf(2))).row?.tagAddedAt).toEqual({ mix: 500 });
    });

    it('removes a tag from a batch and drops the tag when nobody has it', async () => {
        await tagSongs([song(1), song(2)], 'pair', 1000);
        expect(await untagSongs([keyOf(1), keyOf(2), keyOf(7)], 'pair')).toEqual({ ok: true, value: 2 });
        expect(await listSongNoteTags()).toEqual([]);
        expect(await listAllSongNotes()).toEqual([]);
    });
});

describe('search and listing', () => {
    it('finds songs by title, artist, tag name and comment text', async () => {
        await addSongComment(song(1, 'Midnight Drive'), { text: 'x' }, 1000);
        await addSongComment(song(2, 'Other', 'Yoasobi'), { text: 'y' }, 1100);
        await addSongTag(song(3), 'City Pop', 1200);
        await addSongComment(song(4), { text: '副歌太好听了' }, 1300);
        expect([...await searchSongNoteKeys('midnight')]).toEqual([keyOf(1)]);
        expect([...await searchSongNoteKeys('yoaso')]).toEqual([keyOf(2)]);
        expect([...await searchSongNoteKeys('city')]).toEqual([keyOf(3)]);
        expect([...await searchSongNoteKeys('#City')]).toEqual([keyOf(3)]);
        expect([...await searchSongNoteKeys('副歌')]).toEqual([keyOf(4)]);
        expect((await searchSongNoteKeys('  ')).size).toBe(0);
        expect((await listAllSongNotes()).map(row => row.key)).toEqual([keyOf(4), keyOf(3), keyOf(2), keyOf(1)]);
    });
});
