import type { PerfCheckFrames, PerfCheckInference, PerfCheckSettings, PerfCheckStepResult } from './perfCheckTypes';

// src/components/perfCheck/perfCheckPlan.ts
// The performance check's arithmetic, kept apart from the window so it can be tested: which settings
// it tries in what order, the frame statistics of a measured stretch, when a step counts as smooth,
// and which step it recommends.

/**
 * The frame interval a step aims at, ms. Uncapped, the display's refresh. Capped, what the cap really
 * draws at (utils/frameRateLimiter.ts): a frame goes once at least 1000/cap - 1 ms have passed, so
 * on a display whose refresh does not divide the cap the cadence is a whole number of refreshes -
 * 60 on 144 Hz draws every third refresh, 48 fps.
 */
export const targetIntervalMs = (frameRate: PerfCheckSettings['frameRate'], refreshMs: number): number => {
    if (frameRate === 'off') return refreshMs;
    const refreshes = Math.max(1, Math.ceil((1000 / frameRate - 1) / refreshMs - 1e-6));
    return refreshes * refreshMs;
};

/** What the ladder needs to know of the display and the reference style to leave out steps that change nothing. */
export interface PerfCheckLadderContext {
    refreshMs: number;
    /** What 'auto' anti-aliasing is for the reference style (凝彩: off, its post-processing does it). */
    autoAntialias: boolean;
}

/**
 * The settings the check tries, cheapest change first: the user's own, then each step giving up a
 * little more - antialiasing off, the canvas at 0.75, the frame rate capped at 60, the canvas at 0.5 -
 * each on top of the ones before. A step that would draw the same as the one before is left out: the
 * setting already there or lower, anti-aliasing already off for the reference style, a cap of 60 on a
 * display that draws no faster.
 */
export const buildPerfCheckLadder = (
    current: PerfCheckSettings,
    { refreshMs, autoAntialias }: PerfCheckLadderContext,
): { settings: PerfCheckSettings; changes: (keyof PerfCheckSettings)[] }[] => {
    const steps: { settings: PerfCheckSettings; changes: (keyof PerfCheckSettings)[] }[] = [{ settings: current, changes: [] }];
    const next = (patch: Partial<PerfCheckSettings>) => {
        const last = steps[steps.length - 1].settings;
        const changes = (Object.keys(patch) as (keyof PerfCheckSettings)[]).filter(key => patch[key] !== last[key]);
        if (changes.length) steps.push({ settings: { ...last, ...patch }, changes });
    };
    const antialiased = current.antialias === 'on' || (current.antialias === 'auto' && autoAntialias);
    if (antialiased) next({ antialias: 'off' });
    if (current.scale > 0.75) next({ scale: 0.75 });
    if (targetIntervalMs(60, refreshMs) > targetIntervalMs(current.frameRate, refreshMs) + 0.5) next({ frameRate: 60 });
    if (steps[steps.length - 1].settings.scale > 0.5) next({ scale: 0.5 });
    return steps;
};

/** Frame statistics of the intervals between drawn frames, against a target interval. */
export const frameStats = (intervals: readonly number[], targetMs: number): PerfCheckFrames => {
    const targetFps = 1000 / targetMs;
    if (!intervals.length) return { fps: 0, lowFps: 0, droppedShare: 1, targetFps };
    const total = intervals.reduce((sum, ms) => sum + ms, 0);
    const sorted = [...intervals].sort((a, b) => a - b);
    // The 1% low: the frame rate the slowest 1% of frames come at (at least one frame).
    const slowest = sorted.slice(Math.floor(sorted.length * 0.99));
    const slowMean = slowest.reduce((sum, ms) => sum + ms, 0) / slowest.length;
    const dropped = intervals.filter(ms => ms > targetMs * 1.5).length;
    return {
        fps: (intervals.length * 1000) / total,
        lowFps: 1000 / slowMean,
        droppedShare: dropped / intervals.length,
        targetFps,
    };
};

/** Smooth: within a tenth of the target frame rate, and no more than 5% of frames late. */
export const framesSmooth = (frames: PerfCheckFrames): boolean => (
    frames.fps >= frames.targetFps * 0.9 && frames.droppedShare <= 0.05
);

/** The separation keeps up with a playing track (or did not run at all, which costs no frames either). */
export const inferenceKeepsUp = (inference: PerfCheckInference): boolean => (
    inference.realtime === null || inference.realtime >= 1
);

/** A step is smooth when the picture keeps its frame rate with the analysis running and the analysis keeps up. */
export const stepSmooth = (withAnalysis: PerfCheckFrames, inference: PerfCheckInference): boolean => (
    framesSmooth(withAnalysis) && inferenceKeepsUp(inference)
);

/**
 * The step to recommend: the first smooth one (the least given up), else the one whose picture
 * comes closest to its target with the analysis running.
 */
export const recommendStep = (steps: readonly Pick<PerfCheckStepResult, 'smooth' | 'withAnalysis'>[]): number => {
    const smooth = steps.findIndex(step => step.smooth);
    if (smooth >= 0) return smooth;
    let best = 0;
    steps.forEach((step, index) => {
        const ratio = (frames: PerfCheckFrames) => frames.fps / frames.targetFps;
        if (ratio(step.withAnalysis) > ratio(steps[best].withAnalysis)) best = index;
    });
    return best;
};

/** The median of some values, null for none. */
export const medianOf = (values: readonly number[]): number | null => {
    if (!values.length) return null;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
};

export type PerfCheckRating = 'smooth' | 'fair' | 'poor' | 'behind';

/**
 * A step in one word for the results: smooth; behind when the picture is smooth but the analysis
 * does not keep up with playback (the analysis gives way to the picture, so this is common on a
 * busy GPU); fair when the picture keeps three quarters of its target; poor otherwise.
 */
export const rateStep = (step: Pick<PerfCheckStepResult, 'smooth' | 'withAnalysis' | 'inference'>): PerfCheckRating => {
    if (step.smooth) return 'smooth';
    if (framesSmooth(step.withAnalysis)) return 'behind';
    return step.withAnalysis.fps >= step.withAnalysis.targetFps * 0.75 ? 'fair' : 'poor';
};
