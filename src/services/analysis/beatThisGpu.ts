// src/services/analysis/beatThisGpu.ts
// Beat This! on WebGPU in this renderer - the process that also draws the visualizer - with the CPU
// path in the analysis worker (electron/analysis/worker.cjs, MNN) as automix's fallback for everything
// this cannot take.
//
// Where it runs: a dedicated worker (workers/beatThisGpu.worker.ts) with its own device, so neither
// the upload nor the readbacks ever touch the thread that paints. The GPU itself is shared with the
// visualizer's WebGL, and the GPU only switches between command buffers, so the worker submits a
// chunk in slices and kept one slice on the GPU at a time ('auto', since replaced: below). Measured on
// an M4 Pro, a full-window WebGL2 load at 120 Hz, 10 chunks per mode (dev/beat-this-wgsl/coexist.ts):
//
//   render GPU/frame   one submit per chunk          auto slicing
//   ~2 ms              0 missed, 55 ms a chunk       0 missed, 56 ms a chunk
//   ~5 ms              8 missed, 70 ms               0 missed, 96 ms
//   ~11 ms             16 missed, 82 ms              0 missed, 144 ms
//
// So slicing costs nothing next to a light visualizer, and next to a heavy one it trades inference
// time - background work, a few hundred ms a track - for every frame. What it cannot cut is a single
// dispatch: the longest is an attention at ~3 ms here, which on a much slower GPU may still outlast
// a frame.
//
// 'auto' cut finer wherever a slice's submit-to-done outlasted 8 ms, and on Windows that time is not
// the GPU's: Dawn on D3D12 answers a submit's completion ~3 ms late with an idle GPU and 2-4 frames
// late while the visualizer presents. Every stage looked long, every run went one dispatch a submit,
// and a 3.9 s htdemucs segment took 3-16 s instead of ~0.1 s (a user's 2026-11-14 log: RTX 4060
// Laptop, minutes a track, hundreds of frames dropped a segment). Since then the runs are 'paced'
// (gpuSlices.ts): cut by each dispatch's GPU time from timestamp queries into quarter-frame slices,
// the next let go at the last one's completion or the next frame, up to four queued (one on macOS).
// Measured on an RTX 5070 Ti at 120 Hz, one htdemucs segment, dev/htdemucs-wgsl/coexist.ts:
//
//   render GPU/frame   submit to done   none      stage     auto                      paced (4 queued)
//   ~0.1 ms            0.1 ms           39 ms     -         95 ms                     50 ms, 0 missed
//   ~3.9 ms            17-25 ms         74-134    720-915   824 first, then 16-17 s   148-182 ms, 3-7% missed
//                                                                                     (idle: 18-23% missed)
//
// Weights come from the main process (the renderer cannot read the models directory) and are held,
// on the GPU and in the worker, only while in use: two idle minutes and the worker is dropped, the
// same rhythm as the analysis worker in electron/analysis/host.cjs.
//
// The same worker, device and queue run htdemucs for the beat FX's drum stem (runHtdemucsGpu, one
// 3.9 s segment a request): a third model on the one device, loaded on first use and dropped with the
// rest. A segment is ~135 ms of GPU on an M4, cut like a chunk, so a track's separation interleaves
// with beat_this requests a segment at a time instead of holding them for its whole length: a
// background request (automix) goes before the next segment once it has waited a second
// (scheduler.ts BACKGROUND_AGE_MS).
//
// Which request goes next is the scheduler's (scheduler.ts): a picture on screen is waiting for its
// beats or drum hits before automix's background profile, a request whose track was left is dropped
// before it runs, and every run's time is measured. Each request is one unit there - an htdemucs
// segment, a beat_this run over a track's chunks (about half a second), a percussive pass.
// (From the PR #750 review: "dropped before it runs" holds for 时计's drum segments only, which carry
// `stillWanted`; a beat_this or percussive request runs once submitted, whichever track is playing.)
//
// Residency (analysis service plan, phase 4): each model is released on its own once idle -
// htdemucs (350 MB on the GPU, measured on an M4: a track's segments come in a burst when it starts)
// after MODEL_IDLE_MS.htdemucs, beat_this (106 MB) after a minute - instead of both staying until the
// whole worker's two idle minutes; and a load that would take the models past GPU_BUDGET_BYTES first
// releases the least recently used other one. On Apple's unified memory this is the machine's RAM.
// The worker and its device still go after IDLE_MS with nothing loaded or run.
//
// Every failure answers null and the caller runs the chunks on the CPU instead, if it may. A failure to
// get a device at all is remembered for the session - that is the machine, not the moment - while
// a lost device or a failed run only drops this worker, and the next track tries a fresh one.

import { noteGpuAnalysisUnit } from './gpuActivity';
import type { PacedRunStats } from './gpuSlices';
import { createScheduler, watchFrames, type UnitRequest } from './scheduler';

const IDLE_MS = 120_000;
/**
 * The longest chunk the runtime takes (BEAT_THIS_WGSL_FRAMES, MODEL_CHUNK_FRAMES); shorter ones -
 * the single chunk of a track under 30 s - get a graph of their own. Written out rather than
 * imported: this module is reachable from the analysis worker through beatThis.ts, and importing
 * the runtime would put every kernel source into that bundle too.
 */
const CHUNK_FRAMES = 1500;

/**
 * Which Beat This! export a run is for: final0, shipped with the app, which automix and the beat FX
 * both run (and the CPU fallback reads). One name now - small0, which the beat FX once ran, is gone -
 * kept so the worker's messages say which model beside htdemucs.
 */
export type BeatThisModel = 'beat_this';

/** Every model the GPU worker builds: Beat This! and htdemucs. */
type GpuModel = BeatThisModel | 'htdemucs';

/**
 * The samples per channel of one htdemucs segment (HTDEMUCS_SEGMENT in htdemucsWgsl/runtime.ts),
 * written out for the same reason as CHUNK_FRAMES.
 */
export const HTDEMUCS_GPU_SEGMENT = 172032;

interface Reply {
    id: number;
    result?: unknown;
    /** A load's: the GPU memory the model holds. */
    bytes?: number;
    error?: string;
    /** On a failed load: 'device' when the machine has no usable WebGPU, 'model' when only this export failed. */
    scope?: 'device' | 'model';
}

/**
 * Per spectrogram frame: percussive and total energy (HPSS, beatThisWgsl/percussive.ts), for the beat
 * accents' `rhythmic` gate. Declared here rather than imported, for the same reason as CHUNK_FRAMES.
 */
export interface PercussiveEnergyFrames {
    percussive: Float32Array;
    total: Float32Array;
}

interface Logits {
    beat: Float32Array[];
    downbeat: Float32Array[];
    /** Present when asked for and computed; its failure does not fail the logits. */
    percussive?: PercussiveEnergyFrames;
    /** How the chunks were paced (the run that completed the cost table, else the first). */
    paced?: PacedRunStats;
}

let worker: Worker | null = null;
/** Per model: resolves once the worker has it built; absent when it must be asked for again. */
const ready = new Map<GpuModel, Promise<boolean>>();
/** Set when this machine cannot run the WebGPU path at all - no worker, adapter or device - for the session. */
let unsupported = false;
/**
 * Models whose pipelines this device would not build, for the session. Kept per model so one export
 * failing does not take the GPU from the other: htdemucs failing must not send Beat This! to the CPU.
 */
const failedModels = new Set<GpuModel>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 0;

/** What the GPU models may hold together (phase 4); both fit, with room for a short chunk's graph. */
const GPU_BUDGET_BYTES = 512 * 1024 * 1024;
/** A model's GPU memory before it has been measured here (M4, f32 htdemucs with four sources). */
const FIRST_GUESS_BYTES: Record<GpuModel, number> = { beat_this: 106 * 1024 * 1024, htdemucs: 350 * 1024 * 1024 };
/** How long a model stays loaded after its last run. */
const MODEL_IDLE_MS: Record<GpuModel, number> = { beat_this: 60_000, htdemucs: 30_000 };
/** The models loaded: their measured bytes, last use and release timer. */
const resident = new Map<GpuModel, { bytes: number; usedAt: number; timer: ReturnType<typeof setTimeout> | null }>();
/** Each model's bytes as last measured, for the budget before a load. */
const measuredBytes = new Map<GpuModel, number>();
/** The model a run is using now: never released under it. */
let inUse: GpuModel | null = null;

const megabytes = (bytes: number) => `${(bytes / 1048576).toFixed(0)} MB`;

/** Releases `model` in the worker (its device stays); the next run loads it again. */
const unload = (model: GpuModel, why: string) => {
    const entry = resident.get(model);
    if (!entry) return;
    if (entry.timer) clearTimeout(entry.timer);
    resident.delete(model);
    ready.delete(model);
    pacingLogged.delete(model);
    console.log(`[beat-this-gpu] ${model} released (${why}), ${megabytes(entry.bytes)} back`);
    if (worker) void ask({ kind: 'unload', model });
};

/** Marks `model` just used, and arms its release. */
const used = (model: GpuModel) => {
    const entry = resident.get(model);
    if (!entry) return;
    entry.usedAt = performance.now();
    if (entry.timer) clearTimeout(entry.timer);
    const arm = () => {
        entry.timer = setTimeout(() => {
            // A run that began just before: released after it instead.
            if (inUse === model) arm();
            else unload(model, `idle ${MODEL_IDLE_MS[model] / 1000}s`);
        }, MODEL_IDLE_MS[model]);
    };
    arm();
};

/**
 * A model used this recently is not released for room (found by review): where the two do not fit
 * (beat_this unpacked to f32 without shader-f16 is about twice the M4's 106 MB), a track start that
 * interleaves their units would otherwise reload one for every unit of the other. They are then
 * over the budget together for those seconds, and the idle release brings them back under it.
 */
const BUDGET_SPARES_MS = 15_000;

/** Before loading `model`: the least recently used others released until it fits the budget. */
const makeRoom = (model: GpuModel) => {
    const need = measuredBytes.get(model) ?? FIRST_GUESS_BYTES[model];
    for (;;) {
        const now = performance.now();
        const others = [...resident.entries()].filter(([name, entry]) => name !== model && name !== inUse && now - entry.usedAt >= BUDGET_SPARES_MS);
        const held = [...resident.entries()].filter(([name]) => name !== model).reduce((sum, [, entry]) => sum + entry.bytes, 0);
        if (held + need <= GPU_BUDGET_BYTES || others.length === 0) return;
        const [oldest] = others.sort((a, b) => a[1].usedAt - b[1].usedAt)[0];
        unload(oldest, `room for ${model} within ${megabytes(GPU_BUDGET_BYTES)}`);
    }
};
/**
 * Requests, one at a time and in the scheduler's order. The model has one set of activation buffers,
 * so two runs interleaving in the worker would read each other's halves; profileService already
 * serialises analysis, and this makes it true here regardless.
 */
const scheduler = createScheduler({
    isLoaded: kind => (kind === 'percussive' ? worker !== null : ready.has(kind as GpuModel)),
    frames: watchFrames(),
    onUnit: active => noteGpuAnalysisUnit(active),
});

/** Who asks for a GPU run and how urgently: the scheduler's fields bar the work itself. */
export type GpuRunOptions = Omit<UnitRequest<unknown>, 'kind' | 'run'>;

/**
 * When `units` GPU units of `kind`, asked now at `urgency`, would be done (performance.now() ms): the
 * scheduler's estimate, for choosing between the GPU and the CPU (scheduler.ts chooseExecutor).
 */
export const estimateGpuFinish = (kind: string, units: number, urgency: GpuRunOptions['urgency'], deadline?: number): number => (
    scheduler.estimateFinish(kind, units, urgency, deadline)
);

/**
 * Whether the GPU htdemucs is worth asking: false once this machine turned out to have no usable
 * WebGPU (no worker, adapter or device) or htdemucs would not build on it - for the session, as
 * runHtdemucsGpu itself decides. automix reads it to tell a GPU machine from one that only has the
 * API (automix/stems.ts).
 */
export const gpuStemsUsable = (): boolean => !unsupported && !failedModels.has('htdemucs');

/** Set while the performance check runs in its own window: this window's units wait (components/perfCheck/). */
let heldForPerfCheck = false;

/**
 * Holds this window's GPU analysis while the performance check measures the GPU from its own window
 * (true), or lets it go again (false): queued units are passed over and kept (the scheduler's
 * `paused`), and woken when released. A unit with a deadline is not held - automix's stems for a
 * transition due during the check (urgency 'background' with a deadline) still come in time.
 */
export const holdGpuAnalysis = (held: boolean): void => {
    if (heldForPerfCheck === held) return;
    heldForPerfCheck = held;
    if (!held) scheduler.wake();
};

/** A request's options with the hold above added to its own `paused`. */
const withPerfCheckHold = (options: GpuRunOptions): GpuRunOptions => ({
    ...options,
    paused: () => (heldForPerfCheck && options.deadline === undefined && options.urgency !== 'transition') || (options.paused?.() ?? false),
});

/** What the loaded GPU models hold on the graphics card now, bytes: the performance check's memory reading. */
export const gpuModelBytes = (): number => [...resident.values()].reduce((sum, entry) => sum + entry.bytes, 0);

/**
 * The audio one htdemucs segment moves a track's separation on, ms: segments overlap by a quarter
 * (stemRange.ts stemSegmentStarts), so three quarters of the 3.9 s. A segment that takes longer than
 * this runs behind the track.
 */
export const SEGMENT_ADVANCE_MS = ((HTDEMUCS_GPU_SEGMENT - Math.floor(HTDEMUCS_GPU_SEGMENT / 4)) / 44100) * 1000;
/** On-screen segments in a row slower than real time that stop the separation on screen. */
const SLOW_SEGMENTS = 3;
/** On-screen segments in a row so far that took longer than the audio they move the track on. */
let slowInARow = 0;
/** Set once this machine separated too slowly for the picture: on-screen separation stops for the session. */
let tooSlowOnScreen = false;

/**
 * Whether the GPU htdemucs may still separate for the picture (the drum hits, the voice): false
 * once it ran slower than real time SLOW_SEGMENTS segments in a row on screen. Such a machine
 * never catches up with the track, and the separation holds the GPU from the visualizer for all of
 * it (a user's 2026-11-14 log: 3-10 s a 3.9 s segment, minutes a track). automix's background stems
 * are not stopped by it.
 */
export const gpuStemsOnScreenUsable = (): boolean => gpuStemsUsable() && !tooSlowOnScreen;

/** Counts an on-screen segment's time toward the stop above, and logs the stop once. */
const noteOnScreenSegment = (ms: number) => {
    slowInARow = ms > SEGMENT_ADVANCE_MS ? slowInARow + 1 : 0;
    if (slowInARow < SLOW_SEGMENTS || tooSlowOnScreen) return;
    tooSlowOnScreen = true;
    console.warn(`[beat-this-gpu] htdemucs slower than the track here: ${SLOW_SEGMENTS} segments in a row over ${(SEGMENT_ADVANCE_MS / 1000).toFixed(1)} s each, the audio a segment moves on (the last ${(ms / 1000).toFixed(1)} s); the drum hits and the voice on screen stop for this session`);
};

/** Models whose pacing has been logged since they were loaded: one line a load. */
const pacingLogged = new Set<GpuModel>();

/**
 * Logs how a model's runs are paced on this machine, once a load: the GPU time its dispatches
 * measured (the cost table, gpuSlices.ts), the slices that cuts it into, how many are queued, and
 * how long a submit takes to come back - the numbers that tell a slow GPU from late completions.
 */
const notePacing = (model: GpuModel, paced: PacedRunStats | undefined) => {
    if (!paced || pacingLogged.has(model)) return;
    const roundTrip = `submit to done ${paced.roundTripMs.toFixed(1)} ms (median)`;
    if (paced.costs) {
        pacingLogged.add(model);
        const { dispatches, totalMs, longestMs, slices } = paced.costs;
        console.log(`[beat-this-gpu] ${model} measured: ${dispatches} dispatches, ${totalMs.toFixed(1)} ms of GPU a run (longest ${longestMs.toFixed(2)} ms); cut into ${slices} slices of up to ${paced.sliceMs.toFixed(1)} ms, ${paced.pacedInFlight} in flight; ${roundTrip}`);
    } else if (paced.noTimestamps) {
        pacingLogged.add(model);
        console.log(`[beat-this-gpu] ${model}: no GPU timestamps on this device, cut at its stage boundaries (${paced.slices} slices a run), ${paced.inFlight} in flight; ${roundTrip}`);
    }
};

/** Raises a track's queued runs: a caller on screen joined a run asked in the background. */
export const raiseGpuUrgency = (key: string, urgency: GpuRunOptions['urgency']): void => scheduler.raise(key, urgency);
const pending = new Map<number, (reply: Reply) => void>();

const drop = () => {
    const dying = worker;
    worker = null;
    ready.clear();
    for (const entry of resident.values()) if (entry.timer) clearTimeout(entry.timer);
    resident.clear();
    pacingLogged.clear();
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    for (const settle of pending.values()) settle({ id: -1, error: 'worker dropped' });
    pending.clear();
    if (!dying) return;
    // Destroy the device first so its memory goes back now; terminate regardless after a second.
    const id = (nextId += 1);
    const kill = setTimeout(() => dying.terminate(), 1000);
    dying.onmessage = (event: MessageEvent<Reply>) => {
        if (event.data.id !== id) return;
        clearTimeout(kill);
        dying.terminate();
    };
    dying.postMessage({ id, kind: 'dispose' });
};

const ask = (message: Record<string, unknown>, transfer: Transferable[] = []): Promise<Reply> => {
    const active = worker;
    if (!active) return Promise.resolve({ id: -1, error: 'no worker' });
    const id = (nextId += 1);
    return new Promise<Reply>((resolve) => {
        pending.set(id, resolve);
        active.postMessage({ ...message, id }, transfer);
    });
};

/** The worker, started if there is none; null (and `unsupported`) when this renderer cannot start one. */
const spawn = (): Worker | null => {
    if (worker) return worker;
    try {
        worker = new Worker(new URL('../../workers/beatThisGpu.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
        console.warn(`[beat-this-gpu] no worker: ${error}`);
        unsupported = true;
        return null;
    }
    worker.onmessage = (event: MessageEvent<Reply>) => {
        const settle = pending.get(event.data.id);
        if (!settle) return;
        pending.delete(event.data.id);
        settle(event.data);
    };
    worker.onerror = (event) => {
        console.warn(`[beat-this-gpu] worker error: ${event.message}`);
        drop();
    };
    return worker;
};

const start = async (model: GpuModel): Promise<boolean> => {
    const fetchWeights = model === 'htdemucs'
        ? window.electron?.getHtdemucsGpuWeights
        : window.electron?.getBeatThisGpuWeights && (() => window.electron!.getBeatThisGpuWeights!(model));
    if (typeof fetchWeights !== 'function') return false;
    // Not there only in a checkout without the models (both ship in the installer); asked again on the next track.
    makeRoom(model);
    const started = performance.now();
    const found = await fetchWeights();
    if (!found || !spawn()) return false;

    const reply = await ask({ kind: 'load', model, weights: found.weights, manifest: found.manifest }, [found.weights.buffer]);
    if (!reply.error) scheduler.noteLoad(model, performance.now() - started);
    if (reply.error) {
        // Before the first chunk: no WebGPU, no adapter, or a pipeline this device will not build.
        // None of those changes within a session - but only the first three are the machine's.
        console.warn(`[beat-this-gpu] ${model} unavailable: ${reply.error}`);
        if (reply.scope === 'model') {
            failedModels.add(model);
            ready.delete(model);
        } else {
            unsupported = true;
            drop();
        }
        return false;
    }
    const bytes = typeof reply.bytes === 'number' ? reply.bytes : FIRST_GUESS_BYTES[model];
    measuredBytes.set(model, bytes);
    resident.set(model, { bytes, usedAt: performance.now(), timer: null });
    used(model);
    console.log(`[beat-this-gpu] ${model} loaded on ${reply.result}, ${megabytes(bytes)} on the GPU`);
    return true;
};

let adapterProbe: Promise<boolean> | null = null;

/**
 * Whether this renderer can run the WebGPU path, as far as can be told without loading the model:
 * not already failed this session, and an adapter on offer. Asked by settings that depend on it
 * (智能动感模式) so they can say so instead of sitting on and inert; `navigator.gpu` alone
 * exists on machines whose GPU is blocklisted and hands out no adapter. The adapter is not kept.
 */
export const probeBeatThisGpu = (): Promise<boolean> => {
    if (unsupported) return Promise.resolve(false);
    const gpu = typeof navigator !== 'undefined'
        ? (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu
        : undefined;
    if (!gpu) return Promise.resolve(false);
    adapterProbe ??= gpu.requestAdapter().then(adapter => Boolean(adapter), () => false);
    return adapterProbe.then(found => found && !unsupported);
};

/**
 * Logits for these chunks from the WebGPU runtime, or null to have them run on the CPU.
 *
 * Null without trying when there is no WebGPU export on disk, and when this machine has already
 * failed to run it. With `percussiveOf` (the whole spectrogram the chunks were cut from), its
 * per-frame percussive energy is computed in the same run and comes back with the logits.
 */
export const runBeatThisGpu = (
    chunks: Array<{ data: Float32Array; frames: number }>,
    model: BeatThisModel = 'beat_this',
    percussiveOf?: { data: Float32Array; frames: number },
    options: GpuRunOptions = { urgency: 'background' },
): Promise<Logits | null> => {
    if (unsupported || failedModels.has(model) || typeof window === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(null);
    if (!chunks.length || chunks.some(chunk => chunk.frames < 1 || chunk.frames > CHUNK_FRAMES)) return Promise.resolve(null);
    return scheduler.submit({ ...withPerfCheckHold(options), kind: model, run: () => runNow(chunks, model, percussiveOf) });
};

/**
 * The per-frame percussive energy of a whole spectrogram on its own, for a track whose beats are
 * already stored (the accents filled in later). Needs only the device, no model. Null when this
 * machine has no usable WebGPU or the run failed.
 */
export const runPercussiveEnergyGpu = (
    mel: { data: Float32Array; frames: number },
    options: GpuRunOptions = { urgency: 'onScreen' },
): Promise<PercussiveEnergyFrames | null> => {
    if (unsupported || typeof window === 'undefined' || typeof Worker === 'undefined' || mel.frames < 1) return Promise.resolve(null);
    return scheduler.submit({ ...withPerfCheckHold(options), kind: 'percussive', run: async (): Promise<PercussiveEnergyFrames | null> => {
        if (unsupported || !spawn()) return null;
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        const data = Float32Array.from(mel.data.subarray(0, mel.frames * 128));
        const reply = await ask({ kind: 'percussive', mel: data, frames: mel.frames }, [data.buffer]);
        if (worker) idleTimer = setTimeout(drop, IDLE_MS);
        if (reply.error) {
            console.warn(`[beat-this-gpu] percussive energy unavailable: ${reply.error}`);
            if (reply.scope === 'device') {
                unsupported = true;
                drop();
            }
            return null;
        }
        return reply.result as PercussiveEnergyFrames;
    } });
};

/** The worker with `model` built on it, loading it first if need be; false when it cannot be had now. */
const ensureLoaded = async (model: GpuModel): Promise<boolean> => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    let loading = ready.get(model);
    if (!loading) {
        loading = start(model);
        ready.set(model, loading);
    }
    // A start that threw or failed is not kept, or every later run would rethrow or repeat it.
    if (!(await loading.catch(() => false))) {
        if (ready.get(model) === loading) ready.delete(model);
        return false;
    }
    return true;
};

/** One stereo stem of one segment. */
export interface StemChannels { left: Float32Array; right: Float32Array }
/**
 * One segment's four stems, in htdemucs' order (HTDEMUCS_SOURCES: drums, bass, other, vocals); `left`
 * and `right` are the drums', as before the four.
 */
export interface HtdemucsGpuSegment extends StemChannels { stems: StemChannels[] }

/**
 * One htdemucs segment's drum stem from the WebGPU runtime: `left` and `right` of exactly
 * HTDEMUCS_GPU_SEGMENT samples at 44.1 kHz in, the drums' two channels out. Null when htdemucs_gpu is
 * not installed, this machine cannot run it, or the run failed - there is no CPU path behind this.
 * Since the analysis service's phase 3 all four stems come back (`stems`), for automix.
 */
export const runHtdemucsGpu = (
    left: Float32Array,
    right: Float32Array,
    options: GpuRunOptions = { urgency: 'onScreen' },
): Promise<HtdemucsGpuSegment | null> => {
    if (unsupported || failedModels.has('htdemucs') || typeof window === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(null);
    if (tooSlowOnScreen && options.urgency === 'onScreen') return Promise.resolve(null);
    if (left.length !== HTDEMUCS_GPU_SEGMENT || right.length !== HTDEMUCS_GPU_SEGMENT) return Promise.resolve(null);
    return scheduler.submit({ ...withPerfCheckHold(options), kind: 'htdemucs', run: async () => {
        if (unsupported || failedModels.has('htdemucs') || !(await ensureLoaded('htdemucs'))) return null;
        // Copied, not transferred: the caller still owns the track it cut these from.
        const l = Float32Array.from(left);
        const r = Float32Array.from(right);
        inUse = 'htdemucs';
        const started = performance.now();
        const reply = await ask({ kind: 'separate', left: l, right: r }, [l.buffer, r.buffer]).finally(() => { inUse = null; });
        const took = performance.now() - started;
        used('htdemucs');
        if (reply.error) {
            console.warn(`[beat-this-gpu] htdemucs run failed: ${reply.error}`);
            drop();
            return null;
        }
        if (worker) idleTimer = setTimeout(drop, IDLE_MS);
        const { stems, paced } = reply.result as { stems: StemChannels[]; paced?: PacedRunStats };
        notePacing('htdemucs', paced);
        if (options.urgency === 'onScreen') noteOnScreenSegment(took);
        return { left: stems[0].left, right: stems[0].right, stems };
    } });
};

const runNow = async (
    chunks: Array<{ data: Float32Array; frames: number }>,
    model: BeatThisModel,
    percussiveOf?: { data: Float32Array; frames: number },
): Promise<Logits | null> => {
    if (unsupported || failedModels.has(model)) return null;
    if (!(await ensureLoaded(model))) return null;
    // Copied, not transferred: the caller still owns the spectrogram it chunked.
    const data = chunks.map(chunk => Float32Array.from(chunk.data.subarray(0, chunk.frames * 128)));
    const percussive = percussiveOf
        ? { mel: Float32Array.from(percussiveOf.data.subarray(0, percussiveOf.frames * 128)), frames: percussiveOf.frames }
        : undefined;
    inUse = model;
    const reply = await ask(
        { kind: 'run', model, chunks: data, percussive },
        [...data.map(chunk => chunk.buffer), ...(percussive ? [percussive.mel.buffer] : [])],
    ).finally(() => { inUse = null; });
    used(model);
    if (reply.error) {
        console.warn(`[beat-this-gpu] run failed, falling back to the CPU for this track: ${reply.error}`);
        drop();
        return null;
    }
    if (worker) idleTimer = setTimeout(drop, IDLE_MS);
    const logits = reply.result as Logits;
    notePacing(model, logits.paced);
    return logits.beat.length === chunks.length ? logits : null;
};
