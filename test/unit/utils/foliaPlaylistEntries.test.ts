import { describe, expect, it } from 'vitest';
import {
    appendFoliaPlaylistEntries,
    foliaLocalSongKey,
    getFoliaEntryLocalSongId,
    getFoliaEntrySourceKey,
    getFoliaPlaylistLocalSongIds,
    removeFoliaPlaylistEntries,
    reorderFoliaPlaylistEntries,
} from '@/utils/foliaPlaylistEntries';
import { appendScratchpadEntries } from '@/stores/useScratchpadStore';
import type { SongResult } from '@/types';

// test/unit/utils/foliaPlaylistEntries.test.ts
// Folia 聚合歌单条目的纯规则。

const online = (providerId: string, id: number): SongResult => ({
    id,
    name: `s${id}`,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    sourceRef: { kind: 'online', providerId, mediaId: String(id) },
});
const local = (songId: string): SongResult => ({
    id: 1,
    name: songId,
    artists: [],
    album: { id: 0, name: '' },
    durationMs: 1,
    isLocal: true,
    localRef: { songId },
    localData: { id: songId, blob: 'x' },
} as unknown as SongResult);

describe('foliaPlaylistEntries', () => {
    it('appends with the keys and snapshots the scratchpad would store', () => {
        const songs = [online('netease', 1), local('a'), online('netease', 1)];
        const folia = appendFoliaPlaylistEntries([], songs, 5);
        const scratchpad = appendScratchpadEntries([], songs, { now: 5 });
        expect(folia.entries).toEqual(scratchpad.entries);
        expect(folia.result).toEqual({ added: 2, duplicates: 1, rejected: 0 });
        expect(folia.entries[1].song).not.toHaveProperty('localData');
    });

    it('recognizes local entries and names the source of each entry', () => {
        const { entries } = appendFoliaPlaylistEntries([], [online('qq', 2), local('a'), local('b')]);
        expect(entries.map(getFoliaEntryLocalSongId)).toEqual([null, 'a', 'b']);
        expect(getFoliaPlaylistLocalSongIds({ entries })).toEqual(['a', 'b']);
        expect(entries.map(getFoliaEntrySourceKey)).toEqual(['online:qq', 'local', 'local']);
        expect(entries[1].key).toBe(foliaLocalSongKey('a'));
    });

    it('removes by key and reorders only with a full permutation of the expected order', () => {
        const { entries } = appendFoliaPlaylistEntries([], [online('qq', 1), online('qq', 2), online('qq', 3)]);
        const keys = entries.map(item => item.key);
        expect(removeFoliaPlaylistEntries(entries, [keys[1]]).map(item => item.key)).toEqual([keys[0], keys[2]]);
        expect(reorderFoliaPlaylistEntries(entries, [keys[2], keys[0], keys[1]], keys)?.map(item => item.key)).toEqual([keys[2], keys[0], keys[1]]);
        expect(reorderFoliaPlaylistEntries(entries, [keys[2], keys[0]], keys)).toBeNull();
        expect(reorderFoliaPlaylistEntries(entries, [keys[2], keys[0], keys[0]], keys)).toBeNull();
        expect(reorderFoliaPlaylistEntries(entries, [keys[2], keys[0], 'x'], keys)).toBeNull();
        expect(reorderFoliaPlaylistEntries(entries, keys, [keys[1], keys[0], keys[2]])).toBeNull();
    });
});
