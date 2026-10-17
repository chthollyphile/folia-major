import { describe, expect, it } from 'vitest';
import { hasLoopedToStart } from '@/services/playedTrackCache';

// test/unit/services/playedTrackLoop.test.ts
// Single loop never fires `ended`: the wrap from the end back to the start stands in for it, so a
// looping track played through is cached like one that ended.

describe('hasLoopedToStart', () => {
    it('sees the wrap from the last second back to the first', () => {
        expect(hasLoopedToStart(305.6, 0.2, 306)).toBe(true);
    });

    it('ignores ordinary playback, seeks inside the track, and unknown durations', () => {
        expect(hasLoopedToStart(120, 120.25, 306)).toBe(false);
        expect(hasLoopedToStart(200, 0.5, 306)).toBe(false);
        expect(hasLoopedToStart(305.6, 40, 306)).toBe(false);
        expect(hasLoopedToStart(305.6, 0.2, Number.NaN)).toBe(false);
        expect(hasLoopedToStart(2.5, 0.2, 3)).toBe(false);
    });
});
