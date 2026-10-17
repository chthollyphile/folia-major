const { BUNDLED_MODEL_NAMES, modelsPresent, resolveModelFile } = require('./modelPaths.cjs');
const { unpackWeights } = require('./packedWeights.cjs');
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

/**
 * How long the worker is kept with nothing to do, while automix is switched off.
 *
 * Two minutes: long enough that the two windows of one transition share a loaded session - they are
 * requested seconds apart - and short enough that a paused player is not holding half a gigabyte.
 * With automix on there is no such timer at all - see the top of this file.
 */
const IDLE_MS = 120_000;

/** Answer for a request whose worker died under it. Never leaves this file - see `ask`. */
const CRASHED = Symbol('crashed');

/**
 * @param getModelsDirs a function, not a value: the weights are an optional download and their
 *   directory is a setting, so both "where they are" and "are they there" change while the app is
 *   running. Computing it once at startup is how a freshly downloaded model stayed invisible until
 *   the next launch.
 */
const createAnalysisHost = ({ app, ipcMain, getModelsDirs, getBundledModelsDir, idleMs = IDLE_MS }) => {
    const modelsDirs = () => (getModelsDirs?.() ?? []).filter(Boolean);

    let child = null;
    let idleTimer = null;
    let quitting = false;
    let nextId = 0;
    const pending = new Map();
    /** Whether automix is switched on, as the renderer last said. See the top of this file. */
    let automixEnabled = false;

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
        idleTimer = null;
        // Never idle while automix is on: the loaded htdemucs is the point. See setAutomixEnabled.
        if (automixEnabled) return;
        idleTimer = setTimeout(() => {
            if (pending.size) { touch(); return; }
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

        const forward = (stream) => stream?.on('data', (chunk) => {
            const text = String(chunk);
            process.stdout.write(`[analysis] ${text}`);
            runtimeLine('analysis', text); // the worker's own rss/timing lines, into the runtime log
        });
        forward(started.stdout);
        forward(started.stderr);

        started.on('message', ({ id, result }) => {
            // `settle` owns the delete, so hand it the reply and let it do that.
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
        pending.set(id, (value) => {
            pending.delete(id);
            resolve(value);
        });
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
     * Automix switched on or off, from the renderer - on mount and on every change.
     *
     * On: the idle timer is disarmed for as long as it stays on. Off: a running worker is told to release
     * htdemucs - queued behind whatever it is doing, so a separation in flight finishes first - and the
     * idle timer is armed again. A worker that is not running has nothing to release and is not started.
     */
    const setAutomixEnabled = (enabled) => {
        if (enabled === automixEnabled) return;
        automixEnabled = enabled;
        if (enabled) {
            touch();
            return;
        }
        if (child) void send('release', null);
        else touch();
    };
    ipcMain.on('automix-enabled', (_event, enabled) => setAutomixEnabled(enabled === true));

    /**
     * A WebGPU export - beat_this's, or htdemucs' (asked for as 'htdemucs') - for the renderer to run on
     * its own device (beatThisGpu.ts), or null.
     *
     * Read here and handed over rather than run here: the GPU belongs to the renderer, and this is
     * the only process that may read the models directory. Once per model per renderer-side load
     * (41MB for final0, 4.7MB for small0), which that side drops again after two idle minutes. The
     * final0 file is also the worker's CPU fallback; its tensors and manifest are one file
     * (packedWeights.cjs), split here.
     *
     * The channel keeps its automix- name: the beat FX (智能动感模式) ask it for the bundled small0 too,
     * and for htdemucs_gpu (92MB, a download of its own), whose file is the same packed format.
     */
    ipcMain.handle('automix-beat-this-gpu-weights', async (_event, model) => {
        // final0 (automix's download) unless the bundled small0 or htdemucs is asked for by name;
        // nothing else is a WebGPU export, so no other name may pick a file. A bundled model is read
        // from the installer's directory only (modelPaths.cjs BUNDLED_MODEL_NAMES).
        const name = model === 'beat_this_small' ? 'beat_this_small' : model === 'htdemucs' ? 'htdemucs_gpu' : 'beat_this';
        const dirs = BUNDLED_MODEL_NAMES.includes(name) ? [getBundledModelsDir?.()].filter(Boolean) : modelsDirs();
        const file = resolveModelFile(dirs, name);
        if (!file) return null;
        try {
            // A truncated download fails the trailer or the length check in unpackWeights, rather than
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
