// electron/modSystem/guard.cjs
// The gate every main-process call into a mod's Node entry goes through. It is
// the .cjs twin of src/mods/runtime/guard.ts (this side cannot load a .ts file):
// a call is timed with two clock reads around its synchronous part, counted per
// mod, and a throw or a rejected promise is caught and handed to `report`.
// Where the loader already turns a failure into a result of its own (a failed
// load on the mod's status, an rpc answer of { ok: false }) the gate only times
// and counts, and the failure goes on to that handling.

'use strict';

// Reading `then` is itself a read of a mod's object, so it may not throw into the host either.
const isThenable = (value) => {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        return false;
    }
    try {
        return typeof value.then === 'function';
    } catch {
        return false;
    }
};

/*
 * `report(modId, where, error)` is called for a failure the gate caught.
 * Returns { call, getStats }.
 */
const createModGuard = (report) => {
    const statsByMod = new Map();

    const statsOf = (modId) => {
        let stats = statsByMod.get(modId);
        if (!stats) {
            stats = { calls: 0, totalMs: 0, longestMs: 0, failures: 0 };
            statsByMod.set(modId, stats);
        }
        return stats;
    };

    /*
     * One call into mod code. With `rethrow` the failure is the caller's: it is
     * counted, then thrown again, and a rejecting promise is handed back as it
     * is. Without it the failure is reported and the call yields undefined.
     */
    const call = (modId, where, fn, { rethrow = false } = {}) => {
        const stats = statsOf(modId);
        let result;
        let failure;
        let failed = false;
        const started = performance.now();
        try {
            result = fn();
        } catch (error) {
            failure = error;
            failed = true;
        }
        const elapsed = performance.now() - started;
        stats.calls += 1;
        stats.totalMs += elapsed;
        if (elapsed > stats.longestMs) {
            stats.longestMs = elapsed;
        }
        if (failed) {
            stats.failures += 1;
            if (rethrow) {
                throw failure;
            }
            report(modId, where, failure);
            return undefined;
        }
        if (isThenable(result)) {
            // Adopted once: a thenable that can be consumed only once is asked for its then() a
            // single time, and the caller awaits the adopted promise (a native promise is itself).
            const followed = Promise.resolve(result);
            followed.then(undefined, (error) => {
                stats.failures += 1;
                if (!rethrow) {
                    report(modId, where, error);
                }
            });
            return followed;
        }
        return result;
    };

    /** A copy of one mod's counters; null while the host never called into it. The mod's row in Settings shows them. */
    const getStats = (modId) => {
        const stats = statsByMod.get(modId);
        return stats ? { ...stats } : null;
    };

    return { call, getStats };
};

module.exports = { createModGuard, isThenable };
