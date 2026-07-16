import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import { resolveGridViewContextTracks } from '../../../src/components/folia-grid/gridViewContextActions';

// test/unit/gridView/gridViewContextActions.test.ts

const buildTrack = (id: number, name: string, unavailable = false): SongResult => ({
    id,
    name,
    artists: [],
    album: { id, name: 'Album' },
    duration: 180000,
    privilege: unavailable ? { st: -200 } : { st: 0 },
});

describe('resolveGridViewContextTracks', () => {
    it('keeps the complete playable collection when no filter is active', () => {
        const allPlayableTracks = [
            buildTrack(1, 'Alpha'),
            buildTrack(2, 'Beta'),
        ];

        expect(resolveGridViewContextTracks(
            [{ rawTrack: allPlayableTracks[0] }],
            allPlayableTracks,
            false
        )).toBe(allPlayableTracks);
    });

    it('uses only visible playable tracks when a filter is active', () => {
        const alpha = buildTrack(1, 'Alpha');
        const unavailable = buildTrack(2, 'Unavailable', true);
        const gamma = buildTrack(3, 'Gamma');

        expect(resolveGridViewContextTracks(
            [
                { rawTrack: gamma },
                { rawTrack: unavailable },
                {},
            ],
            [alpha, gamma],
            true
        )).toEqual([gamma]);
    });

    it('returns an empty action context when the filter has no results', () => {
        expect(resolveGridViewContextTracks([], [buildTrack(1, 'Alpha')], true)).toEqual([]);
    });
});
