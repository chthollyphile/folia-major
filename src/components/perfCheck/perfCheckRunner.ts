import { HTDEMUCS_GPU_SEGMENT, SEGMENT_ADVANCE_MS, gpuModelBytes, runBeatThisGpu, runHtdemucsGpu } from '../../services/analysis/beatThisGpu';
import { requestUncappedAnimationFrame } from '../../utils/frameRateLimiter';
import { buildFixtureMel, buildFixtureSegment } from './perfCheckFixture';
import {
    buildPerfCheckLadder, frameStats, medianOf, recommendStep, stepSmooth, targetIntervalMs,
} from './perfCheckPlan';
import type {
    PerfCheckInference, PerfCheckMemory, PerfCheckReport, PerfCheckSettings, PerfCheckStepResult,
} from './perfCheckTypes';

// src/components/perfCheck/perfCheckRunner.ts
// Runs the performance check in its window: the display's refresh first, then the analysis models
// loaded and measured once (their first runs profile the GPU, gpuSlices.ts), then every step of the
// settings ladder - the picture alone, then the picture with the GPU analysis running beside it, the
// way 智能动感 and automix run it - and memory. The window draws the lyric style; this only switches
// its settings (`apply`) and counts the frames it draws.

/** After a settings change, before measuring: a renderer rebuilt for antialiasing or a new size settles. */
const SETTLE_MS = 1200;
/** The picture alone, per step. */
const PICTURE_MS = 3500;
/** The picture beside the analysis, per step. */
const ANALYSIS_MS = 4500;
/** beat_this' chunk, frames: two of them are a minute of audio. */
const BEAT_CHUNK_FRAMES = 1500;

export type PerfCheckPhase = 'warmup' | 'picture' | 'analysis';

export interface PerfCheckProgress {
    /** The step being measured (0-based); -1 while warming up. */
    step: number;
    steps: number;
    phase: PerfCheckPhase;
    settings: PerfCheckSettings;
}

export class PerfCheckCancelled extends Error {
    constructor() {
        super('performance check cancelled');
    }
}

const wait = (ms: number, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
        reject(new PerfCheckCancelled());
        return;
    }
    const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
    }, ms);
    const abort = () => {
        clearTimeout(timer);
        reject(new PerfCheckCancelled());
    };
    signal.addEventListener('abort', abort, { once: true });
});

/**
 * The intervals between the frames drawn over `ms`, through the window's own requestAnimationFrame -
 * the one the frame-rate cap gates (utils/frameRateLimiter.ts), so a capped step counts the frames the
 * picture really draws.
 */
const sampleFrames = (ms: number, signal: AbortSignal) => new Promise<number[]>((resolve, reject) => {
    const intervals: number[] = [];
    let last = 0;
    let handle = 0;
    const started = performance.now();
    const tick = (at: number) => {
        if (signal.aborted) {
            reject(new PerfCheckCancelled());
            return;
        }
        if (last) intervals.push(at - last);
        last = at;
        if (at - started >= ms) {
            resolve(intervals);
            return;
        }
        handle = window.requestAnimationFrame(tick);
    };
    handle = window.requestAnimationFrame(tick);
    signal.addEventListener('abort', () => window.cancelAnimationFrame(handle), { once: true });
});

/** The shortest of 60 uncapped frame intervals, ms: a busy picture stretches frames, never shortens them. */
const shortestFrameMs = () => new Promise<number>((resolve) => {
    const intervals: number[] = [];
    let last = 0;
    const tick = (at: number) => {
        if (last && at > last) intervals.push(at - last);
        last = at;
        if (intervals.length >= 60) resolve(Math.min(...intervals));
        else requestUncappedAnimationFrame(tick);
    };
    requestUncappedAnimationFrame(tick);
});

/**
 * The display's refresh interval, ms: what the system says of the display this window is on, unless
 * frames never come that fast here (Chromium pacing to another display's vsync, a laptop's dynamic
 * refresh reporting its top rate) - then the shortest interval seen.
 */
const measureRefreshMs = async (): Promise<number> => {
    const said = await window.electron?.getPerfCheckMetrics?.().catch(() => null);
    const seen = await shortestFrameMs();
    if (!said || said.refreshHz <= 0) return seen;
    const system = 1000 / said.refreshHz;
    return seen > system * 1.5 ? seen : system;
};

/** Chromium's heap reading, MB; null where there is none. */
const heapMb = (): number | null => {
    const memory = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
    return memory ? memory.usedJSHeapSize / 1048576 : null;
};

export interface PerfCheckRun {
    current: PerfCheckSettings;
    /** Switches the drawn picture to these settings. */
    apply: (settings: PerfCheckSettings) => void;
    onProgress: (progress: PerfCheckProgress) => void;
    signal: AbortSignal;
}

/** What 'auto' anti-aliasing is for the reference style: 凝彩 leaves it to its post-processing (on by default). */
const REFERENCE_AUTO_ANTIALIAS = false;

/** Runs the whole check; rejects with PerfCheckCancelled when `signal` aborts. */
export const runPerfCheck = async ({ current, apply, onProgress, signal }: PerfCheckRun): Promise<PerfCheckReport> => {
    const refreshMs = await measureRefreshMs();
    const ladder = buildPerfCheckLadder(current, { refreshMs, autoAntialias: REFERENCE_AUTO_ANTIALIAS });
    const segment = buildFixtureSegment(HTDEMUCS_GPU_SEGMENT);
    const mel = buildFixtureMel(BEAT_CHUNK_FRAMES);
    const chunks = [{ data: mel, frames: BEAT_CHUNK_FRAMES }, { data: mel, frames: BEAT_CHUNK_FRAMES }];
    const separate = () => runHtdemucsGpu(segment.left, segment.right, { urgency: 'background' });
    const beats = () => runBeatThisGpu(chunks);

    apply(ladder[0].settings);
    onProgress({ step: -1, steps: ladder.length, phase: 'warmup', settings: ladder[0].settings });
    await wait(SETTLE_MS, signal);
    // Loads both models and lets their first runs measure the GPU (gpuSlices.ts): not counted.
    let gpuAnalysis = (await separate()) !== null;
    if (gpuAnalysis) gpuAnalysis = (await separate()) !== null && (await separate()) !== null;
    await beats();
    await beats();

    const memory: PerfCheckMemory = { appMb: null, gpuProcessMb: null, heapMb: null, modelsMb: 0 };
    const readMemory = async () => {
        const processes = await window.electron?.getPerfCheckMetrics?.().catch(() => null);
        if (processes) {
            memory.appMb = Math.max(memory.appMb ?? 0, processes.totalMb);
            memory.gpuProcessMb = Math.max(memory.gpuProcessMb ?? 0, processes.byType.GPU ?? 0);
        }
        const heap = heapMb();
        if (heap !== null) memory.heapMb = Math.max(memory.heapMb ?? 0, heap);
        memory.modelsMb = Math.max(memory.modelsMb, gpuModelBytes() / 1048576);
    };

    const steps: PerfCheckStepResult[] = [];
    for (const [index, { settings, changes }] of ladder.entries()) {
        apply(settings);
        onProgress({ step: index, steps: ladder.length, phase: 'picture', settings });
        await wait(SETTLE_MS, signal);
        const target = targetIntervalMs(settings.frameRate, refreshMs);
        const picture = frameStats(await sampleFrames(PICTURE_MS, signal), target);

        onProgress({ step: index, steps: ladder.length, phase: 'analysis', settings });
        const segmentTimes: number[] = [];
        let beatsMs: number | null = null;
        // Ends the separation loop once the frames are counted: the segment under way finishes first.
        const stop = new AbortController();
        const separateOne = async () => {
            const at = performance.now();
            if (!(await separate())) return false;
            segmentTimes.push(performance.now() - at);
            return true;
        };
        // One segment first, whatever the time: on a slow GPU beat_this alone can outlast the stretch.
        const analysis = (async () => {
            const separating = gpuAnalysis && await separateOne();
            const started = performance.now();
            beatsMs = (await beats()) ? performance.now() - started : null;
            while (separating && !stop.signal.aborted && !signal.aborted) {
                if (!(await separateOne())) break;
            }
        })();
        let intervals: number[];
        try {
            intervals = await sampleFrames(ANALYSIS_MS, signal);
        } finally {
            stop.abort();
            await analysis;
        }
        await readMemory();
        const segmentMs = medianOf(segmentTimes);
        // A separation that runs here but failed this step reads as falling behind, not as not running.
        const inference: PerfCheckInference = {
            segmentMs,
            realtime: segmentMs ? SEGMENT_ADVANCE_MS / segmentMs : gpuAnalysis ? 0 : null,
            beatsMs,
        };
        const withAnalysis = frameStats(intervals, target);
        steps.push({ settings, changes, picture, withAnalysis, inference, smooth: stepSmooth(withAnalysis, inference) });
    }
    return { steps, memory, refreshHz: 1000 / refreshMs, recommended: recommendStep(steps), gpuAnalysis };
};
