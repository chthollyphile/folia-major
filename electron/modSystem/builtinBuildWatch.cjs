// electron/modSystem/builtinBuildWatch.cjs
// Development builds only (Folium 2.0 plan §6.2): the built-in mods folder is dist-mods/, which
// dev/sources/build.mjs writes, in --watch mode on every change of a source. The build writes each mod's
// `build.json` (the fingerprint of everything it wrote) last; this watches for that file and asks for a
// differential reload, so only the mod whose fingerprint moved is restarted (its version token carries the
// fingerprint, see `readBuildFingerprint`). A packaged app never watches: resources/builtin-mods is read-only.

'use strict';

const fs = require('fs');
const path = require('path');

const BUILD_STAMP = 'build.json';

/** The fingerprint dev/sources/build.mjs stamped on the mod folder `dirPath`, or null when it has none. */
const readBuildFingerprint = (dirPath, fsModule = fs) => {
    try {
        const stamp = JSON.parse(fsModule.readFileSync(path.join(dirPath, BUILD_STAMP), 'utf8'));
        return typeof stamp?.fingerprint === 'string' && /^[0-9a-f]{8,64}$/.test(stamp.fingerprint) ? stamp.fingerprint : null;
    } catch {
        return null;
    }
};

/*
 * Watches `directory` (recursively) for a written build.json and calls `onChange` once per burst of them
 * (`debounceMs`). A folder that is not there yet (no build has run) is looked for again every `retryMs`; so is
 * one whose watcher failed. `watch` and `exists` are for tests.
 */
const createBuiltinBuildWatch = ({
    directory, onChange, debounceMs = 200, retryMs = 2000,
    watch = (dir, listener) => fs.watch(dir, { recursive: true }, listener),
    exists = (dir) => fs.existsSync(dir),
}) => {
    let watcher = null;
    let retry = null;
    let pending = null;
    let stopped = true;
    // Neither the watcher nor its timers keep a process alive on their own (a test's loader, a quitting app).
    const later = (fn, ms) => {
        const timer = setTimeout(fn, ms);
        timer.unref?.();
        return timer;
    };

    const fire = () => {
        clearTimeout(pending);
        pending = later(() => {
            pending = null;
            if (!stopped) onChange();
        }, debounceMs);
    };

    // `late`: the folder (or a working watcher) came after the start, so a build may have landed unseen.
    const attach = (late = false) => {
        retry = null;
        if (stopped) return;
        if (!exists(directory)) {
            retry = later(() => attach(true), retryMs);
            return;
        }
        try {
            watcher = watch(directory, (_event, filename) => {
                if (filename && path.basename(String(filename)) === BUILD_STAMP) fire();
            });
            watcher.unref?.();
            watcher.on?.('error', () => {
                watcher?.close();
                watcher = null;
                if (!stopped) retry = later(() => attach(true), retryMs);
            });
            // Whatever was built while nobody watched counts as a change.
            if (late) fire();
        } catch {
            watcher = null;
            retry = later(() => attach(true), retryMs);
        }
    };

    return {
        start: () => {
            if (!stopped) return;
            stopped = false;
            attach();
        },
        stop: () => {
            stopped = true;
            clearTimeout(retry);
            clearTimeout(pending);
            retry = null;
            pending = null;
            watcher?.close();
            watcher = null;
        },
    };
};

module.exports = { BUILD_STAMP, readBuildFingerprint, createBuiltinBuildWatch };
