import { describe, expect, it } from 'vitest';
import {
    createBrutInstallState,
    createBrutSlabState,
    resolveBrutIgniteDuration,
    resolveBrutInstallState,
    resolveBrutRevealTiming,
    resolveBrutSlabState,
} from '@/components/visualizer/brut/brutInstallMotion';
import type { BrutInstallUnit } from '@/components/visualizer/brut/brutLyricUnits';

// test/unit/visualizer/brutInstallMotion.test.ts
// The slab and ignition curves are pure functions of absolute time - that is what makes seeking
// free, because there is no animation state to reset, the curve evaluates to the terminal pose.

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

const MICRO = resolveBrutRevealTiming({
    rawDuration: 0.05,
    timingClass: 'micro',
    renderEndTime: 0.07,
    lineTransitionMode: 'none',
    wordRevealMode: 'instant',
});

describe('resolveBrutRevealTiming', () => {
    it('collapses micro lines to an instant reveal', () => {
        expect(MICRO.instant).toBe(true);
        expect(resolveBrutIgniteDuration(unit(0, 0.05), MICRO)).toBe(0);
    });

    it('compresses short lines without making them instant', () => {
        const fast = resolveBrutRevealTiming({
            rawDuration: 0.15,
            timingClass: 'short',
            renderEndTime: 0.2,
            lineTransitionMode: 'fast',
            wordRevealMode: 'fast',
        });
        expect(fast.instant).toBe(false);
        expect(fast.lead).toBeLessThan(NORMAL.lead);
        expect(fast.emerge).toBeLessThan(NORMAL.emerge);
        expect(resolveBrutIgniteDuration(unit(0, 1), fast))
            .toBeLessThan(resolveBrutIgniteDuration(unit(0, 1), NORMAL));
    });

    it('falls back to the normal curve without hints', () => {
        expect(resolveBrutRevealTiming(null)).toEqual(NORMAL);
    });
});

describe('resolveBrutSlabState', () => {
    const state = createBrutSlabState();

    it('keeps the slab inside the wall until its lead-in', () => {
        expect(resolveBrutSlabState(unit(10, 10.4), 5, NORMAL, state).visible).toBe(false);
        expect(state.extend).toBe(0);
    });

    it('is fully extruded before its token arrives', () => {
        const result = resolveBrutSlabState(unit(10, 10.4), 10 - NORMAL.lead, NORMAL, state);
        expect(result.visible).toBe(true);
        expect(result.extend).toBeCloseTo(1, 6);
    });

    it('grows monotonically and stays bounded', () => {
        let previous = 0;
        for (let time = 9; time < 10.5; time += 0.01) {
            const { extend } = resolveBrutSlabState(unit(10, 10.4), time, NORMAL, state);
            expect(extend).toBeGreaterThanOrEqual(0);
            expect(extend).toBeLessThanOrEqual(1);
            expect(extend).toBeGreaterThanOrEqual(previous - 1e-9);
            previous = extend;
        }
    });

    it('is already out for a micro line', () => {
        expect(resolveBrutSlabState(unit(10, 10.05), 10, MICRO, state).extend).toBeCloseTo(1, 6);
    });
});

describe('resolveBrutInstallState', () => {
    const state = createBrutInstallState();

    it('stays dark until its own word starts', () => {
        const result = resolveBrutInstallState(unit(10, 10.4), 9.99, NORMAL, state);
        expect(result.visible).toBe(false);
        expect(result.alpha).toBe(0);
        expect(result.ignite).toBe(0);
    });

    it('reaches the terminal pose long after ignition, so a seek needs no reset', () => {
        const result = resolveBrutInstallState(unit(10, 10.4), 400, NORMAL, state);
        expect(result.visible).toBe(true);
        expect(result.alpha).toBe(1);
        expect(result.ignite).toBe(1);
        expect(result.scale).toBeCloseTo(1, 6);
        expect(result.tint).toBe(1);
        expect(result.flash).toBe(0);
    });

    it('peaks its flash at the moment the word starts', () => {
        const onset = resolveBrutInstallState(unit(10, 10.4), 10, NORMAL, state).flash;
        const later = resolveBrutInstallState(unit(10, 10.4), 10.15, NORMAL, state).flash;
        expect(onset).toBeCloseTo(1, 6);
        expect(later).toBeLessThan(onset);
    });

    it('keeps every output bounded and finite across the whole curve', () => {
        for (let time = 9.5; time < 11.5; time += 0.01) {
            const result = resolveBrutInstallState(unit(10, 10.4), time, NORMAL, state);
            expect(Number.isFinite(result.scale)).toBe(true);
            expect(result.alpha).toBeGreaterThanOrEqual(0);
            expect(result.alpha).toBeLessThanOrEqual(1);
            expect(result.ignite).toBeGreaterThanOrEqual(0);
            expect(result.ignite).toBeLessThanOrEqual(1);
            expect(result.tint).toBeGreaterThanOrEqual(0);
            expect(result.tint).toBeLessThanOrEqual(1);
            expect(result.flash).toBeGreaterThanOrEqual(0);
            expect(result.flash).toBeLessThanOrEqual(1);
        }
    });

    it('produces no NaN for a zero-duration unit', () => {
        const result = resolveBrutInstallState(unit(10, 10), 10, NORMAL, state);
        expect(Number.isFinite(result.alpha)).toBe(true);
        expect(Number.isFinite(result.tint)).toBe(true);
        expect(Number.isFinite(result.scale)).toBe(true);
    });

    it('lights a micro line immediately', () => {
        const result = resolveBrutInstallState(unit(10, 10.05), 10, MICRO, state);
        expect(result.ignite).toBe(1);
        expect(result.alpha).toBe(1);
    });
});
