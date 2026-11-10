'use strict';

// dev/perf/app/guard.cjs
// Loaded by dev/perf/app/entry.cjs, the script Electron is started with, before the app's own main
// script. The app that then starts is the real one: electron/main.cjs and the production build in
// dist/, no line of them changed. The guard stands between the app and everything outside one
// folder of this run:
//
//   - user data, session data, the temp folder and every other folder Electron hands out are inside
//     PERF_APP_PROFILE_DIR, and the process ends at once if user data is anywhere else;
//   - a write, a delete or a rename outside that folder is refused and reported (node's fs);
//   - no child process is started (the wallpaper helper, ffmpeg, reg.exe), through node's
//     child_process or through Electron's utilityProcess (the analysis worker and its Python sidecar);
//   - no connection leaves this machine: Chromium's requests (every session), node's sockets,
//     DNS look-ups, named pipes (the Discord client listens on one) and UDP;
//   - a worker thread the app starts is held the same way (it has its own copies of node's modules:
//     guardWorker.cjs puts the locks of locks.cjs on them before the worker's own script runs);
//   - every window is off-screen, cannot take focus, has no taskbar button and is muted;
//   - no tray icon, no dialog, no notification, nothing opened in another program, no relaunch;
//   - the process ends by itself once the runner that started it is gone.
//
// It also notes when things happen (process created, this file loaded, main.cjs evaluated, app
// ready, window created, page loaded) and how long each IPC call and each require() of main.cjs
// took. Every note is one line on standard output: `[perf-app] {json}`.

const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const electron = require('electron');
const { installLocks } = require('./locks.cjs');

const { app } = electron;
const guardLoadedAt = Date.now();

const PROFILE = path.resolve(process.env.PERF_APP_PROFILE_DIR || '');
const ROOT = path.resolve(__dirname, '../../..');
const MAIN_SCRIPT = path.join(ROOT, 'electron', 'main.cjs');
const PROBE = process.env.PERF_APP_PROBE || path.join(__dirname, 'probe.cjs');
const WIDTH = Number(process.env.PERF_WIDTH || 1920);
const HEIGHT = Number(process.env.PERF_HEIGHT || 1080);
const DEVICE_SCALE = process.env.PERF_DEVICE_SCALE || '1';
const RUNNER_PID = Number(process.env.PERF_RUNNER_PID || 0);
const OFF_SCREEN = -20000;

const say = (kind, data = {}) => {
    try {
        process.stdout.write(`[perf-app] ${JSON.stringify({ kind, t: Date.now(), ...data })}\n`);
    } catch {
        // The runner's pipe is gone; the watch below ends the process.
    }
};

const abort = (reason) => {
    try {
        fs.writeSync(1, `[perf-app] ${JSON.stringify({ kind: 'abort', t: Date.now(), reason })}\n`);
    } catch {
        // Nothing to write to.
    }
    process.exit(97);
};

if (!process.env.PERF_APP_PROFILE_DIR || !fs.existsSync(PROFILE)) {
    abort(`PERF_APP_PROFILE_DIR is not an existing folder: "${process.env.PERF_APP_PROFILE_DIR || ''}"`);
}

// An error nobody catches would make Electron show a dialog box on the desktop. With a listener it
// does not; the runner sees the note and counts the launch as failed.
process.on('uncaughtException', (error) => {
    say('uncaught-exception', { text: String(error?.stack ?? error).slice(0, 600) });
});

// What `electron .` does before it loads an app's main script (Electron's default_app): the name,
// the version and the app's folder come from package.json. Started with entry.cjs instead, they
// are set here, before anything reads them.
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
app.name = packageJson.productName || packageJson.name;
app.setVersion(packageJson.version);
app.setAppPath(ROOT);

// -------------------------------------------------------------------------------------------------
// The runner is gone: quit
// -------------------------------------------------------------------------------------------------

if (RUNNER_PID > 0) {
    setInterval(() => {
        try {
            // Signal 0 sends nothing: it only asks whether the process is there.
            process.kill(RUNNER_PID, 0);
        } catch (error) {
            if (error.code === 'ESRCH') {
                app.exit(0);
            }
        }
    }, 2000).unref();
}

// -------------------------------------------------------------------------------------------------
// Folders: everything inside the run's folder
// -------------------------------------------------------------------------------------------------

// The locks on node's own modules (files, child processes, sockets, DNS, UDP, listening) are in
// locks.cjs: guardWorker.cjs puts the same ones on every worker thread.
const { isInsideProfile, writeRefusal, spawnRefusal, deadChild, isLoopback, refusedConnection } = installLocks({ profile: PROFILE, say });

const folders = {
    userData: 'userData',
    home: 'home',
    appData: 'appData',
    temp: 'temp',
    desktop: path.join('home', 'Desktop'),
    documents: path.join('home', 'Documents'),
    downloads: path.join('home', 'Downloads'),
    music: path.join('home', 'Music'),
    pictures: path.join('home', 'Pictures'),
    videos: path.join('home', 'Videos'),
    logs: 'logs',
    crashDumps: 'crashDumps',
};
Object.entries(folders).forEach(([name, relative]) => {
    const folder = path.join(PROFILE, relative);
    fs.mkdirSync(folder, { recursive: true });
    try {
        app.setPath(name, folder);
    } catch (error) {
        // userData is the one that must hold; the check below ends the run if it does not.
        say('guard-warning', { text: `app.setPath('${name}') failed: ${error.message}` });
    }
});
// os.tmpdir() reads these; the app writes two files of the Netease module there when it starts.
process.env.TEMP = path.join(PROFILE, 'temp');
process.env.TMP = process.env.TEMP;

const checkFolders = (when) => {
    ['userData', 'sessionData', 'temp', 'logs', 'crashDumps', 'appData'].forEach((name) => {
        let actual = '';
        try {
            actual = app.getPath(name);
        } catch {
            return;
        }
        if (!isInsideProfile(actual)) {
            abort(`${when}: app.getPath('${name}') is "${actual}", outside the run's folder "${PROFILE}"`);
        }
    });
};
checkFolders('at load');

// -------------------------------------------------------------------------------------------------
// Child processes: none (node's own child_process is locked in locks.cjs)
// -------------------------------------------------------------------------------------------------

// Electron's own way to start a child (electron/analysis/host.cjs forks the analysis worker with it,
// and the worker starts the Python sidecar). Such a process would have its own fs, sockets and
// child_process, with none of the stand-ins of this file: it is refused like the others. The
// caller gets a child that ends at once with code 1 and answers nothing.
const silentUtilityProcess = {
    fork: (modulePath, args) => Object.assign(deadChild(spawnRefusal('utilityProcess.fork', modulePath, args)), { postMessage: () => {} }),
};

// -------------------------------------------------------------------------------------------------
// Worker threads: the same locks in each
// -------------------------------------------------------------------------------------------------

// A worker thread has its own copies of node's modules, so the locks put on this thread's do not
// hold in it. Every worker thread the app starts runs guardWorker.cjs before its own script, and
// that puts them on. (The app's Netease API runs in a worker thread: electron/netease.)
const workerThreads = require('node:worker_threads');
const RealWorker = workerThreads.Worker;
workerThreads.Worker = class GuardedWorker extends RealWorker {
    constructor(file, options = {}) {
        super(file, { ...options, execArgv: [...(options.execArgv ?? []), '--require', path.join(__dirname, 'guardWorker.cjs')] });
        say('worker-started', { file: String(file).slice(-120), thread: this.threadId });
    }
};

// -------------------------------------------------------------------------------------------------
// The network: nothing beyond this machine (node's sockets, DNS and UDP are locked in locks.cjs)
// -------------------------------------------------------------------------------------------------

/** A request Chromium is about to make: allowed when it stays on this machine or is no network request at all. */
const isLocalUrl = (url) => {
    try {
        const parsed = new URL(url);
        if (!['http:', 'https:', 'ws:', 'wss:', 'ftp:'].includes(parsed.protocol)) {
            return true;
        }
        return isLoopback(parsed.hostname);
    } catch {
        return false;
    }
};
const guardedSessions = new WeakSet();
const guardSession = (ses) => {
    if (guardedSessions.has(ses)) {
        return;
    }
    guardedSessions.add(ses);
    const { webRequest } = ses;
    const realOnBeforeRequest = webRequest.onBeforeRequest.bind(webRequest);
    // Electron keeps one listener per event and session. The app registers none for this event
    // today; if it ever does, its listener runs after the guard's, for requests the guard let pass.
    let appListener = null;
    realOnBeforeRequest((details, callback) => {
        if (!isLocalUrl(details.url)) {
            let host = details.url.slice(0, 80);
            try {
                host = new URL(details.url).host;
            } catch {
                // Kept as cut above.
            }
            refusedConnection('chromium', host);
            callback({ cancel: true });
            return;
        }
        if (appListener) {
            appListener(details, callback);
        } else {
            callback({});
        }
    });
    webRequest.onBeforeRequest = (filterOrListener, maybeListener) => {
        appListener = typeof filterOrListener === 'function' ? filterOrListener : (maybeListener ?? null);
        say('guard-warning', { text: 'the app registered webRequest.onBeforeRequest; it runs behind the guard, and its URL filter is ignored' });
    };
};
app.on('session-created', guardSession);
// A second lock on Chromium's side: no host name resolves except this machine's.
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1');
// And no proxy: behind one, the proxy resolves the names and the rule above says nothing. (A
// session the app itself points at the system's proxy keeps it; the request lock above covers that.)
app.commandLine.appendSwitch('no-proxy-server');

// -------------------------------------------------------------------------------------------------
// Windows, tray, dialogs: nothing appears, takes focus or sounds
// -------------------------------------------------------------------------------------------------

// The off-screen window must not count as covered (it would be slowed), the scale is fixed so a
// viewport means the same pixels on any screen, and the app does not take the media keys or show
// up in Windows' media overlay.
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion,HardwareMediaKeyHandling');
app.commandLine.appendSwitch('force-device-scale-factor', DEVICE_SCALE);

let mainWindowSeen = false;
const quiet = name => function ignored() { say('window-call-ignored', { name }); };

class GuardedBrowserWindow extends electron.BrowserWindow {
    constructor(options = {}) {
        // The app's own window is the one with the app's preload script; the others (the YouTube
        // Music sandbox, the remote control) keep their size and are hidden the same way.
        const isMain = !mainWindowSeen && /preload\.cjs$/.test(String(options.webPreferences?.preload ?? ''));
        const { x: _x, y: _y, ...rest } = options;
        super({
            ...rest,
            ...(isMain ? { width: WIDTH, height: HEIGHT } : {}),
            show: false,
            skipTaskbar: true,
            focusable: false,
            alwaysOnTop: false,
        });
        super.setPosition(OFF_SCREEN, OFF_SCREEN);
        // A window that is never shown draws unevenly (dev/perf/README.md), so it is shown where
        // the app would show it, only without taking focus and outside every screen.
        if (options.show !== false) {
            super.showInactive();
        }
        if (isMain) {
            super.setContentSize(WIDTH, HEIGHT);
        }
        this.webContents.setAudioMuted(true);
        if (isMain) {
            mainWindowSeen = true;
            say('window-created', { bounds: this.getBounds(), transparent: Boolean(options.transparent) });
            this.webContents.once('did-start-loading', () => say('did-start-loading'));
            this.webContents.once('dom-ready', () => say('dom-ready'));
            this.webContents.once('did-finish-load', () => say('did-finish-load', { url: this.webContents.getURL().slice(0, 200) }));
            this.once('ready-to-show', () => say('ready-to-show'));
            this.webContents.on('render-process-gone', (_event, details) => say('render-process-gone', { reason: details.reason }));
        } else {
            say('window-created-other', { preload: String(options.webPreferences?.preload ?? ''), partition: String(options.webPreferences?.partition ?? '') });
        }
    }

    show() {
        if (!this.isDestroyed() && !this.isVisible()) {
            super.showInactive();
        }
    }
}
['focus', 'setPosition', 'setBounds', 'setSize', 'setContentSize', 'center', 'maximize', 'unmaximize', 'minimize',
    'restore', 'setFullScreen', 'setSimpleFullScreen', 'setKiosk', 'setAlwaysOnTop', 'moveTop', 'setSkipTaskbar',
    'setFocusable', 'flashFrame', 'hide', 'setVisibleOnAllWorkspaces'].forEach((name) => {
    GuardedBrowserWindow.prototype[name] = quiet(name);
});

// A window made without the class above (window.open from a page) is caught here, a moment later.
app.on('browser-window-created', (_event, win) => {
    if (win instanceof GuardedBrowserWindow) {
        return;
    }
    say('guard-warning', { text: 'a window was created outside the guarded class; moved off-screen' });
    electron.BrowserWindow.prototype.setPosition.call(win, OFF_SCREEN, OFF_SCREEN);
    win.setSkipTaskbar(true);
    win.setFocusable(false);
    win.blur();
});
app.on('web-contents-created', (_event, contents) => {
    contents.setAudioMuted(true);
    // window.open from a page: Electron would build that window itself and show it before the
    // handler above could move it. None is opened. (main.cjs sets no handler of its own for its windows.)
    contents.setWindowOpenHandler(({ url }) => {
        say('suppressed', { what: 'window.open', text: String(url).slice(0, 200) });
        return { action: 'deny' };
    });
});

class SilentTray extends EventEmitter {
    constructor() {
        super();
        this.destroyed = false;
        say('suppressed', { what: 'tray icon' });
    }

    isDestroyed() { return this.destroyed; }

    destroy() { this.destroyed = true; }

    getBounds() { return { x: 0, y: 0, width: 0, height: 0 }; }
}
['setContextMenu', 'setToolTip', 'setImage', 'setPressedImage', 'setTitle', 'setIgnoreDoubleClickEvents',
    'popUpContextMenu', 'closeContextMenu', 'displayBalloon', 'removeBalloon', 'focus'].forEach((name) => {
    SilentTray.prototype[name] = () => {};
});

class SilentNotification extends EventEmitter {
    static isSupported() { return false; }

    show() { say('suppressed', { what: 'notification' }); }

    close() {}
}

const cancelled = (what, value) => (...args) => {
    const options = args.find(arg => arg && typeof arg === 'object' && !(arg instanceof electron.BrowserWindow)) ?? {};
    say('suppressed', { what: `dialog ${what}`, text: String(options.message ?? options.title ?? args.find(arg => typeof arg === 'string') ?? '').slice(0, 200) });
    return typeof value === 'function' ? value(options) : value;
};
const cancelButton = options => options.cancelId ?? Math.max(0, (options.buttons?.length ?? 1) - 1);
const silentDialog = {
    showOpenDialog: cancelled('open', Promise.resolve({ canceled: true, filePaths: [] })),
    showOpenDialogSync: cancelled('open', undefined),
    showSaveDialog: cancelled('save', Promise.resolve({ canceled: true, filePath: '' })),
    showSaveDialogSync: cancelled('save', undefined),
    showMessageBox: cancelled('message', options => Promise.resolve({ response: cancelButton(options), checkboxChecked: false })),
    showMessageBoxSync: cancelled('message', cancelButton),
    showErrorBox: cancelled('error', undefined),
    showCertificateTrustDialog: cancelled('certificate', Promise.resolve()),
};

const silentShell = Object.create(electron.shell, {
    openExternal: { value: async (url) => { say('suppressed', { what: 'open in another program', text: String(url).slice(0, 200) }); } },
    openPath: { value: async (target) => { say('suppressed', { what: 'open a path', text: String(target).slice(0, 200) }); return ''; } },
    showItemInFolder: { value: (target) => { say('suppressed', { what: 'show in folder', text: String(target).slice(0, 200) }); } },
    trashItem: { value: async (target) => { throw writeRefusal('trashItem', String(target)); } },
    beep: { value: () => {} },
    writeShortcutLink: { value: () => false },
});

const silentShortcuts = {
    register: (accelerator) => { say('suppressed', { what: 'global shortcut', text: String(accelerator) }); return false; },
    registerAll: (accelerators) => { say('suppressed', { what: 'global shortcut', text: String(accelerators) }); },
    isRegistered: () => false,
    unregister: () => {},
    unregisterAll: () => {},
};

// What `require('electron')` gives the app: Electron itself, with the seven things above in place
// of the real ones. (Electron's own exports cannot be assigned to, so the app gets an object that
// inherits from them.)
const guardedElectron = Object.create(electron, {
    utilityProcess: { value: silentUtilityProcess, enumerable: true },
    BrowserWindow: { value: GuardedBrowserWindow, enumerable: true },
    Tray: { value: SilentTray, enumerable: true },
    Notification: { value: SilentNotification, enumerable: true },
    dialog: { value: silentDialog, enumerable: true },
    shell: { value: silentShell, enumerable: true },
    globalShortcut: { value: silentShortcuts, enumerable: true },
});

// What reaches outside the process through `app` itself.
['relaunch', 'setLoginItemSettings', 'setAsDefaultProtocolClient', 'removeAsDefaultProtocolClient', 'setJumpList',
    'setUserTasks', 'addRecentDocument', 'clearRecentDocuments', 'setBadgeCount', 'focus', 'show'].forEach((name) => {
    if (typeof app[name] === 'function') {
        app[name] = (...args) => {
            say('suppressed', { what: `app.${name}`, text: JSON.stringify(args).slice(0, 200) });
            return false;
        };
    }
});

// -------------------------------------------------------------------------------------------------
// Notes: when things happen in the main process
// -------------------------------------------------------------------------------------------------

say('guard-loaded', {
    t: guardLoadedAt,
    pid: process.pid,
    processCreatedAt: Math.round(process.getCreationTime() ?? 0),
    profile: PROFILE,
    userData: app.getPath('userData'),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
});

// How long each IPC call took in the main process (`ipcMain.handle`): where a page's wait for the
// main process goes. Only the first ones are told one by one; a page can make thousands.
const { ipcMain } = electron;
const realHandle = ipcMain.handle.bind(ipcMain);
let ipcTold = 0;
ipcMain.handle = (channel, listener) => realHandle(channel, async (event, ...args) => {
    const startedAt = Date.now();
    const began = performance.now();
    try {
        return await listener(event, ...args);
    } finally {
        if (ipcTold < 1500) {
            ipcTold += 1;
            say('ipc', { t: startedAt, channel, ms: Number((performance.now() - began).toFixed(2)) });
        }
    }
});

// The main process's own log lines, with the time each was written.
['log', 'info', 'warn', 'error'].forEach((level) => {
    const real = console[level].bind(console);
    console[level] = (...args) => {
        say('log', { level, text: args.map(arg => (typeof arg === 'string' ? arg : (arg instanceof Error ? arg.message : (() => { try { return JSON.stringify(arg); } catch { return String(arg); } })()))).join(' ').slice(0, 300) });
        real(...args);
    };
});

const realLoad = Module._load;
const requireTimes = [];
Module._load = function guardedLoad(request, parent, isMain) {
    if (request === 'electron' || request === 'electron/main' || request === 'electron/common') {
        return guardedElectron;
    }
    // How long each require() written in main.cjs itself took (what it loads in turn is inside it).
    if (parent?.filename !== MAIN_SCRIPT) {
        return realLoad.call(this, request, parent, isMain);
    }
    const began = performance.now();
    try {
        return realLoad.call(this, request, parent, isMain);
    } finally {
        requireTimes.push({ request, ms: Number((performance.now() - began).toFixed(1)) });
    }
};

app.once('ready', () => say('app-ready'));
app.whenReady().then(() => {
    checkFolders('at ready');
    guardSession(electron.session.defaultSession);
    // The recorder inside the page (dev/perf/app/probe.cjs): there from the page's first instruction.
    electron.session.defaultSession.registerPreloadScript({ type: 'frame', id: 'perf-app-probe', filePath: PROBE });
    say('guard-ready', { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), temp: app.getPath('temp') });
});
app.on('child-process-gone', (_event, details) => say('child-process-gone', { type: details.type, reason: details.reason, name: details.name }));
app.on('before-quit', () => say('before-quit'));

module.exports = { MAIN_SCRIPT, say, requireTimes };
