// src/services/analysis/gpuActivity.ts
// Whether a GPU analysis unit (beat_this, htdemucs, percussive) is running or just ran: the scheduler
// notes each unit's start and end here. Visualizers that adapt their quality to frame time (町景's
// adaptive degrade) skip the frames drawn meanwhile, so a song's analysis sharing the GPU for a few
// seconds does not read as the picture being too heavy. Kept apart from beatThisGpu.ts so that
// asking costs no import of the models.

let running = 0;
let lastEnd = Number.NEGATIVE_INFINITY;

/** Called by the scheduler when a unit starts (true) and ends (false). */
export const noteGpuAnalysisUnit = (active: boolean, at = performance.now()): void => {
    running = Math.max(0, running + (active ? 1 : -1));
    if (!active) lastEnd = at;
};

/** A unit is running, or one ended less than `settleMs` ago (the next is usually handed out right after). */
export const isGpuAnalysisActive = (now = performance.now(), settleMs = 1000): boolean => running > 0 || now - lastEnd < settleMs;
