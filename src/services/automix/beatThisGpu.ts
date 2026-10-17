// src/services/automix/beatThisGpu.ts
// Beat This! on WebGPU in this renderer - the process that also draws the visualizer - with the
// onnxruntime path in the main process as the fallback for everything this cannot take.
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
// same rhythm as the onnxruntime worker in electron/analysis/host.cjs.
//
// Every failure answers null and the caller runs the chunks over onnxruntime instead. A failure to
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

interface Reply {
    id: number;
    result?: unknown;
    error?: string;
}

interface Logits { beat: Float32Array[]; downbeat: Float32Array[] }

let worker: Worker | null = null;
/** Resolves once the worker has its model; null when there is none and this must be asked again. */
let ready: Promise<boolean> | null = null;
/** Set when this machine cannot run the WebGPU path at all; for the rest of the session. */
let unsupported = false;
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
    ready = null;
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

const start = async (): Promise<boolean> => {
    const fetchWeights = window.electron?.getBeatThisGpuWeights;
    if (typeof fetchWeights !== 'function') return false;
    // Not there is the ordinary state until the export is downloaded; asked again on the next track.
    const found = await fetchWeights();
    if (!found) return false;

    try {
        worker = new Worker(new URL('../../workers/beatThisGpu.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
        console.warn(`[beat-this-gpu] no worker: ${error}`);
        unsupported = true;
        return false;
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

    const reply = await ask({ kind: 'load', weights: found.weights, manifest: found.manifest }, [found.weights.buffer]);
    if (reply.error) {
        // Before the first chunk: no WebGPU, no adapter, or a pipeline this device will not build.
        // None of those changes within a session.
        console.warn(`[beat-this-gpu] unavailable, using onnxruntime: ${reply.error}`);
        unsupported = true;
        drop();
        return false;
    }
    console.log(`[beat-this-gpu] loaded on ${reply.result}`);
    return true;
};

/**
 * Logits for these chunks from the WebGPU runtime, or null to have them run over onnxruntime.
 *
 * Null without trying when there is no WebGPU export on disk, and when this machine has already
 * failed to run it.
 */
export const runBeatThisGpu = (chunks: Array<{ data: Float32Array; frames: number }>): Promise<Logits | null> => {
    if (unsupported || typeof window === 'undefined' || typeof Worker === 'undefined') return Promise.resolve(null);
    if (!chunks.length || chunks.some(chunk => chunk.frames < 1 || chunk.frames > CHUNK_FRAMES)) return Promise.resolve(null);
    const run = queue.then(() => runNow(chunks));
    queue = run.catch(() => null);
    return run;
};

const runNow = async (chunks: Array<{ data: Float32Array; frames: number }>): Promise<Logits | null> => {
    if (unsupported) return null;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    ready ??= start();
    if (!(await ready)) {
        ready = null;
        return null;
    }
    // Copied, not transferred: the caller still owns the spectrogram it chunked.
    const data = chunks.map(chunk => Float32Array.from(chunk.data.subarray(0, chunk.frames * 128)));
    const reply = await ask({ kind: 'run', chunks: data }, data.map(chunk => chunk.buffer));
    if (reply.error) {
        console.warn(`[beat-this-gpu] run failed, using onnxruntime for this track: ${reply.error}`);
        drop();
        return null;
    }
    if (worker) idleTimer = setTimeout(drop, IDLE_MS);
    const logits = reply.result as Logits;
    return logits.beat.length === chunks.length ? logits : null;
};
