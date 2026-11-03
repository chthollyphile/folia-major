const { createDebugLogWriter, logsRoot } = require('./debugLogWriter.cjs');
const { createMemoryMonitor } = require('./memoryMonitor.cjs');
const { redactCredentials } = require('./redactCredentials.cjs');
const fs = require('fs');

// electron/debug/debugHost.cjs
// The developer debug module: what is recorded, where it lands, and how the renderer switches it.
//
// This replaces the temporary automix instrument (`analysis/diag.cjs`) that was wired straight into
// the analysis host and could not be turned off, renamed, or pointed anywhere else. Everything that
// used it now goes through `runtimeLine`, and the whole module is removable by deleting this folder
// and the four call sites that reference it - which was the standing condition on keeping it.
//
// Two logs, two directories, two switches:
//
//   logs/runtime/<date>.log     what the app said while it ran (console, both processes)
//   logs/memory/<date>.jsonl    what it cost, one JSON object per sample
//
// They are never merged. A memory curve at one sample every two seconds is forty thousand lines a
// day; a runtime log sharing that file is unreadable, and the two are opened to answer different
// questions anyway.

const DEFAULTS = {
    // Off by default. The Developer section is visible to everyone, and a diagnostic that writes a
    // file all session without being asked is disk and a trace of activity a normal listener never
    // opted into. Anyone debugging turns it on first - it persists once flipped - which is a smaller
    // cost than every install logging to disk unprompted. (It was on by default to catch a problem
    // before it was reproduced; that trade is not worth making on behalf of users who will never look.)
    runtimeLogEnabled: false,
    runtimeLogMode: 'append',
    // The renderer's session-log switch, as it last reported it. That switch is whether anything
    // is kept at all; the file switch above is only whether what is kept also goes to disk. It
    // lives in the renderer (the browser build has it too) and is remembered here so that the
    // lines written before the first window exists follow it as well.
    consoleCaptureEnabled: true,
    // Off by default: this one costs a timer and a metrics call across every process. It is
    // switched on to answer a question, not left running.
    memoryMonitorEnabled: false,
    // Writing the curve down is its own switch, the way the runtime log's is. Sampling is what the
    // live window reads; a file that grows all session is a separate cost, opted into separately.
    memoryLogEnabled: false,
    memoryLogMode: 'overwrite',
    memoryIntervalMs: 2000,
};

const STORE_KEYS = {
    runtimeLogEnabled: 'debug_runtime_log_enabled',
    runtimeLogMode: 'debug_runtime_log_mode',
    consoleCaptureEnabled: 'debug_console_capture_enabled',
    memoryMonitorEnabled: 'debug_memory_monitor_enabled',
    memoryLogEnabled: 'debug_memory_log_enabled',
    memoryLogMode: 'debug_memory_log_mode',
    memoryIntervalMs: 'debug_memory_interval_ms',
};

const MODES = ['append', 'overwrite'];
/** Below a second the samples say more about the sampler than the app; above a minute it is not a curve. */
const clampInterval = (value) => Math.min(60_000, Math.max(1000, Math.round(Number(value) || DEFAULTS.memoryIntervalMs)));

/**
 * Seeds the new file switch from the old combined monitor switch exactly once.
 *
 * Before the split, enabling the monitor necessarily wrote every sample to disk. An explicit value
 * for the new switch always wins; only an absent key means this install still needs migrating.
 */
const migrateMemoryLogEnabled = (store, stored) => {
    if (typeof stored.memoryLogEnabled === 'boolean') return stored.memoryLogEnabled;
    const inherited = stored.memoryMonitorEnabled === true;
    store.set(STORE_KEYS.memoryLogEnabled, inherited);
    return inherited;
};

/**
 * The live host, or null before startup / after quit.
 *
 * A module-level singleton on purpose: `runtimeLine` is called from subsystems that are constructed
 * during main's own startup and have no business being handed a logger. Before the host exists, and
 * after it is gone, those calls are no-ops rather than errors.
 */
let host = null;

/**
 * Open fd count per pid, read from /proc. Linux only - elsewhere, and for any process that has gone
 * away or is not ours to read, the pid is simply left out and its row keeps null.
 */
const readFdCounts = (metrics, { platform = process.platform, readdirSync = fs.readdirSync } = {}) => {
    const counts = new Map();
    if (platform !== 'linux') return counts;
    for (const metric of metrics) {
        try {
            counts.set(metric.pid, readdirSync(`/proc/${metric.pid}/fd`).length);
        } catch {
            // Exited between getAppMetrics and here, or sandboxed out of reach.
        }
    }
    return counts;
};

/**
 * One line into the runtime log. Safe to call from anywhere in the main process, at any time.
 * `tag` is the `[Prefix]` convention the rest of the app already logs under - see docs/client-logging.md.
 */
const runtimeLine = (tag, text) => {
    host?.runtimeLine(tag, text);
};

/**
 * Main's console lines, for the log panel inside the app.
 *
 * The panel lives in the renderer and records the renderer's console. A line written in this
 * process was readable only in the runtime log file, which is off until someone switches it on.
 * A window asks once: it gets what was said before it asked, then each later burst, on one channel
 * so the order holds.
 */
const PANEL_BACKLOG = 300;
const createPanelFeed = ({ limit = PANEL_BACKLOG, defer = setImmediate } = {}) => {
    let backlog = [];
    let pending = [];
    let sending = false;
    const windows = new Set();
    const send = (target, lines, isBacklog) => {
        // A page that crashed asks again once it is loaded again.
        if (target.isDestroyed() || target.isCrashed()) { windows.delete(target); return; }
        sending = true;
        try { target.send('debug-main-lines', lines, isBacklog); } catch { /* closing */ } finally { sending = false; }
    };
    const flush = () => {
        const lines = pending;
        pending = [];
        if (lines.length) for (const target of windows) send(target, lines, false);
    };
    return {
        add: (at, level, text) => {
            // Electron reports a send that failed through console.error, which is this feed's own
            // input: taken in, that line would be sent, fail and be reported again without end.
            if (sending) return;
            const line = { at, level, text };
            backlog.push(line);
            if (backlog.length > limit) backlog = backlog.slice(-limit);
            // One message per burst, not per line.
            if (windows.size && pending.push(line) === 1) defer(flush);
        },
        subscribe: (target) => {
            // A reloaded page asks from a window that is already listening. What is pending is in
            // the backlog it is about to get, so it is left out of this flush.
            windows.delete(target);
            flush();
            windows.add(target);
            send(target, backlog.slice(), true);
        },
        clear: () => {
            backlog = [];
            pending = [];
        },
    };
};

/**
 * An Error nested in a logged object. JSON.stringify writes one as `{}`: name and message live on
 * the prototype, not on the object, which is how a failed call ended up in the log as `"error":{}`.
 */
const errorReplacer = (_key, value) => (value instanceof Error ? `${value.name}: ${value.message}` : value);

/** One console call as a line of text. A value that cannot be serialised is not a reason to lose the line. */
const consoleText = args => args.map((value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack || value.message;
    try { return JSON.stringify(value, errorReplacer); } catch { return String(value); }
}).join(' ');

const createDebugHost = ({ app, ipcMain, store, BrowserWindow }) => {
    const root = logsRoot(app);
    const monitor = createMemoryMonitor();
    const panel = createPanelFeed();

    const readState = () => {
        const stored = {
            runtimeLogEnabled: store.get(STORE_KEYS.runtimeLogEnabled),
            runtimeLogMode: store.get(STORE_KEYS.runtimeLogMode),
            consoleCaptureEnabled: store.get(STORE_KEYS.consoleCaptureEnabled),
            memoryMonitorEnabled: store.get(STORE_KEYS.memoryMonitorEnabled),
            memoryLogEnabled: store.get(STORE_KEYS.memoryLogEnabled),
            memoryLogMode: store.get(STORE_KEYS.memoryLogMode),
            memoryIntervalMs: store.get(STORE_KEYS.memoryIntervalMs),
        };
        return {
            runtimeLogEnabled: typeof stored.runtimeLogEnabled === 'boolean' ? stored.runtimeLogEnabled : DEFAULTS.runtimeLogEnabled,
            runtimeLogMode: MODES.includes(stored.runtimeLogMode) ? stored.runtimeLogMode : DEFAULTS.runtimeLogMode,
            consoleCaptureEnabled: stored.consoleCaptureEnabled !== false,
            memoryMonitorEnabled: stored.memoryMonitorEnabled === true,
            memoryLogEnabled: migrateMemoryLogEnabled(store, stored),
            memoryLogMode: MODES.includes(stored.memoryLogMode) ? stored.memoryLogMode : DEFAULTS.memoryLogMode,
            memoryIntervalMs: clampInterval(stored.memoryIntervalMs),
        };
    };

    let state = readState();
    let runtimeWriter = null;
    let memoryWriter = null;
    let memoryTimer = null;

    const describe = () => ({
        ...state,
        logsRoot: root,
        runtimeFile: runtimeWriter ? runtimeWriter.file : null,
        memoryFile: memoryWriter ? memoryWriter.file : null,
    });

    // ---- runtime log -------------------------------------------------------

    const openRuntime = () => {
        // Both switches: with the session log off nothing is kept, so there is nothing to write.
        if (runtimeWriter || !state.runtimeLogEnabled || !state.consoleCaptureEnabled) return;
        try {
            runtimeWriter = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: state.runtimeLogMode });
        } catch {
            // A log that cannot open is not a reason for the app not to start.
            runtimeWriter = null;
        }
    };

    const closeRuntime = () => {
        runtimeWriter?.close();
        runtimeWriter = null;
    };

    const writeRuntime = (at, level, tag, text) => {
        if (!runtimeWriter) return;
        const stamp = new Date(at).toISOString();
        // Credential values never reach the file, from any process (see redactCredentials.cjs).
        runtimeWriter.write(`${stamp} [${level}] ${tag ? `[${tag}] ` : ''}${redactCredentials(String(text)).replace(/\s+$/, '')}`);
    };

    // ---- memory log --------------------------------------------------------

    /**
     * What each process last said about itself, by pid. See memoryMonitor's `merge` for why this
     * exists at all: the metrics table covers every process but is missing `privateBytes` off
     * Windows, and a process asked directly has it everywhere.
     *
     * Entries expire. A renderer that has gone away would otherwise keep answering for a pid the
     * OS is free to hand to something else, which is a wrong number rather than a missing one.
     */
    const reports = new Map();
    const REPORT_TTL_MS = 30_000;

    const rememberReport = (report) => {
        if (!report || typeof report.pid !== 'number') return;
        reports.set(report.pid, { ...report, at: Date.now() });
    };

    const liveReports = () => {
        const cutoff = Date.now() - REPORT_TTL_MS;
        for (const [pid, report] of reports) if (report.at < cutoff) reports.delete(pid);
        return reports;
    };

    const takeSample = () => {
        let system = null;
        let heap = null;
        try { system = process.getSystemMemoryInfo(); } catch { /* not on this platform */ }
        try { heap = process.getHeapStatistics(); } catch { /* main-process heap unavailable */ }

        // Main answering for itself, the same way the renderer does. Not awaited: this returns a
        // promise, the sampler runs on a timer, and a figure one tick old on a two-second curve is
        // not worth making the whole sample path asynchronous for.
        process.getProcessMemoryInfo?.().then(memory => rememberReport({
            pid: process.pid,
            privateKB: memory.private,
            sharedKB: memory.shared,
            heapUsedKB: heap ? heap.usedHeapSize : undefined,
        })).catch(() => { /* unsupported, or the app is quitting */ });

        let sample;
        try {
            const metrics = app.getAppMetrics();
            sample = monitor.sample({ at: Date.now(), metrics, system, heap, reports: liveReports(), fdCounts: readFdCounts(metrics) });
        } catch (error) {
            writeRuntime(Date.now(), 'warn', 'Debug', `memory sample failed: ${(error && error.message) || error}`);
            return;
        }

        memoryWriter?.write(JSON.stringify(sample));
        // Pushed rather than polled: the sampling rate is decided here, and a window that is not
        // open simply has no listener. The renderer decides separately how often it redraws.
        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed() || window.webContents.isCrashed()) continue;
            try { window.webContents.send('debug-memory-sample', sample); } catch { /* closing */ }
        }
    };

    const stopMemory = () => {
        if (memoryTimer) { clearInterval(memoryTimer); memoryTimer = null; }
        memoryWriter?.close();
        memoryWriter = null;
        reports.clear();
    };

    const startMemory = () => {
        if (memoryTimer || !state.memoryMonitorEnabled) return;
        // Reset with the run, not with the app: peak / floor / mean answer for the session being
        // recorded, and carrying a figure across a switch-off makes the first sample after it lie.
        monitor.reset();
        // Only when asked to. Samples reach the live window either way - they are pushed to the
        // renderer below - so a run with no file still answers the question the window is open for.
        if (state.memoryLogEnabled) {
            try {
                memoryWriter = createDebugLogWriter({ root, folder: 'memory', extension: '.jsonl', mode: state.memoryLogMode });
            } catch {
                memoryWriter = null;
            }
        }
        memoryTimer = setInterval(takeSample, state.memoryIntervalMs);
        if (memoryTimer.unref) memoryTimer.unref();
        takeSample();
    };

    // ---- switches ----------------------------------------------------------

    const apply = (patch) => {
        const next = { ...state };
        if (typeof patch.runtimeLogEnabled === 'boolean') next.runtimeLogEnabled = patch.runtimeLogEnabled;
        if (MODES.includes(patch.runtimeLogMode)) next.runtimeLogMode = patch.runtimeLogMode;
        if (typeof patch.consoleCaptureEnabled === 'boolean') next.consoleCaptureEnabled = patch.consoleCaptureEnabled;
        if (typeof patch.memoryMonitorEnabled === 'boolean') next.memoryMonitorEnabled = patch.memoryMonitorEnabled;
        if (typeof patch.memoryLogEnabled === 'boolean') next.memoryLogEnabled = patch.memoryLogEnabled;
        if (MODES.includes(patch.memoryLogMode)) next.memoryLogMode = patch.memoryLogMode;
        if (patch.memoryIntervalMs !== undefined) next.memoryIntervalMs = clampInterval(patch.memoryIntervalMs);

        // A mode change has to reopen the file, not just be remembered: 'overwrite' truncates when
        // the writer opens, so a switch that only wrote the setting down would take effect at the
        // next launch and read, today, as having done nothing.
        const runtimeChanged = next.runtimeLogEnabled !== state.runtimeLogEnabled || next.runtimeLogMode !== state.runtimeLogMode
            || next.consoleCaptureEnabled !== state.consoleCaptureEnabled;
        // Switched off, the renderer drops the lines it was holding; so does this process.
        if (!next.consoleCaptureEnabled) panel.clear();
        const memoryChanged = next.memoryMonitorEnabled !== state.memoryMonitorEnabled
            || next.memoryLogEnabled !== state.memoryLogEnabled
            || next.memoryLogMode !== state.memoryLogMode
            || next.memoryIntervalMs !== state.memoryIntervalMs;

        state = next;
        for (const [key, storeKey] of Object.entries(STORE_KEYS)) store.set(storeKey, state[key]);

        if (runtimeChanged) { closeRuntime(); openRuntime(); }
        if (memoryChanged) { stopMemory(); startMemory(); }
        return describe();
    };

    // ---- wiring ------------------------------------------------------------

    ipcMain.handle('debug-get-state', () => describe());
    ipcMain.handle('debug-set-state', (_event, patch) => apply(patch && typeof patch === 'object' ? patch : {}));
    // One-way and batched by the renderer: a per-line round trip on a subsystem that logs forty
    // lines in a burst is exactly the overhead this module must not add.
    ipcMain.on('debug-runtime-lines', (_event, lines) => {
        if (!Array.isArray(lines)) return;
        for (const entry of lines) {
            if (!entry) continue;
            writeRuntime(entry.at || Date.now(), entry.level || 'log', entry.tag || null, entry.text ?? '');
        }
    });
    // The renderer's answer about itself, sent back one tick after each sample it receives.
    ipcMain.on('debug-renderer-memory', (_event, report) => rememberReport(report));
    ipcMain.handle('debug-open-logs', async (_event, which) => {
        const { shell } = require('electron');
        const path = require('path');
        const target = which === 'runtime' || which === 'memory' ? path.join(root, which) : root;
        try {
            require('fs').mkdirSync(target, { recursive: true });
            return (await shell.openPath(target)) === '';
        } catch {
            return false;
        }
    });

    ipcMain.on('debug-main-lines-ready', event => panel.subscribe(event.sender));

    // Main's own console into the same file and into the app's log panel. Patched rather than
    // routed through call sites so that everything already logging - the analysis worker's tee,
    // update checks, window handoff - lands in both without any of them knowing this module exists.
    for (const level of ['log', 'info', 'warn', 'error', 'debug']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            try {
                const at = Date.now();
                const text = consoleText(args);
                writeRuntime(at, level, 'main', text);
                if (state.consoleCaptureEnabled) panel.add(at, level, redactCredentials(text));
            } catch { /* never let logging break the thing that logged */ }
            original(...args);
        };
    }

    app.on('will-quit', () => {
        stopMemory();
        closeRuntime();
        host = null;
    });

    host = {
        runtimeLine: (tag, text) => writeRuntime(Date.now(), 'log', tag, text),
        describe,
        apply,
        stop: () => { stopMemory(); closeRuntime(); host = null; },
    };

    openRuntime();
    startMemory();
    writeRuntime(Date.now(), 'info', 'Debug', `runtime log ${state.runtimeLogEnabled ? state.runtimeLogMode : 'off'}, memory monitor ${state.memoryMonitorEnabled ? `${state.memoryIntervalMs}ms ${state.memoryLogEnabled ? state.memoryLogMode : 'no file'}` : 'off'}, root ${root}`);

    return host;
};

module.exports = { createDebugHost, createPanelFeed, consoleText, runtimeLine, migrateMemoryLogEnabled, readFdCounts, DEFAULTS };
