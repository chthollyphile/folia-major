/// <reference types="@webgpu/types" />

// src/services/analysis/gpuSlices.ts
// How the WebGPU analysis runtimes (htdemucsWgsl, beatThisWgsl, percussive) cut a run into slices
// and hand them to the GPU, shared so the three pace alike.
//
// The GPU only switches work between command buffers, so a run is cut into several submits to let
// the visualizer's frames in between. Two things went wrong with cutting by what a submit took from
// submit to done (the 'auto' slicing this replaces): on Windows (Dawn on D3D12) that round trip is
// not the GPU's time but mostly the wait for the GPU process to look - about 3 ms a submit with an
// idle GPU, and 2-4 whole frames (17-25 ms at 120 Hz) while it is busy presenting the visualizer -
// so every stage looked too long, got cut one dispatch per submit, and a 3.9 s htdemucs segment
// took 3-16 s instead of ~0.1 s (a user's 2026-11-14 log, reproduced on an RTX 5070 Ti). On an M4
// the round trip is cheap and the same rule behaved.
//
// So here a slice is cut by GPU time measured with timestamp queries (each runtime profiles its
// dispatches on its first runs, `DispatchCosts`), never by the round trip; and the next slice is
// let go when the last one is done or the next display frame comes, whichever is first, with up to
// `inFlight` slices queued (`createSliceQueue`). Where completions come back promptly that is one
// slice at a time, as before; where they come back late the queue keeps the GPU fed instead of
// waiting frames for each. Results are the same whatever the cut: same dispatches, same order.

export interface SlicePacing {
    /** The GPU time a slice is cut to, ms, by the measured costs of its dispatches. */
    sliceMs: number;
    /** Slices queued on the GPU at once; 1 waits for each before the next is submitted. */
    inFlight: number;
    /** Resolves at the next display frame: with inFlight > 1 a slice is let go at it too. */
    frame?: () => Promise<void>;
}

/** The submit side of a GPUQueue, all a slice queue needs (and all a unit test has to fake). */
export interface SubmitQueue {
    submit(commandBuffers: Iterable<GPUCommandBuffer>): void;
    onSubmittedWorkDone(): Promise<void>;
}

export interface SliceQueue {
    /** Submits one slice; resolves when the next may be recorded, or with `last` when every slice is done. */
    submit(commands: GPUCommandBuffer, last?: boolean): Promise<void>;
    /** Slices submitted so far. */
    readonly slices: number;
    /** Time spent waiting in `submit`, ms. */
    readonly waitedMs: number;
    /** Each slice's submit-to-done time, ms, in order of completion. */
    readonly roundTrips: readonly number[];
}

/** One slice at a time, each waited for: what a run without pacing does. */
export const SERIAL_PACING: SlicePacing = { sliceMs: Infinity, inFlight: 1 };
/** A paced run's pacing when none is given: quarter-frame slices at 120 Hz, one at a time. */
export const DEFAULT_PACING: SlicePacing = { sliceMs: 2, inFlight: 1 };
/** A timestamp query set holds at most this many queries (WebGPU's limit): two a profiled dispatch. */
export const MAX_TIMESTAMP_QUERIES = 4096;

/**
 * Submits slices under `pacing`: with inFlight 1 each is waited for before the next; above that the
 * next is let go once the last is done or the next frame comes, while no more than inFlight are on
 * the GPU. A `last` slice waits for all of them.
 */
export const createSliceQueue = (queue: SubmitQueue, pacing: SlicePacing = SERIAL_PACING): SliceQueue => {
    const inFlight = Math.max(1, Math.floor(pacing.inFlight));
    const pending: Promise<void>[] = [];
    const roundTrips: number[] = [];
    let unfinished = 0;
    let slices = 0;
    let waitedMs = 0;
    return {
        async submit(commands, last = false) {
            const started = performance.now();
            queue.submit([commands]);
            slices += 1;
            unfinished += 1;
            const done = queue.onSubmittedWorkDone().then(() => {
                unfinished -= 1;
                roundTrips.push(performance.now() - started);
            });
            // A slice nobody awaits any more (the run threw) must not end as an unhandled rejection.
            done.catch(() => undefined);
            pending.push(done);
            try {
                if (last) {
                    await Promise.all(pending.splice(0));
                    return;
                }
                if (inFlight > 1 && pacing.frame) await Promise.race([done, pacing.frame()]);
                else if (inFlight === 1) await done;
                while (unfinished >= inFlight) await pending.shift();
            } finally {
                waitedMs += performance.now() - started;
            }
        },
        get slices() { return slices; },
        get waitedMs() { return waitedMs; },
        get roundTrips() { return roundTrips; },
    };
};

/**
 * The dispatches a new slice starts at: walking the costs in order, a slice is closed before the
 * dispatch that would take it past `sliceMs`. A dispatch longer than that is a slice of its own -
 * only splitting the kernel would get under it.
 */
export const planCuts = (costs: ArrayLike<number>, sliceMs: number): Set<number> => {
    const cuts = new Set<number>();
    let sum = 0;
    for (let index = 0; index < costs.length; index += 1) {
        const cost = costs[index];
        if (sum > 0 && sum + cost > sliceMs) {
            cuts.add(index);
            sum = 0;
        }
        sum += cost;
    }
    return cuts;
};

/** How many profiled runs a cost table averages; it is used from the first on. */
const PROFILE_RUNS = 2;

/**
 * One graph's GPU time per dispatch, from timestamp queries over its first PROFILE_RUNS runs
 * (averaged: Chromium quantises timestamps to 100 µs, so a minimum would read low). The first run
 * is cut at its stage boundaries and profiled; from the second on the table cuts, the second still
 * profiled into the average. A first table that comes back empty or broken (a driver answering
 * zeros) is given up on: the graph then stays cut at its stage boundaries. A broken later run is
 * dropped and the table kept. Runtimes keep one per graph and device (not per model instance), so a
 * model released while idle and loaded again is not profiled again.
 */
export class DispatchCosts {
    private sums: Float64Array | null = null;
    private runs = 0;
    private broken = false;
    private cuts: { sliceMs: number; at: Set<number> } | null = null;

    constructor(private readonly dispatches: number) {}

    /** Whether the next run should be profiled. */
    get wanted(): boolean {
        return !this.broken && this.runs < PROFILE_RUNS;
    }

    /** The averaged costs once ready (after one profiled run), else null. */
    get costs(): Float64Array | null {
        if (this.broken || this.runs === 0 || !this.sums) return null;
        return this.sums.map(sum => sum / this.runs);
    }

    /** Whether this graph will never get a table (timestamps unusable): cut at stage boundaries for good. */
    get unusable(): boolean {
        return this.broken;
    }

    /** One profiled run's durations, ms per dispatch in order. */
    record(durations: ArrayLike<number>): void {
        if (this.broken || this.runs >= PROFILE_RUNS) return;
        let total = 0;
        let valid = durations.length === this.dispatches;
        for (let index = 0; valid && index < durations.length; index += 1) {
            const ms = durations[index];
            if (!Number.isFinite(ms) || ms < 0) valid = false;
            total += ms;
        }
        if (!valid || total <= 0) {
            if (this.runs === 0) this.broken = true;
            return;
        }
        this.sums ??= new Float64Array(this.dispatches);
        for (let index = 0; index < durations.length; index += 1) this.sums[index] += durations[index];
        this.runs += 1;
        this.cuts = null;
    }

    /** Marks the table unusable, for a device without timestamp-query (or a graph past its query limit). */
    giveUp(): void {
        this.broken = true;
    }

    /** The dispatches a slice starts at for `sliceMs`, or null while there is no table. */
    cutsFor(sliceMs: number): Set<number> | null {
        const costs = this.costs;
        if (!costs) return null;
        if (this.cuts?.sliceMs !== sliceMs) this.cuts = { sliceMs, at: planCuts(costs, sliceMs) };
        return this.cuts.at;
    }
}

/** Durations, ms, from a resolved timestamp query set written as begin/end pairs per dispatch. */
export const durationsFromTicks = (ticks: BigInt64Array, dispatches: number): Float64Array => {
    const durations = new Float64Array(dispatches);
    for (let index = 0; index < dispatches; index += 1) durations[index] = Number(ticks[index * 2 + 1] - ticks[index * 2]) / 1e6;
    return durations;
};

/** The median of some values, 0 for none. */
export const median = (values: readonly number[]): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[sorted.length >> 1];
};

/** What one paced run reports, for the caller's log. */
export interface PacedRunStats {
    slices: number;
    /** The slice size the pacing asks for, ms of GPU. */
    sliceMs: number;
    /** Whether this run was cut by the cost table (else at its stage boundaries). */
    byCosts: boolean;
    /** Slices this run kept queued at once: 1 when it was cut at its stage boundaries. */
    inFlight: number;
    /** Slices a run cut by the cost table keeps queued at once (the pacing's). */
    pacedInFlight: number;
    /** Median submit-to-done time of the run's slices, ms. */
    roundTripMs: number;
    /**
     * With the run that completed a cost table: its dispatches, their summed and longest GPU time, and
     * the slices a run is cut into at `sliceMs` from now on.
     */
    costs?: { dispatches: number; totalMs: number; longestMs: number; slices: number };
    /** Set when this run found the timestamps unusable. */
    noTimestamps?: boolean;
}

/** The cost summary a run reports when its table has just become ready, for slices of `sliceMs`. */
export const costSummary = (costs: Float64Array, sliceMs: number): NonNullable<PacedRunStats['costs']> => {
    let total = 0;
    let longest = 0;
    for (const ms of costs) {
        total += ms;
        longest = Math.max(longest, ms);
    }
    return { dispatches: costs.length, totalMs: total, longestMs: longest, slices: planCuts(costs, sliceMs).size + 1 };
};

/**
 * A display-frame clock for a worker: `next()` resolves at the next animation frame (one shared
 * request however many wait), and `frameMs` is the shortest interval seen between consecutive
 * frames lately - the display's refresh, once a few frames have been asked for in a row. Without
 * requestAnimationFrame (a hidden page throttles it to nothing, which is fine: a slice is let go at
 * its completion as well) nothing resolves from here.
 */
export const createFrameClock = (raf: ((callback: (at: number) => void) => unknown) | undefined) => {
    let waiting: Promise<void> | null = null;
    let lastAt = 0;
    const intervals: number[] = [];
    return {
        next: (): Promise<void> => {
            const request = raf;
            if (!request) return new Promise<void>(() => undefined);
            waiting ??= new Promise<void>((resolve) => {
                try {
                    request((at) => {
                        if (lastAt && at > lastAt) {
                            intervals.push(at - lastAt);
                            if (intervals.length > 32) intervals.shift();
                        }
                        lastAt = at;
                        waiting = null;
                        resolve();
                    });
                } catch {
                    // A worker with no frame provider throws here: no frame ever comes, and the
                    // promise stays pending for good, so every slice is let go at its completion.
                    raf = undefined;
                }
            });
            return waiting;
        },
        /** The shortest recent frame interval, ms, or null before two frames in a row. */
        get frameMs(): number | null {
            return intervals.length ? Math.min(...intervals) : null;
        },
    };
};

/** The slice size for a display frame of `frameMs`: a quarter of it, within 1-4 ms of GPU. */
export const sliceMsForFrame = (frameMs: number | null): number => {
    const frame = frameMs && frameMs > 0 ? frameMs : 1000 / 120;
    return Math.min(4, Math.max(1, frame / 4));
};
