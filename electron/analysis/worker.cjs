const { resolveModelFile } = require('./modelPaths.cjs');
const mnn = require('./mnn.cjs');
const htdemucs = require('./htdemucs.cjs');
const fs = require('fs');
const os = require('os');

// electron/analysis/worker.cjs
// Both analysis models on the CPU, in a process that owns no window.
//
// This file exists because of one measured fact about onnxruntime-node, the runtime that used to be
// here: its `run()` LOOKS async and is not. The JS wrapper was `new Promise(resolve => setImmediate(()
// => resolve(session.run(...))))`, and `session.run` there a synchronous N-API call - so `setImmediate`
// only decided which tick the block started on, never that it was a block. Measured with a 10ms
// interval timer around one htdemucs segment: 1 tick fired where 150 were due, and 0 of 361 during the
// model load.
//
// In the main process that is fatal rather than slow. The main process owns the window's message loop and
// every ipcMain handler, so a blocked event loop is a window Windows paints as "not responding" and a
// renderer whose every `invoke` is queued behind the transformer. A 30s window is six segments, a
// transition needs two windows, and the session reloads between tracks: about twenty seconds of frozen UI
// per track, the symptom that sent us looking.
//
// So the models live here, reached over `utilityProcess`. Nothing in this file may require 'electron' -
// it is plain Node, and the model directories arrive as argv.
//
// The runtime is MNN now (mnn.cjs), compiled into one library that ships with the app: no onnxruntime,
// no downloaded Python, no second process per separation. Its `run` IS async - koffi runs the call on a
// thread of its own, measured ~90% of 10ms ticks firing through a separation - so the reason above no
// longer bites here; the process stays because the rule it encodes (no model in the process that owns
// the window) still holds.
//
// What runs here:
//   - htdemucs. Loaded on first use and KEPT while automix is switched on, released in this process
//     when the host says automix was switched off - see `release` below.
//   - beat_this, only as the CPU fallback for automix's beat grid. The renderer runs it on its own GPU
//     first (src/services/automix/beatThisGpu.ts); what reaches this file is what that could not take.

/**
 * Every directory a model may live in, best first: the user's own folder, then what the app
 * downloaded, then what the installer shipped. Handed over as argv by host.cjs, because nothing in
 * this file may require 'electron' to ask.
 */
const MODEL_DIRS = process.argv.slice(2);

/**
 * How many cores beat_this may use.
 *
 * Not a timidity knob - more was measured to be SLOWER. On onnxruntime, whose default was one thread per
 * logical core, this 24-core machine ran an htdemucs segment in 3547ms against 1438ms at twelve threads:
 * the pool spent its time contending with itself. Measured, per segment:
 *
 *   default(24)  3547ms  51% of the machine        4  1873ms  32%
 *   12           1438ms  66%                       2  2908ms  19%
 *   6            1602ms  42%
 *
 * A quarter of the cores, because the number that matters is the FRACTION of the machine left for the
 * renderer's frames and the audio thread, and that fraction should not depend on how big the machine is.
 */
const THREADS = Math.max(1, Math.floor(os.cpus().length / 4));

/**
 * How many cores htdemucs may use: four, what the Python runner it replaced ran with
 * (htdemucs_runner.py's intra_op_num_threads), so a separation costs the machine what it did before.
 * At four, MNN with the FoliaDConv operator separates a 30s window in 3.2-3.6s on an M4 against the
 * runner's 3.7-4.1s; separation has minutes of lead time, it needs to be invisible, not fast.
 */
const HTDEMUCS_THREADS = 4;

/**
 * htdemucs, once loaded: `{ model, file }`, or null.
 *
 * Kept for as long as automix is switched on, however long the gap between tracks. A reload is a 190MB
 * read and a second or more, asked for the moment a track starts; holding ~200MB while the feature that
 * needs it is on is the trade the listener made by switching it on. Switching it off is what gives the
 * memory back - the host sends 'release' and `release` below frees it in this process.
 */
let stems = null;

/**
 * A request this worker will not run, said out loud.
 *
 * Every guard below used to answer a bare null. Loading failures are logged where they happen, and a
 * finished run logs its duration, so the ONLY outcome that printed nothing was "the payload was not
 * something I can run" - exactly the outcome a caller cannot see either, because both renderer modules
 * read null as "this build has no models" and stop asking. Not hypothetical: the stem gesture ran zero
 * times between shipping and being noticed, invisible for the whole of it.
 */
const decline = (kind, why) => {
    console.warn(`[${kind}] declined: ${why}`);
    return null;
};

const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

// ---------------------------------------------------------------------------- Beat This!
//
// Everything that can be reasoned about without a model - the spectrogram, the chunking, the peak
// picking - lives in src/services/automix/beatThis.ts where the unit tests can reach it. What is
// here is the CPU run of the same export the renderer's GPU path reads, and nothing else.

/** Frames the model accepts in one call; longer is cut into chunks by the renderer. */
const MAX_CHUNK_FRAMES = 1500;
const MEL_BANDS = 128;

/**
 * Loaded per request and released at its end, unlike htdemucs. This is a fallback for a machine whose
 * GPU could not take the request, it is built in about a second from a 41MB file, and while loaded it
 * holds several hundred MB planned for the largest chunk - memory nothing would use between tracks.
 */
const runBeatThis = async (chunks) => {
    if (!Array.isArray(chunks) || !chunks.length) return decline('beat-this', 'no spectrogram chunks in the request');
    for (const chunk of chunks) {
        const frames = Number(chunk?.frames);
        // The renderer is trusted, but a shape mismatch here is a native crash rather than an
        // exception - so the one thing that would cause it is checked rather than assumed.
        if (!Number.isInteger(frames) || frames <= 0 || frames > MAX_CHUNK_FRAMES) {
            return decline('beat-this', `chunk of ${frames} frames, outside 1..${MAX_CHUNK_FRAMES}`);
        }
        if (!chunk.data || chunk.data.length !== frames * MEL_BANDS) {
            return decline('beat-this', `chunk data is ${chunk.data?.length ?? 'missing'}, expected ${frames * MEL_BANDS}`);
        }
    }

    const file = resolveModelFile(MODEL_DIRS, 'beat_this');
    if (!file) {
        console.warn(`[beat_this] no weights in ${MODEL_DIRS.join(', ') || '(no directories given)'}`
            + ' - the renderer falls back to its estimators');
        return null;
    }
    let model;
    try {
        model = mnn.loadBeatThis(await fs.promises.readFile(file), { threads: THREADS });
    } catch (error) {
        return decline('beat-this', `could not load ${file}: ${error?.message || error}`);
    }
    console.log(`[beat_this] loaded on the CPU (${THREADS} threads, ${mnn.isa()}), rss ${rssMb()}MB`);
    try {
        const beat = [];
        const downbeat = [];
        for (const { data, frames } of chunks) {
            const [b, d] = await model.run([{ data: Float32Array.from(data), dims: [frames, MEL_BANDS] }]);
            beat.push(b.data);
            downbeat.push(d.data);
        }
        return { beat, downbeat };
    } finally {
        model.release();
    }
};

// ---------------------------------------------------------------------------- htdemucs
//
// Raw stereo float at 44.1kHz in, three raw stereo stems out. The segmenting and the overlap-add are
// htdemucs.cjs; the model is a .mnn whose STFT/iSTFT are inside the graph (build/htdemucs_mnn/
// make_model.py), so this function is the gate, the load and the hand-off.

const MODEL_RATE = 44100;
/**
 * Longest window we will separate in one request.
 *
 * Forty seconds covers the longest overlap the planner can ask for (25s) plus the room either side
 * a placement search needs. It is also the memory bound: the reply carries three stereo stems, so
 * the renderer receives about 42MB per track, and two tracks are in flight during a transition.
 */
const MAX_SAMPLES = 40 * MODEL_RATE;

/**
 * Frees htdemucs in this process. Sent by the host when automix is switched off; queued like any request,
 * so it never lands in the middle of a separation. mnn.cjs' release returns the memory to the system,
 * not only to the allocator (folia_mnn_free).
 */
const release = () => {
    if (!stems) return true;
    const before = rssMb();
    stems.model.release();
    stems = null;
    console.log(`[htdemucs] released, rss ${before}MB -> ${rssMb()}MB`);
    return true;
};

const loadStems = () => {
    const file = resolveModelFile(MODEL_DIRS, 'htdemucs');
    if (!file) return decline('htdemucs', `no weights in ${MODEL_DIRS.join(', ') || '(no directories)'}`);
    if (stems?.file === file) return stems;
    // A different file than the one loaded: the host restarts this process when the directory or a
    // download changes, so this is belt and braces rather than a path expected to run.
    release();
    try {
        const started = Date.now();
        stems = { model: mnn.loadModel(file, { threads: HTDEMUCS_THREADS, precision: 'high' }), file };
        console.log(`[htdemucs] loaded on the CPU (${HTDEMUCS_THREADS} threads, ${mnn.isa()}) in ${Date.now() - started}ms, rss ${rssMb()}MB`);
        return stems;
    } catch (error) {
        return decline('htdemucs', `could not load ${file}: ${error?.message || error}`);
    }
};

const runHtdemucs = async (request) => {
    const left = request?.left;
    const right = request?.right;
    // A shape mismatch would reach the model as a wrong-sized buffer, so the one thing that would
    // cause it is checked here rather than assumed.
    if (!left || !right || left.length !== right.length) {
        return decline('htdemucs', `channels are ${left?.length ?? 'missing'} and ${right?.length ?? 'missing'}`);
    }
    if (!left.length || left.length > MAX_SAMPLES) {
        return decline('htdemucs', `${left.length} samples, outside 1..${MAX_SAMPLES}`);
    }
    const loaded = loadStems();
    if (!loaded) return null;
    try {
        return await htdemucs.separate(loaded.model, Float32Array.from(left), Float32Array.from(right));
    } catch (error) {
        return decline('htdemucs', error?.message || String(error));
    }
};

// ---------------------------------------------------------------------------- dispatch

const HANDLERS = { 'beat-this': runBeatThis, htdemucs: runHtdemucs, release };

// Once per process, before the first model: a minimised app's process tree is put on the efficiency
// cores by Windows, which made separation 2.2x slower when it ran in its own Python process. A no-op
// elsewhere; a library that cannot be loaded is reported by the first request, not here.
if (process.platform === 'win32') {
    try {
        const fast = mnn.preferFastCores();
        if (fast) console.log(`[analysis] preferring ${fast} fast cores`);
    } catch {
        // Reported when a model is asked for.
    }
}

/**
 * One at a time, across BOTH models.
 *
 * The thread counts above are already sized to leave the machine usable; two inferences at once would
 * double that share and hold two models' activations at once.
 */
let queue = Promise.resolve();

process.parentPort.on('message', ({ data }) => {
    const { id, kind, payload } = data || {};
    const handler = HANDLERS[kind];
    const run = queue.then(async () => {
        if (!handler) return decline(kind, 'no handler for this kind');
        const started = Date.now();
        const result = await handler(payload);
        if (result && kind !== 'release') {
            // RSS alongside the duration, because the memory is the half that has surprised us. A live
            // worker was once observed at 2663MB, and nothing said when it started or which kind of
            // request was running; this line is what was missing the first time.
            console.log(`[${kind}] done in ${((Date.now() - started) / 1000).toFixed(1)}s, rss ${rssMb()}MB`);
        }
        return result;
    }).catch((error) => {
        console.warn(`[${kind}] failed`, error);
        return null;
    });
    // The queue must not inherit a rejection, or one failure poisons every later request.
    queue = run.then(() => undefined, () => undefined);
    run.then(result => process.parentPort.postMessage({ id, result: result ?? null }));
});
