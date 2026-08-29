import { describe, expect, it } from 'vitest';
import {
    isTrackTransitionGlowVisible,
    mapTrackHandoffProgress,
    resolveTrackHandoffProgress,
    resolveTransitionClock,
} from '../../../src/components/remote/remoteTrackTransition';

// test/unit/remote/remoteTrackTransition.test.ts
// 遥控窗口的进度条提示与内容交接必须共用实际混音 cue。

const playing = (elapsedSec: number, crossover = 0.5) => ({
    transition: {
        startedAtMs: 10_000,
        durationSec: 10,
        crossover,
    },
    isPlaying: true,
    nowMs: 10_000 + elapsedSec * 1000,
});

describe('isTrackTransitionGlowVisible', () => {
    it('lights only inside the actual transition span', () => {
        expect(isTrackTransitionGlowVisible(playing(-0.1))).toBe(false);
        expect(isTrackTransitionGlowVisible(playing(0))).toBe(true);
        expect(isTrackTransitionGlowVisible(playing(5))).toBe(true);
        expect(isTrackTransitionGlowVisible(playing(10))).toBe(false);
    });

    it('stays dark while paused or without a cue', () => {
        expect(isTrackTransitionGlowVisible({ ...playing(2), isPlaying: false })).toBe(false);
        expect(isTrackTransitionGlowVisible({ ...playing(2), transition: null })).toBe(false);
    });
});

describe('resolveTrackHandoffProgress', () => {
    it('ramps from 0 to 1 across the cue wall-clock span', () => {
        expect(resolveTrackHandoffProgress(playing(0))).toBe(0);
        expect(resolveTrackHandoffProgress(playing(5))).toBeCloseTo(0.5);
        expect(resolveTrackHandoffProgress(playing(10))).toBe(1);
    });

    it('aligns visual dominance with an off-centre audio crossover', () => {
        expect(resolveTrackHandoffProgress(playing(7, 0.7))).toBeCloseTo(0.5);
        expect(resolveTrackHandoffProgress(playing(3.5, 0.7))).toBeCloseTo(0.15625);
        expect(resolveTrackHandoffProgress(playing(8.5, 0.7))).toBeCloseTo(0.84375);
    });

    it('falls back to the current track while paused or without a cue', () => {
        expect(resolveTrackHandoffProgress({ ...playing(2), isPlaying: false })).toBe(0);
        expect(resolveTrackHandoffProgress({ ...playing(2), transition: null })).toBe(0);
    });
});

describe('local transition clock calibration', () => {
    it('compensates for a delayed snapshot without moving the absolute cue position', () => {
        const clock = resolveTransitionClock(playing(3.25, 0.7));

        expect(clock?.elapsedSec).toBeCloseTo(3.25);
        expect(clock?.timeProgress).toBeCloseTo(0.325);
    });

    it('maps the exact audio crossover to equal visual opacity', () => {
        expect(mapTrackHandoffProgress(0.7, 0.7)).toBeCloseTo(0.5);
    });

    it('shortens the interval where both track faces are strongly visible', () => {
        expect(mapTrackHandoffProgress(0.25, 0.5)).toBeCloseTo(0.15625);
        expect(mapTrackHandoffProgress(0.75, 0.5)).toBeCloseTo(0.84375);
    });
});
