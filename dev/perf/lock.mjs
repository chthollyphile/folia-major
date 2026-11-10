import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dev/perf/lock.mjs
// One measuring run at a time on this PC. The tools under dev/perf hold the same slow processors
// (the `laptop` and `old` profiles) and read the same graphics card, whichever worktree of the
// repository they are started in: two at once spoil each other's numbers. A run takes this lock
// before it starts anything that is measured and before it looks at what other programs do:
//
//   import { holdMeasuringLock } from '../lock.mjs';
//   await holdMeasuringLock('dev/perf/app/run.mjs --baseline');
//
// The lock is one file in the system's temp folder (the same for every worktree), made
// exclusively, that says which process holds it, what that process runs, in which worktree, and
// since when. While another live process holds it the caller waits, without a time limit, and
// looks again every few seconds. A lock whose process is gone (a runner that was killed) is taken
// over. The file is removed when the holding process ends in a way node sees (it returns, calls
// process.exit, or handles a signal and exits).
//
// Windows gives the number of a process that has ended to a new one after a while. The lock
// therefore also says when its holder was created: a live process with that number that was created
// at another time is not the holder, and the lock is taken over. (Windows only, and only when it
// tells this process the other one's start time; otherwise such a lock reads as held, and the line
// that is printed while waiting names the file to delete.)
//
// What it does not know: the file is in os.tmpdir(), which follows the TEMP variable. A shell with
// another TEMP has another lock.

const LOCK_FILE = path.join(os.tmpdir(), 'folia-perf-measuring.lock');
/** Held for an instant by the one process that is removing a dead run's lock. */
const TAKEOVER_FILE = `${LOCK_FILE}.takeover`;
const LOOK_AGAIN_MS = 3000;
/** A file that cannot be read and is older than this was left by a process that died while writing it. */
const LEFT_HALF_WRITTEN_MS = 10_000;
/** Two start times of one process, read at different moments, differ by less than this. */
const SAME_PROCESS_MS = 5000;
/** How long an answer about who has a holder's number is kept before Windows is asked again. */
const ASK_AGAIN_MS = 10 * 60_000;
const WORKTREE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const sleep = ms => new Promise((resolve) => { setTimeout(resolve, ms); });

export const isAlive = (pid) => {
    try {
        // Signal 0 sends nothing: it only asks whether the process is there.
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code === 'EPERM';
    }
};

/** What the lock file says: null when there is none, `{ unreadable, ageMs }` when it holds no record yet. */
const readLock = () => {
    try {
        const ageMs = Date.now() - fs.statSync(LOCK_FILE).mtimeMs;
        try {
            const record = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
            return Number.isInteger(record?.pid) ? record : { unreadable: true, ageMs };
        } catch (error) {
            return error.code === 'ENOENT' ? null : { unreadable: true, ageMs };
        }
    } catch {
        return null;
    }
};

/** When a process was created, in ms since 1970; null when this is not Windows or Windows does not say. */
const createdAt = (pid) => {
    if (process.platform !== 'win32') {
        return null;
    }
    try {
        const text = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
            `[DateTimeOffset]::new((Get-Process -Id ${Number(pid)}).StartTime).ToUnixTimeMilliseconds()`],
        { encoding: 'utf8', timeout: 20_000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
        const value = Number(text.trim());
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
};

/** What Windows said about a holder's number, by lock record: asking starts a PowerShell, so not at every look. */
const asked = new Map();

/** True when the process that has the holder's number now was created at another time than the holder. */
const isNumberHandedOn = (holder) => {
    if (typeof holder.createdAt !== 'number') {
        // Written by a copy of this file that did not say it.
        return false;
    }
    const key = `${holder.pid} ${holder.startedAt}`;
    const last = asked.get(key);
    if (!last || Date.now() - last.at > ASK_AGAIN_MS) {
        asked.set(key, { at: Date.now(), value: createdAt(holder.pid) });
    }
    const now = asked.get(key).value;
    return now !== null && Math.abs(now - holder.createdAt) > SAME_PROCESS_MS;
};

let held = false;

/** True for a lock nobody holds any more: its process is gone, or it was never written to the end. */
const isLeftBehind = holder => (holder.unreadable
    ? holder.ageMs > LEFT_HALF_WRITTEN_MS
    // This process's own number in a lock it does not hold: the number was handed out again.
    : !isAlive(holder.pid) || (holder.pid === process.pid && !held) || isNumberHandedOn(holder));

/**
 * Removes the lock of a run that is gone, and returns what it said. Only one process at a time
 * does this (a second file, made exclusively), and it looks at the lock again once it is the one:
 * a lock that another waiting run has just taken is never the one removed.
 */
const removeDeadLock = () => {
    let handle;
    try {
        handle = fs.openSync(TAKEOVER_FILE, 'wx');
    } catch {
        // Another run is at it right now, or one died in the middle of it a while ago.
        try {
            if (Date.now() - fs.statSync(TAKEOVER_FILE).mtimeMs > LEFT_HALF_WRITTEN_MS) {
                fs.rmSync(TAKEOVER_FILE, { force: true });
            }
        } catch {
            // It is gone already.
        }
        return null;
    }
    try {
        const holder = readLock();
        if (holder && isLeftBehind(holder)) {
            fs.rmSync(LOCK_FILE, { force: true });
            return holder;
        }
        return null;
    } finally {
        fs.closeSync(handle);
        fs.rmSync(TAKEOVER_FILE, { force: true });
    }
};

const release = () => {
    try {
        if (JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8')).pid === process.pid) {
            fs.rmSync(LOCK_FILE, { force: true });
        }
    } catch {
        // No file, or not this process's: nothing to give back.
    }
};

/**
 * Takes the lock for this process and returns once it holds it. `what` is said to a run that has
 * to wait for this one (the command line is a good value). Returns the lock file and how long the
 * wait was.
 */
export const holdMeasuringLock = async (what) => {
    const askedAt = Date.now();
    let toldOf = null;
    let withoutAnswer = 0;
    const myCreation = createdAt(process.pid);
    while (!held) {
        const mine = { pid: process.pid, what: String(what), worktree: WORKTREE, startedAt: new Date().toISOString(), ...(myCreation === null ? {} : { createdAt: myCreation }) };
        try {
            fs.writeFileSync(LOCK_FILE, `${JSON.stringify(mine, null, 2)}\n`, { flag: 'wx' });
            held = true;
            process.on('exit', release);
            break;
        } catch (error) {
            // EPERM: Windows is still removing the file the last holder deleted.
            if (!['EEXIST', 'EPERM', 'EBUSY'].includes(error.code)) {
                throw error;
            }
        }
        const holder = readLock();
        if (holder && isLeftBehind(holder)) {
            const dead = removeDeadLock();
            if (dead) {
                console.log(`[perf] the measuring lock was left by a run that is gone (${dead.unreadable ? 'it never wrote who it was' : `process ${dead.pid}, ${dead.what}, in ${dead.worktree}, started ${dead.startedAt}`}): taken over`);
            }
            await sleep(100);
            continue;
        }
        if (holder && !holder.unreadable) {
            const who = `${holder.pid} ${holder.startedAt}`;
            if (toldOf !== who) {
                toldOf = who;
                console.log(`[perf] waiting: another measuring run holds this PC since ${holder.startedAt}: ${holder.what}, in ${holder.worktree} (process ${holder.pid}). This run starts when that one has ended. (If no such run exists any more, delete ${LOCK_FILE}.)`);
            }
            await sleep(LOOK_AGAIN_MS);
            continue;
        }
        // No file any more, or one that is being written this instant.
        withoutAnswer = holder ? 0 : withoutAnswer + 1;
        if (withoutAnswer > 100) {
            throw new Error(`[perf] the measuring lock ${LOCK_FILE} can be neither made nor read`);
        }
        await sleep(100);
    }
    return { file: LOCK_FILE, waitedMs: Date.now() - askedAt };
};
