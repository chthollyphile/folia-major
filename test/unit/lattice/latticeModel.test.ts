import { describe, expect, it } from 'vitest';
import type { SongResult } from '../../../src/types';
import { buildLatticeTiles } from '../../../src/components/app/lattice/latticeModel';

// Verifies the wall mirrors the play queue exactly, including its order.

const song = (id: string, sourceRef: SongResult['sourceRef']): SongResult => ({
    id,
    name: `Song ${id}`,
    artists: [{ id: 1, name: 'Artist' }],
    album: { id: 1, name: 'Album' },
    durationMs: 180_000,
    sourceRef,
});

const online = (id: string) => song(id, { kind: 'online', providerId: 'netease', mediaId: id });

describe('buildLatticeTiles', () => {
    it('mirrors the queue order one tile per entry', () => {
        const queue = [online('one'), online('two'), online('three')];

        const tiles = buildLatticeTiles({ queue, currentSong: null });

        expect(tiles.map(tile => tile.id)).toEqual([
            'online:netease:one',
            'online:netease:two',
            'online:netease:three',
        ]);
    });

    it('splits sections around the playhead', () => {
        const queue = [online('one'), online('two'), online('three')];

        const tiles = buildLatticeTiles({ queue, currentSong: queue[1] });

        expect(tiles.map(tile => tile.section)).toEqual(['played', 'now', 'upcoming']);
    });

    it('marks everything upcoming when the current song is outside the queue', () => {
        const tiles = buildLatticeTiles({
            queue: [online('one'), online('two')],
            currentSong: online('elsewhere'),
        });

        expect(tiles.map(tile => tile.section)).toEqual(['upcoming', 'upcoming']);
    });

    it('keeps mixed sources without filtering by provider', () => {
        const tiles = buildLatticeTiles({
            queue: [
                online('netease'),
                song('qq', { kind: 'online', providerId: 'qq', mediaId: 'qq' }),
                song('nav', { kind: 'navidrome', mediaId: 'nav' }),
            ],
            currentSong: null,
        });

        expect(tiles).toHaveLength(3);
    });

    it('returns nothing for an empty queue', () => {
        expect(buildLatticeTiles({ queue: [], currentSong: null })).toEqual([]);
    });
});
