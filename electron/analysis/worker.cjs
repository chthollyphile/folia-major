const { resolveModelFile, resolveRuntime } = require('./modelPaths.cjs');
const sidecar = require('./sidecar.cjs');
const os = require('os');

// electron/analysis/worker.cjs
// Both ONNX models, in a process that owns no window.
//
// This file exists because of one measured fact about onnxruntime-node: its `run()` LOOKS async and is
// not. The JS wrapper is `new Promise(resolve => setImmediate(() => resolve(session.run(...))))`, and
// `session.run` there is a synchronous N-API call - so `setImmediate` only decides which tick the block
// starts on, never that it is a block. Measured with a 10ms interval timer around one htdemucs segment:
// 1 tick fired where 150 were due, and 0 of 361 during the model load.
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
// The second measured fact is in THREADS below, the third in PROVIDERS.

/**
 * Every directory a model may live in, best first: the user's own folder, then what the app
 * downloaded, then what the installer shipped. Handed over as argv by host.cjs, because nothing in
 * this file may require 'electron' to ask.
 */
const MODEL_DIRS = process.argv.slice(2);

/**
 * How many cores inference may use.
 *
 * Not a timidity knob - the default is measured to be SLOWER. onnxruntime's default intra-op pool is one
 * thread per logical core, and on this 24-core machine that ran a segment in 3547ms against 1438ms at
 * twelve threads: the pool spends its time contending with itself. Measured, per segment:
 *
 *   default(24)  3547ms  51% of the machine        4  1873ms  32%
 *   12           1438ms  66%                       2  2908ms  19%
 *   6            1602ms  42%
 *
 * A quarter of the cores, because the number that matters is the FRACTION of the machine left for the
 * renderer's frames and the audio thread, and that fraction should not depend on how big the machine is.
 * Separation has minutes of lead time and no deadline; it does not need to be fast, it needs to be invisible.
 */
const THREADS = Math.max(1, Math.floor(os.cpus().length / 4));

/**
 * Which execution providers each model may try, in order, before the CPU.
 *
 * Per model rather than one list, and the split is not about which graph the GPU runs faster - it runs
 * both faster. It is about what each model is FOR. Measured on an RTX 4090 against a 24-core CPU at
 * THREADS, per call, through this same utilityProcess:
 *
 *                    CPU      DirectML    WebGPU     VRAM      GPU busy
 *   beat_this      447ms      41ms(*)     92ms       ~580MB      22%
 *   htdemucs      3040ms   212301ms      553ms       ~4GB       100%
 *   (*) bare node; DirectML was never given a place here - see below.
 *
 * beat_this goes to the GPU because its answer is on a deadline. The beat grid is half of what a
 * transition is planned from, and a profile arriving after the transition it was for is the same as no
 * profile - measured happening, three seconds late. Twelve chunks of a real track go from 3.6s to 0.74s,
 * and 580MB at a fifth of the card is a load a visualiser does not feel.
 *
 * htdemucs stays on the CPU, and the reason is at the top of STEM_WINDOW_SEC: separation has minutes of
 * lead time and no deadline, so "it does not need to be fast, it needs to be invisible". Four gigabytes
 * of VRAM at a hundred percent of the card for half a second is not invisible on this app in particular -
 * separation is asked for the instant a track STARTS, exactly when the visualiser is running its
 * song-change scene. The CPU path already satisfies its only requirement, and THREADS made it invisible;
 * spending the card to make an unwatched job five times faster trades the requirement for a number.
 *
 * DirectML is in the table only to be ruled out. It is the fastest thing measured on beat_this and takes
 * 212 SECONDS per call on htdemucs - warm and reproducible, on the same card WebGPU runs the same graph
 * in half a second. A provider being accepted by a graph therefore says nothing about it running that
 * graph, which is what GPU_ABANDON_MS below exists for. It is also Windows-only, so putting it here would
 * turn a hardware question into an operating-system one.
 *
 * A provider that is not there throws at session creation - measured: `[cuda] backend not found` - so the
 * fallback below is a catch, not a capability probe. There is nothing to detect.
 */
// htdemucs is not here: it no longer runs over onnxruntime-node at all. It moved to a Python sidecar
// (sidecar.cjs / htdemucs_runner.py) for the one flag that halves its memory, and stayed on the CPU
// for the reason this table gave - separation has minutes of lead and no deadline, so it must be
// invisible, not fast. Only beat_this loads a session in this process now.
const PROVIDERS = {
    beat_this: ['webgpu'],
};

/**
 * Set by the host when a previous worker had a GPU request killed for blowing its deadline. A fresh
 * worker's `pinnedToCpu` starts empty, so without this the re-fork would choose the same provider that
 * just hung and hang again; the flag carries that one bit of state across the kill. See host.cjs.
 */
const FORCE_CPU = process.env.FOLIA_ANALYSIS_FORCE_CPU === '1';

/**
 * How long one GPU call may take before its provider is abandoned for the rest of this process.
 *
 * Not a performance target - it is the line between "this GPU is slow" and "this GPU is not running the
 * graph". The slowest legitimate call measured is the FIRST on htdemucs at 1.9s, which includes shader
 * compilation; every warm call is 0.26s. The failure it exists for is the DirectML row above: the
 * provider takes the graph, partitions it badly and never recovers, and without this the symptom is a
 * subsystem that quietly never finishes in time.
 */
const GPU_ABANDON_MS = 60_000;

/** Thrown out of a runner whose provider just proved unusable. Never leaves this file. */
const DEMOTED = Symbol('demoted');

/**
 * How long each model is kept loaded after the last request that used it, or null to keep it until
 * the host stops the process.
 *
 * Both models used to stay resident until the HOST killed this whole process, two minutes after the last
 * request of ANY kind. For a four-minute track that is half a gigabyte held for most of the track with
 * nothing being asked of it. Measured here, bare node, with the options this file uses, so both halves of
 * the trade come from one measurement:
 *
 *   baseline (runtime required)     57MB
 *   + beat_this                    174MB    release returns  96MB, reload costs 0.7s
 *   + htdemucs                     563MB    release returns 395MB, reload costs 4-6s
 *
 * `release()` is what returns the bytes; dropping the handle is not enough. Hence a timer rather than a
 * smaller cache.
 *
 * **Only htdemucs is on a timer, and the split is the same one PROVIDERS makes: what the model is FOR.**
 * The reload is the entire cost, and a reload is only free where nothing is waiting. htdemucs is asked for
 * the moment a track starts and not needed until that track ENDS, so four to six seconds inside minutes of
 * lead time cannot move anything - and it is 395MB of the 491MB there is to give back. beat_this is the
 * opposite on every count: its answer gates the transition plan and a late profile is the same as no
 * profile (measured three seconds late), it runs on WebGPU where a reload re-compiles shaders, and it is
 * only worth 96MB. Trading a deadline for a fifth of the saving is not an optimisation.
 *
 * Thirty seconds is longer than any gap inside one track's separation work - the two windows of a
 * transition are requested seconds apart - and far shorter than the gap between tracks. So it fires about
 * once per track, and the reload it costs is the one the host's idle timer was going to cost anyway; this
 * just stops holding the weights without throwing the loaded runtime away too.
 */
// htdemucs is gone from here too: the sidecar process IS the release - it exits after each separation
// and every byte goes back, which is why the whole idle-timer dance below is now beat_this' alone (and
// beat_this is null, i.e. never released on a timer). Kept because the mechanism still guards the shape.
const IDLE_RELEASE_MS = {
    beat_this: null,
};

/** name -> { run, session, usedAt }. `run` is the runner; `session` is what can be released. */
const sessions = new Map();
/** Set per model once loading has been tried and failed, so a broken install is reported once. */
const unavailable = new Map();
/** Models whose GPU provider failed or crawled once; they load on the CPU for the rest of the run. */
const pinnedToCpu = new Set();

const optionsFor = (provider) => ({
    // The single most important line for htdemucs. Measured on that graph: the default arena takes peak
    // RSS to 5190MB, and switching it off takes the SAME work to 530MB. Five gigabytes beside an Electron
    // renderer is not a slow app, it is a machine that starts swapping.
    enableCpuMemArena: false,
    // Still set for a GPU session: shape-related nodes are assigned to the CPU whatever the preferred
    // provider is, and they should get the same fraction of the machine as everything.
    intraOpNumThreads: THREADS,
    ...(provider === 'cpu' ? {} : {
        executionProviders: [provider],
        // Both are documented hard requirements of the GPU providers rather than tuning. Leaving
        // enableMemPattern on is what the first DirectML measurement recorded: 14GB resident and no answer
        // in twenty minutes, on a graph WebGPU finishes in 0.26s.
        enableMemPattern: false,
        executionMode: 'sequential',
    }),
});

/**
 * One inference, plus the check that makes preferring a GPU safe to do unattended.
 *
 * A CPU session is handed through untouched - there is nothing to fall back to. A GPU session is watched
 * for the two ways a provider can be present and still not work: throwing mid-run, which is what a GPU
 * that runs out of its own memory does, and taking GPU_ABANDON_MS on one call. Either drops the session
 * and pins the model to the CPU; the dispatcher re-runs the request, so a caller never learns any of this
 * happened.
 */
const makeRunner = (name, session, provider) => {
    if (provider === 'cpu') return { run: (feeds) => session.run(feeds) };
    const demote = (why) => {
        console.warn(`[${name}] ${provider} gave up - ${why}, continuing on the CPU`);
        pinnedToCpu.add(name);
        // Dropping the entry is what releases the GPU session; nothing else holds a reference.
        sessions.delete(name);
        return DEMOTED;
    };
    return {
        run: async (feeds) => {
            const started = Date.now();
            let result;
            try {
                result = await session.run(feeds);
            } catch (error) {
                throw demote(error?.message || String(error));
            }
            const elapsed = Date.now() - started;
            if (elapsed > GPU_ABANDON_MS) throw demote(`${(elapsed / 1000).toFixed(0)}s on one call`);
            return result;
        },
    };
};

/**
 * Requests in flight. The sweep below will not release anything while this is non-zero.
 *
 * A separation is tens of seconds of repeated `run` calls on one loaded session, longer than any budget
 * above - so "idle" has to mean "no request is using it", not "no request has started recently".
 * Everything here is serialised through one queue, so this is 0 or 1.
 */
let running = 0;

/**
 * Releases models nobody has asked for in a while. One interval, no per-request bookkeeping.
 *
 * Ten seconds against a thirty-second budget: the granularity costs at most a third of the budget
 * and buys a timer that cannot get out of step with the queue.
 */
const sweep = () => {
    if (running) return;
    const now = Date.now();
    for (const [name, entry] of sessions) {
        const budget = IDLE_RELEASE_MS[name];
        if (!budget || now - entry.usedAt < budget) continue;
        // Dropped before the release resolves, so a request arriving in between loads a fresh
        // session rather than running on one that is being torn down.
        sessions.delete(name);
        const idleSec = Math.round((now - entry.usedAt) / 1000);
        const before = Math.round(process.memoryUsage().rss / 1048576);
        entry.session.release().then(() => {
            const after = Math.round(process.memoryUsage().rss / 1048576);
            console.log(`[${name}] released after ${idleSec}s idle, rss ${before}MB -> ${after}MB`);
        }, (error) => console.warn(`[${name}] release failed`, error));
    }
};
setInterval(sweep, 10_000).unref?.();

const load = async (name) => {
    const live = sessions.get(name);
    if (live) {
        live.usedAt = Date.now();
        return live;
    }
    if (unavailable.has(name)) return null;

    const file = resolveModelFile(MODEL_DIRS, name);
    if (!file) {
        // NOT latched in `unavailable`: the weights are a download now, so this heals, and the host
        // restarts this process when one arrives. Latching it here is how a finished download went
        // on being ignored until the app was relaunched.
        console.warn(`[${name}] no weights in ${MODEL_DIRS.join(', ') || '(no directories given)'}`
            + ' - the renderer falls back to its estimators');
        return null;
    }

    const ort = require('onnxruntime-node');
    const order = (FORCE_CPU || pinnedToCpu.has(name)) ? ['cpu'] : [...(PROVIDERS[name] ?? []), 'cpu'];
    let last = '';
    for (const provider of order) {
        try {
            const session = await ort.InferenceSession.create(file, optionsFor(provider));
            // `session` is carried alongside the runner because releasing it is what returns the
            // memory - see IDLE_RELEASE_MS. The runner deliberately does not expose it.
            const entry = { ...makeRunner(name, session, provider), session, usedAt: Date.now() };
            sessions.set(name, entry);
            console.log(
                `[${name}] weights loaded on ${provider === 'cpu' ? `cpu (${THREADS} threads)` : provider}`
                + `, rss ${Math.round(process.memoryUsage().rss / 1048576)}MB`,
            );
            return entry;
        } catch (error) {
            last = error?.message || String(error);
            // Logged, not warned, for a GPU provider: "this machine has no WebGPU" is the expected
            // answer on plenty of machines, and the line above says which provider actually won.
            if (provider === 'cpu') break;
            console.log(`[${name}] ${provider} unavailable: ${last}`);
        }
    }
    unavailable.set(name, last);
    console.warn(`[${name}] could not start: ${last}`);
    return null;
};

// ---------------------------------------------------------------------------- Beat This!
//
// Everything that can be reasoned about without a model - the spectrogram, the chunking, the peak
// picking - lives in src/services/automix/beatThis.ts where the unit tests can reach it. What is
// here is what needs a native runtime and an 83MB file, and nothing else.

/** Frames the export accepts in one call; a longer tensor fails inside the attention block. */
const MAX_CHUNK_FRAMES = 1500;
const MEL_BANDS = 128;

/**
 * A request this worker will not run, said out loud.
 *
 * Every guard below used to answer a bare null. Loading failures are logged by `load`, and a finished run
 * logs its duration, so the ONLY outcome that printed nothing was "the payload was not something I can
 * run" - exactly the outcome a caller cannot see either, because both renderer modules read null as "this
 * build has no models" and stop asking. Not hypothetical: the stem gesture ran zero times between
 * shipping and being noticed, invisible for the whole of it.
 */
const decline = (kind, why) => {
    console.warn(`[${kind}] declined: ${why}`);
    return null;
};

const runBeatThis = async (chunks) => {
    const session = await load('beat_this');
    if (!session) return null;
    if (!Array.isArray(chunks) || !chunks.length) return decline('beat-this', 'no spectrogram chunks in the request');

    const ort = require('onnxruntime-node');
    const beat = [];
    const downbeat = [];
    for (const chunk of chunks) {
        const frames = Number(chunk?.frames);
        const data = chunk?.data;
        // The renderer is trusted, but a shape mismatch here is a native crash rather than an
        // exception - so the one thing that would cause it is checked rather than assumed.
        if (!Number.isInteger(frames) || frames <= 0 || frames > MAX_CHUNK_FRAMES) {
            return decline('beat-this', `chunk of ${frames} frames, outside 1..${MAX_CHUNK_FRAMES}`);
        }
        if (!data || data.length !== frames * MEL_BANDS) {
            return decline('beat-this', `chunk data is ${data?.length ?? 'missing'}, expected ${frames * MEL_BANDS}`);
        }

        const input = new ort.Tensor('float32', Float32Array.from(data), [1, frames, MEL_BANDS]);
        const output = await session.run({ input_spectrogram: input });
        // Copied out of the tensors: their buffers belong to the runtime and are not ours to send.
        beat.push(new Float32Array(output.beat.data));
        downbeat.push(new Float32Array(output.downbeat.data));
    }
    return { beat, downbeat };
};

// ---------------------------------------------------------------------------- htdemucs
//
// Raw stereo float at 44.1kHz in, three raw stereo stems out. Unlike beat_this, none of the work is
// here: the whole separation - segmenting, the overlap-add window, the stem order, and the ONNX run
// itself - lives in htdemucs_runner.py, spawned in the downloaded Python runtime. The reason is one
// flag (enable_mem_reuse) that halves this graph's memory and is reachable only from Python; the full
// story is at the top of htdemucs_runner.py and sidecar.cjs. This function is only the gate and the
// spawn: check the runtime and the weights are on disk, hand the mix to the sidecar, pass the stems up.

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
 * What the sidecar needs, or the reason it cannot run. Both are optional downloads, and either one
 * missing means the renderer reads the same null it reads for a build with no models - a crossfade
 * cue - so this is a decline, logged, rather than an error.
 */
const htdemucsPaths = () => {
    const pythonExe = resolveRuntime(MODEL_DIRS);
    if (!pythonExe) return decline('htdemucs', `no Python runtime in ${MODEL_DIRS.join(', ') || '(no directories)'}`);
    const modelPath = resolveModelFile(MODEL_DIRS, 'htdemucs');
    if (!modelPath) return decline('htdemucs', `no weights in ${MODEL_DIRS.join(', ') || '(no directories)'}`);
    return { pythonExe, script: sidecar.RUNNER_SCRIPT, modelPath };
};

const runHtdemucs = async (request) => {
    const left = request?.left;
    const right = request?.right;
    // A shape mismatch would reach the runner as a wrong-sized file, so the one thing that would
    // cause it is checked here rather than assumed - same guard the in-process version had.
    if (!left || !right || left.length !== right.length) {
        return decline('htdemucs', `channels are ${left?.length ?? 'missing'} and ${right?.length ?? 'missing'}`);
    }
    if (!left.length || left.length > MAX_SAMPLES) {
        return decline('htdemucs', `${left.length} samples, outside 1..${MAX_SAMPLES}`);
    }

    const paths = htdemucsPaths();
    if (!paths) return null;

    try {
        // One at a time is guaranteed by the queue below, so only one sidecar is ever alive - which is
        // what keeps the memory win real: its peak is one process's, and it is gone when that process exits.
        return await sidecar.separate({ ...paths, left, right });
    } catch (error) {
        return decline('htdemucs', error?.message || String(error));
    }
};

// ---------------------------------------------------------------------------- dispatch

const HANDLERS = { 'beat-this': runBeatThis, htdemucs: runHtdemucs };

/** Which model each request kind loads. The sweep counts that model's idleness from this request. */
const MODEL_OF = { 'beat-this': 'beat_this', htdemucs: 'htdemucs' };

/**
 * One at a time, across BOTH models.
 *
 * The pool above is already sized to leave the machine usable; two inferences at once would double
 * that share and hold two models' weights at once.
 */
let queue = Promise.resolve();

process.parentPort.on('message', ({ data }) => {
    const { id, kind, payload } = data || {};
    const handler = HANDLERS[kind];
    const run = queue.then(async () => {
        if (!handler) return decline(kind, 'no handler for this kind');
        const started = Date.now();
        let result;
        // Held across the whole request, not just the model call: a separation is many `run`s on
        // one session and the sweep must not release it between two of them.
        running += 1;
        try {
            try {
                result = await handler(payload);
            } catch (error) {
                if (error !== DEMOTED) throw error;
                // The GPU session is gone and the model is pinned to the CPU. Nothing about the
                // request changed, so it is simply asked again - see makeRunner.
                result = await handler(payload);
            }
        } finally {
            running -= 1;
            // Idleness is counted from the END of the work rather than from `load`, so a separation
            // that takes twenty seconds does not spend two thirds of its own budget running.
            const entry = sessions.get(MODEL_OF[kind]);
            if (entry) entry.usedAt = Date.now();
        }
        if (result) {
            // RSS alongside the duration, because the memory is the half that has surprised us. A worker
            // with both models resident and working measures 650-680MB - no path here grows with the
            // number of runs, models loaded, or input shapes; all three were measured. It no longer STAYS
            // there across tracks: htdemucs is released thirty seconds after the last separation, so
            // between transitions this line should read a few hundred MB lower. See IDLE_RELEASE_MS. A live
            // worker was once observed at 2663MB anyway, and the idle timer reclaimed it whole a few
            // minutes later - the design working but not an explanation. If it happens again this line says
            // when it started and which kind of request was running, which is what was missing the first time.
            const rssMb = Math.round(process.memoryUsage().rss / 1048576);
            console.log(`[${kind}] done in ${((Date.now() - started) / 1000).toFixed(1)}s, rss ${rssMb}MB`);
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
