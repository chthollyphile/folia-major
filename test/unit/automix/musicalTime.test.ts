import { describe, expect, it } from 'vitest';
import {
    alignEntry,
    barGrid,
    quantiseToMusic,
    settledBpm,
    snapToGrid,
    tempoMatch,
    BEATS_PER_PHRASE,
} from '@/services/automix/musicalTime';

// test/unit/automix/musicalTime.test.ts
// The units music is counted in, and the one relationship between two tracks that a gain curve
// cannot stand in for.

describe('settledBpm', () => {
    it('prefers the tail, which is the half a transition is laid against', () => {
        expect(settledBpm(120, 118)).toBe(118);
    });

    it('answers null when the two readings of one track disagree', () => {
        // Not "take the later one". Two measurements of one quantity that disagree by a third mean
        // the quantity was not measured - no song slows by a third into its last chorus, that is a
        // beat tracker on the wrong harmonic. Both of these are verbatim from a real log.
        expect(settledBpm(92, 123)).toBe(null);
        expect(settledBpm(136, 86)).toBe(null);
        expect(settledBpm(117, 136)).toBe(null);
    });

    it('still folds the octave, and answers in the whole-track counting', () => {
        // 88 against 176 is the same pulse counted twice, so this is not the disagreement above -
        // the tail reading is usable and must not come back null.
        //
        // WHICH OCTAVE it comes back in was the bug. This used to return the tail reading verbatim,
        // and a real log caught what that costs: "125 BPM, 63 at the end" handed back 63, a period
        // twice as long as the bar grid, `beatOffset` and the stem gesture are laid on. `periodSec`
        // feeds `planBlendShape`, which quantises the overlap to it - at double length every
        // candidate fell outside the snap tolerance and the blend landed on no beat at all. Seen on
        // 丑 twice, with and without performance mode, while 烂泥 on the same album snapped fine.
        //
        // So the answer is the tail's TEMPO in the whole track's octave. Identical to the tail
        // reading whenever the two agree without folding, which is every other case.
        expect(settledBpm(88, 176)).toBeCloseTo(88, 6);
        expect(settledBpm(125, 63)).toBeCloseTo(126, 6);
        // A drift inside one octave is untouched - the tail still wins, at its own rate.
        expect(settledBpm(125, 121)).toBeCloseTo(121, 6);
    });

    it('falls back rather than inventing, when only one end was measured', () => {
        expect(settledBpm(120, null)).toBe(120);
        expect(settledBpm(null, 120)).toBe(120);
        expect(settledBpm(null, null)).toBe(null);
        expect(settledBpm(0, 0)).toBe(null);
    });
});

describe('tempoMatch', () => {
    it('treats half time and double time as the same tempo', () => {
        // 90 against 180 is not a doubling of speed, it is one pulse counted two ways. Forcing
        // either onto the other would be a two-to-one stretch to fix something nobody can hear.
        expect(tempoMatch(90, 180).relation).toBe('locked');
        expect(tempoMatch(180, 90).relation).toBe('locked');
        expect(tempoMatch(60, 120).stretch).toBe(1);
    });

    it('grades a difference by what could honestly be done about it', () => {
        expect(tempoMatch(120, 120.5).relation).toBe('locked');
        expect(tempoMatch(120, 125).relation).toBe('near');
        expect(tempoMatch(120, 130).relation).toBe('stretchable');
        // Past what a stretch should be asked to do, and still perfectly overlappable.
        expect(tempoMatch(120, 138).relation).toBe('drifting');
        // Far enough that even the shortest blend drifts a whole beat.
        expect(tempoMatch(90, 128).relation).toBe('far');
    });

    it('separates "do not bend this" from "do not overlap this"', () => {
        // The regression this exists to prevent. One threshold was answering both questions, so
        // lowering the bend limit silently started CUTTING pairs an eighth apart - a difference two
        // tracks are easily overlapped across, just not beat matched. Verbatim from a real log:
        // "blending 0.51s - beatCut - the two tempos are 11% apart, so this one is cut".
        const eleven = tempoMatch(100, 111);
        expect(eleven.relation).not.toBe('far');
        expect(eleven.stretch).not.toBe(1);   // close enough to actually fix

        const fifteen = tempoMatch(100, 115);
        expect(fifteen.relation).toBe('drifting');
        expect(fifteen.stretch).toBe(1);      // too far to fix, near enough to still overlap
    });

    it('never bends towards a ratio a mis-measured tempo produces', () => {
        // A beat tracker that locks onto the wrong harmonic returns 5:4, 4:3 or 3:2 of the true
        // period. The invariant that matters is that none of them is BENT to - where exactly the
        // overlap line falls between them is a much cheaper thing to be wrong about. All from a
        // real log.
        expect(tempoMatch(123, 92).stretch).toBe(1);   // 3:4, "92 BPM (123 at the end)"
        expect(tempoMatch(136, 102).stretch).toBe(1);  // 3:4 again
        expect(tempoMatch(117, 89).stretch).toBe(1);   // 4:3
        expect(tempoMatch(90, 135).stretch).toBe(1);   // 3:2
    });

    it('bends the outgoing track onto the incoming one, never the other way', () => {
        // The departing track has seconds left and no future to be wrong in; the arriving one is
        // about to be listened to for three minutes.
        const match = tempoMatch(100, 105);
        expect(match.stretch).toBeCloseTo(1.05, 6);
        expect(match.ratio).toBeCloseTo(1.05, 6);
    });

    it('does nothing at all when the two are too far apart', () => {
        // `far` routes to a different transition, not to a bigger correction.
        expect(tempoMatch(90, 128).stretch).toBe(1);
    });

    it('has no answer without two tempos', () => {
        expect(tempoMatch(null, 120)).toMatchObject({ relation: 'unknown', stretch: 1 });
        expect(tempoMatch(120, 0)).toMatchObject({ relation: 'unknown', stretch: 1 });
    });
});

describe('quantiseToMusic', () => {
    const beat = 0.5;

    it('rounds a long blend to whole phrases', () => {
        // Four bars is what an arrangement is built in; 4.8 beats is not a length any music has.
        expect(quantiseToMusic(9, beat, 30)).toBeCloseTo(BEATS_PER_PHRASE * beat, 6);
    });

    it('rounds a middling blend to whole bars and a short one to whole beats', () => {
        expect(quantiseToMusic(2.6, beat, 30)).toBeCloseTo(4 * beat, 6);
        expect(quantiseToMusic(1.1, beat, 30)).toBeCloseTo(2 * beat, 6);
    });

    it('steps down by whole units rather than landing on the ceiling', () => {
        // The ceiling is a limit, not a length. Twenty-five seconds is not a number of bars.
        const answer = quantiseToMusic(16, beat, 6.2);
        expect(answer).toBeLessThanOrEqual(6.2);
        expect(answer / beat).toBe(Math.round(answer / beat));
        expect(answer).toBeCloseTo(12 * beat, 6);
    });

    it('never returns nothing, however tight the ceiling', () => {
        expect(quantiseToMusic(8, beat, 0.1)).toBeCloseTo(beat, 6);
    });

    it('passes the seconds straight through without a grid to count on', () => {
        expect(quantiseToMusic(4, null, 30)).toBe(4);
        expect(quantiseToMusic(40, null, 30)).toBe(30);
    });
});

describe('barGrid and snapToGrid', () => {
    it('folds the downbeat into the first bar', () => {
        // 120 BPM: a bar is two seconds, so a downbeat at 7.5s is the same grid as one at 1.5s.
        expect(barGrid(120, 7.5)).toEqual({ offset: 1.5, period: 2 });
    });

    it('has no grid without a tempo or without a downbeat', () => {
        expect(barGrid(null, 1.5)).toBeNull();
        expect(barGrid(120, null)).toBeNull();
    });

    it('moves a moment onto a line only when one is close enough to reach', () => {
        const grid = { offset: 1.5, period: 2 };
        expect(snapToGrid(9.8, grid, 0.5)).toBeCloseTo(9.5, 6);
        // A whole bar away is a different handover, not the same one tidied up.
        expect(snapToGrid(10.4, grid, 0.5)).toBe(10.4);
        expect(snapToGrid(9.8, null, 0.5)).toBe(9.8);
    });
});

describe('alignEntry', () => {
    it('starts the incoming track so its bar line lands on the outgoing one\'s', () => {
        // The half of beat matching a gain curve genuinely cannot do: two tracks whose bars are a
        // quarter note apart stay a quarter note apart however the levels are moved.
        const incoming = { offset: 0.4, period: 2 };
        // The outgoing track's next bar line is 1.2s after the handover, so the incoming track has
        // to be 1.2s short of one of its own when it starts.
        const entry = alignEntry(1, incoming, 1.2);
        expect((entry + 1.2 - incoming.offset) % incoming.period).toBeCloseTo(0, 6);
        expect(entry).toBeGreaterThanOrEqual(1);
    });

    it('never enters before the point everything else agreed on', () => {
        // Skipping into a track to make the bars agree would delete the beginning of it.
        for (const phase of [0, 0.3, 0.9, 1.7, 1.99]) {
            expect(alignEntry(2.5, { offset: 0.4, period: 2 }, phase)).toBeGreaterThanOrEqual(2.5);
        }
    });

    it('leaves the entry alone when either side has no grid', () => {
        expect(alignEntry(1.5, null, 0.5)).toBe(1.5);
        expect(alignEntry(1.5, { offset: 0, period: 2 }, null)).toBe(1.5);
    });
});
