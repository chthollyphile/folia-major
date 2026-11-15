'use strict';

// electron/perfCheck.cjs
// The performance check's window and its IPC channels (src/components/perfCheck/): the main window
// asks for the check ('perf-check-open'); the check window, which runs the app's own lyric style and
// GPU analysis in a renderer of its own so the user's playback and settings are untouched, reads
// every process's memory and its display's refresh rate ('perf-check-metrics'), writes its result to
// the runtime log ('perf-check-log': its own console does not reach the log, which takes first-party
// windows only), and hands back the settings the user picks ('perf-check-apply'), which go to the
// main window to be applied there, through its own stores. While the check window is open the main
// window is told ('perf-check-state'), so it holds its own picture and GPU analysis and the check
// measures this computer rather than two windows drawing and analysing at once; the hold ends when
// the measuring does ('perf-check-done', the results stay up), or the window closes or its renderer dies.
//
// The check window has the preload (it reads the GPU model weights like the main window does) but is
// not first-party: its own channels are guarded by its own identity, and the first-party ones refuse it.

const { createSenderGuardedHandler } = require('./ipcAccessGuard.cjs');

const PERF_CHECK_WINDOW_TITLE = 'Folia';
const FRAME_RATES = new Set(['off', 60, 90, 120]);
const RENDER_SCALES = new Set([0.5, 0.75, 1, 1.5, 2]);
const ANTIALIAS = new Set(['auto', 'on', 'off']);
/** The longest log text the check window may hand over. */
const LOG_LIMIT = 4000;

/** The settings a check can hand back, or null when they are not exactly that shape. */
const readChoice = (value) => {
    if (!value || typeof value !== 'object') return null;
    const { frameRate, scale, antialias } = value;
    if (!FRAME_RATES.has(frameRate) || !RENDER_SCALES.has(scale) || !ANTIALIAS.has(antialias)) return null;
    return { frameRate, scale, antialias };
};

/** Every process's memory, MB, by Chromium's process type ('Browser', 'GPU', 'Tab', 'Utility', ...). */
const summarizeMetrics = (metrics) => {
    const byType = {};
    let totalMb = 0;
    for (const metric of metrics) {
        // workingSetSize is in KB.
        const mb = (metric.memory?.workingSetSize ?? 0) / 1024;
        byType[metric.type] = (byType[metric.type] ?? 0) + mb;
        totalMb += mb;
    }
    return { totalMb, byType, processes: metrics.length };
};

function createPerfCheckHost({
    app, ipcMain, BrowserWindow, screen, preloadPath, iconPath, loadAppEntry, isolateFirstPartyWindow, isFirstPartyWindowContents, getMainWindow,
}) {
    let win = null;
    const isPerfCheckContents = event => Boolean(win && !win.isDestroyed() && event.sender && event.sender.id === win.webContents.id);
    const tellMainWindow = (running) => {
        const main = getMainWindow();
        if (main && !main.isDestroyed()) main.webContents.send('perf-check-state', { running });
    };

    const open = () => {
        if (win && !win.isDestroyed()) {
            win.show();
            win.focus();
            return true;
        }
        // Over the main window, at the size the picture is usually drawn at.
        const main = getMainWindow();
        const bounds = main && !main.isDestroyed() && !main.isMinimized() ? main.getBounds() : { width: 1280, height: 800 };
        win = new BrowserWindow({
            ...bounds,
            minWidth: 720,
            minHeight: 480,
            title: PERF_CHECK_WINDOW_TITLE,
            name: 'folia-perf-check',
            autoHideMenuBar: true,
            backgroundColor: '#000000',
            icon: iconPath,
            webPreferences: {
                preload: preloadPath,
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                // A check measures frames: a throttled window would measure the throttling.
                backgroundThrottling: false,
            },
        });
        isolateFirstPartyWindow(win);
        // Above a main window kept on top, at its level: under it the check would run unseen.
        if (main && !main.isDestroyed() && main.isAlwaysOnTop()) win.setAlwaysOnTop(true, 'screen-saver');
        win.on('closed', () => {
            win = null;
            tellMainWindow(false);
        });
        win.webContents.on('render-process-gone', () => tellMainWindow(false));
        loadAppEntry(win, { perfCheck: '1' });
        tellMainWindow(true);
        return true;
    };

    ipcMain.handle('perf-check-open', createSenderGuardedHandler({
        channel: 'perf-check-open',
        isTrusted: isFirstPartyWindowContents,
        handler: () => open(),
    }));

    // With the refresh rate of the display the asking window is on: what the check aims frames at.
    ipcMain.handle('perf-check-metrics', (event) => {
        const asker = BrowserWindow.fromWebContents(event.sender);
        const display = asker && !asker.isDestroyed() ? screen.getDisplayMatching(asker.getBounds()) : screen.getPrimaryDisplay();
        return { ...summarizeMetrics(app.getAppMetrics()), refreshHz: display.displayFrequency || 0 };
    });

    ipcMain.handle('perf-check-log', createSenderGuardedHandler({
        channel: 'perf-check-log',
        isTrusted: isPerfCheckContents,
        handler: (_event, text) => {
            if (typeof text !== 'string') return false;
            console.info(`[PerfCheck] ${text.slice(0, LOG_LIMIT)}`);
            return true;
        },
    }));

    ipcMain.handle('perf-check-done', createSenderGuardedHandler({
        channel: 'perf-check-done',
        isTrusted: isPerfCheckContents,
        handler: () => {
            tellMainWindow(false);
            return true;
        },
    }));

    ipcMain.handle('perf-check-apply', createSenderGuardedHandler({
        channel: 'perf-check-apply',
        isTrusted: isPerfCheckContents,
        handler: (_event, value) => {
            const choice = readChoice(value);
            const main = getMainWindow();
            if (!choice || !main || main.isDestroyed()) return false;
            main.webContents.send('perf-check-apply', choice);
            return true;
        },
    }));

    /** Closes the check with the main window: its window and GPU work would keep the app from quitting. */
    const close = () => {
        if (win && !win.isDestroyed()) win.close();
    };
    return { close };
}

module.exports = { createPerfCheckHost, readChoice, summarizeMetrics };
