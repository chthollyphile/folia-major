const os = require('os');

// electron/analysis/threads.cjs
// How many CPU threads each request's model is built with, and which worker process runs it on exactly
// that many. worker.cjs builds the models with these counts; host.cjs reads the same counts to choose
// the process a request goes to (`poolFits`), so the two cannot disagree about a request.

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
// @note Since the analysis service's phase 3 a request may say how many threads (the renderer's
// scheduler picks a level, analysis/scheduler.ts cpuThreads: quiet - a quarter of the cores, at most
// four - or hurry, about half, for a transition that would otherwise be late). MNN fixes a model's
// threads when it is built, so a different count rebuilds it (its load time is logged); four stays
// the count for a request that does not say.
const MAX_HTDEMUCS_THREADS = Math.max(1, os.cpus().length);

/** The threads an htdemucs request builds its model with: the count it asks for, at most the cores, else four. */
const htdemucsThreads = (request) => {
    const asked = Number(request?.threads);
    return Number.isInteger(asked) && asked >= 1 ? Math.min(asked, MAX_HTDEMUCS_THREADS) : HTDEMUCS_THREADS;
};

/** The threads the model a request of `kind` builds asks MNN for; 0 for one that builds none ('release'). */
const requestThreads = (kind, payload) => {
    if (kind === 'htdemucs') return htdemucsThreads(payload);
    if (kind === 'beat-this') return THREADS;
    return 0;
};

/**
 * Whether a worker whose MNN thread pool was made for `pool` threads (null: none made yet) runs a build
 * asking for `threads` on exactly that many.
 *
 * MNN makes one thread pool per process, at the first build asking for more than one thread - of either
 * model - and never resizes it (MNN 3.6.1: CPURuntime::_resetThreadPool, and ThreadPool::init, which
 * keys its pools by CPU mask alone; ours is the same mask for every build). A build asking for more runs
 * on the pool's count. One asking for fewer runs beside the rest of the pool, whose threads spin on
 * yield for as long as any model runs, so a quiet build after a hurried one is not quiet. One thread
 * uses no pool at all, so it fits any worker, and a worker without a pool yet makes it for whichever
 * build comes first.
 *
 * Measured after PR #750, 2026-10-19, Ryzen 7 9700X, a 30 s window through host.cjs and worker.cjs,
 * medians of three: one worker asked for four threads and then eight ran the eight in 8.6 s (8.1-8.6)
 * keeping 3.9 cores busy, four's time; asked for eight and then four, it ran the four in 8.9 s keeping
 * 7.7 busy. Sent to a worker of their own, eight ran in 6.6 s (6.5-7.0) on 7.7 cores and four in 8.6 s
 * on 3.9. (Busy cores: the worker's CPU seconds over the request, from app.getAppMetrics.)
 */
const poolFits = (pool, threads) => threads <= 1 || pool === null || pool === threads;

module.exports = { THREADS, HTDEMUCS_THREADS, MAX_HTDEMUCS_THREADS, htdemucsThreads, requestThreads, poolFits };
