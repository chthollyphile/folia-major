import {
    isConsoleCaptureEnabled,
    recordMainProcessLines,
    setConsoleLogSink,
    subscribeToConsoleLog,
    type ConsoleLogEntry,
} from '../../utils/consoleLogBuffer';

// src/services/debug/debugModule.ts
// The renderer's half of the developer debug module: the switches, and the pipe that sends console
// lines to the file the main process keeps.
//
// Everything here is optional-chained through `window.electron`. The browser build has no main
// process, so it has no log files either, and every function below is a no-op there rather than a
// feature that half-works. The switches still render - they just report the module as unavailable.

export type DebugLogMode = 'append' | 'overwrite';

export interface DebugModuleSnapshot {
    /** False in the browser build, and until the first answer from the main process arrives. */
    available: boolean;
    runtimeLogEnabled: boolean;
    runtimeLogMode: DebugLogMode;
    /** The session-log switch as the main process last heard it. See `syncCapture`. */
    consoleCaptureEnabled: boolean;
    memoryMonitorEnabled: boolean;
    memoryLogEnabled: boolean;
    memoryLogMode: DebugLogMode;
    memoryIntervalMs: number;
    logsRoot: string | null;
    runtimeFile: string | null;
    memoryFile: string | null;
}

const UNAVAILABLE: DebugModuleSnapshot = {
    available: false,
    runtimeLogEnabled: false,
    runtimeLogMode: 'append',
    consoleCaptureEnabled: true,
    memoryMonitorEnabled: false,
    memoryLogEnabled: false,
    memoryLogMode: 'overwrite',
    memoryIntervalMs: 2000,
    logsRoot: null,
    runtimeFile: null,
    memoryFile: null,
};

const bridge = () => (typeof window === 'undefined' ? undefined : window.electron);

let snapshot: DebugModuleSnapshot = UNAVAILABLE;
const listeners = new Set<() => void>();

const publish = (next: DebugModuleSnapshot) => {
    snapshot = next;
    listeners.forEach(listener => listener());
};

/** `useSyncExternalStore` reads this. Stable identity between changes, so React can compare it. */
export const getDebugModuleSnapshot = () => snapshot;

export const subscribeToDebugModule = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

const adopt = (state: DebugModuleState | undefined | null) => {
    if (!state) { publish(UNAVAILABLE); return; }
    publish({ available: true, ...state });
};

/** Re-reads the switches from the main process, which owns them. */
export const refreshDebugModule = async () => {
    try {
        adopt(await bridge()?.debugGetState?.());
    } catch {
        publish(UNAVAILABLE);
    }
};

/**
 * Flips a switch and adopts whatever the main process says the state became.
 *
 * The answer is authoritative rather than optimistic on purpose: a mode change REOPENS the file, so
 * "which file is being written" changes with it, and the settings page shows that path. Guessing it
 * would show a filename nothing is writing to.
 */
export const setDebugModuleState = async (patch: Partial<Pick<DebugModuleSnapshot,
    'runtimeLogEnabled' | 'runtimeLogMode' | 'consoleCaptureEnabled' | 'memoryMonitorEnabled' | 'memoryLogEnabled' | 'memoryLogMode' | 'memoryIntervalMs'>>) => {
    try {
        adopt(await bridge()?.debugSetState?.(patch));
    } catch {
        // Left as it was: reporting a switch as flipped when the write failed is worse than the
        // switch appearing not to move.
    }
};

/** Opens the log folder in the OS file manager. False when there is nothing to open. */
export const openDebugLogsFolder = async (which?: 'runtime' | 'memory') => {
    try {
        return (await bridge()?.debugOpenLogs?.(which)) ?? false;
    } catch {
        return false;
    }
};

// ---- runtime log pipe ------------------------------------------------------

/**
 * How long a line waits for company before it is sent.
 *
 * One IPC message per console line would be a real cost on a subsystem that logs in bursts - a
 * prefetch pass writes forty in a few milliseconds - and this module exists to diagnose overhead,
 * not to add it. A second of latency on a file nobody is tailing live is free.
 */
const BATCH_MS = 1000;
/** Send early rather than hold more than this. Keeps a burst out of the renderer's own memory. */
const BATCH_MAX = 200;

type RuntimeLine = { at: number; level: string; tag: string | null; text: string };
let queue: RuntimeLine[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Startup lines held until the main process says whether the runtime log is even on.
 *
 * The switch's real value arrives over an async IPC (see `installDebugModule`), and until it does
 * `snapshot.runtimeLogEnabled` is its `false` default - so a naive `enqueue` drops every line logged
 * before that answer, which is exactly the startup burst this pipe was installed early to catch. These
 * are buffered instead and either flushed or discarded once the answer is in. Bounded so a bridge that
 * never answers cannot grow it without end.
 */
let startupBuffer: RuntimeLine[] = [];
let stateKnown = false;
const STARTUP_MAX = 2000;

const flush = () => {
    if (batchTimer) { clearTimeout(batchTimer); batchTimer = null; }
    if (!queue.length) return;
    const lines = queue;
    queue = [];
    try { bridge()?.debugWriteRuntimeLines?.(lines); } catch { /* the window is going away */ }
};

/** Called once the first main-process answer is in: keep the startup lines if logging is on, else drop. */
const settleStartupBuffer = () => {
    stateKnown = true;
    const held = startupBuffer;
    startupBuffer = [];
    if (!held.length) return;
    if (!snapshot.runtimeLogEnabled) return; // logging off, or browser build - discard, do not write
    queue = held.concat(queue);
    flush();
};

const enqueue = (entry: ConsoleLogEntry) => {
    const line: RuntimeLine = { at: entry.at, level: entry.level, tag: entry.scope, text: entry.text };
    // Before the first answer, buffer regardless: dropping on the not-yet-known default is what lost
    // the startup lines. Once known, read the switch live - it lives in a settings page that can be
    // flipped mid-session, so a pipe that checked once at install would keep writing after it was off.
    if (!stateKnown) {
        if (startupBuffer.length < STARTUP_MAX) startupBuffer.push(line);
        return;
    }
    if (!snapshot.runtimeLogEnabled) return;
    queue.push(line);
    if (queue.length >= BATCH_MAX) { flush(); return; }
    if (batchTimer) return;
    batchTimer = setTimeout(flush, BATCH_MS);
};

/**
 * Keeps the main process told whether the session log is on.
 *
 * The switch lives in the renderer, because the browser build has it too. The main process owns
 * the log file and its own console lines, and off has to mean off for those as well: nothing in
 * the panel and a file still being written is two answers to one switch. Null until the main
 * process has said what it holds, and for good in the browser build.
 */
let captureAtMain: boolean | null = null;
const syncCapture = () => {
    const enabled = isConsoleCaptureEnabled();
    if (captureAtMain === null || captureAtMain === enabled) return;
    captureAtMain = enabled;
    void setDebugModuleState({ consoleCaptureEnabled: enabled });
};

/**
 * Starts the module. Idempotent, and safe to call before the main process has answered.
 *
 * Called from bootstrap rather than from a component: the lines worth having are the startup ones,
 * and a pipe that opens when a settings page first renders misses every one of them.
 */
let installed = false;
export const installDebugModule = () => {
    if (installed || typeof window === 'undefined') return;
    installed = true;
    setConsoleLogSink(enqueue);
    // The main process's console joins the panel, whether or not the file is being written.
    bridge()?.onDebugMainLines?.(recordMainProcessLines);
    // A buffered line is worth less than the crash it was recorded during.
    window.addEventListener('pagehide', flush);
    // The first answer decides the fate of everything logged before it arrived. `finally`, not
    // `then`: a rejected refresh leaves the snapshot UNAVAILABLE, which is the correct "discard" case.
    void refreshDebugModule().finally(() => {
        // Before the startup lines are sent: the main process opens the file on this message, and
        // the lines behind it are then written, not dropped.
        captureAtMain = snapshot.available ? snapshot.consoleCaptureEnabled : null;
        syncCapture();
        settleStartupBuffer();
    });
    // The buffer tells its listeners about the switch as well as about every line.
    subscribeToConsoleLog(syncCapture);
};
