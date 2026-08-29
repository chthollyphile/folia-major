// src/services/automix/uiYield.ts
// Hands the thread back during the two scans long enough to need to.
//
// One file, not two: the budget and the yield both describe one frame of animation, so splitting
// them risks a build where they silently disagree.

/**
 * Longest either scan may hold the main thread between yields.
 *
 * In milliseconds, not frames - that is the whole fix. The old "every 512 frames" is not an amount
 * of work: one `analyseTrack` frame is a 2048-point FFT, a second FFT for the side channel, and four
 * passes over a thousand bins, so 500 of them run 50ms to several hundred depending on track and
 * machine. That is not a frame of animation, so the UI visibly stopped ~20 times per analysed track,
 * only for tracks not already profiled - exactly the "sometimes it stutters after a transition,
 * sometimes not" that was reported. 8ms is half a frame at 60Hz; checked, not counted, so it holds
 * on machines slower than the one it was chosen on.
 */
export const YIELD_BUDGET_MS = 8;

/**
 * Whether this thread has a picture on it.
 *
 * Both scans normally run in a worker now (see analysisOffThread), where every yield is pure cost:
 * nested `setTimeout(0)` clamps to ~4ms, so a four-minute track's hundreds of yields add a
 * second-plus of sleeping to a job no frame waits on. On the main thread - the fallback, and any
 * environment without workers - they are still the whole reason those functions are async. Read once
 * at module load; the answer cannot change for the life of a thread.
 */
const paints = typeof document !== 'undefined';

/** Hands the thread back for one turn, or does nothing at all where there is nothing to hand it to. */
export const yieldToUi = (): Promise<void> => (paints
    ? new Promise<void>(resolve => { setTimeout(resolve, 0); })
    : Promise.resolve());
