const { modelsPresent, resolveModelFile } = require('./modelPaths.cjs');
const { unpackWeights } = require('./packedWeights.cjs');
const { poolFits, requestThreads } = require('./threads.cjs');
const { runtimeLine } = require('../debug/debugHost.cjs');
const fs = require('fs');
const path = require('path');

// electron/analysis/host.cjs
// The main process's half of the analysis worker: spawn it, correlate replies, stop it when idle.
//
// Deliberately the thinnest thing that can sit here. Every decision about the models is in
// worker.cjs, and the reason they are not in this process at all is at the top of that file.
//
// Restarting rather than releasing is the other half of that move. The old in-process version tried to
// give the 530MB back by dropping the session handle and hoping `global.gc()` existed, which in a normal
// build it does not. Killing a child process returns every byte, and the reload it costs is now several
// seconds of a background process rather than several seconds of a frozen window.
//
// Except while automix is switched on. Then the worker is never stopped for being idle - htdemucs stays
// loaded across the gaps between tracks, which is what the listener asked for by switching it on - and
// switching automix OFF is what gives the memory back: the worker is told to release htdemucs, in its own
// process, and only after that does the idle timer apply again. The renderer reports the switch
// (`automix-enabled`); until it has, automix counts as off.
// (From the PR #750 re-review, 2026-10-19: no exception any more. htdemucs is not kept on any
// machine - the worker releases it a minute after each run (worker.cjs STEMS_IDLE_MS) - so an idle
// worker is stopped with automix on as well. Switching automix off still has a running worker
// release htdemucs at once.)
// (Measured after PR #750, 2026-10-19: one decision about the models is made here after all - which
// worker process a request goes to. MNN makes one thread pool per process, sized by the first build
// that asks for more than one thread, so a request for another count waits until the worker has
// answered everything sent to it and then goes to a new one: see `flush`, and threads.cjs poolFits
// for what sharing a pool cost - a hurried 30 s window after a quiet one took 8.6 s on the quiet
// level's four threads, and takes 6.6 s on its own eight.)

/**
 * How long the worker is kept with nothing to do, while automix is switched off.
 *
 * Two minutes: long enough that the two windows of one transition share a loaded session - they are
 * requested seconds apart - and short enough that a paused player is not holding half a gigabyte.
 * With automix on there is no such timer at all - see the top of this file.
 * (From the PR #750 re-review, 2026-10-19: with automix on too. The worker has released htdemucs by
 * then, a minute after its last run (STEMS_IDLE_MS there), so this gives back the rest of the process.)
 */
const IDLE_MS = 120_000;

/** Answer for a request whose worker died under it. Never leaves this file - see `ask`. */
const CRASHED = Symbol('crashed');

/**
 * @param getModelsDir the installer's models directory (in a dev checkout, the repo's models/), which
 *   holds both models (modelPaths.cjs).
 */
const createAnalysisHost = ({ app, ipcMain, getModelsDir, idleMs = IDLE_MS }) => {
    const modelsDirs = () => [getModelsDir?.()].filter(Boolean);

    let child = null;
    /**
     * The threads MNN's thread pool in `child` was made for, or null while nothing sent to it has asked
     * for more than one. Set when such a request is sent rather than when it is answered, so a request
     * behind it is judged against the pool it will meet (threads.cjs poolFits). A request the worker
     * declined before building counts as having made the pool: the worst that does is a worker replaced
     * for nothing, never a build on a pool of another size.
     */
    let childPool = null;
    let idleTimer = null;
    let quitting = false;
    let nextId = 0;
    /** What settles each request sent to `child` and not answered yet, by id. */
    const pending = new Map();
    /**
     * Requests not sent yet, in the order they were asked: the first wants another thread pool than
     * `child`'s and waits for `pending` to empty, the rest wait behind it, so the worker still runs
     * requests in the order they came. See `flush`.
     */
    const held = [];
    /** Whether automix is switched on, as the renderer last said. See the top of this file. */
    let automixEnabled = false;

    const stop = () => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        const dying = child;
        child = null;
        // Out of `pending` before any of them is settled: settling one sends what was held, to a new
        // worker, and so into `pending`.
        const orphans = [...pending.values()];
        pending.clear();
        if (dying) dying.kill();
        for (const settle of orphans) settle(CRASHED);
    };

    const touch = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = null;
        // Never idle while automix is on: the loaded htdemucs is the point. See setAutomixEnabled.
        // (From the PR #750 re-review, 2026-10-19: idle whichever way automix is switched - no
        // htdemucs is kept now, so there is no point in keeping the process for it.)
        idleTimer = setTimeout(() => {
            if (pending.size || held.length) { touch(); return; }
            console.log('[analysis] worker idle, stopping');
            stop();
        }, idleMs);
        if (idleTimer.unref) idleTimer.unref();
    };

    const spawn = () => {
        if (child) return child;
        // Required here rather than at the top: this module is loaded during main's own startup,
        // and utilityProcess is only meaningful once the app is running.
        const { utilityProcess } = require('electron');
        const started = utilityProcess.fork(path.join(__dirname, 'worker.cjs'), modelsDirs(), {
            // Piped and forwarded by hand. `inherit` is the documented default and on Windows it
            // silently drops the child's output, which for a subsystem whose only failure mode is
            // answering null means it fails invisibly - measured, not assumed: with `inherit` not
            // one of the worker's lines reached the terminal.
            stdio: 'pipe',
            // So the worker is unmistakable in app.getAppMetrics() - it lands as Utility/folia-analysis
            // instead of an anonymous Utility PID. Ignored by Electron if unsupported.
            serviceName: 'folia-analysis',
            // The library mnn.cjs loads is found through resources/ (or FOLIA_MNN_LIBRARY in dev), and
            // the worker gets the parent's environment for that.
            env: { ...process.env },
        });
        child = started;
        childPool = null;

        const forward = (stream) => stream?.on('data', (chunk) => {
            const text = String(chunk);
            process.stdout.write(`[analysis] ${text}`);
            runtimeLine('analysis', text); // the worker's own rss/timing lines, into the runtime log
        });
        forward(started.stdout);
        forward(started.stderr);

        started.on('message', ({ id, result, reason }) => {
            // `settle` owns the delete, so hand it the reply and let it do that.
            const settle = pending.get(id);
            if (settle) settle({ result: result ?? null, reason: reason ?? null });
        });
        started.on('exit', (code) => {
            // `stop` clears `child` first, so reaching here with this one still installed means it
            // died on its own. The app going away underneath it is not news.
            if (child !== started || quitting) return;
            console.warn(`[analysis] worker exited on its own (${code})`);
            stop();
        });
        return started;
    };

    /**
     * Sends a held request to the worker, starting one if none is running, and notes the pool it makes.
     * A fork or a post that throws fails that request alone, as it did when `send` posted directly:
     * this also runs inside the worker's message and exit handlers, where a throw would be uncaught.
     */
    const post = ({ id, kind, payload, threads, settle, fail }) => {
        try {
            spawn().postMessage({ id, kind, payload });
        } catch (error) {
            fail(error);
            return;
        }
        pending.set(id, settle);
        if (childPool === null && threads > 1) childPool = threads;
    };

    /**
     * Sends the held requests in order, for as long as each fits the worker's thread pool.
     *
     * One that does not fit waits until the worker has answered everything sent to it - this runs again
     * at every answer - and only then is the worker replaced, the request going to the new one. The
     * wait is what keeps the swap invisible: a worker stopped under a request answers it CRASHED, `ask`
     * asks once more only, and a second CRASHED is answered null - a window without its stems, a track
     * on the estimator's beats. The new worker starts cold, which costs about what rebuilding for
     * another count in the old one did (automix/stems.ts CPU_REBUILD_MS).
     */
    const flush = () => {
        while (held.length) {
            const next = held[0];
            if (child && !poolFits(childPool, next.threads)) {
                if (pending.size) return;
                console.log(`[analysis] ${next.kind} asks for ${next.threads} threads and the worker's thread pool has ${childPool}: replacing the worker`);
                const replaced = child;
                child = null;
                replaced.kill();
            }
            held.shift();
            post(next);
        }
    };

    const send = (kind, payload) => new Promise((resolve, reject) => {
        const id = nextId += 1;
        held.push({
            id,
            kind,
            payload,
            threads: requestThreads(kind, payload),
            settle: (value) => {
                pending.delete(id);
                resolve(value);
                flush();
            },
            fail: reject,
        });
        touch();
        flush();
    });

    /**
     * One retry, and it is load-bearing rather than optimism.
     *
     * A restart (`reload`) or a one-off crash resolves any in-flight request with CRASHED. The retry
     * re-forks the worker, so a restart is invisible to the caller.
     *
     * It matters because of what a null means downstream: the renderer falls back to its estimator for
     * that track. A crash that repeats is still answered null: twice in a row is the runtime, not a
     * restart. (Models were once a download, and a finished download restarted the worker; they ship
     * with the app now, but the retry still covers a crash.)
     * (Measured after PR #750, 2026-10-19: replacing the worker for another thread pool never spends
     * this retry - `flush` waits until nothing is under the worker it replaces.)
     */
    const ask = async (kind, payload) => {
        let answer = await send(kind, payload);
        if (answer === CRASHED) answer = await send(kind, payload);
        return answer === CRASHED ? { result: null, reason: 'the analysis worker died twice in a row' } : answer;
    };

    ipcMain.handle('automix-beat-this', async (_event, chunks) => (await ask('beat-this', chunks)).result);
    /**
     * The stems, or `{ declined }` with the worker's reason when it ran nothing. The reason crosses over
     * because the worker's own log goes to this process's stdout, which the renderer's console - where
     * the listener looks - never shows: a library that would not load used to read there as a
     * separation that never finished.
     */
    ipcMain.handle('automix-htdemucs', async (_event, request) => {
        const { result, reason } = await ask('htdemucs', request);
        return result ?? { declined: reason || 'the worker gave no reason' };
    });

    /**
     * Automix switched on or off, from the renderer - on mount and on every change.
     *
     * On: the idle timer is disarmed for as long as it stays on. Off: a running worker is told to release
     * htdemucs - queued behind whatever it is doing, so a separation in flight finishes first - and the
     * idle timer is armed again. A worker that is not running has nothing to release and is not started.
     * (From the PR #750 re-review, 2026-10-19: on disarms nothing now - the idle timer runs either
     * way. Off still sends the release, so the memory comes back at once rather than at the worker's
     * idle minute; that is what this channel is kept for.)
     */
    const setAutomixEnabled = (enabled) => {
        if (enabled === automixEnabled) return;
        automixEnabled = enabled;
        if (!enabled && child) void send('release', null);
    };
    ipcMain.on('automix-enabled', (_event, enabled) => setAutomixEnabled(enabled === true));

    /**
     * A WebGPU export - beat_this's, or htdemucs' (asked for as 'htdemucs') - for the renderer to run on
     * its own device (beatThisGpu.ts), or null.
     *
     * Read here and handed over rather than run here: the GPU belongs to the renderer, and this is
     * the only process that may read the models directory. Once per model per renderer-side load
     * (41MB for final0, 92MB for htdemucs), which that side drops again after two idle minutes. Both
     * files are the worker's CPU models too; tensors and manifest are one file (packedWeights.cjs),
     * split here.
     *
     * The channel keeps its automix- name: the beat FX (智能动感模式) ask it for final0 as well, and
     * for htdemucs, whose file is the same packed format.
     */
    ipcMain.handle('automix-beat-this-gpu-weights', async (_event, model) => {
        // final0 unless htdemucs is asked for by name; nothing else is a WebGPU export, so no other
        // name may pick a file.
        const name = model === 'htdemucs' ? 'htdemucs_gpu' : 'beat_this';
        const file = resolveModelFile(modelsDirs(), name);
        if (!file) return null;
        try {
            // A truncated file fails the trailer or the length check in unpackWeights, rather than
            // uploading as weights with a zero tail.
            const { weights, manifest } = unpackWeights(await fs.promises.readFile(file));
            // A plain Uint8Array over the tensor region, not the Buffer view: it crosses IPC by
            // structured clone, and the renderer transfers its buffer straight on to its worker.
            return { weights: new Uint8Array(weights.buffer, weights.byteOffset, weights.byteLength), manifest };
        } catch (error) {
            console.warn(`[beat-this-gpu] could not read ${file}: ${error?.message || error}`);
            return null;
        }
    });

    /**
     * Which weights are on disk, without loading anything.
     *
     * The renderer could only find this out by ASKING for an inference, which forks the worker and loads a
     * model to be told there is no model. The weights ship with the app, so the answer is true in every
     * packaged build; it is false in a dev checkout without them (`npm run models:fetch`) or an install
     * missing a file, where a page claiming the full engine over an empty directory is the failure this
     * codebase has already paid for twice.
     *
     * Deliberately the SAME FUNCTION the worker gates on rather than a matching-looking copy - see
     * modelPaths.cjs - so the page cannot say one thing while the worker does another. Not cached: it is
     * a few stats.
     */
    ipcMain.handle('automix-models-present', () => modelsPresent(modelsDirs()));

    // Renderer stage marks - the automix session's own timeline, which is worth having beside the
    // worker's lines rather than only in the renderer's console buffer. See services/automix/diag.ts.
    ipcMain.on('automix-diag', (_event, text) => runtimeLine('automix', String(text)));

    app?.on('will-quit', () => { quitting = true; stop(); });

    // Restarts the worker: stopping is what the idle timer does every couple of minutes anyway, and
    // the next request forks a fresh one. (It once picked up a downloaded model or a new models
    // directory; neither exists now.)
    return { reload: stop };
};

module.exports = { createAnalysisHost };
