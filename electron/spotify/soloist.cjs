'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFile } = require('node:child_process');
const { promisify } = require('node:util');
const WebSocket = require('ws');
const { describeBuild } = require('./soloistVersion.cjs');
// Local Soloist lifecycle and encrypted credentials; only the trusted main window can configure it.
const runFile = promisify(execFile);
const OFFICIAL = {
    key: 'https://developer.spotify.com/dashboard',
    download: 'https://developer.spotify.com/documentation/soloist/reference/downloads-and-updates',
    guide: 'https://developer.spotify.com/documentation/soloist/tutorials/getting-started',
};
function connectionStatus() {
    return new Promise(resolve => {
        const socket = new WebSocket('ws://127.0.0.1:9090');
        let finished = false;
        const finish = value => {
            if (finished) return;
            finished = true; clearTimeout(timer); socket.terminate(); resolve(value);
        };
        const timer = setTimeout(() => finish({ running: false, connected: false }), 900);
        socket.on('message', raw => {
            try { const value = JSON.parse(String(raw)); if (value.type === 'auth_state') finish({ running: true, connected: value.logged_in === true, active: value.is_active === true }); } catch {}
        });
        socket.on('error', () => finish({ running: false, connected: false }));
        socket.on('close', () => finish({ running: false, connected: false }));
    });
}
function install({ app, BrowserWindow, ipcMain, safeStorage, shell, dialog, isTrustedMainWindowContents }) {
    const configDir = app.getPath('userData');
    const keyFile = path.join(configDir, 'soloist-api-key.enc');
    const configFile = path.join(configDir, 'soloist-local.json');
    const defaultBinary = path.join(app.getPath('home'), '.local/share/spotify-soloist/soloist');
    const dataDir = path.join(configDir, 'soloist-data');
    let child = null, starting = null, sessionKey = null, error = '', keyState = 'missing';
    let versionCache = null, versionPending = null, pendingOpen = false, quitting = false;
    let config;
    try { config = JSON.parse(fs.readFileSync(configFile, 'utf8')); } catch { config = {}; }
    const binaryPath = () => process.env.FOLIA_SOLOIST_BIN || config.executable || defaultBinary;
    const trusted = event => isTrustedMainWindowContents(event.sender);
    const saveConfig = () => {
        fs.writeFileSync(`${configFile}.tmp`, JSON.stringify(config, null, 2), { mode: 0o600 });
        fs.renameSync(`${configFile}.tmp`, configFile);
    };
    const mainWindow = () => BrowserWindow.getAllWindows().find(win => !win.isDestroyed() && isTrustedMainWindowContents(win.webContents));
    function openSettings() {
        if (quitting) return;
        pendingOpen = true;
        const win = mainWindow();
        if (!win) return;
        if (win.isMinimized()) win.restore();
        win.show(); win.webContents.send('open-provider-settings', 'spotify');
    }
    const secureStorageAvailable = () => safeStorage.isEncryptionAvailable()
        && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';
    function readKey() {
        if (sessionKey) { keyState = 'available'; return sessionKey; }
        if (!fs.existsSync(keyFile)) { keyState = 'missing'; return null; }
        if (!secureStorageAvailable()) { keyState = 'locked'; return null; }
        try { sessionKey = safeStorage.decryptString(fs.readFileSync(keyFile)); keyState = 'available'; return sessionKey; }
        catch { keyState = 'unreadable'; return null; }
    }
    async function inspectBinary(filename = binaryPath(), force = false) {
        let stat;
        try { stat = fs.statSync(filename); if (!stat.isFile()) throw Error(); }
        catch { return { path: filename, state: 'missing', version: null, daysRemaining: null }; }
        const identity = `${filename}:${stat.mtimeMs}:${stat.size}`;
        if (!force && versionCache?.identity === identity) return { path: filename, ...describeBuild(versionCache.output) };
        if (versionPending?.identity === identity) return versionPending.promise;
        const promise = (async () => {
            try {
                const { stdout, stderr } = await runFile(filename, ['--version'], { timeout: 5000, maxBuffer: 8192 });
                const output = stdout + stderr;
                if (!/^soloist\s/m.test(output)) return { path: filename, state: 'invalid', version: null };
                versionCache = { identity, output };
                return { path: filename, ...describeBuild(output) };
            } catch (cause) { return { path: filename, state: cause.code === 10 ? 'expired' : 'invalid', version: null, daysRemaining: cause.code === 10 ? 0 : null }; }
        })().finally(() => { if (versionPending?.promise === promise) versionPending = null; });
        versionPending = { identity, promise };
        return promise;
    }
    async function stop() {
        const owned = child; child = null;
        if (!owned || owned.exitCode !== null) return;
        await new Promise(resolve => {
            const timer = setTimeout(() => { owned.kill('SIGKILL'); resolve(); }, 2500);
            owned.once('exit', () => { clearTimeout(timer); resolve(); }); owned.kill('SIGTERM');
        });
    }
    async function ensureStarted() {
        if (quitting) return { ok: false, message: 'exit' };
        if (starting) return starting;
        starting = (async () => {
            const info = await inspectBinary();
            if (['missing', 'invalid', 'expired'].includes(info.state)) {
                error = info.state === 'expired' ? 'expired' : 'program';
                return { ok: false, message: error };
            }
            const key = readKey();
            if (!key) { error = keyState === 'missing' ? 'key' : 'locked'; return { ok: false, message: error }; }
            if ((await connectionStatus()).running) { error = ''; return { ok: true }; }
            fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 }); error = '';
            const owned = spawn(binaryPath(), ['--device-name', 'Folia Audio', '--api-key', key, '--ws', '127.0.0.1:9090',
                '--data-dir', dataDir, '--cache-dir', path.join(configDir, 'soloist-cache'), '--cache-size', '512'], { stdio: 'ignore' });
            child = owned;
            owned.once('error', () => { if (child === owned) { child = null; error = 'start'; } });
            owned.once('exit', code => {
                if (child !== owned) return;
                child = null; error = code === 10 ? 'expired' : 'exit';
                if (code === 10) versionCache = null;
            });
            for (let i = 0; i < 12 && !error; i++) {
                if ((await connectionStatus()).running) return { ok: true };
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            return { ok: false, message: error || 'start' };
        })().finally(() => { starting = null; });
        return starting;
    }
    ipcMain.on('provider-settings-ready', event => { if (trusted(event) && pendingOpen) { pendingOpen = false; event.sender.send('open-provider-settings', 'spotify'); } });
    let mutations = Promise.resolve();
    const mutate = work => {
        const result = mutations.catch(() => {}).then(work);
        mutations = result;
        return result.catch(() => ({ ok: false, message: 'storage' }));
    };
    ipcMain.handle('soloist-local-prepare', async event => {
        if (!trusted(event)) return { ok: false, message: 'untrusted' };
        const result = await mutate(ensureStarted); if (!result.ok) openSettings(); return result;
    });
    ipcMain.handle('soloist-local-status', async event => {
        if (!trusted(event)) return { error: 'untrusted' };
        readKey();
        const [binary, connection] = await Promise.all([inspectBinary(), connectionStatus()]);
        return { configured: fs.existsSync(keyFile), keyState, binary, ...connection, error };
    });
    ipcMain.handle('soloist-local-save', (event, value) => mutate(async () => {
        if (!trusted(event)) return { ok: false, message: 'untrusted' };
        const key = typeof value === 'string' ? value.trim() : '';
        if (key.length < 8 || key.length > 8192 || /\s/.test(key)) return { ok: false, message: 'invalidKey' };
        if (!secureStorageAvailable()) return { ok: false, message: 'locked' };
        await stop();
        fs.writeFileSync(`${keyFile}.tmp`, safeStorage.encryptString(key), { mode: 0o600 });
        fs.renameSync(`${keyFile}.tmp`, keyFile); sessionKey = key; keyState = 'available';
        return { ...await ensureStarted(), saved: true };
    }));
    ipcMain.handle('soloist-local-restart', event => mutate(async () => {
        if (!trusted(event)) return { ok: false, message: 'untrusted' };
        await stop(); sessionKey = null; return ensureStarted();
    }));
    ipcMain.handle('soloist-local-check-version', async event => trusted(event) ? inspectBinary(binaryPath(), true) : null);
    ipcMain.handle('soloist-local-select-binary', event => mutate(async () => {
        if (!trusted(event)) return { ok: false, message: 'untrusted' };
        const choice = await dialog.showOpenDialog(mainWindow(), { title: 'Spotify Soloist', properties: ['openFile'], defaultPath: app.getPath('downloads') });
        if (choice.canceled || !choice.filePaths[0]) return { canceled: true };
        const filename = choice.filePaths[0], info = await inspectBinary(filename, true);
        if (!['valid', 'expiring', 'clock-warning', 'unknown'].includes(info.state)) return { ok: false, message: info.state === 'expired' ? 'expired' : 'program' };
        await stop(); config.executable = filename; saveConfig(); error = '';
        return { ok: true, binary: info };
    }));
    ipcMain.handle('soloist-local-official', (event, which) => trusted(event) && OFFICIAL[which] ? shell.openExternal(OFFICIAL[which]) : undefined);
    app.on('second-instance', (_event, argv) => { if (argv.includes('--soloist-setup')) openSettings(); });

    app.whenReady().then(async () => {
        const info = await inspectBinary();
        if (process.argv.includes('--soloist-setup')) openSettings();
        if (fs.existsSync(keyFile)) { const result = await mutate(ensureStarted); if (!result.ok) openSettings(); }
        if (info.state === 'expiring') {
            const notice = `${info.builtAt}:${new Date().toISOString().slice(0, 10)}`;
            if (config.expiryNotice !== notice) { config.expiryNotice = notice; saveConfig(); openSettings(); }
        }
        console.info('[Soloist Local] Startup status', { keyState, version: info.version, validity: info.state });
    }).catch(() => { error = 'storage'; openSettings(); });
    console.info('[Soloist Local] Integrated Spotify setup loaded');
    let shutdownPromise = null;
    const shutdown = () => {
        quitting = true;
        if (!child && !starting) return null;
        return shutdownPromise ??= mutations.catch(() => {}).then(stop);
    };
    return { ensureStarted, stop, shutdown };
}
module.exports = { install, connectionStatus };
