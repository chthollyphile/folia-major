import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/gpuActivity.test.ts
// Whether a GPU analysis unit is running or just ran (gpuActivity.ts): true while any unit runs, and
// for the settle window after the last one ends, so 町景's adaptive degrade skips those frames.

type GpuActivity = typeof import('@/services/analysis/gpuActivity');
let activity: GpuActivity;

// The count lives in the module: a fresh copy per test.
beforeEach(async () => {
    vi.resetModules();
    activity = await import('@/services/analysis/gpuActivity');
});

describe('isGpuAnalysisActive', () => {
    it('is false before any unit ran', () => {
        expect(activity.isGpuAnalysisActive(0)).toBe(false);
        expect(activity.isGpuAnalysisActive(1_000_000)).toBe(false);
    });

    it('stays true for the settle window after the count reaches zero, then turns false', () => {
        activity.noteGpuAnalysisUnit(true, 1000);
        expect(activity.isGpuAnalysisActive(1500)).toBe(true);
        activity.noteGpuAnalysisUnit(false, 2000);
        expect(activity.isGpuAnalysisActive(2000)).toBe(true);
        expect(activity.isGpuAnalysisActive(2999)).toBe(true);
        expect(activity.isGpuAnalysisActive(3000)).toBe(false);
        // The window is the caller's to pick.
        expect(activity.isGpuAnalysisActive(2400, 300)).toBe(false);
        expect(activity.isGpuAnalysisActive(2200, 300)).toBe(true);
    });

    it('counts the settle window only from the end of the last of several units', () => {
        activity.noteGpuAnalysisUnit(true, 0);
        activity.noteGpuAnalysisUnit(true, 100);
        // One of two ended: the other still runs, however long after.
        activity.noteGpuAnalysisUnit(false, 1000);
        expect(activity.isGpuAnalysisActive(5000)).toBe(true);
        expect(activity.isGpuAnalysisActive(10_000)).toBe(true);
        activity.noteGpuAnalysisUnit(false, 10_000);
        expect(activity.isGpuAnalysisActive(10_999)).toBe(true);
        expect(activity.isGpuAnalysisActive(11_000)).toBe(false);
    });
});
