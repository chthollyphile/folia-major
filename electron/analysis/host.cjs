const { modelsPresent } = require('./modelPaths.cjs');
const { runtimeLine } = require('../debug/debugHost.cjs');
const path = require('path');

// electron/analysis/host.cjs
// The main process's half of the analysis worker: spawn it, correlate replies, kill it when idle.
//
// Deliberately the thinnest thing that can sit here. Every decision about the models is in
// worker.cjs, and the reason they are not in this process at all is at the top of that file.
//
// Restarting rather than releasing is the other half of that move. The old in-process version tried to
// give the 530MB back by dropping the session handle and hoping `global.gc()` existed, which in a normal
// build it does not. Killing a child process returns every byte, and the reload it costs is now several
// seconds of a background process rather than several seconds of a frozen window.

/**
 * How long the worker is kept with nothing to do.
 *
 * Two minutes: long enough that the two windows of one transition share a loaded session - they are
 * requested seconds apart - and short enough that a paused player is not holding half a gigabyte.
 * Tracks are minutes apart, so this does mean a reload per track, which is the trade being made.
 */
const IDLE_MS = 120_000;

/**
 * Hard ceiling on one request, past which the worker is killed rather than waited on.
 *
 * Only beat_this has one, and only beat_this needs one: it is the single model that runs a native
 * onnxruntime `session.run` in this process's worker, and that call is synchronous under the hood
 * (see the top of worker.cjs) - so a GPU provider that takes the graph and never returns blocks the
 * worker's whole message loop, and the worker's own GPU_ABANDON_MS check never runs because it sits
 * AFTER the call that never came back. A deadline the worker cannot self-enforce has to live out here.
 *
 * 90s is comfortably above the worker's own 60s graceful-abandon window (a slow-but-returning provider
 * is demoted in there without a kill) and far above any legitimate beat_this call, which is a second or
 * two. htdemucs is deliberately absent: it runs in a separate Python process whose exit IS asynchronous,
 * so it can never wedge the worker, and it already bounds itself with the sidecar's own timeout.
 */
const DEADLINE_MS = { 'beat-this': 90_000 };

/** Answer for a request whose worker died under it. Never leaves this file - see `ask`. */
const CRASHED = Symbol('crashed');

/**
 * @param getModelsDirs a function, not a value: the weights are an optional download and their
 *   directory is a setting, so both "where they are" and "are they there" change while the app is
 *   running. Computing it once at startup is how a freshly downloaded model stayed invisible until
 *   the next launch.
 */
const createAnalysisHost = ({ app, ipcMain, getModelsDirs, deadlines = DEADLINE_MS }) => {
    const modelsDirs = () => (getModelsDirs?.() ?? []).filter(Boolean);

    let child = null;
    let idleTimer = null;
    let quitting = false;
    let nextId = 0;
    const pending = new Map();
    /**
     * Set once a GPU request blew its deadline and had to be killed. It survives the re-fork - a fresh
     * worker's in-memory `pinnedToCpu` does not - so the retry, and every request after it this session,
     * loads beat_this on the CPU instead of choosing the provider that just proved it hangs. Carried to
     * the worker as an env flag at fork time; see `spawn`.
     */
    let forceCpu = false;

    const stop = () => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        const dying = child;
        child = null;
        for (const resolve of pending.values()) resolve(CRASHED);
        pending.clear();
        if (dying) dying.kill();
    };

    const touch = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            if (pending.size) { touch(); return; }
            console.log('[analysis] worker idle, stopping');
            stop();
        }, IDLE_MS);
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
            // env defaults to a copy of process.env only when omitted; once we pass it we must carry
            // the parent's own across. The flag is what makes a GPU demotion outlive the kill.
            env: forceCpu ? { ...process.env, FOLIA_ANALYSIS_FORCE_CPU: '1' } : { ...process.env },
        });
        child = started;

        const forward = (stream) => stream?.on('data', (chunk) => {
            const text = String(chunk);
            process.stdout.write(`[analysis] ${text}`);
            runtimeLine('analysis', text); // the worker's own rss/timing lines, into the runtime log
        });
        forward(started.stdout);
        forward(started.stderr);

        started.on('message', ({ id, result }) => {
            // `settle` owns the delete and the timer clear, so hand it the reply and let it do both.
            const settle = pending.get(id);
            if (settle) settle(result ?? null);
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

    const send = (kind, payload) => new Promise((resolve) => {
        const id = nextId += 1;
        const budget = deadlines[kind];
        // Wrapped so both exits - a real reply and a deadline kill - clear the timer and resolve once.
        let timer = null;
        const settle = (value) => {
            if (!pending.has(id)) return; // already settled by the other path
            pending.delete(id);
            if (timer) clearTimeout(timer);
            resolve(value);
        };
        pending.set(id, settle);
        if (budget) {
            timer = setTimeout(() => {
                if (!pending.has(id)) return;
                console.warn(`[analysis] ${kind} exceeded ${budget / 1000}s with no reply - killing the worker`);
                // The GPU provider is the only thing that hangs a beat_this run this way; pin off it so
                // the re-fork the retry triggers does not choose it and wedge again.
                forceCpu = true;
                stop(); // resolves every pending (this one included) with CRASHED, then kills the child
            }, budget);
            timer.unref?.();
        }
        touch();
        spawn().postMessage({ id, kind, payload });
    });

    /**
     * One retry, and it is load-bearing rather than optimism.
     *
     * The host restarts the worker whenever the model directory changes or a download lands (see
     * `reload`), which resolves any in-flight request with CRASHED. The retry re-forks the worker - now
     * seeing the new directory - so a restart is invisible to the caller.
     *
     * It matters because of what a null means downstream: the renderer falls back to its estimator for
     * that track. A worker restarted the instant a download finished would otherwise hand back a null with
     * the weights now present, wasting the first transition after a download on the fallback. A crash that
     * repeats is still answered null: twice in a row is the runtime, not a restart.
     */
    const ask = async (kind, payload) => {
        let answer = await send(kind, payload);
        if (answer === CRASHED) answer = await send(kind, payload);
        return answer === CRASHED ? null : answer;
    };

    ipcMain.handle('automix-beat-this', (_event, chunks) => ask('beat-this', chunks));
    ipcMain.handle('automix-htdemucs', (_event, request) => ask('htdemucs', request));

    /**
     * Which weights are on disk, without loading anything.
     *
     * The renderer could only find this out by ASKING for an inference, which forks the worker and loads a
     * model to be told there is no model - and until it did, the settings page said this was the full
     * build. That was survivable while the weights shipped inside the installer and their absence meant a
     * broken install. It stops being survivable the moment they are an optional download: "not downloaded
     * yet" becomes the normal state, and a page claiming the full engine over an empty directory is the
     * failure this codebase has already paid for twice.
     *
     * Deliberately the SAME FUNCTION the worker gates on rather than a matching-looking copy - see
     * modelPaths.cjs - so the page cannot say one thing while the worker does another. Not cached: it is
     * two stats, and the answer is expected to CHANGE within a session, the whole point of a download button.
     */
    ipcMain.handle('automix-models-present', () => modelsPresent(modelsDirs()));

    // Renderer stage marks - the automix session's own timeline, which is worth having beside the
    // worker's lines rather than only in the renderer's console buffer. See services/automix/diag.ts.
    ipcMain.on('automix-diag', (_event, text) => runtimeLine('automix', String(text)));

    app?.on('will-quit', () => { quitting = true; stop(); });

    // The running worker took its directories as argv at fork time, so a model arriving - or the
    // directory setting changing - has to reach it by restarting it. Cheap: stopping is what the
    // idle timer does every couple of minutes anyway, and the next request forks a fresh one.
    return { reload: stop };
};

module.exports = { createAnalysisHost };
