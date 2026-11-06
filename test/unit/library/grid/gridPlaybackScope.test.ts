import { describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../../src/types';
import type { CollectionResourceSnapshot } from '../../../../src/library/core/shared/resource.contract';
import { resolveGridPlaybackScope, runGridPlaybackScope } from '../../../../src/library/suites/grid/collection/gridPlaybackScope';

// The grid must leave playback filtering to the port so unsupported-row skip counts remain accurate.

const tracks: SongResult[] = [
    { id: 'catalog', name: 'Catalog song', artists: [], album: { id: 1, name: 'Album' }, durationMs: 123_000 },
    { id: 'unsupported', name: 'Uploaded song', artists: [], album: { id: 2, name: 'Upload' }, durationMs: 234_000 },
    { id: 'catalog-2', name: 'Another catalog song', artists: [], album: { id: 1, name: 'Album' }, durationMs: 345_000 },
];

describe('grid playback scope', () => {
    it('passes every displayed row to the bulk playback port when not filtering', () => {
        expect(resolveGridPlaybackScope(tracks, null)).toBe(tracks);
        expect(resolveGridPlaybackScope(tracks, null).map(track => track.id))
            .toEqual(['catalog', 'unsupported', 'catalog-2']);
    });

    it('keeps unsupported rows and display order within the matched scope', () => {
        expect(resolveGridPlaybackScope(tracks, [1, 2]).map(track => track.id))
            .toEqual(['unsupported', 'catalog-2']);
    });

    it('does not fall back to all displayed rows when the filter has no matches', () => {
        expect(resolveGridPlaybackScope(tracks, [])).toEqual([]);
    });

    it('checks the freshest completeness when a previously enabled bulk callback executes', () => {
        let snapshot: Pick<CollectionResourceSnapshot, 'librarySongs'> = {
            librarySongs: { complete: true, loadedCount: 3, refreshing: false },
        };
        const play = vi.fn();
        const execute = () => runGridPlaybackScope('library_songs', () => snapshot, tracks, play);
        execute();
        expect(play).toHaveBeenCalledWith(tracks);
        play.mockClear();
        snapshot = { librarySongs: { complete: false, loadedCount: 3, refreshing: true } };
        execute();
        expect(play).not.toHaveBeenCalled();
    });

    it('blocks stale library callbacks after invalidation removes completeness metadata', () => {
        const play = vi.fn();
        runGridPlaybackScope('library_songs', () => ({}), tracks, play);
        runGridPlaybackScope('library_songs', () => null, tracks, play);
        expect(play).not.toHaveBeenCalled();
    });

    it('does not require library completeness metadata for other collection types', () => {
        const play = vi.fn();
        runGridPlaybackScope('playlist', () => null, tracks, play);
        expect(play).toHaveBeenCalledWith(tracks);
    });
});
