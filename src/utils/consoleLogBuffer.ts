// src/utils/consoleLogBuffer.ts
// Keeps the last few hundred console lines in memory, so the debug overlay can show them.
//
// The packaged desktop build has no console at all: DevTools are only opened automatically under
// ELECTRON_DEV, and the window is frameless, so there is no menu left to toggle them from. Every
// diagnosis of a playback problem starts with what the app logged while it was running, and on the
// desktop build that was simply unavailable - the only way to read it was to run the web build
// instead, which is a different runtime from the one with the problem in it.

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

export interface ConsoleLogEntry {
    id: number;
    at: number;
    level: ConsoleLevel;
    text: string;
    /** The `[Module]` this line announced itself as, or null when it did not. See `readScope`. */
    scope: string | null;
}

/**
 * The subsystem a line came from, read off the `[Prefix]` almost every call site already writes.
 *
 * Free structure: `[Automix]`, `[Prefetch]`, `[KugouLibrary]` and the rest are a convention the
 * whole app follows, and nothing was reading them. Recorded per line rather than re-parsed per
 * render because it is a property OF the line and never changes after it is written.
 *
 * Left in `text` on purpose. Stripping it would make every copied log a slightly different format
 * from the one people already recognise, for no gain.
 */
const readScope = (text: string): string | null => /^\[([^\]\s]{1,40})\]/.exec(text)?.[1] ?? null;

/** Bounded, because this runs for the whole life of the app and a long session logs a lot. */
const LIMIT = 1000;

let entries: ConsoleLogEntry[] = [];
let nextId = 0;
const listeners = new Set<() => void>();

/**
 * One console argument as a line of text.
 *
 * Never throws, and that is the whole requirement: this runs *inside* console, so anything escaping
 * here would take down a call site whose only crime was logging. Circular structures are the normal
 * case rather than the exception - DOM nodes, audio nodes, React fibers - and JSON.stringify
 * refuses those outright.
 */
const format = (value: unknown): string => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`;
    try {
        const seen = new WeakSet<object>();
        return JSON.stringify(value, (_key, item: unknown) => {
            if (typeof item !== 'object' || item === null) return item;
            if (seen.has(item)) return '[circular]';
            seen.add(item);
            return item;
        }) ?? String(value);
    } catch {
        return String(value);
    }
};

const CAPTURE_KEY = 'console_log_capture';

/**
 * Whether lines are recorded at all.
 *
 * Default ON, and that is the only defensible default: the whole reason this buffer exists is that
 * the packaged desktop build has no console, so a log that has to be switched on BEFORE the problem
 * happens is a log nobody ever has when they need one. The switch is here for someone who wants the
 * app to spend nothing on it, not as a gate on the feature.
 */
let capturing = (() => {
    if (typeof window === 'undefined') return true;
    try {
        return localStorage.getItem(CAPTURE_KEY) !== 'off';
    } catch {
        return true;
    }
})();

export const isConsoleCaptureEnabled = () => capturing;

export const setConsoleCaptureEnabled = (enabled: boolean) => {
    capturing = enabled;
    try {
        localStorage.setItem(CAPTURE_KEY, enabled ? 'on' : 'off');
    } catch {
        // Blocked storage: the choice still applies to this session, it just does not last.
    }
    // Holding on to lines somebody just said they did not want is the wrong answer, and it also
    // makes the panel's line count lie about what is still being collected.
    if (!enabled) clearConsoleLog();
    listeners.forEach(listener => listener());
};

/**
 * Where lines go besides this buffer, or null for nowhere.
 *
 * A registered sink rather than an import, so this file keeps depending on nothing: it is installed
 * before anything else in the app and a dependency here is a dependency in every startup path. The
 * debug module registers itself once the app is running - see services/debug/runtimeLogSink.ts.
 */
let sink: ((entry: ConsoleLogEntry) => void) | null = null;

export const setConsoleLogSink = (next: ((entry: ConsoleLogEntry) => void) | null) => {
    sink = next;
};

const push = (level: ConsoleLevel, args: unknown[]) => {
    // Before the formatting, not after: turning capture off has to stop the work, not just the
    // storing. Serialising every console argument is the expensive half.
    if (!capturing) return;
    const text = args.map(format).join(' ');
    // A new array rather than a mutated one: useSyncExternalStore compares snapshots by identity,
    // and a buffer changed in place would leave the panel rendering a list it thinks is current.
    entries = entries.concat({
        id: nextId += 1,
        at: Date.now(),
        level,
        text,
        scope: readScope(text),
    });
    if (entries.length > LIMIT) entries = entries.slice(entries.length - LIMIT);
    // After the buffer, and never allowed to throw back into it: a sink that fails is a log that is
    // not written, not a console call that raises inside whatever was being logged about.
    if (sink) {
        try { sink(entries[entries.length - 1]); } catch { /* the sink's problem, not the caller's */ }
    }
    listeners.forEach(listener => listener());
};

export const getConsoleLogEntries = () => entries;

export const subscribeToConsoleLog = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
};

export const clearConsoleLog = () => {
    entries = [];
    listeners.forEach(listener => listener());
};

/**
 * Lines as plain text, which is the form they are useful in outside the app.
 *
 * Takes a list rather than always using the whole buffer: the reason to copy a log is to hand it
 * to someone, and a thousand lines is not a handover. What is worth pasting is the handful around
 * the problem, so the panel passes in whatever the reader has narrowed the view down to.
 */
export const formatConsoleLog = (list: readonly ConsoleLogEntry[] = entries) => list
    .map(entry => `${new Date(entry.at).toLocaleTimeString()} [${entry.level}] ${entry.text}`)
    .join('\n');

let installed = false;

/** Call once, as early as possible - anything logged before this is not recorded. */
export const installConsoleLogCapture = () => {
    if (installed) return;
    installed = true;

    (['log', 'info', 'warn', 'error', 'debug'] as const).forEach(level => {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
            push(level, args);
            original(...args);
        };
    });

    // Out of console's reach: an exception nobody caught is printed by the browser itself, not
    // through console, so patching console alone would leave the panel blank for exactly the
    // failure worth reading.
    window.addEventListener('error', event => push('error', [event.error ?? event.message]));
    window.addEventListener('unhandledrejection', event => push('error', ['Unhandled rejection:', event.reason]));
};
