import { describe, expect, it } from 'vitest';
import { resolveMachiCar, type MachiLane } from '@/components/visualizer/machi/engine/actors/schedules';
import { buildMachiLightningTimes, resolveMachiLightning } from '@/components/visualizer/machi/engine/director';
import type { Line } from '@/types';

// test/unit/visualizer/machi/schedules.test.ts
// 町景里会动的东西：车按氛围时间确定地出现、同时最多一辆；闪电落在每段副歌的开头。

const LANES: MachiLane[] = [
    { from: [-8, 3], to: [8, 3] },
    { from: [8, 4.5], to: [-8, 4.5] },
];

describe('traffic', () => {
    it('is deterministic and never has two cars at once', () => {
        for (let t = 0; t < 600; t += 0.37) {
            expect(resolveMachiCar(t, 'song', LANES)).toEqual(resolveMachiCar(t, 'song', LANES));
        }
        const seen = Array.from({ length: 2000 }, (_, index) => resolveMachiCar(index * 0.3, 'song', LANES)).filter(Boolean);
        expect(seen.length).toBeGreaterThan(100);
        seen.forEach(car => expect(car!.lane).toBeGreaterThanOrEqual(0));
    });

    it('sends fewer cars when the chance is lower', () => {
        const count = (chance: number) => Array.from({ length: 3000 }, (_, index) => resolveMachiCar(index * 0.2, 'busy', LANES, chance)).filter(Boolean).length;
        expect(count(0.3)).toBeLessThan(count(0.9));
        expect(count(0)).toBe(0);
    });

    it('has no cars without lanes', () => {
        expect(Array.from({ length: 200 }, (_, index) => resolveMachiCar(index, 'song', [])).some(Boolean)).toBe(false);
    });
});

describe('lightning', () => {
    const line = (start: number, chorus: boolean): Line => ({ words: [], startTime: start, endTime: start + 2, fullText: 'x', isChorus: chorus });

    it('strikes at the start of each chorus run', () => {
        const lines = [line(0, false), line(3, true), line(5, true), line(8, false), line(11, true)];
        expect(buildMachiLightningTimes(lines)).toEqual([3, 11]);
    });

    it('flashes twice and fades within about a second', () => {
        const times = [10];
        expect(resolveMachiLightning(times, 9.9)).toBe(0);
        expect(resolveMachiLightning(times, 10.04)).toBeGreaterThan(0.9);
        expect(resolveMachiLightning(times, 10.14)).toBeLessThan(resolveMachiLightning(times, 10.24));
        expect(resolveMachiLightning(times, 11.5)).toBe(0);
    });
});
