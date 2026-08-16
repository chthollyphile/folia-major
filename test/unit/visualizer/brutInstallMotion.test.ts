import { describe, expect, it } from 'vitest';
import {
    createBrutInstallState,
    resolveBrutInstallState,
    resolveBrutRevealTiming,
    resolveBrutUnitSlam,
} from '@/components/visualizer/brut/brutInstallMotion';
import type { BrutInstallUnit } from '@/components/visualizer/brut/brutLyricUnits';

// test/unit/visualizer/brutInstallMotion.test.ts
// The install curve is a pure function of absolute time - that is what makes seeking free, because
// there is no animation state to reset, the curve simply evaluates to the terminal pose.

const unit = (startTime: number, endTime: number): BrutInstallUnit => ({
    text: '字',
    charStart: 0,
    charEnd: 1,
    startTime,
    endTime,
});

const NORMAL = resolveBrutRevealTiming({
    rawDuration: 3,
    timingClass: 'normal',
    renderEndTime: 3,
    lineTransitionMode: 'normal',
    wordRevealMode: 'normal',
});

describe('resolveBrutRevealTiming', () => {
    it('collapses micro lines to an instant reveal', () => {
        const timing = resolveBrutRevealTiming({
            rawDuration: 0.05,
            timingClass: 'micro',
            renderEndTime: 0.07,
            lineTransitionMode: 'none',
            wordRevealMode: 'instant',
        });
        expect(timing.instant).toBe(true);
        expect(resolveBrutUnitSlam(unit(0, 0.05), timing)).toBe(0);
    });

    it('compresses short lines without making them instant', () => {
        const timing = resolveBrutRevealTiming({
            rawDuration: 0.15,
            timingClass: 'short',
            renderEndTime: 0.2,
            lineTransitionMode: 'fast',
            wordRevealMode: 'fast',
        });
        expect(timing.instant).toBe(false);
        expect(timing.pre).toBeLessThan(NORMAL.pre);
        expect(resolveBrutUnitSlam(unit(0, 1), timing)).toBeLessThan(resolveBrutUnitSlam(unit(0, 1), NORMAL));
    });

    it('falls back to the normal curve without hints', () => {
        expect(resolveBrutRevealTiming(null)).toEqual(NORMAL);
    });
});

describe('resolveBrutInstallState', () => {
    const state = createBrutInstallState();

    it('hides a plate well before its slot opens', () => {
        const result = resolveBrutInstallState(unit(10, 10.4), 5, NORMAL, 0, state);
        expect(result.visible).toBe(false);
        expect(result.alpha).toBe(0);
    });

    it('shows the empty recessed slot during the lead-in', () => {
        const result = resolveBrutInstallState(unit(10, 10.4), 9.9, NORMAL, 0, state);
        expect(result.visible).toBe(true);
        expect(result.z).toBeLessThan(0);
        expect(result.alpha).toBeGreaterThan(0);
        expect(result.alpha).toBeLessThan(0.3);
        expect(result.tint).toBe(0);
    });

    it('reaches the terminal pose long after the slam, so a seek needs no reset', () => {
        const result = resolveBrutInstallState(unit(10, 10.4), 400, NORMAL, 0.03, state);
        expect(result.visible).toBe(true);
        expect(result.alpha).toBe(1);
        expect(result.scale).toBeCloseTo(1, 6);
        expect(result.z).toBeCloseTo(0.02, 6);
        expect(result.roll).toBeCloseTo(0.03, 6);
        expect(result.tint).toBe(1);
        expect(result.flash).toBe(0);
    });

    it('keeps every output bounded and finite across the whole curve', () => {
        for (let time = 9.5; time < 11.5; time += 0.01) {
            const result = resolveBrutInstallState(unit(10, 10.4), time, NORMAL, 0.02, state);
            expect(Number.isFinite(result.z)).toBe(true);
            expect(result.alpha).toBeGreaterThanOrEqual(0);
            expect(result.alpha).toBeLessThanOrEqual(1);
            expect(result.tint).toBeGreaterThanOrEqual(0);
            expect(result.tint).toBeLessThanOrEqual(1);
            expect(result.flash).toBeGreaterThanOrEqual(0);
            expect(result.flash).toBeLessThanOrEqual(1);
        }
    });

    it('produces no NaN for a zero-duration unit', () => {
        const result = resolveBrutInstallState(unit(10, 10), 10, NORMAL, 0, state);
        expect(Number.isFinite(result.alpha)).toBe(true);
        expect(Number.isFinite(result.tint)).toBe(true);
        expect(Number.isFinite(result.scale)).toBe(true);
    });

    it('installs instantly when the line is a micro line', () => {
        const timing = resolveBrutRevealTiming({
            rawDuration: 0.05,
            timingClass: 'micro',
            renderEndTime: 0.07,
            lineTransitionMode: 'none',
            wordRevealMode: 'instant',
        });
        const result = resolveBrutInstallState(unit(10, 10.05), 10, timing, 0, state);
        expect(result.scale).toBeCloseTo(1, 6);
        expect(result.alpha).toBe(1);
    });
});
