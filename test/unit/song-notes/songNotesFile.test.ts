import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { SongNotesDatabase, setSongNotesDatabaseForTest } from '@/components/song-notes/songNotesDatabase';
import { SONG_NOTE_MAX_TAGS, SONG_NOTE_MAX_TEXT } from '@/components/song-notes/songNotesModel';
import {
    addSongComment,
    addSongTag,
    getSongNote,
    importSongNotes,
    listSongNoteTags,
    readAllSongNotesForExport,
} from '@/components/song-notes/songNotesService';
import {
    countSongNotesImport,
    musicNotesImportOf,
    readSongNotesFileText,
    serializeSongNotesFile,
    splitLongText,
} from '@/components/song-notes/songNotesFile';
import { MUSIC_NOTES_MOD_DATABASE, countMusicNotesModSongs, readMusicNotesModRecords } from '@/components/song-notes/musicNotesModDatabase';
import { resetSongNotesBroadcast } from '@/components/song-notes/songNotesBroadcast';
import type { SongResult } from '@/types';

// test/unit/song-notes/songNotesFile.test.ts
// 第三阶段：「时刻」自己的文件（导出再读回来）、「音乐笔记」模组导出的 JSON（v1 / v2）与它的库、只添加缺少的导入。

const song = (id: number, name = `song ${id}`): SongResult => ({
    id,
    name,
    artists: [{ id: 1, name: 'Singer' }],
    album: { id: 2, name: 'Album' },
    durationMs: 200000,
    sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(id) },
} as SongResult);
const keyOf = (id: number) => `online:netease:${id}`;

let dbIndex = 0;

beforeEach(() => {
    resetSongNotesBroadcast(null);
    dbIndex += 1;
    setSongNotesDatabaseForTest(new SongNotesDatabase(`FoliaSongNotesDB-file-${dbIndex}`));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
    setSongNotesDatabaseForTest(null);
});

const modRecord = (id: string, extra: Record<string, unknown> = {}) => ({
    key: JSON.stringify(['online:netease', id]),
    song: { source: 'online:netease', id, title: `mod ${id}`, artist: 'Mod Singer' },
    tags: [],
    note: '',
    bookmarks: [],
    createdAt: 1000,
    updatedAt: 2000,
    revision: 1,
    ...extra,
});

describe('own file', () => {
    it('round-trips tags, comments and their times', async () => {
        await addSongTag(song(1), 'Night', 1000);
        await addSongTag(song(1), 'Rain', 1100);
        await addSongComment(song(1), { text: 'chorus', at: 61.5 }, 1200);
        await addSongComment(song(2), { text: 'plain' }, 1300);
        const data = await readAllSongNotesForExport();
        const exported = serializeSongNotesFile(data!, [], 5000);
        expect(exported).toMatchObject({ exportedCount: 2, skippedCount: 0 });

        const reading = readSongNotesFileText(exported.content);
        expect(reading.kind).toBe('folia');
        if (reading.kind !== 'folia') return;
        expect(reading.data.tags.map(tag => tag.name)).toEqual(['Night', 'Rain']);
        const first = reading.data.songs.find(item => item.song.source === 'online' && item.song.song.name === 'song 1')!;
        expect(first.tags).toEqual([{ name: 'Night', addedAt: 1000 }, { name: 'Rain', addedAt: 1100 }]);
        expect(first.comments).toEqual([{ text: 'chorus', at: 61.5, createdAt: 1200 }]);
        expect(countSongNotesImport(reading.data)).toEqual({ songs: 2, comments: 2, tags: 2 });
    });

    it('names what is wrong with a file', () => {
        expect(readSongNotesFileText('not json')).toEqual({ kind: 'error', error: 'not-json' });
        expect(readSongNotesFileText('{"format":"other"}')).toEqual({ kind: 'error', error: 'unknown-format' });
        expect(readSongNotesFileText('{"format":"folia-song-notes","version":9,"tags":[],"songs":[]}')).toEqual({ kind: 'error', error: 'newer-version' });
        expect(readSongNotesFileText('{"format":"folia-song-notes","version":1}')).toEqual({ kind: 'error', error: 'damaged' });
    });

    it('skips broken songs and empty comments without losing the rest', () => {
        const content = JSON.stringify({
            format: 'folia-song-notes',
            version: 1,
            tags: [{ name: ' #Mix ', createdAt: 5 }, { name: '' }],
            songs: [
                { source: 'online', song: { name: 'x' } },
                {
                    source: 'online',
                    song: { id: 3, name: 'ok', artists: [], album: { name: '' }, sourceRef: { kind: 'online', providerId: 'netease', mediaId: '3' } },
                    tags: [{ name: 'mix' }, { name: 'MIX' }],
                    comments: [{ text: '   ', createdAt: 1 }, { text: '', at: 12 }, { text: 'hi' }],
                    updatedAt: 9,
                },
            ],
        });
        const reading = readSongNotesFileText(content);
        if (reading.kind !== 'folia') throw new Error(reading.kind);
        expect(reading.data.invalidCount).toBe(1);
        expect(reading.data.tags).toEqual([{ name: 'Mix', createdAt: 5 }]);
        expect(reading.data.songs[0].tags).toEqual([{ name: 'mix', addedAt: 9 }]);
        expect(reading.data.songs[0].comments).toEqual([{ text: '', at: 12, createdAt: 9 }, { text: 'hi', createdAt: 9 }]);
    });
});

describe('music notes mod', () => {
    it('turns the note into comments, bookmarks into timed comments, and keeps v2 tag order', () => {
        const content = JSON.stringify({
            format: 'music-notes',
            version: 2,
            notes: [
                modRecord('1', { tags: ['b', 'A'], note: '  long story  ', bookmarks: [{ id: 'bookmark-1', positionSeconds: 30.04, text: 'drop' }] }),
                modRecord('2', { song: { source: 'local', id: 'L1', title: 'local one', artist: '' }, key: '["local","L1"]', tags: ['c'] }),
                modRecord('3', { song: { source: 'stage', id: '9', title: 'x', artist: '' } }),
            ],
            // First seen: b, a, c → order c, a, b.
            tagOrder: [2, 1, 0],
        });
        const reading = readSongNotesFileText(content);
        if (reading.kind !== 'music-notes') throw new Error(reading.kind);
        const { data } = reading;
        expect(data.invalidCount).toBe(1);
        expect(data.tags.map(tag => tag.name)).toEqual(['c', 'A', 'b']);
        expect(data.songs[0].song).toEqual({ kind: 'online', providerId: 'netease', mediaId: '1', title: 'mod 1', artist: 'Mod Singer' });
        expect(data.songs[0].comments).toEqual([
            { text: 'long story', createdAt: 2000 },
            { text: 'drop', at: 30, createdAt: 2001 },
        ]);
        expect(data.songs[0].tags).toEqual([{ name: 'b', addedAt: 1000 }, { name: 'A', addedAt: 1000 }]);
        expect(data.songs[1].song).toMatchObject({ kind: 'local', songId: 'L1' });
    });

    it('orders v1 tags by use, then name', () => {
        const data = musicNotesImportOf([
            modRecord('1', { tags: ['z', 'y'] }),
            modRecord('2', { tags: ['y'] }),
            modRecord('3', { tags: ['x'] }),
        ], null);
        expect(data.tags.map(tag => tag.name)).toEqual(['y', 'x', 'z']);
    });

    it('splits a note longer than one comment', () => {
        const parts = splitLongText('字'.repeat(SONG_NOTE_MAX_TEXT + 5));
        expect(parts.map(part => Array.from(part).length)).toEqual([SONG_NOTE_MAX_TEXT, 5]);
    });
});

describe('importSongNotes', () => {
    it('adds only what is missing and keeps what is there', async () => {
        await addSongTag(song(1), 'Old', 100);
        await addSongComment(song(1), { text: 'mine', at: 10 }, 200);
        const result = await importSongNotes({
            tags: [{ name: 'Fresh', createdAt: 50 }, { name: 'old', createdAt: 1 }],
            songs: [
                {
                    song: song(1),
                    tags: [{ name: 'OLD', addedAt: 1 }, { name: 'Fresh', addedAt: 300 }],
                    comments: [{ text: 'mine', at: 10, createdAt: 5 }, { text: 'theirs', createdAt: 400 }],
                    updatedAt: 50,
                },
                { song: song(2), tags: [], comments: [{ text: 'new song', createdAt: 600 }], updatedAt: 600 },
                { song: { ...song(3), sourceRef: { kind: 'stage', mediaId: '3' } } as SongResult, tags: [], comments: [{ text: 'x', createdAt: 1 }], updatedAt: 1 },
            ],
        }, 9999);
        expect(result).toEqual({
            ok: true,
            value: { songsAdded: 1, songsMerged: 1, commentsAdded: 2, tagsAdded: 1, commentsDuplicate: 1, overLimit: 0 },
        });
        expect((await listSongNoteTags()).map(tag => [tag.name, tag.order])).toEqual([['Old', 1], ['Fresh', 2]]);
        const first = await getSongNote(keyOf(1));
        expect(first.row).toMatchObject({ tags: ['old', 'fresh'], tagAddedAt: { old: 100, fresh: 300 }, commentCount: 2 });
        expect(first.comments.map(comment => comment.text)).toEqual(['mine', 'theirs']);
        expect((await getSongNote(keyOf(2))).row).toMatchObject({ commentCount: 1, updatedAt: 600 });
    });

    it('does not keep times from the future', async () => {
        const future = 9e12;
        await importSongNotes({
            tags: [],
            songs: [{ song: song(5), tags: [{ name: 'later', addedAt: future }], comments: [{ text: 'x', createdAt: future, editedAt: future }], updatedAt: future }],
        }, 5000);
        const detail = await getSongNote(keyOf(5));
        expect(detail.row).toMatchObject({ updatedAt: 5000, tagAddedAt: { later: 5000 } });
        expect(detail.comments[0]).toMatchObject({ createdAt: 5000, editedAt: 5000 });
    });

    it('drops tags over the limit and does not leave an unused new tag behind', async () => {
        for (let index = 0; index < SONG_NOTE_MAX_TAGS; index += 1) await addSongTag(song(1), `t${index}`);
        const result = await importSongNotes({ tags: [], songs: [{ song: song(1), tags: [{ name: 'extra', addedAt: 1 }], comments: [], updatedAt: 1 }] });
        expect(result).toMatchObject({ ok: true, value: { songsAdded: 0, songsMerged: 0, tagsAdded: 0, overLimit: 1 } });
        expect((await listSongNoteTags()).some(tag => tag.key === 'extra')).toBe(false);
    });
});

describe('the mod database', () => {
    const openMod = () => new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(MUSIC_NOTES_MOD_DATABASE, 30);
        request.onupgradeneeded = () => {
            request.result.createObjectStore('notes', { keyPath: 'key' });
            request.result.createObjectStore('metadata', { keyPath: 'key' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    it('is not created when it is not there', async () => {
        expect(await countMusicNotesModSongs()).toBe(0);
        expect((await indexedDB.databases()).some(info => info.name === MUSIC_NOTES_MOD_DATABASE)).toBe(false);
    });

    it('reads the records and the tag order without changing the version', async () => {
        const db = await openMod();
        await new Promise<void>((resolve) => {
            const transaction = db.transaction(['notes', 'metadata'], 'readwrite');
            transaction.objectStore('notes').put(modRecord('1', { tags: ['a'] }));
            transaction.objectStore('notes').put(modRecord('2'));
            transaction.objectStore('metadata').put({ key: 'order', noteOrder: [], tagOrder: ['a'] });
            transaction.oncomplete = () => resolve();
        });
        db.close();
        expect(await countMusicNotesModSongs()).toBe(2);
        const read = await readMusicNotesModRecords();
        expect(read?.records).toHaveLength(2);
        expect(read?.tagOrder).toEqual(['a']);
        expect((await indexedDB.databases()).find(info => info.name === MUSIC_NOTES_MOD_DATABASE)?.version).toBe(30);
    });
});
