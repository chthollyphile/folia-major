import { describe, expect, it } from 'vitest';

// test/unit/playback/externalSpectrum.test.ts — the bands of a song that sounds in another program:
// a function of the player's own position, so they move with the song and freeze where it stops.

const { externalSpectrumAt } = await import('@/components/app/playback/externalSpectrum');

const BANDS = ['power', 'bass', 'lowMid', 'mid', 'vocal', 'treble'] as const;

/** What the bands are at `position`, read before the next call writes over the one answer. */
const snapshot = (position: number) => {
    const bands = externalSpectrumAt(position);
    return {
        power: bands.power, bass: bands.bass, lowMid: bands.lowMid, mid: bands.mid, vocal: bands.vocal, treble: bands.treble,
        spectrum: Array.from(bands.spectrum),
    };
};

describe('the bands of an external song', () => {
    it('answers the same picture for the same position', () => {
        expect(snapshot(41.5)).toEqual(snapshot(41.5));
    });

    it('moves as the position moves, and stands still where it is paused', () => {
        const at = snapshot(41.5);
        expect(snapshot(42.5)).not.toEqual(at);
        expect(snapshot(41.5).bass).toBe(at.bass);
    });

    it('writes into the one answer it holds, with one bin array, frame after frame', () => {
        const first = externalSpectrumAt(10);
        const spectrum = first.spectrum;
        const second = externalSpectrumAt(11);
        // The visualizer reads this every frame: a route that allocated a bins array per frame would
        // hand the collector sixty of them a second (M3).
        expect(second).toBe(first);
        expect(second.spectrum).toBe(spectrum);
    });

    it('keeps every band inside the analyser\'s own range', () => {
        for (const position of [0, 0.25, 1, 7.4, 199.9]) {
            const bands = externalSpectrumAt(position);
            for (const band of BANDS) {
                expect(bands[band]).toBeGreaterThanOrEqual(0);
                expect(bands[band]).toBeLessThanOrEqual(255);
            }
            expect(bands.spectrum.length).toBeGreaterThan(0);
            for (const value of bands.spectrum) expect(value).toBeLessThanOrEqual(255);
        }
    });

    it('takes a position it cannot use for the start of the song', () => {
        expect(snapshot(Number.NaN)).toEqual(snapshot(0));
        expect(snapshot(-5)).toEqual(snapshot(0));
    });
});
