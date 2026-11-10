import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_DIR, Cdp, ELECTRON, ROOT, log, sleep, winAction } from '../rig.mjs';

// dev/perf/app/launch.mjs
// Starts the real app (electron/main.cjs and the production build in dist/) through
// dev/perf/app/entry.cjs, which puts the guard in place first (dev/perf/app/guard.cjs), reads the guard's notes, and attaches to the app's page over the
// DevTools protocol. Everything a run leaves on disk is under dev/perf/.build/app/.

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(HERE, 'entry.cjs');
const PROBE = path.join(HERE, 'probe.cjs');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

export const APP_BUILD_DIR = path.join(BUILD_DIR, 'app');
export const PROFILES_DIR = path.join(APP_BUILD_DIR, 'profiles');
export const APP_DIST = path.join(ROOT, 'dist');

/**
 * Builds the app as `npm run dev:electron:dist` does (ELECTRON=true gives the relative base a
 * file:// page needs), into dist/. VERCEL_GIT_COMMIT_SHA is set to zeros so that vite.config.ts
 * skips its look-up of a commit name on the network; the only trace is the commit label the app
 * shows in its About page.
 */
export const buildApp = ({ skip = false } = {}) => {
    if (skip && fs.existsSync(path.join(APP_DIST, 'index.html'))) {
        log('build skipped: using dist/ as it is');
        return { skipped: true, seconds: 0 };
    }
    const startedAt = Date.now();
    const env = { ...process.env, ELECTRON: 'true', ELECTRON_DEV: 'false', VERCEL_GIT_COMMIT_SHA: '0000000', VERCEL_GIT_COMMIT_REF: 'perf' };
    delete env.NODE_ENV;
    const result = spawnSync(process.execPath, [VITE, 'build'], { cwd: ROOT, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) {
        throw new Error(`[perf] the app did not build:\n${result.stdout}\n${result.stderr}`);
    }
    const seconds = (Date.now() - startedAt) / 1000;
    log(`app built in ${seconds.toFixed(1)} s`);
    return { skipped: false, seconds };
};

/** What the built app is made of: the files the page loads, by size. */
export const distShape = () => {
    const assets = path.join(APP_DIST, 'assets');
    const files = fs.existsSync(assets)
        ? fs.readdirSync(assets, { recursive: true }).map(name => String(name)).filter(name => fs.statSync(path.join(assets, name)).isFile())
            .map(name => ({ name: name.replaceAll('\\', '/'), bytes: fs.statSync(path.join(assets, name)).size }))
        : [];
    const total = kind => files.filter(file => file.name.endsWith(kind)).reduce((sum, file) => sum + file.bytes, 0);
    return {
        files: files.length,
        jsBytes: total('.js'),
        cssBytes: total('.css'),
        largest: [...files].sort((left, right) => right.bytes - left.bytes).slice(0, 12),
    };
};

/** A new, empty folder for one launch's user data, temp files and everything else the app writes. */
export const freshProfile = (name) => {
    const folder = path.join(PROFILES_DIR, name);
    removeFolder(folder);
    fs.mkdirSync(folder, { recursive: true });
    return folder;
};

/** Removes a folder of this tool. Refuses anything that is not under dev/perf/.build/app. */
export const removeFolder = (folder) => {
    const resolved = path.resolve(folder);
    if (!resolved.startsWith(APP_BUILD_DIR + path.sep)) {
        throw new Error(`[perf] not removing ${resolved}: it is not under ${APP_BUILD_DIR}`);
    }
    for (let attempt = 0; ; attempt += 1) {
        try {
            fs.rmSync(resolved, { recursive: true, force: true });
            return;
        } catch (error) {
            // A process that has just ended may still hold a file for a moment.
            if (attempt >= 20) {
                throw error;
            }
            spawnSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
        }
    }
};

/** Copies a profile folder: every launch of a series starts from the same bytes. */
export const copyProfile = (from, name) => {
    const folder = path.join(PROFILES_DIR, name);
    removeFolder(folder);
    fs.cpSync(from, folder, { recursive: true });
    return folder;
};

/**
 * Starts the app. With `affinityMask` it goes through `start /affinity`, so the browser process and
 * every process it starts are held to those processors from their first instruction.
 * `homePictures` is how many pictures the first page of this profile shows when it is whole.
 * Resolves once the guard has spoken (`guard-loaded`) and the DevTools port is known; the page is
 * attached to separately (`attachPage`), so a start-up measurement can leave the page alone.
 */
export const launchApp = async ({ profileDir, affinityMask = null, width = 1920, height = 1080, deviceScale = 1, homePictures = 0 }) => {
    if (!fs.existsSync(path.join(APP_DIST, 'index.html'))) {
        throw new Error('[perf] dist/index.html is missing: the app has not been built');
    }
    const env = {
        ...process.env,
        ELECTRON_DEV: 'false',
        PERF_APP_PROFILE_DIR: profileDir,
        PERF_APP_PROBE: PROBE,
        PERF_WIDTH: String(width),
        PERF_HEIGHT: String(height),
        PERF_DEVICE_SCALE: String(deviceScale),
        // How many pictures the first page must show before the recorder calls it usable (probe.cjs); 0: any number.
        PERF_APP_HOME_PICTURES: String(homePictures),
        // The app quits by itself once this process is gone (guard.cjs).
        PERF_RUNNER_PID: String(process.pid),
        TEMP: path.join(profileDir, 'temp'),
        TMP: path.join(profileDir, 'temp'),
    };
    fs.mkdirSync(env.TEMP, { recursive: true });
    // Nothing of the developer's shell decides how the app starts. A proxy least of all: one on
    // 127.0.0.1 counts as this machine for the guard, and would carry a request out.
    Object.keys(env).filter(name => /^(FOLIA_|ELECTRON_RUN_AS_NODE$|NODE_ENV$|NODE_OPTIONS$|APPIMAGE$|APPDIR$|HTTPS?_PROXY$|ALL_PROXY$|NO_PROXY$|NODE_USE_ENV_PROXY$)/i.test(name)).forEach((name) => { delete env[name]; });

    const spawnedAt = Date.now();
    // English on every PC, so that what the runner looks for in the page has the same name everywhere.
    const args = ['--remote-debugging-port=0', '--lang=en-US', ENTRY];
    const child = affinityMask
        ? spawn('cmd.exe', ['/d', '/s', '/c', `"start "" /affinity ${affinityMask} /b /wait "${ELECTRON}" ${args.map(arg => `"${arg}"`).join(' ')}"`], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: true })
        : spawn(ELECTRON, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });

    const events = [];
    const waiters = new Set();
    const output = [];
    let exited = false;
    let pending = '';
    child.stdout.on('data', (chunk) => {
        pending += String(chunk);
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
            if (line.startsWith('[perf-app] {')) {
                try {
                    const event = JSON.parse(line.slice('[perf-app] '.length));
                    events.push(event);
                    waiters.forEach(waiter => waiter(event));
                } catch {
                    output.push(line.slice(0, 300));
                }
            } else if (line) {
                output.push(line.slice(0, 300));
            }
        }
    });
    let errorText = '';
    let onDevtools;
    const devtools = new Promise((resolve) => { onDevtools = resolve; });
    child.stderr.on('data', (chunk) => {
        errorText = (errorText + String(chunk)).slice(-8000);
        const match = /DevTools listening on (ws:\S+)/.exec(errorText);
        if (match) {
            onDevtools(match[1]);
        }
    });
    child.once('exit', () => {
        exited = true;
        waiters.forEach(waiter => waiter({ kind: 'exit' }));
    });

    /** The first note of a kind (one that was already made counts). Throws when the app ends or the time runs out first. */
    const waitFor = (kind, timeoutMs = 60_000, where = () => true) => new Promise((resolve, reject) => {
        const have = events.find(event => event.kind === kind && where(event));
        if (have) {
            resolve(have);
            return;
        }
        const aborted = events.find(event => event.kind === 'abort');
        if (aborted || exited) {
            reject(new Error(`[perf] the app ended before "${kind}"${aborted ? `: the guard aborted (${aborted.reason})` : ''}`));
            return;
        }
        const timer = setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error(`[perf] no "${kind}" from the app in ${timeoutMs} ms`));
        }, timeoutMs);
        const waiter = (event) => {
            if (event.kind === 'exit' || event.kind === 'abort') {
                clearTimeout(timer);
                waiters.delete(waiter);
                reject(new Error(`[perf] the app ended before "${kind}"${event.reason ? `: the guard aborted (${event.reason})` : ''}`));
            } else if (event.kind === kind && where(event)) {
                clearTimeout(timer);
                waiters.delete(waiter);
                resolve(event);
            }
        };
        waiters.add(waiter);
    });

    const running = {
        profileDir,
        spawnedAt,
        events,
        output,
        waitFor,
        hasExited: () => exited,
        errorText: () => errorText,
        browserPid: 0,
        cdp: null,
        close: async () => {
            try {
                await running.cdp?.send('Browser.close', {}, undefined, 3000);
            } catch {
                // It is going away either way.
            }
            for (let waited = 0; waited < 3000 && !exited; waited += 100) {
                await sleep(100);
            }
            // By process id only, and only the process this launch started (with what it started).
            if (running.browserPid) {
                spawnSync('taskkill', ['/pid', String(running.browserPid), '/t', '/f'], { stdio: 'ignore' });
            }
            if (!exited) {
                spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
            }
            await sleep(300);
        },
    };

    try {
        const loaded = await waitFor('guard-loaded', 30_000);
        running.browserPid = loaded.pid;
        if (!String(loaded.userData).toLowerCase().startsWith(profileDir.toLowerCase())) {
            throw new Error(`[perf] the app's user data is ${loaded.userData}, not inside ${profileDir}`);
        }
        const url = await Promise.race([devtools, sleep(30_000).then(() => { throw new Error('[perf] the app opened no DevTools port'); })]);
        running.cdp = await Cdp.connect(url);
        return running;
    } catch (error) {
        await running.close();
        throw new Error(`${error.message}\n${errorText.slice(-600)}`);
    }
};

/** Attaches to the app's own page (the one loaded from dist/index.html) and returns ways to talk to it. */
export const attachPage = async (running, { timeoutMs = 60_000 } = {}) => {
    const { cdp } = running;
    const deadline = Date.now() + timeoutMs;
    let target = null;
    while (!target) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        target = targetInfos.find(info => info.type === 'page' && /\/dist\/index\.html/.test(info.url)) ?? null;
        if (!target) {
            if (Date.now() > deadline || running.hasExited()) {
                throw new Error(`[perf] the app opened no page from dist/index.html (targets: ${targetInfos.map(info => `${info.type} ${info.url}`).join(', ')})`);
            }
            await sleep(100);
        }
    }
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const send = (method, params, timeout) => cdp.send(method, params, sessionId, timeout);
    const pageLog = [];
    cdp.listeners.add((method, params, session) => {
        if (session !== sessionId) {
            return;
        }
        if (method === 'Runtime.exceptionThrown') {
            pageLog.push(`exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? ''}`.slice(0, 300));
        } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
            pageLog.push(`${params.type}: ${params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 300));
        }
    });
    const page = {
        targetId: target.targetId,
        url: target.url,
        pageLog,
        send,
        /** Evaluates an expression in the page and waits for its promise. */
        evaluate: async (expression, timeout = 60_000) => {
            const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeout);
            if (result.exceptionDetails) {
                throw new Error(`[perf] in the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
            }
            return result.result.value;
        },
        /** Turns on the page's error log and the numbers of Performance.getMetrics. Not done while a start-up is being timed. */
        enable: async () => {
            await send('Runtime.enable');
            await send('Performance.enable', { timeDomain: 'timeTicks' });
            // The window cannot take focus; the page still behaves as the one in front.
            await send('Emulation.setFocusEmulationEnabled', { enabled: true });
        },
        /** A real mouse click at a point of the page: pressed and released, as the browser gets it from the system. */
        click: async (x, y) => {
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
        },
        /** A real key press: down and up. `key` as in KeyboardEvent.key, `code` as in KeyboardEvent.code. */
        press: async ({ key, code, keyCode, text = undefined, modifiers = 0 }) => {
            await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, text, modifiers });
            await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode, modifiers });
        },
        type: text => send('Input.insertText', { text }),
        metrics: async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value])),
    };
    return page;
};

/** Every process of the app as Windows lists it: pid, kind, affinity, working set and private bytes. */
export const processTree = (running) => {
    const found = winAction('memory', ['-RootPid', String(running.browserPid)]);
    return found === null ? [] : (Array.isArray(found) ? found : [found]);
};
