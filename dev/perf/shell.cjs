const path = require('node:path');
const { app, BrowserWindow, powerSaveBlocker, session } = require('electron');

// dev/perf/shell.cjs
// The Electron main script of the perf rig: one window of the same engine the app ships, opened
// where nobody sees it, for dev/perf/rig.mjs to drive over the DevTools protocol.
//
// Copied from electron/main.cjs, so the page is drawn the way the app's window draws it:
//   - the window: frame false, not transparent, backgroundColor #09090b (the app's defaults);
//   - webPreferences: nodeIntegration false, contextIsolation true, webSecurity true,
//     backgroundThrottling false;
//   - command-line switches: on Windows main.cjs adds only the feature
//     ReleaseVideoSourceProviderIfNotInUse, nothing that changes drawing. The GL switches it has
//     are for Linux and for Intel Macs and are not repeated here.
// Not copied: the preload script (the page uses no IPC), the single-instance lock, the stored
// window bounds, tray, wallpaper and transparent-window modes.
//
// Added for measuring, none of which changes how a frame is drawn:
//   - the window is shown inactive far outside every screen (x and y -20000), cannot take focus
//     and has no taskbar button. A window that is never shown (PERF_WINDOW_MODE=hidden) also runs,
//     but its frames come unevenly and screenshots of it hang, so it is not the default;
//   - CalculateNativeWinOcclusion is switched off, so Windows calling the window covered can never
//     slow it down;
//   - the screen is kept on while the shell runs: a baseline takes over an hour with nobody at the
//     PC, and the window takes its frame rate from the screen;
//   - audio may start without a click and is muted;
//   - PERF_DEVICE_SCALE sets the device scale (force-device-scale-factor), so a viewport means the
//     same number of pixels on any screen;
//   - every request that does not go to this machine is refused and logged;
//   - PERF_RUNNER_PID names the process that started the shell. Once that process is gone (killed,
//     a closed terminal) nobody would close this window, and it would stay unseen, drawing at full
//     rate and keeping the screen on: the shell looks every two seconds and quits by itself.

const width = Number(process.env.PERF_WIDTH || 1920);
const height = Number(process.env.PERF_HEIGHT || 1080);
const deviceScale = process.env.PERF_DEVICE_SCALE || '1';
const windowMode = process.env.PERF_WINDOW_MODE || 'offscreen';
const runnerPid = Number(process.env.PERF_RUNNER_PID || 0);

if (runnerPid > 0) {
    setInterval(() => {
        try {
            // Signal 0 sends nothing: it only asks whether the process is there.
            process.kill(runnerPid, 0);
        } catch (error) {
            if (error.code === 'ESRCH') {
                app.exit(0);
            }
        }
    }, 2000);
}

app.setPath('userData', process.env.PERF_USER_DATA || path.join(__dirname, '.build', 'userdata'));
app.commandLine.appendSwitch('enable-features', 'ReleaseVideoSourceProviderIfNotInUse');
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('force-device-scale-factor', deviceScale);

const isLocal = (url) => {
    try {
        const parsed = new URL(url);
        return ['data:', 'blob:', 'about:', 'devtools:', 'chrome:'].includes(parsed.protocol)
            || parsed.hostname === '127.0.0.1'
            || parsed.hostname === 'localhost';
    } catch {
        return false;
    }
};

app.whenReady().then(() => {
    powerSaveBlocker.start('prevent-display-sleep');
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
        const allowed = isLocal(details.url);
        if (!allowed) {
            console.log(`[perf] refused a request beyond this machine: ${new URL(details.url).host}`);
        }
        callback({ cancel: !allowed });
    });

    const win = new BrowserWindow({
        width,
        height,
        useContentSize: true,
        frame: false,
        transparent: false,
        hasShadow: true,
        backgroundColor: '#09090b',
        autoHideMenuBar: true,
        show: false,
        skipTaskbar: true,
        focusable: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            webSecurity: true,
            backgroundThrottling: false,
        },
    });
    win.webContents.setAudioMuted(true);
    if (windowMode !== 'hidden') {
        win.setPosition(-20000, -20000);
        win.showInactive();
        win.setContentSize(width, height);
    }
    void win.loadURL('about:blank');
    console.log(`[perf] shell up: ${width}x${height} at scale ${deviceScale}, window ${windowMode}, bounds ${JSON.stringify(win.getBounds())}`);
});

app.on('window-all-closed', () => app.quit());
