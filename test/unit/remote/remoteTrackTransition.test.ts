import { describe, expect, it } from 'vitest';
import {
    isOutroGlowVisible,
    OUTRO_GLOW_SECONDS,
    resolveTrackHandoffProgress,
    TRACK_HANDOFF_SECONDS,
} from '../../../src/components/remote/remoteTrackTransition';

// test/unit/remote/remoteTrackTransition.test.ts
// 遥控窗口的收尾时序：发光提示要在最后 30 秒亮起，内容交接要在最后 10 秒内走完，
// 而不是等切歌那一刻才硬跳。短曲目两者都必须整首不触发。

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
    const playing = (remainingSeconds: number, duration = 200) => ({
        ...timing(remainingSeconds, duration),
        isPlaying: true,
    });

    it('ramps from 0 to 1 across the final 10 seconds', () => {
        expect(resolveTrackHandoffProgress(playing(TRACK_HANDOFF_SECONDS + 1))).toBe(0);
        expect(resolveTrackHandoffProgress(playing(TRACK_HANDOFF_SECONDS))).toBe(0);
        expect(resolveTrackHandoffProgress(playing(TRACK_HANDOFF_SECONDS / 2))).toBeCloseTo(0.5);
        expect(resolveTrackHandoffProgress(playing(0.5))).toBeCloseTo(0.95);
    });

    it('falls back to the current track while paused', () => {
        expect(resolveTrackHandoffProgress({ ...playing(2), isPlaying: false })).toBe(0);
    });

    it('never hands off on tracks shorter than twice the window', () => {
        expect(resolveTrackHandoffProgress(playing(2, TRACK_HANDOFF_SECONDS * 2))).toBe(0);
    });
});
