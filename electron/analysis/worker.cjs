const { resolveModelFile } = require('./modelPaths.cjs');
const mnn = require('./mnn.cjs');
const htdemucs = require('./htdemucs.cjs');
const { THREADS, HTDEMUCS_THREADS, htdemucsThreads } = require('./threads.cjs');
const fs = require('fs');

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
//     (From the PR #750 re-review, 2026-10-19: no longer kept, on any machine - released
//     STEMS_IDLE_MS after every run as well as when automix is switched off; see `stems` below.)
//   - beat_this, only as the CPU fallback for automix's beat grid. The renderer runs it on its own GPU
//     first (src/services/analysis/beatThisGpu.ts); what reaches this file is what that could not take.

/**
 * The directory the models live in - the installer's (a dev checkout's models/) - as a list, the
 * shape resolveModelFile takes. Handed over as argv by host.cjs, because nothing in this file may
 * require 'electron' to ask.
 */
const MODEL_DIRS = process.argv.slice(2);

// How many cores beat_this (THREADS) and htdemucs (HTDEMUCS_THREADS, or what a request asks for) may
// use is in threads.cjs, with why: host.cjs reads the same counts to choose the worker a request goes to.

/**
 * The threads MNN's thread pool in this process was made for, or null before any build asked for more
 * than one. There is one pool per process, made by the first build with more than one thread - of
 * either model - and never grown (MNN 3.6.1, CPURuntime::_resetThreadPool and ThreadPool::init), so a
 * later build asking for more runs on this many.
 * (Measured after PR #750, 2026-10-19, Ryzen 7 9700X, a 30 s window: a worker that had built htdemucs
 * for four threads took 8.8 s rebuilt for eight - its four-thread time; eight in a worker of their own
 * took 6.3-6.5 s - and one built for two took 12.6-12.8 s rebuilt for four, where four alone took
 * 7.9-9.1 s.)
 * (Measured after PR #750, 2026-10-19, later the same evening: and the other way round, a worker that
 * had built for eight kept 7.7 cores busy rebuilt for four, where four in a worker of their own kept
 * 3.9 busy - the pool's other threads spin for as long as a model runs. host.cjs has sent a build for
 * another count to a worker of its own since (threads.cjs poolFits), so a load line saying either is
 * the host and MNN disagreeing.)
 */
let poolThreads = null;
/** The threads a build asking for `threads` gets in this process; the first with more than one makes the pool. */
const grantedThreads = (threads) => {
    if (threads <= 1) return 1;
    if (poolThreads === null) poolThreads = threads;
    return Math.min(threads, poolThreads);
};
/**
 * What a load line says about the threads: how many were asked for, and how many run when fewer.
 * (Measured after PR #750, 2026-10-19: or how many more the pool has, spinning beside the build.)
 */
const threadsText = (threads, granted) => {
    if (granted < threads) return `${threads} threads, running on the ${granted} this process's thread pool was made for`;
    if (threads > 1 && poolThreads > threads) return `${threads} threads, beside the other ${poolThreads - threads} of this process's thread pool`;
    return `${threads} threads`;
};

/**
 * htdemucs, once loaded: `{ model, file, threads }`, or null.
 *
 * Kept for as long as automix is switched on, however long the gap between tracks. A reload is a 92MB
 * read and the network built over it, asked for the moment a track starts; holding ~400MB while the
 * feature that needs it is on is the trade the listener made by switching it on. Switching it off is what gives the
 * memory back - the host sends 'release' and `release` below frees it in this process.
 * (From the PR #750 re-review, 2026-10-19: not kept any more, a machine without a GPU included - the
 * maintainer would rather have the memory back than save the reload. It is released STEMS_IDLE_MS
 * after each run ends, and on 'release' as before. A reload is about half a second - measured 516 ms
 * at two threads, 500 ms at three - and releasing took this process from 487 MB to 137 MB rss.)
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
    declined = why;
    return null;
};

/**
 * Why the request being run answered null, sent back beside the null.
 *
 * The line above lands in the main process's stdout, which the renderer's console never shows - so a
 * library that could not be loaded (rc1 on glibc 2.41+, a library marked as needing an executable
 * stack) printed nothing where the listener looks, and every separation read as "still separating".
 * Reset per request; requests run one at a time (the queue below), so one variable is enough.
 */
let declined = null;

const rssMb = () => Math.round(process.memoryUsage().rss / 1048576);

// ---------------------------------------------------------------------------- Beat This!
//
// Everything that can be reasoned about without a model - the spectrogram, the chunking, the peak
// picking - lives in src/services/analysis/beatThis.ts where the unit tests can reach it. What is
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
        model = mnn.loadBeatThis(file, { threads: THREADS });
    } catch (error) {
        return decline('beat-this', `could not load ${file}: ${error?.message || error}`);
    }
    const granted = grantedThreads(THREADS);
    console.log(`[beat_this] loaded on the CPU (${threadsText(THREADS, granted)}, ${mnn.isa()}), rss ${rssMb()}MB`);
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
// htdemucs.cjs; the network, STFT and iSTFT included, is built by native/folia-mnn/folia_htdemucs.cpp
// over the WebGPU export's weights (htdemucs-wgsl.bin, the file the GPU runs too), so this function is
// the gate, the load and the hand-off.

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
 * How long htdemucs stays after a run the renderer marked `resident: false` (analysis service plan,
 * phase 4): a fallback for a machine whose GPU does the separating (a GPU run that could not, or a
 * deadline it would have missed). Keeping ~400 MB for the rest of the session on the strength of
 * one such window is the waste phase 4 is about; a machine without a GPU (`resident` true or absent)
 * keeps it while automix is on, as before.
 * (From the PR #750 re-review, 2026-10-19: after every run now, on every machine, and a request's
 * `resident` is ignored - so it is STEMS_IDLE_MS rather than FALLBACK_IDLE_MS. The host stops an
 * idle worker only after two minutes (host.cjs IDLE_MS), so this minute is the one that counts.)
 */
const STEMS_IDLE_MS = 60_000;
let stemsIdleTimer = null;
/**
 * Bumped by every htdemucs request: a release the timer queued is dropped when a request came after
 * it was armed (found by review: a queued run, a resident one included, could not stop it).
 */
let stemsGeneration = 0;

/**
 * Frees htdemucs in this process. Sent by the host when automix is switched off; queued like any request,
 * so it never lands in the middle of a separation. mnn.cjs' release returns the memory to the system,
 * not only to the allocator (folia_mnn_free).
 */
const release = () => {
    if (stemsIdleTimer) clearTimeout(stemsIdleTimer);
    stemsIdleTimer = null;
    if (!stems) return true;
    const before = rssMb();
    stems.model.release();
    stems = null;
    console.log(`[htdemucs] released, rss ${before}MB -> ${rssMb()}MB`);
    return true;
};

const loadStems = (threads = HTDEMUCS_THREADS) => {
    const file = resolveModelFile(MODEL_DIRS, 'htdemucs_gpu');
    if (!file) return decline('htdemucs', `no weights in ${MODEL_DIRS.join(', ') || '(no directories)'}`);
    if (stems?.file === file && stems.threads === threads) return stems;
    // A different file than the one loaded: the directory is fixed for the process's life, so this is
    // belt and braces rather than a path expected to run. Or another thread count (see above).
    if (stems?.file === file) console.log(`[htdemucs] rebuilding on the CPU for ${threads} threads (was ${stems.threads})`);
    release();
    try {
        const started = Date.now();
        stems = { model: mnn.loadHtdemucs(file, { threads }), file, threads };
        const granted = grantedThreads(threads);
        console.log(`[htdemucs] loaded on the CPU (${threadsText(threads, granted)}, ${mnn.isa()}) in ${Date.now() - started}ms, rss ${rssMb()}MB`);
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
    const threads = htdemucsThreads(request);
    // How long this request spent building the model, 0 when it was built: sent with the stems, so the
    // renderer's CPU estimate (src/services/automix/stems.ts) can learn from the rest of its wait.
    const building = Date.now();
    const loaded = loadStems(threads);
    if (!loaded) return null;
    const buildMs = Date.now() - building;
    if (stemsIdleTimer) clearTimeout(stemsIdleTimer);
    stemsIdleTimer = null;
    const generation = (stemsGeneration += 1);
    try {
        const separated = await htdemucs.separate(loaded.model, Float32Array.from(left), Float32Array.from(right));
        return { ...separated, buildMs };
    } catch (error) {
        return decline('htdemucs', error?.message || String(error));
    } finally {
        // Idle from when the run ends, not when it started (review: a slow run had its release queued
        // right behind it).
        // (From the PR #750 re-review, 2026-10-19: armed after every run, whatever `resident` says.)
        if (generation === stemsGeneration) {
            stemsIdleTimer = setTimeout(() => {
                stemsIdleTimer = null;
                // Queued like a request, so it never lands in the middle of a separation; dropped
                // there if another request came meanwhile.
                queue = queue.then(() => {
                    if (generation !== stemsGeneration) return;
                    console.log(`[htdemucs] idle for ${STEMS_IDLE_MS / 1000}s since its last run`);
                    release();
                }, () => undefined);
            }, STEMS_IDLE_MS);
            if (stemsIdleTimer.unref) stemsIdleTimer.unref();
        }
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
        declined = null;
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
        declined = error?.message || String(error);
        return null;
    // The reply is built inside the chain, before the next request can reset `declined`.
    }).then(result => (result == null ? { id, result: null, reason: declined } : { id, result }));
    // The queue must not inherit a rejection, or one failure poisons every later request.
    queue = run.then(() => undefined, () => undefined);
    run.then(reply => process.parentPort.postMessage(reply));
});
