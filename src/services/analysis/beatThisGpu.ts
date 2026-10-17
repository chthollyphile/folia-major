// src/services/analysis/beatThisGpu.ts
// Beat This! on WebGPU in this renderer - the process that also draws the visualizer - with the CPU
// path in the analysis worker (electron/analysis/worker.cjs, MNN) as automix's fallback for everything
// this cannot take.
//
// Where it runs: a dedicated worker (workers/beatThisGpu.worker.ts) with its own device, so neither
// the upload nor the readbacks ever touch the thread that paints. The GPU itself is shared with the
// visualizer's WebGL, and the GPU only switches between command buffers, so the worker submits a
// chunk in slices and keeps one slice on the GPU at a time ('auto' in BeatThisWgsl.run). Measured on
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
// Weights come from the main process (the renderer cannot read the models directory) and are held,
// on the GPU and in the worker, only while in use: two idle minutes and the worker is dropped, the
// same rhythm as the analysis worker in electron/analysis/host.cjs.
//
// The same worker, device and queue run htdemucs for the beat FX's drum stem (runHtdemucsGpu, one
// 3.9 s segment a request): a third model on the one device, loaded on first use and dropped with the
// rest. A segment is ~135 ms of GPU on an M4, cut like a chunk, so a track's separation interleaves
// with beat_this requests a segment at a time instead of holding them for its whole length.
//
// Every failure answers null and the caller runs the chunks on the CPU instead, if it may. A failure to
// get a device at all is remembered for the session - that is the machine, not the moment - while
// a lost device or a failed run only drops this worker, and the next track tries a fresh one.

const IDLE_MS = 120_000;
/**
 * The longest chunk the runtime takes (BEAT_THIS_WGSL_FRAMES, MODEL_CHUNK_FRAMES); shorter ones -
 * the single chunk of a track under 30 s - get a graph of their own. Written out rather than
 * imported: this module is reachable from the analysis worker through beatThis.ts, and importing
 * the runtime would put every kernel source into that bundle too.
 */
const CHUNK_FRAMES = 1500;

/**
 * Which export a run is for: final0, automix's download (and the CPU fallback's), or small0, bundled
 * with the app for the beat FX. Same kernels, different widths. The worker builds each on its one
 * device the first time it is asked for and keeps both until the idle drop: with both features on, a
 * track change asks for small0 and automix's look-ahead for final0, and reloading on every switch
 * would re-read 41MB and rebuild every pipeline beside the visualizer for nothing.
 */
export type BeatThisModel = 'beat_this' | 'beat_this_small';

/** Every model the GPU worker builds: the two Beat This! exports and htdemucs. */
type GpuModel = BeatThisModel | 'htdemucs';

/**
 * The samples per channel of one htdemucs segment (HTDEMUCS_SEGMENT in htdemucsWgsl/runtime.ts),
 * written out for the same reason as CHUNK_FRAMES.
 */
export const HTDEMUCS_GPU_SEGMENT = 172032;

interface Reply {
    id: number;
    result?: unknown;
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
}

let worker: Worker | null = null;
/** Per model: resolves once the worker has it built; absent when it must be asked for again. */
const ready = new Map<GpuModel, Promise<boolean>>();
/** Set when this machine cannot run the WebGPU path at all - no worker, adapter or device - for the session. */
let unsupported = false;
/**
 * Models whose pipelines this device would not build, for the session. Kept per model so one export
 * failing does not take the GPU from the other: small0 failing must not send automix to the CPU.
 */
const failedModels = new Set<GpuModel>();
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextId = 0;
/**
 * Requests, one at a time. The model has one set of activation buffers, so two runs interleaving
 * in the worker would read each other's halves; profileService already serialises analysis, and
 * this makes it true here regardless.
 */
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<number, (reply: Reply) => void>();

const drop = () => {
    const dying = worker;
    worker = null;
    ready.clear();
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
    // Not there is the ordinary state until final0 (or htdemucs_gpu) is downloaded; asked again on the next track.
    const found = await fetchWeights();
    if (!found || !spawn()) return false;

    const reply = await ask({ kind: 'load', model, weights: found.weights, manifest: found.manifest }, [found.weights.buffer]);
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
    console.log(`[beat-this-gpu] ${model} loaded on ${reply.result}`);
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
): Promise<Logits | null> => {
    if (unsupported || failedModels.has(model) || typeof window === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(null);
    if (!chunks.length || chunks.some(chunk => chunk.frames < 1 || chunk.frames > CHUNK_FRAMES)) return Promise.resolve(null);
    const run = queue.then(() => runNow(chunks, model, percussiveOf));
    queue = run.catch(() => null);
    return run;
};

/**
 * The per-frame percussive energy of a whole spectrogram on its own, for a track whose beats are
 * already stored (the accents filled in later). Needs only the device, no model. Null when this
 * machine has no usable WebGPU or the run failed.
 */
export const runPercussiveEnergyGpu = (mel: { data: Float32Array; frames: number }): Promise<PercussiveEnergyFrames | null> => {
    if (unsupported || typeof window === 'undefined' || typeof Worker === 'undefined' || mel.frames < 1) return Promise.resolve(null);
    const run = queue.then(async (): Promise<PercussiveEnergyFrames | null> => {
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
    });
    queue = run.catch(() => null);
    return run;
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

/**
 * One htdemucs segment's drum stem from the WebGPU runtime: `left` and `right` of exactly
 * HTDEMUCS_GPU_SEGMENT samples at 44.1 kHz in, the drums' two channels out. Null when htdemucs_gpu is
 * not installed, this machine cannot run it, or the run failed - there is no CPU path behind this.
 */
export const runHtdemucsGpu = (left: Float32Array, right: Float32Array): Promise<{ left: Float32Array; right: Float32Array } | null> => {
    if (unsupported || failedModels.has('htdemucs') || typeof window === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(null);
    if (left.length !== HTDEMUCS_GPU_SEGMENT || right.length !== HTDEMUCS_GPU_SEGMENT) return Promise.resolve(null);
    const run = queue.then(async () => {
        if (unsupported || failedModels.has('htdemucs') || !(await ensureLoaded('htdemucs'))) return null;
        // Copied, not transferred: the caller still owns the track it cut these from.
        const l = Float32Array.from(left);
        const r = Float32Array.from(right);
        const reply = await ask({ kind: 'separate', left: l, right: r }, [l.buffer, r.buffer]);
        if (reply.error) {
            console.warn(`[beat-this-gpu] htdemucs run failed: ${reply.error}`);
            drop();
            return null;
        }
        if (worker) idleTimer = setTimeout(drop, IDLE_MS);
        return reply.result as { left: Float32Array; right: Float32Array };
    });
    queue = run.catch(() => null);
    return run;
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
    const reply = await ask(
        { kind: 'run', model, chunks: data, percussive },
        [...data.map(chunk => chunk.buffer), ...(percussive ? [percussive.mel.buffer] : [])],
    );
    if (reply.error) {
        console.warn(`[beat-this-gpu] run failed, falling back to the CPU for this track: ${reply.error}`);
        drop();
        return null;
    }
    if (worker) idleTimer = setTimeout(drop, IDLE_MS);
    const logits = reply.result as Logits;
    return logits.beat.length === chunks.length ? logits : null;
};
