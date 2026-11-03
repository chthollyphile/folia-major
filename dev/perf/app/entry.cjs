'use strict';

// dev/perf/app/entry.cjs
// The script dev/perf/app/launch.mjs starts Electron with. It puts the guard in place
// (dev/perf/app/guard.cjs) and only then loads the app's own main script, electron/main.cjs. The
// order is the point: main.cjs can never run without the guard, because this file is the only
// thing that loads it, and it ends the process instead when the guard could not be put in place.

let guard;
try {
    guard = require('./guard.cjs');
} catch (error) {
    try {
        require('node:fs').writeSync(1, `[perf-app] ${JSON.stringify({ kind: 'abort', t: Date.now(), reason: `the guard could not be put in place: ${String(error?.stack ?? error).slice(0, 600)}` })}\n`);
    } catch {
        // Nothing to write to.
    }
    process.exit(97);
}

guard.say('main-script-started');
const began = performance.now();
require(guard.MAIN_SCRIPT);
guard.say('main-script-evaluated', {
    ms: Number((performance.now() - began).toFixed(1)),
    // The slowest of the require() calls written in main.cjs itself.
    requires: [...guard.requireTimes].sort((left, right) => right.ms - left.ms).slice(0, 12),
});
