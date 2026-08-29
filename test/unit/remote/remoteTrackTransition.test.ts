import { describe, expect, it } from 'vitest';
import {
    isOutroGlowVisible,
    OUTRO_GLOW_SECONDS,
    resolveTrackHandoffProgress,
} from '../../../src/components/remote/remoteTrackTransition';

// test/unit/remote/remoteTrackTransition.test.ts
// 遥控窗口的收尾时序：曲尾提示仍看剩余时间，内容交接则必须跟随 AutoMix 实际 cue。

const timing = (remainingSeconds: number, duration = 200) => ({
    hasTrack: true,
    duration,
    remainingSeconds,
});

describe('isOutroGlowVisible', () => {
    it('lights up only inside the final 30 seconds', () => {
        expect(isOutroGlowVisible(timing(OUTRO_GLOW_SECONDS + 1))).toBe(false);
        expect(isOutroGlowVisible(timing(OUTRO_GLOW_SECONDS))).toBe(true);
        expect(isOutroGlowVisible(timing(1))).toBe(true);
    });

    it('stays dark once the track is over, without a track, or on short tracks', () => {
        expect(isOutroGlowVisible(timing(0))).toBe(false);
        expect(isOutroGlowVisible({ ...timing(5), hasTrack: false })).toBe(false);
        expect(isOutroGlowVisible(timing(5, OUTRO_GLOW_SECONDS * 2))).toBe(false);
    });

    it('ignores tracks with an unknown duration', () => {
        expect(isOutroGlowVisible({ hasTrack: true, duration: 0, remainingSeconds: Number.POSITIVE_INFINITY }))
            .toBe(false);
    });
});

describe('resolveTrackHandoffProgress', () => {
    const playing = (elapsedSec: number, crossover = 0.5) => ({
        transition: {
            startedAtMs: 10_000,
            durationSec: 10,
            crossover,
        },
        isPlaying: true,
        nowMs: 10_000 + elapsedSec * 1000,
    });

    it('ramps from 0 to 1 across the cue wall-clock span', () => {
        expect(resolveTrackHandoffProgress(playing(0))).toBe(0);
        expect(resolveTrackHandoffProgress(playing(5))).toBeCloseTo(0.5);
        expect(resolveTrackHandoffProgress(playing(10))).toBe(1);
    });

    it('aligns visual dominance with an off-centre audio crossover', () => {
        expect(resolveTrackHandoffProgress(playing(7, 0.7))).toBeCloseTo(0.5);
        expect(resolveTrackHandoffProgress(playing(3.5, 0.7))).toBeCloseTo(0.25);
        expect(resolveTrackHandoffProgress(playing(8.5, 0.7))).toBeCloseTo(0.75);
    });

    it('falls back to the current track while paused or without a cue', () => {
        expect(resolveTrackHandoffProgress({ ...playing(2), isPlaying: false })).toBe(0);
        expect(resolveTrackHandoffProgress({ ...playing(2), transition: null })).toBe(0);
    });
});
