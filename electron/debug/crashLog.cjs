const fs = require('fs');
const os = require('os');
const path = require('path');

// electron/debug/crashLog.cjs
// Writes a file when the app falls over, and tells the user where it went.
//
// Deliberately separate from debugHost's runtime log: that one is opt-in, buffered, and off by
// default, which is exactly wrong for the one event nobody gets a second chance to record. This
// writes synchronously, always, and only when something has actually gone wrong.

/** How many crash files to keep. Old ones go when a new one is written. */
const KEEP_FILES = 20;
/** A crash while reporting a crash must not loop; the second one is written but not announced. */
let isReporting = false;

const stamp = (at = new Date()) => at.toISOString().replace(/[:.]/g, '-');

/** Confirms a directory can actually be written to, rather than trusting that it exists. */
const isWritableDir = (dir) => {
    try {
        fs.mkdirSync(dir, { recursive: true });
        const probe = path.join(dir, `.write-probe-${process.pid}`);
        fs.writeFileSync(probe, '');
        fs.unlinkSync(probe);
        return true;
    } catch {
        return false;
    }
};

/**
 * Where crash files go: `logs` beside the executable, falling back to `<userData>/logs`.
 *
 * The install directory is what a user can find without being told a platform-specific path, and
 * on Windows the per-user NSIS install is writable. It often is not anywhere else — a `.deb` lands
 * under root-owned `/opt`, an AppImage mount is read only — so the fallback is not an edge case.
 *
 * macOS never uses the install directory. `app.getPath('exe')` there is inside `Folia.app`, and
 * writing into a signed bundle invalidates its signature: the crash report would cost the user
 * their next launch. Its crashes go to userData.
 */
const resolveCrashLogDir = (app) => {
    if (process.platform !== 'darwin') {
        try {
            const beside = path.join(path.dirname(app.getPath('exe')), 'logs');
            if (isWritableDir(beside)) {
                return beside;
            }
        } catch { /* no exe path before ready on some platforms; fall through */ }
    }

    const fallback = path.join(app.getPath('userData'), 'logs');
    return isWritableDir(fallback) ? fallback : null;
};

/** `crash-<stamp ending in Z>[-<n>].log`. The stamp's trailing Z is what separates it from the suffix. */
const CRASH_FILE = /^crash-(.+Z)(?:-(\d+))?\.log$/;

/**
 * Crash file names, oldest first.
 *
 * Not a plain lexicographic sort. The timestamps are ISO, so those order correctly as text, but a
 * burst inside one millisecond shares a timestamp and is told apart by a numeric suffix — and as
 * text `-10` comes before `-2`, and `-2` before the unsuffixed first file. That put the newest
 * report at the head of the list, which is the end `prune` deletes from.
 */
const orderedCrashFiles = (dir) => fs.readdirSync(dir)
    .filter(name => name.startsWith('crash-') && name.endsWith('.log'))
    .map(name => {
        const match = CRASH_FILE.exec(name);
        // An unparseable name sorts oldest, so a file an earlier build left behind is cleaned up
        // rather than sitting outside the cap forever.
        return { name, stamp: match ? match[1] : '', suffix: match ? Number(match[2] ?? 1) : 0 };
    })
    .sort((a, b) => (a.stamp === b.stamp ? a.suffix - b.suffix : (a.stamp < b.stamp ? -1 : 1)))
    .map(entry => entry.name);

/** Keeps the newest KEEP_FILES crash files, so a crash loop cannot fill a disk. */
const prune = (dir) => {
    try {
        const files = orderedCrashFiles(dir);
        for (const name of files.slice(0, Math.max(0, files.length - KEEP_FILES))) {
            try { fs.unlinkSync(path.join(dir, name)); } catch { /* in use, or already gone */ }
        }
    } catch { /* unreadable directory is not worth failing over */ }
};

/** Everything that is worth knowing before reading the stack. */
const describeEnvironment = (app) => [
    `Folia      ${app.getVersion()}`,
    `Electron   ${process.versions.electron}`,
    `Chrome     ${process.versions.chrome}`,
    `Node       ${process.versions.node}`,
    `Platform   ${process.platform} ${process.arch} (${os.release()})`,
    `Packaged   ${app.isPackaged}`,
    `Uptime     ${Math.round(process.uptime())}s`,
].join('\n');

const describeError = (error) => {
    if (error instanceof Error) {
        return error.stack || `${error.name}: ${error.message}`;
    }
    if (error && typeof error === 'object') {
        try { return JSON.stringify(error, null, 2); } catch { return String(error); }
    }
    return String(error);
};

const createCrashLog = ({ app, dialog, shell, getLocale, onLine }) => {
    // Resolved once, at install time: a crash handler that has to work out where to write while
    // the process is already coming down should have as little left to do as possible.
    const dir = resolveCrashLogDir(app);

    const note = (text) => {
        try { onLine?.('Crash', text); } catch { /* the logger is not worth crashing over */ }
    };

    if (!dir) {
        console.warn('[Crash] No writable log directory; crash reports will not be saved');
    } else {
        note(`crash logs -> ${dir}`);
    }

    /**
     * A path nothing is already using.
     *
     * The timestamp alone is not enough: a crash loop produces several reports inside one
     * millisecond, and they would all be the same file, each overwriting the last.
     */
    const uniquePath = (base) => {
        let file = path.join(dir, `${base}.log`);
        for (let suffix = 2; fs.existsSync(file); suffix += 1) {
            file = path.join(dir, `${base}-${suffix}.log`);
        }
        return file;
    };

    /** Writes one report and returns its path, or null when there was nowhere to put it. */
    const write = (kind, detail) => {
        if (!dir) return null;
        const file = uniquePath(`crash-${stamp()}`);
        const body = [
            `# Folia crash report`,
            `Time       ${new Date().toISOString()}`,
            `Kind       ${kind}`,
            describeEnvironment(app),
            '',
            detail,
            '',
        ].join('\n');
        try {
            fs.writeFileSync(file, body, 'utf8');
        } catch (error) {
            console.error('[Crash] Failed to write the crash report', error);
            return null;
        }
        prune(dir);
        return file;
    };

    /**
     * Tells the user, and offers to open the folder.
     *
     * @param blocking a synchronous dialog, for the one caller that is about to exit the process.
     *        Everywhere else it must be async: `showMessageBoxSync` stops the main process, and the
     *        app-level `render-process-gone` listener runs BEFORE the per-window ones (verified on
     *        Electron 43), so a sync dialog there would hold the wallpaper recovery behind a modal
     *        until someone clicked it.
     */
    const announce = (file, blocking) => {
        const locale = getLocale();
        if (!app.isReady()) {
            // Before `ready` there is no window and no message box; showErrorBox is the one dialog
            // Electron will put up this early.
            try { dialog.showErrorBox(locale.crashTitle, `${locale.crashMessage}\n\n${file}`); } catch { /* headless */ }
            return;
        }
        const options = {
            type: 'error',
            title: locale.crashTitle,
            message: locale.crashMessage,
            detail: file,
            buttons: [locale.crashOpenFolder, locale.crashClose],
            defaultId: 0,
            cancelId: 1,
            noLink: true,
        };
        const openIfAsked = (choice) => {
            if (choice === 0) {
                shell.showItemInFolder(file);
            }
        };
        try {
            if (blocking) {
                openIfAsked(dialog.showMessageBoxSync(options));
                return;
            }
            dialog.showMessageBox(options)
                .then(result => openIfAsked(result.response))
                .catch(error => console.error('[Crash] Failed to show the crash dialog', error));
        } catch (error) {
            console.error('[Crash] Failed to show the crash dialog', error);
        }
    };

    /**
     * @param announceToUser false for the failures the app survives — an unhandled rejection is a
     *        bug worth a file, but interrupting playback with a modal over one is not proportionate.
     * @param blocking       for the fatal path only: hold the process until the dialog is answered,
     *        because the exit that follows would otherwise take the dialog with it.
     *
     * The file is always written inline. Only the dialog is deferred, and the two are separated for
     * a reason: a wallpaper renderer crash recovers by relaunching the app, so a report scheduled
     * whole would never reach the disk.
     */
    const report = (kind, detail, { announceToUser = true, blocking = false } = {}) => {
        if (isReporting) return null;
        isReporting = true;
        try {
            const file = write(kind, detail);
            note(`${kind} -> ${file || 'not saved'}`);
            if (!file || !announceToUser) {
                return file;
            }
            if (blocking) {
                announce(file, true);
            } else {
                // Yields to whatever else is listening for the same event — in this app, the
                // wallpaper watchdog and the in-place renderer reload.
                setImmediate(() => announce(file, false));
            }
            return file;
        } finally {
            isReporting = false;
        }
    };

    return {
        dir,
        report,
        reportError: (kind, error, options) => report(kind, describeError(error), options),
    };
};

// Asks Electron to write what the pages keep in their storage (localStorage, a sign-in among it)
// to disk: app.exit() does not wait for that. It only asks, so the exit is not held by it.
const flushPageStorage = () => require('electron').session.defaultSession.flushStorageData();

/**
 * Points every way the app can fall over at one crash log.
 *
 * @param isRendererCrashRecovered the app's own answer to "am I about to fix this myself?".
 *        Wallpaper recovery and bounded main-window reloads gate on `reason === 'crashed'`.
 *        The file is still written; only the interruption is withheld while recovery runs.
 * @param flushStorage asks for the pages' storage to be written before the app exits.
 */
const installCrashHandlers = ({
    app,
    crashLog,
    isRendererCrashRecovered = () => false,
    flushStorage = flushPageStorage,
    // Runs right before the exit below: app.exit() skips before-quit and will-quit, so children
    // that would outlive the app (HiFi's mpv) are killed here.
    beforeExit = () => {},
}) => {
    // A shutdown is not a crash: renderers legitimately go away while the app exits, and a modal
    // put up over a closing window is one nobody can act on. Tracked here rather than read off
    // main's own quit flag, so installing this needs nothing but `app`.
    let isQuitting = false;
    app.on('before-quit', () => { isQuitting = true; });
    app.on('will-quit', () => { isQuitting = true; });

    process.on('uncaughtException', (error) => {
        crashLog.reportError('uncaughtException', error, { blocking: true });
        // Registering this handler is what suppressed Electron's own fatal error box, so the quit it
        // would have done has to be done here. Continuing on a main process whose invariants have
        // already broken is how one crash becomes a corrupted store.
        try {
            flushStorage();
        } catch { /* before the app is ready, or outside Electron: nothing to write */ }
        try {
            beforeExit();
        } catch { /* the exit below must still happen */ }
        app.exit(1);
    });

    // Written down but not announced: a rejected promise nobody awaited is a bug worth the evidence,
    // and the app is still running. A modal over playback for one would be out of proportion.
    process.on('unhandledRejection', (reason) => {
        crashLog.reportError('unhandledRejection', reason, { announceToUser: false });
    });

    app.on('render-process-gone', (_event, contents, details) => {
        if (details?.reason === 'clean-exit') return;
        let url = null;
        try { url = contents?.getURL?.() ?? null; } catch { /* already destroyed */ }
        let recovered = false;
        try { recovered = isRendererCrashRecovered(details, contents) === true; } catch { /* advisory only */ }
        crashLog.report('render-process-gone', [
            `Reason     ${details?.reason ?? 'unknown'}`,
            `Exit code  ${details?.exitCode ?? 'unknown'}`,
            `URL        ${url ?? 'unknown'}`,
            `Recovered  ${recovered}`,
        ].join('\n'), { announceToUser: !isQuitting && !recovered });
    });

    // GPU and utility processes are restarted by Chromium on their own, often without the window
    // ever showing it. Worth the file when a report says "it went black for a second"; not worth a
    // modal, which is why this one never announces.
    app.on('child-process-gone', (_event, details) => {
        if (details?.reason === 'clean-exit') return;
        crashLog.report('child-process-gone', [
            `Type       ${details?.type ?? 'unknown'}`,
            `Name       ${details?.name ?? 'unknown'}`,
            `Reason     ${details?.reason ?? 'unknown'}`,
            `Exit code  ${details?.exitCode ?? 'unknown'}`,
        ].join('\n'), { announceToUser: false });
    });
};

module.exports = { createCrashLog, installCrashHandlers, resolveCrashLogDir, orderedCrashFiles, describeError, flushPageStorage };
