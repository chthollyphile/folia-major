import { describe, expect, it } from 'vitest';
import type { SongResult } from '@/types';
import { appendScratchpadEntries, parseStoredScratchpad, toScratchpadSong } from '@/stores/useScratchpadStore';

// test/unit/stores/scratchpadStore.test.ts
// 速记簿的纯操作：追加去重、容量、舞台歌、本地歌只存引用、读坏存档。

const online = (id: number, name = `song ${id}`): SongResult => ({
    id, name, ar: [{ id: id + 1, name: 'artist' }], al: { id: id + 2, name: 'album', picUrl: '' }, dt: 1000,
} as unknown as SongResult);

const local = (songId: string): SongResult => ({
    id: songId, name: songId, isLocal: true, localRef: { songId }, localData: { id: songId, fileHandle: {} },
} as unknown as SongResult);

describe('appendScratchpadEntries', () => {
    it('appends in order and skips songs already in it, also within one batch', () => {
        const first = appendScratchpadEntries([], [online(1), online(2)], { now: 10, origin: { label: 'A' } });
        expect(first.result).toEqual({ added: 2, duplicates: 0, rejected: 0 });
        const second = appendScratchpadEntries(first.entries, [online(2), online(3), online(3)], { now: 20 });
        expect(second.result).toEqual({ added: 1, duplicates: 2, rejected: 0 });
        expect(second.entries.map(entry => entry.song.name)).toEqual(['song 1', 'song 2', 'song 3']);
        expect(second.entries[0].origin).toEqual({ label: 'A' });
        expect(second.entries[2].origin).toBeUndefined();
        expect(second.entries[2].addedAt).toBe(20);
    });

    it('refuses past capacity instead of pushing old entries out', () => {
        const full = appendScratchpadEntries([], [online(1), online(2)], { capacity: 2 });
        const over = appendScratchpadEntries(full.entries, [online(3)], { capacity: 2 });
        expect(over.result).toEqual({ added: 0, duplicates: 0, rejected: 1 });
        expect(over.entries.map(entry => entry.song.id)).toEqual([1, 2]);
    });

    it('does not take Stage songs', () => {
        const stage = { ...online(9), isStage: true } as unknown as SongResult;
        expect(appendScratchpadEntries([], [stage]).result).toEqual({ added: 0, duplicates: 0, rejected: 1 });
    });

    it('keys local songs by their library id and keeps only the reference', () => {
        const { entries } = appendScratchpadEntries([], [local('local_a')]);
        expect(entries[0].key).toBe('local:local_a');
        expect((entries[0].song as { localData?: unknown }).localData).toBeUndefined();
        expect((entries[0].song as { localRef?: unknown }).localRef).toEqual({ songId: 'local_a' });
    });
});

describe('toScratchpadSong', () => {
    it('leaves online songs as they are, with their source written down', () => {
        const song = toScratchpadSong(online(5));
        expect(song.name).toBe('song 5');
        expect(song.sourceRef?.kind).toBe('online');
    });
});

describe('parseStoredScratchpad', () => {
    it('reads what was written and drops malformed entries', () => {
        const { entries } = appendScratchpadEntries([], [online(1)], { now: 1 });
        const raw = JSON.stringify({ version: 1, entries: [...entries, { key: 'x' }, null] });
        expect(parseStoredScratchpad(raw)).toEqual(entries);
    });

    it('treats unreadable, unknown-version and missing data as empty', () => {
        expect(parseStoredScratchpad(null)).toEqual([]);
        expect(parseStoredScratchpad('{not json')).toEqual([]);
        expect(parseStoredScratchpad(JSON.stringify({ version: 2, entries: [] }))).toEqual([]);
    });
});
