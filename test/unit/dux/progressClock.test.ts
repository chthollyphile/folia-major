import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 没有 Position 的播放器（KDE Connect 代理）也要让歌词时钟走起来；有 Position 时以它为准，
// 暂停时停住，跳转时重新对齐。

const require = createRequire(import.meta.url);
const { createProgressClock } = require('../../../electron/dux/progressClock.cjs') as {
    createProgressClock: (options?: { now?: () => number }) => {
        reset: (state: { trackId: string; positionSec: number; playing: boolean }) => void;
        update: (state: { trackId: string; positionSec: number; playing: boolean }) => number;
        currentMs: () => number;
    };
};

describe('progressClock', () => {
    it('advances from zero when the player never reports a position', () => {
        let now = 1000;
        const clock = createProgressClock({ now: () => now });
        clock.reset({ trackId: 'a', positionSec: 0, playing: true });
        now += 2000;
        expect(clock.update({ trackId: 'a', positionSec: 0, playing: true })).toBe(2000);
        now += 1000;
        expect(clock.update({ trackId: 'a', positionSec: 0, playing: false })).toBe(3000);
        now += 5000;
        expect(clock.currentMs()).toBe(3000);
    });

    it('trusts a reported position and resyncs after a jump', () => {
        let now = 1000;
        const clock = createProgressClock({ now: () => now });
        clock.reset({ trackId: 'a', positionSec: 30, playing: true });
        expect(clock.currentMs()).toBe(30000);
        now += 1000;
        expect(clock.update({ trackId: 'a', positionSec: 31, playing: true })).toBeCloseTo(31000, -2);
        expect(clock.update({ trackId: 'a', positionSec: 90, playing: true })).toBe(90000);
    });

    it('rewinds when a trusted player restarts the same track at zero', () => {
        let now = 1000;
        const clock = createProgressClock({ now: () => now });
        clock.reset({ trackId: 'a', positionSec: 120, playing: true });
        now += 5000;
        expect(clock.update({ trackId: 'a', positionSec: 0, playing: true })).toBe(0);
        now += 2000;
        expect(clock.update({ trackId: 'a', positionSec: 0, playing: true })).toBe(2000);
    });

    it('starts again at the beginning for a new track', () => {
        let now = 1000;
        const clock = createProgressClock({ now: () => now });
        clock.reset({ trackId: 'a', positionSec: 120, playing: true });
        now += 5000;
        clock.reset({ trackId: 'b', positionSec: 0, playing: true });
        now += 1000;
        expect(clock.update({ trackId: 'b', positionSec: 0, playing: true })).toBe(1000);
    });
});
