import { describe, expect, it } from 'vitest';
import { currentWebLyricTimeSec } from '@/utils/webLyricSource';
import type { WebLyricClock } from '@/types/webLyricSource';

// test/unit/utils/webLyricSource.test.ts
// 通用时钟外推：播放中按墙钟推进、暂停冻结、有时长则夹取。

describe('currentWebLyricTimeSec', () => {
    const base: WebLyricClock = { positionSec: 10, durationSec: 200, anchoredAtMs: 1000, playing: true };

    it('advances by wall-clock while playing', () => {
        expect(currentWebLyricTimeSec(base, 1000)).toBeCloseTo(10, 5);
        expect(currentWebLyricTimeSec(base, 3000)).toBeCloseTo(12, 5); // +2s
    });

    it('freezes while paused', () => {
        const paused: WebLyricClock = { ...base, playing: false };
        expect(currentWebLyricTimeSec(paused, 9999)).toBeCloseTo(10, 5);
    });

    it('clamps to duration when playing past the end', () => {
        expect(currentWebLyricTimeSec(base, 1000 + 500_000)).toBeCloseTo(200, 5);
    });

    it('does not clamp when duration is unknown', () => {
        const noDuration: WebLyricClock = { ...base, durationSec: 0 };
        expect(currentWebLyricTimeSec(noDuration, 1000 + 500_000)).toBeGreaterThan(200);
    });

    it('never advances when the wall-clock predates the anchor', () => {
        const future: WebLyricClock = { ...base, anchoredAtMs: 5000 };
        expect(currentWebLyricTimeSec(future, 1000)).toBeCloseTo(10, 5);
    });
});
