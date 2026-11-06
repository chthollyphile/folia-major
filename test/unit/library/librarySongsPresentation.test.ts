import { describe, expect, it } from 'vitest';
import { projectLibrarySongsPresentation } from '../../../src/library/core/collection/librarySongsPresentation';
import { projectCollectionTracks } from '../../../src/library/suites/bravais/bravaisProjection';
import type { SongResult } from '../../../src/types';

// Shared all-songs status projection stays consistent across the three library suites.

describe('library songs presentation', () => {
    it('does not change other collection statuses', () => {
        expect(projectLibrarySongsPresentation(undefined, 'ready', 'none')).toBeNull();
    });

    it('keeps a loaded count visible when complete, including an empty library', () => {
        expect(projectLibrarySongsPresentation({ complete: true, loadedCount: 0, refreshing: false }, 'ready', 'none'))
            .toEqual({ key: 'loaded', count: 0, retry: false, filterPartial: false });
    });

    it('warns that filtering is partial while loading or interrupted', () => {
        expect(projectLibrarySongsPresentation({ complete: false, loadedCount: 100, refreshing: false }, 'ready', 'syncing'))
            .toEqual({ key: 'loading', count: 100, retry: false, filterPartial: true });
        expect(projectLibrarySongsPresentation({ complete: false, loadedCount: 100, refreshing: false }, 'error', 'interrupted'))
            .toEqual({ key: 'incomplete', count: 100, retry: true, filterPartial: true });
    });

    it('labels a retained old list as not updated after refresh failure', () => {
        expect(projectLibrarySongsPresentation({ complete: false, loadedCount: 100, refreshing: true }, 'loading', 'syncing'))
            .toEqual({ key: 'refreshing', count: 100, retry: false, filterPartial: true });
        expect(projectLibrarySongsPresentation({ complete: false, loadedCount: 100, refreshing: true }, 'error', 'interrupted'))
            .toEqual({ key: 'refreshFailed', count: 100, retry: true, filterPartial: true });
    });

    it('keeps unsupported rows in Bravais without classifying them as taken down', () => {
        const tracks: SongResult[] = [
            { id: 'catalog', name: 'Catalog song', artists: [], album: { id: 1, name: 'Album' }, durationMs: 123_000 },
            { id: 'upload', name: 'Uploaded song', artists: [], album: { id: 2, name: 'Upload' }, durationMs: 234_000 },
        ];
        const items = projectCollectionTracks(tracks, index => `entry-${index}`, track => ({
            artists: [],
            album: track.album.name,
            durationMs: track.durationMs,
            playbackKey: String(track.id),
            unavailable: false,
            playbackUnsupported: track.id === 'upload',
        }), 'Unknown');
        expect(items).toHaveLength(2);
        expect(items[0]).toMatchObject({ key: 'entry-0', title: 'Catalog song', playbackUnsupported: undefined });
        expect(items[1]).toMatchObject({ key: 'entry-1', title: 'Uploaded song', playbackUnsupported: true, unavailable: undefined });
    });

    it('does not claim a cached incomplete snapshot is still loading', () => {
        expect(projectLibrarySongsPresentation({ complete: false, loadedCount: 100, refreshing: false }, 'ready', 'none')?.key)
            .toBe('incomplete');
    });
});
