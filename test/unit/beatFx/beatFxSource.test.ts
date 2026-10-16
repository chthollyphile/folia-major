import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/beatFx/beatFxSource.test.ts
// A beat lookup that throws must answer "no beats" - so the frame falls back - and must not be
// remembered, so the next play of the track tries again.

const { getTrackBeatGrid } = vi.hoisted(() => ({ getTrackBeatGrid: vi.fn() }));
vi.mock('@/services/analysis/beatGrid', () => ({ getTrackBeatGrid }));
vi.mock('@/services/analysis/modelAvailability', () => ({ refreshModelAvailability: vi.fn(async () => undefined) }));
vi.mock('@/services/analysis/beatThis', () => ({ BEAT_THIS_SAMPLE_RATE: 22050, canRunBeatThis: () => true }));

const { loadBeatFxTrackBeats } = await import('@/services/beatFx/beatFxSource');

const song = { id: 'throws', sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'throws' } } as unknown as SongResult;

describe('loadBeatFxTrackBeats', () => {
    beforeEach(() => {
        getTrackBeatGrid.mockReset();
    });

    it('answers no beats when the lookup throws, and retries on the next play', async () => {
        getTrackBeatGrid.mockRejectedValueOnce(new Error('idb gone'));
        const first = await loadBeatFxTrackBeats(song).beats;
        expect(first.source).toBe('none');
        expect(first.events).toEqual([]);
        expect(first.note).toContain('idb gone');

        // Let the eviction of the failed entry run.
        await Promise.resolve();
        getTrackBeatGrid.mockResolvedValueOnce({ beats: [0.5, 1], downbeats: [0.5] });
        const second = await loadBeatFxTrackBeats(song).beats;
        expect(second.source).toBe('beat_this');
        expect(second.events.length).toBeGreaterThan(0);
        expect(getTrackBeatGrid).toHaveBeenCalledTimes(2);
        // small0 only: the beat FX never ask for, read or share automix's final0 lists.
        for (const call of getTrackBeatGrid.mock.calls) expect(call[2]).toEqual({ model: 'beat_this_small' });
    });
});
