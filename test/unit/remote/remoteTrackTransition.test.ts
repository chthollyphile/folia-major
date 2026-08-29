import { describe, expect, it } from 'vitest';
import {
    mapTrackHandoffProgress,
    resolveStoppedTrackHandoffProgress,
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

describe('local transition clock calibration', () => {
    it('compensates for a delayed snapshot without moving the absolute cue position', () => {
        const clock = resolveTransitionClock(playing(3.25, 0.7));

        expect(clock?.elapsedSec).toBeCloseTo(3.25);
        expect(clock?.timeProgress).toBeCloseTo(0.325);
    });

    it('has no clock while paused or without a cue', () => {
        expect(resolveTransitionClock({ ...playing(2), isPlaying: false })).toBeNull();
        expect(resolveTransitionClock({ ...playing(2), transition: null })).toBeNull();
    });
});

describe('mapTrackHandoffProgress', () => {
    it('spans the whole cue from one face to the other', () => {
        expect(mapTrackHandoffProgress(0, 0.5)).toBe(0);
        expect(mapTrackHandoffProgress(0.5, 0.5)).toBeCloseTo(0.5);
        expect(mapTrackHandoffProgress(1, 0.5)).toBe(1);
    });

    it('maps the exact audio crossover to equal visual opacity', () => {
        expect(mapTrackHandoffProgress(0.7, 0.7)).toBeCloseTo(0.5);
    });

    it('shortens the interval where both track faces are strongly visible', () => {
        expect(mapTrackHandoffProgress(0.25, 0.5)).toBeCloseTo(0.15625);
        expect(mapTrackHandoffProgress(0.75, 0.5)).toBeCloseTo(0.84375);
    });

    // hold 为 0 时 automixSession 会给出 crossover 0，「50% 落在 crossover 上」这时无解：
    // 硬套会让第一帧直接跳到半透明，交接看起来像闪了一下。
    it('stays continuous when the crossover sits on either endpoint', () => {
        expect(mapTrackHandoffProgress(0, 0)).toBe(0);
        expect(mapTrackHandoffProgress(0.001, 0)).toBeLessThan(0.01);
        expect(mapTrackHandoffProgress(1, 0)).toBe(1);

        expect(mapTrackHandoffProgress(0.999, 1)).toBeGreaterThan(0.99);
        expect(mapTrackHandoffProgress(1, 1)).toBe(1);
    });
});

describe('resolveStoppedTrackHandoffProgress', () => {
    const pair = {
        startedAtMs: 10_000,
        durationSec: 10,
        outgoingKey: 'track-a',
        incoming: { key: 'track-b', title: 'B', artist: 'B artist', coverUrl: null },
    };

    it('keeps the end position after B becomes the current track', () => {
        expect(resolveStoppedTrackHandoffProgress(pair, 'track-b', 20_000)).toBe(1);
    });

    it('restores the start position when cancellation returns to A mid-cue', () => {
        expect(resolveStoppedTrackHandoffProgress(pair, 'track-a', 14_000)).toBe(0);
    });

    // settle 同步清 cue，显示曲目要等下一次 React 提交才推进；夹在中间的那次发布带着
    // 「没有 cue 的 A」过来，按取消处理会让已经淡完的 A 满不透明度闪回。
    it('holds the end position while the finished cue waits for the track to promote', () => {
        expect(resolveStoppedTrackHandoffProgress(pair, 'track-a', 20_000)).toBe(1);
    });

    it('defaults to the current face when no handoff pair was observed', () => {
        expect(resolveStoppedTrackHandoffProgress(null, 'track-a', 20_000)).toBe(0);
    });
});
