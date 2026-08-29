const { createDebugLogWriter, logsRoot } = require('./debugLogWriter.cjs');
const { createMemoryMonitor } = require('./memoryMonitor.cjs');

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
    // Off by default: this one costs a timer, a metrics call across every process, and a file that
    // grows all session. It is switched on to answer a question, not left running.
    memoryMonitorEnabled: false,
    memoryLogMode: 'overwrite',
    memoryIntervalMs: 2000,
};

const STORE_KEYS = {
    runtimeLogEnabled: 'debug_runtime_log_enabled',
    runtimeLogMode: 'debug_runtime_log_mode',
    memoryMonitorEnabled: 'debug_memory_monitor_enabled',
    memoryLogMode: 'debug_memory_log_mode',
    memoryIntervalMs: 'debug_memory_interval_ms',
};

const MODES = ['append', 'overwrite'];
/** Below a second the samples say more about the sampler than the app; above a minute it is not a curve. */
const clampInterval = (value) => Math.min(60_000, Math.max(1000, Math.round(Number(value) || DEFAULTS.memoryIntervalMs)));

/**
 * The live host, or null before startup / after quit.
 *
 * A module-level singleton on purpose: `runtimeLine` is called from subsystems that are constructed
 * during main's own startup and have no business being handed a logger. Before the host exists, and
 * after it is gone, those calls are no-ops rather than errors.
 */
let host = null;

/**
 * One line into the runtime log. Safe to call from anywhere in the main process, at any time.
 * `tag` is the `[Prefix]` convention the rest of the app already logs under - see docs/client-logging.md.
 */
const runtimeLine = (tag, text) => {
    host?.runtimeLine(tag, text);
};

const createDebugHost = ({ app, ipcMain, store, BrowserWindow }) => {
    const root = logsRoot(app);
    const monitor = createMemoryMonitor();

    const readState = () => {
        const stored = {
            runtimeLogEnabled: store.get(STORE_KEYS.runtimeLogEnabled),
            runtimeLogMode: store.get(STORE_KEYS.runtimeLogMode),
            memoryMonitorEnabled: store.get(STORE_KEYS.memoryMonitorEnabled),
            memoryLogMode: store.get(STORE_KEYS.memoryLogMode),
            memoryIntervalMs: store.get(STORE_KEYS.memoryIntervalMs),
        };
        return {
            runtimeLogEnabled: typeof stored.runtimeLogEnabled === 'boolean' ? stored.runtimeLogEnabled : DEFAULTS.runtimeLogEnabled,
            runtimeLogMode: MODES.includes(stored.runtimeLogMode) ? stored.runtimeLogMode : DEFAULTS.runtimeLogMode,
            memoryMonitorEnabled: stored.memoryMonitorEnabled === true,
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
        if (runtimeWriter || !state.runtimeLogEnabled) return;
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
        runtimeWriter.write(`${stamp} [${level}] ${tag ? `[${tag}] ` : ''}${String(text).replace(/\s+$/, '')}`);
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
            sample = monitor.sample({ at: Date.now(), metrics: app.getAppMetrics(), system, heap, reports: liveReports() });
        } catch (error) {
            writeRuntime(Date.now(), 'warn', 'Debug', `memory sample failed: ${(error && error.message) || error}`);
            return;
        }

        memoryWriter?.write(JSON.stringify(sample));
        // Pushed rather than polled: the sampling rate is decided here, and a window that is not
        // open simply has no listener. The renderer decides separately how often it redraws.
        for (const window of BrowserWindow.getAllWindows()) {
            if (window.isDestroyed()) continue;
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
        try {
            memoryWriter = createDebugLogWriter({ root, folder: 'memory', extension: '.jsonl', mode: state.memoryLogMode });
        } catch {
            memoryWriter = null;
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
        if (typeof patch.memoryMonitorEnabled === 'boolean') next.memoryMonitorEnabled = patch.memoryMonitorEnabled;
        if (MODES.includes(patch.memoryLogMode)) next.memoryLogMode = patch.memoryLogMode;
        if (patch.memoryIntervalMs !== undefined) next.memoryIntervalMs = clampInterval(patch.memoryIntervalMs);

        // A mode change has to reopen the file, not just be remembered: 'overwrite' truncates when
        // the writer opens, so a switch that only wrote the setting down would take effect at the
        // next launch and read, today, as having done nothing.
        const runtimeChanged = next.runtimeLogEnabled !== state.runtimeLogEnabled || next.runtimeLogMode !== state.runtimeLogMode;
        const memoryChanged = next.memoryMonitorEnabled !== state.memoryMonitorEnabled
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

    // Main's own console into the same file. Patched rather than routed through call sites so that
    // everything already logging - the analysis worker's tee, update checks, window handoff - lands
    // in the runtime log without any of them knowing this module exists.
    for (const level of ['log', 'info', 'warn', 'error']) {
        const original = console[level].bind(console);
        console[level] = (...args) => {
            try {
                writeRuntime(Date.now(), level, 'main', args.map(value => (
                    typeof value === 'string' ? value : (value instanceof Error ? (value.stack || value.message) : JSON.stringify(value))
                )).join(' '));
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
    writeRuntime(Date.now(), 'info', 'Debug', `runtime log ${state.runtimeLogEnabled ? state.runtimeLogMode : 'off'}, memory monitor ${state.memoryMonitorEnabled ? `${state.memoryIntervalMs}ms ${state.memoryLogMode}` : 'off'}, root ${root}`);

    return host;
};

module.exports = { createDebugHost, runtimeLine, DEFAULTS };
