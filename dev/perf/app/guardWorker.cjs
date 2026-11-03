'use strict';

// dev/perf/app/guardWorker.cjs
// Runs in every worker thread the app starts, before the worker's own script (guard.cjs sees to
// that). A worker thread has its own copies of node's modules, so the locks the guard put on the
// main thread's do not hold in it; this puts the same ones on the worker's (locks.cjs). Without
// it a request made in a worker thread would leave this machine.

const fs = require('node:fs');
const path = require('node:path');
const { threadId } = require('node:worker_threads');
const { installLocks } = require('./locks.cjs');

const say = (kind, data = {}) => {
    try {
        process.stdout.write(`[perf-app] ${JSON.stringify({ kind, t: Date.now(), thread: threadId, ...data })}\n`);
    } catch {
        // The runner's pipe is gone; the main thread's watch ends the process.
    }
};

// The worker has the main thread's environment: the process's own when it was started with
// SHARE_ENV (the app's Netease API worker is), else a copy made when the worker was started.
const profile = process.env.PERF_APP_PROFILE_DIR ? path.resolve(process.env.PERF_APP_PROFILE_DIR) : '';
if (!profile || !fs.existsSync(profile)) {
    // No folder to hold the worker to: it does not run. (The app sees a worker that failed.)
    throw new Error(`the perf guard cannot hold a worker thread without PERF_APP_PROFILE_DIR ("${profile}")`);
}
installLocks({ profile, say });
say('worker-guarded');
