const fs = require('fs');
const path = require('path');

// electron/debug/debugLogWriter.cjs
// The only thing in the debug module that touches disk.
//
// One writer per log KIND, and the kind is the directory: `logs/runtime` never sees a memory
// sample and `logs/memory` never sees a console line. That separation is the point of the module -
// the two are read for different questions ("what happened" vs "what did it cost"), and a memory
// curve at one sample every two seconds buries a runtime log it shares a file with.
//
// Buffered, because the reason this exists is to diagnose a performance problem and a logger that
// syscalls per line is a new one. Lines accumulate and go out on a timer; `MAX_PENDING` is the
// escape hatch for a burst that would otherwise sit in memory until the timer fires.

/** How long a line may sit in memory before it is on disk. */
const FLUSH_MS = 1000;
/** Flush early rather than hold this many lines. */
const MAX_PENDING = 400;
/** Files older than this are removed when a writer opens. Disk, not memory - see `prune`. */
const KEEP_DAYS = 7;

const dayStamp = (at = new Date()) => at.toISOString().slice(0, 10);

/**
 * Drops log files older than `KEEP_DAYS`.
 *
 * A memory log at one sample every two seconds is ~40k lines a day. Nothing else in the app would
 * ever clean that up, and a debug module that fills a disk is worse than no debug module. Only
 * files this writer's own naming produces are considered.
 */
const prune = (dir, extension) => {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith(extension)) continue;
        const stamp = Date.parse(name.slice(0, 10));
        if (Number.isNaN(stamp) || stamp >= cutoff) continue;
        try { fs.unlinkSync(path.join(dir, name)); } catch { /* in use, or already gone */ }
    }
};

/**
 * @param root      the `logs` directory - see `logsRoot`.
 * @param folder    'runtime' or 'memory'. Created if absent, which is the first-launch case.
 * @param extension '.log' or '.jsonl'. One file per day, so the name answers "when" on its own.
 * @param mode      'overwrite' truncates today's file when the writer opens; 'append' keeps it.
 *                  Overwrite is per SESSION, not per line: reopening mid-session would erase the
 *                  session that is still being recorded.
 */
const createDebugLogWriter = ({ root, folder, extension, mode }) => {
    const dir = path.join(root, folder);
    fs.mkdirSync(dir, { recursive: true });
    try { prune(dir, extension); } catch { /* unreadable directory is not worth failing over */ }

    let day = dayStamp();
    let file = path.join(dir, `${day}${extension}`);
    // A descriptor and `writeSync`, not a write stream. Batching already removes the per-line cost,
    // and what a stream adds back is a write that has not landed when the process exits - which for
    // a log whose whole job is to survive a crash is the one failure that matters. `will-quit` gets
    // no time to drain an async stream; a synchronous flush of a few kilobytes once a second is free.
    let fd = null;
    try { fd = fs.openSync(file, mode === 'overwrite' ? 'w' : 'a'); } catch { fd = null; }

    let pending = [];
    let timer = null;

    const flush = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (!pending.length || fd === null) { pending = []; return; }
        const chunk = pending.join('');
        pending = [];
        try { fs.writeSync(fd, chunk); } catch { /* disk full, permissions, folder removed under us */ }
    };

    // The day is fixed in the file name and the descriptor at open, so a session that runs past
    // midnight would write tomorrow into today's file and never prune again - both "one file per day"
    // and KEEP_DAYS quietly stop holding on a desktop left playing overnight. Checked lazily on the
    // next write rather than on a timer: a date compare is free, and a rotation with nothing to log is
    // pointless. Pending lines are flushed to the day they were written on before the descriptor moves.
    const rollIfNewDay = () => {
        const today = dayStamp();
        if (today === day) return;
        flush();
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* already closed */ } }
        day = today;
        file = path.join(dir, `${day}${extension}`);
        try { prune(dir, extension); } catch { /* unreadable directory is not worth failing over */ }
        // 'a', never 'w': overwrite is a per-SESSION reset (see the param doc), and a new day inside
        // one session is a continuation of it, not a new session.
        try { fd = fs.openSync(file, 'a'); } catch { fd = null; }
    };

    return {
        // A getter, not a value: the name changes when the day rolls, and callers read this to report
        // where the log is (see debugHost's getState). A captured string would name yesterday's file.
        get file() { return file; },
        dir,
        write(line) {
            rollIfNewDay();
            pending.push(line.endsWith('\n') ? line : `${line}\n`);
            if (pending.length >= MAX_PENDING) { flush(); return; }
            if (timer) return;
            timer = setTimeout(flush, FLUSH_MS);
            // So a buffered line never keeps a quitting app alive.
            if (timer.unref) timer.unref();
        },
        flush,
        close() {
            flush();
            if (fd === null) return;
            try { fs.closeSync(fd); } catch { /* already closed */ }
            fd = null;
        },
    };
};

/** `<userData>/logs`. Created on demand, so a first launch never fails on a missing directory. */
const logsRoot = (app) => {
    const root = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(root, { recursive: true });
    return root;
};

module.exports = { createDebugLogWriter, logsRoot, dayStamp };
