import { afterEach, describe, expect, it, vi } from 'vitest';
import { announceTransition, getTransitionHandoffProgress } from '../../../src/services/automix/transitionCue';
import { mapTrackHandoffProgress, progressSince } from '../../../src/services/automix/handoffProgress';
import { readIncomingLyricClock } from '../../../src/components/app/playback/bridges/incomingLyricClock';

// test/unit/automix/transitionHandoffProgress.test.ts
// The song hand-off the main window's visualizer draws: how far it has come over a cue, and the
// incoming track's line read from its own clock.

const announceAt = (nowMs: number, cue: Parameters<typeof announceTransition>[0]) => {
    vi.spyOn(performance, 'now').mockReturnValue(nowMs);
    announceTransition(cue);
};

describe('getTransitionHandoffProgress', () => {
    afterEach(() => {
        announceTransition(null);
        vi.restoreAllMocks();
    });

    it('is 0 with no cue announced', () => {
        expect(getTransitionHandoffProgress(5_000)).toBe(0);
    });

    it('runs the shared curve over the cue and holds 1 past its end until the settle', () => {
        announceAt(1_000, { seconds: 10, crossover: 0.6, periodSec: null });

        expect(getTransitionHandoffProgress(1_000)).toBe(0);
        expect(getTransitionHandoffProgress(4_000)).toBeCloseTo(mapTrackHandoffProgress(0.3, 0.6));
        expect(getTransitionHandoffProgress(7_000)).toBeCloseTo(0.5);
        expect(getTransitionHandoffProgress(11_000)).toBe(1);
        expect(getTransitionHandoffProgress(14_000)).toBe(1);
    });

    it('goes back to 0 when the blend is called off', () => {
        announceAt(1_000, { seconds: 10, crossover: 0.5, periodSec: null });
        expect(getTransitionHandoffProgress(8_000)).toBeGreaterThan(0.5);

        announceTransition(null);
        expect(getTransitionHandoffProgress(8_000)).toBe(0);
    });

    it('ignores a settings preview', () => {
        announceAt(1_000, { seconds: 10, crossover: 0.5, periodSec: null, preview: 'ring' });
        expect(getTransitionHandoffProgress(6_000)).toBe(0);
    });
});

describe('readIncomingLyricClock', () => {
    const lines = [
        { fullText: 'one', startTime: 0, endTime: 4, words: [] },
        { fullText: 'two', startTime: 5, endTime: 9, words: [] },
    ];

    it("reads the incoming track's line from its own deck, less the lyric offset", () => {
        expect(readIncomingLyricClock(6, 0, lines)).toEqual({ lyricTimeSec: 6, lineIndex: 1 });
        // 1.5 s of offset puts 6 s on the deck in the gap after the first line.
        expect(readIncomingLyricClock(6, 1500, lines)).toEqual({ lyricTimeSec: 4.5, lineIndex: -1 });
        expect(readIncomingLyricClock(3, 0, lines).lineIndex).toBe(0);
    });

    it('has no line while the lyrics are still loading', () => {
        expect(readIncomingLyricClock(6, 0, null)).toEqual({ lyricTimeSec: 6, lineIndex: -1 });
    });
    it('reads full-song lyrics at a preview file position without changing the manual offset', () => {
        expect(readIncomingLyricClock(1 + 5000 / 1000, 500, lines)).toEqual({ lyricTimeSec: 5.5, lineIndex: 1 });
        expect(readIncomingLyricClock(1, 500, lines)).toEqual({ lyricTimeSec: 0.5, lineIndex: 0 });
    });
});

describe('progressSince', () => {
    it('runs its whole course from where it began, and is done when it began at the end', () => {
        expect(progressSince(0.4, 0.4)).toBe(0);
        expect(progressSince(0.7, 0.4)).toBeCloseTo(0.5);
        expect(progressSince(1, 0.4)).toBe(1);
        // Behind where it began (a hand-off going back) stays at the start; at the end it is done.
        expect(progressSince(0.2, 0.4)).toBe(0);
        expect(progressSince(0.5, 1)).toBe(1);
    });
});
