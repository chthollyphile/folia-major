import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTSIDE_LOAD } from './scenarios.mjs';
import { PUBLIC_DIR, writeSong } from './song.mjs';
import {
    darwinProcessTree,
    darwinTopology,
    ELECTRON_DARWIN,
    keepDarwinAwake,
    startDarwinSampler,
    stopDarwinStrays,
} from './darwin.mjs';

// dev/perf/rig.mjs
// What dev/perf/run.mjs and dev/perf/shots.mjs share: building and serving the measuring page,
// starting the Electron shell (held to a set of processors where a profile asks for it), talking
// to it over the DevTools protocol, and the Windows helper (dev/perf/win.ps1).
//
// macOS runs the same page, scenarios and report through dev/perf/darwin.mjs: the branches below
// pick the platform's Electron binary, sampler, screen keeper and process tree. What macOS does
// not give an unprivileged process - processor pinning (so only the `host` profile exists there),
// GPU-engine and video-memory counters, the screen's refresh rate - is refused or left out there,
// never faked; see darwin.mjs.

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
export const BUILD_DIR = path.join(HERE, '.build');
export const DIST_DIR = path.join(BUILD_DIR, 'dist');
/** The page as shots.mjs wants it: the same page with every dynamic import folded into one script (see vite.config.ts). */
export const SHOTS_DIST_DIR = path.join(BUILD_DIR, 'dist-shots');
/**
 * The page is served here: a port of its own, not the dev server's 3000 nor the tests' 4173.
 * When something else on this PC already listens there (another agent's server did, once), the
 * system picks a free port instead.
 */
const PAGE_PORT = 47830;
let pageOrigin = `http://127.0.0.1:${PAGE_PORT}`;

export const ELECTRON = process.platform === 'darwin' ? ELECTRON_DARWIN : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const VITE = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');
const WIN_SCRIPT = path.join(HERE, 'win.ps1');
const SHELL = path.join(HERE, 'shell.cjs');

export const sleep = ms => new Promise(resolve => { setTimeout(resolve, ms); });
export const log = (...parts) => console.log('[perf]', ...parts);

/**
 * Where results go by default: claude-notes/perf of the checkout this runs in. A worktree under
 * `<checkout>/.claude/worktrees/<name>` writes to that checkout's folder, so the results of every
 * worktree land in one place. (Not the repository's first checkout: git's common folder belongs
 * to another one here.)
 */
export const notesDir = () => {
    const parts = ROOT.split(path.sep);
    const inWorktree = parts.length > 3 && parts[parts.length - 2] === 'worktrees' && parts[parts.length - 3] === '.claude';
    return path.join(inWorktree ? parts.slice(0, -3).join(path.sep) : ROOT, 'claude-notes', 'perf');
};

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

export const mean = values => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

export const percentile = (values, share) => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))];
};

export const median = (values) => {
    if (values.length === 0) {
        return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = sorted.length >> 1;
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Every number in a nested record, under its dotted name: `{ a: { b: 1 } }` gives `{ 'a.b': 1 }`. */
export const flattenNumbers = (record, prefix = '', out = {}) => {
    Object.entries(record ?? {}).forEach(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'number' && Number.isFinite(value)) {
            out[name] = value;
        } else if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenNumbers(value, name, out);
        }
    });
    return out;
};

/** The median, the lowest and the highest of every number that several records share. */
export const summarize = (records) => {
    const flat = records.map(record => flattenNumbers(record));
    const summary = {};
    Object.keys(flat[0] ?? {}).forEach((name) => {
        const values = flat.map(entry => entry[name]).filter(value => typeof value === 'number');
        summary[name] = { median: median(values), min: Math.min(...values), max: Math.max(...values) };
    });
    return summary;
};

// ---------------------------------------------------------------------------------------------
// The page: build and serve
// ---------------------------------------------------------------------------------------------

/**
 * Builds the measuring page as a production bundle (dev/perf/vite.config.ts) and makes the test
 * song if it is missing. Returns false when it built nothing because `skip` asked for the page
 * built before.
 */
export const buildPage = ({ skip = false, oneFile = false } = {}) => {
    if (writeSong({ onlyIfMissing: true })) {
        log('test song written');
    }
    if (skip && fs.existsSync(path.join(oneFile ? SHOTS_DIST_DIR : DIST_DIR, 'dev', 'perf', 'page.html'))) {
        log('build skipped: using the page built before');
        return false;
    }
    const startedAt = Date.now();
    const env = { ...process.env, PERF_ONE_FILE: oneFile ? '1' : '' };
    const result = spawnSync(process.execPath, [VITE, 'build', '--config', path.join(HERE, 'vite.config.ts')], { cwd: ROOT, encoding: 'utf8', env });
    if (result.status !== 0) {
        throw new Error(`[perf] the page did not build:\n${result.stdout}\n${result.stderr}`);
    }
    log(`page built in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
    return true;
};

const CONTENT_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wav': 'audio/wav',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.wasm': 'application/wasm',
    '.bin': 'application/octet-stream',
};

/** Serves the built page, and the test song under /perf-song/, on 127.0.0.1 only. */
export const startServer = ({ dist = DIST_DIR } = {}) => new Promise((resolve, reject) => {
    const server = http.createServer((request, response) => {
        const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
        const [base, relative] = pathname.startsWith('/perf-song/')
            ? [PUBLIC_DIR, pathname.slice('/perf-song/'.length)]
            : [dist, pathname.slice(1)];
        const file = path.resolve(base, relative);
        if (!file.startsWith(base) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
            response.writeHead(404).end();
            return;
        }
        const size = fs.statSync(file).size;
        const headers = {
            'Content-Type': CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
            'Accept-Ranges': 'bytes',
        };
        const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? '');
        if (range) {
            const start = range[1] ? Number(range[1]) : 0;
            const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
            response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
            fs.createReadStream(file, { start, end }).pipe(response);
            return;
        }
        response.writeHead(200, { ...headers, 'Content-Length': size });
        fs.createReadStream(file).pipe(response);
    });
    const listening = () => {
        pageOrigin = `http://127.0.0.1:${server.address().port}`;
        resolve({ origin: pageOrigin, close: () => new Promise((done) => { server.close(done); server.closeAllConnections(); }) });
    };
    server.once('error', (error) => {
        if (error.code !== 'EADDRINUSE') {
            reject(error);
            return;
        }
        log(`port ${PAGE_PORT} is taken, serving the page on a free one`);
        server.listen(0, '127.0.0.1', listening);
    });
    server.listen(PAGE_PORT, '127.0.0.1', listening);
});

// ---------------------------------------------------------------------------------------------
// Windows: processors, process trees, counters
// ---------------------------------------------------------------------------------------------

const POWERSHELL = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', WIN_SCRIPT];

/** Runs one action of dev/perf/win.ps1 and returns what it printed, parsed. */
export const winAction = (action, args = []) => {
    const result = spawnSync('powershell.exe', [...POWERSHELL, '-Action', action, ...args], { encoding: 'utf8' });
    if (result.status !== 0) {
        throw new Error(`[perf] win.ps1 ${action} failed: ${result.stderr || result.stdout}`);
    }
    // An action that found nothing prints nothing (PowerShell writes no JSON for an empty list).
    const printed = result.stdout.trim();
    return printed ? JSON.parse(printed) : null;
};

/** The commit the working tree is at and whether files differ from it: what a result was measured from. */
export const gitState = () => {
    const git = args => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
    const head = git(['rev-parse', 'HEAD']);
    const status = git(['status', '--porcelain']);
    return {
        commit: head.status === 0 ? head.stdout.trim() : null,
        dirty: status.status === 0 ? status.stdout.trim().length > 0 : null,
    };
};

const maskOf = indices => indices.reduce((mask, index) => mask | (1n << BigInt(index)), 0n).toString(16).toUpperCase();
const indicesOf = (mask) => {
    const value = BigInt(`0x${mask}`);
    return Array.from({ length: 64 }, (_, index) => index).filter(index => (value >> BigInt(index)) & 1n);
};

/**
 * The profiles a run can be taken under. `cores` slow processors hold every process of the
 * measuring app (raster, compositor, GPU process and workers too), and that is all a profile does.
 * The DevTools slow-down of the main thread (Emulation.setCPUThrottlingRate) is not used: its
 * helper thread kept most of one processor busy by itself and it did not slow short tasks, so
 * `old` with it was neither two cores nor twice as slow.
 */
export const PROFILES = {
    host: { cores: null },
    laptop: { cores: 4 },
    old: { cores: 2 },
};

/** Asked of Windows once per run: every launch resolves its profile, and the answer does not change. */
let topologyAsked = null;

/**
 * Which processors a profile means on this PC. The slow ones are the cores Windows reports with
 * the lowest efficiency class (the "E" cores of a hybrid Intel chip); a PC without two classes
 * gets its last processors instead, and `hasSlowCores` says so. A PC that cannot give exactly the
 * number a profile asks for is refused: `laptop` on two slow cores would be `old` under another name.
 *
 * macOS has no processor pinning for an unprivileged process (darwin.mjs), so there only `host`
 * exists; `laptop` and `old` are refused rather than run without their limits under those names.
 */
export const resolveProfile = (name) => {
    const profile = PROFILES[name];
    if (!profile) {
        throw new Error(`[perf] no profile named "${name}" (host, laptop, old)`);
    }
    if (process.platform === 'darwin' && profile.cores) {
        throw new Error(`[perf] profile "${name}" holds the app to ${profile.cores} processors, and macOS offers no processor pinning: run the ${name} scenarios under --profile host`);
    }
    if (process.platform === 'darwin') {
        topologyAsked ??= darwinTopology();
        return {
            name,
            heldProcessors: null,
            affinityMask: null,
            samplerMask: null,
            hasSlowCores: false,
            /** macOS reads no graphics-card counters (darwin.mjs): nothing averages the zeros in. */
            gpuCounters: false,
            cpuName: topologyAsked.name,
            logicalProcessors: topologyAsked.logicalProcessors,
            slowProcessors: [],
            memoryGb: topologyAsked.memoryGb,
            videoCard: topologyAsked.videoCard,
            screen: topologyAsked.screen,
            screenRefreshRate: topologyAsked.refreshRate,
        };
    }
    topologyAsked ??= winAction('topology');
    const topology = topologyAsked;
    const cores = Array.isArray(topology.cores) ? topology.cores : [topology.cores];
    const classes = [...new Set(cores.map(core => core.efficiencyClass))].sort((left, right) => left - right);
    const hasSlowCores = classes.length > 1;
    const slow = cores.filter(core => !hasSlowCores || core.efficiencyClass === classes[0]).flatMap(core => indicesOf(core.mask));
    const fast = cores.filter(core => hasSlowCores && core.efficiencyClass !== classes[0]).flatMap(core => indicesOf(core.mask));
    const held = profile.cores ? (hasSlowCores ? slow.slice(0, profile.cores) : slow.slice(-profile.cores)) : null;
    if (held && held.length !== profile.cores) {
        throw new Error(`[perf] profile "${name}" holds the app to ${profile.cores} ${hasSlowCores ? 'slow ' : ''}processors, and this PC has ${held.length}`);
    }
    const others = held ? [...fast, ...slow].filter(index => !held.includes(index)) : null;
    return {
        name,
        heldProcessors: held,
        affinityMask: held ? maskOf(held) : null,
        /**
         * Where the sampler goes, so it stays off the processors being measured. The runner itself is
         * not held anywhere: a process started with `start /affinity` from a held parent keeps the
         * parent's processors, not the ones asked for, and the runner only waits while a window plays.
         */
        samplerMask: held ? maskOf(fast.length ? fast : others) : null,
        hasSlowCores,
        cpuName: topology.name,
        logicalProcessors: topology.logicalProcessors,
        slowProcessors: hasSlowCores ? slow : [],
        memoryGb: topology.memoryGb,
        videoCard: topology.videoCard,
        screen: topology.screen,
        /** How often the screen refreshes a second, as Windows reports the current mode; null when it does not say. */
        screenRefreshRate: Number(topology.refreshRate) || null,
    };
};

/**
 * What other programs did over some of the sampler's lines, and which of the limits in OUTSIDE_LOAD
 * (scenarios.mjs) that broke. Shared by dev/perf/run.mjs and dev/perf/app/run.mjs.
 *
 * `profile.gpuCounters === false` (macOS, darwin.mjs) leaves the graphics-card numbers out instead
 * of averaging the sampler's zeros into them, and the card's limit cannot break.
 */
export const outsideLoad = (samples, profile) => {
    const held = profile.heldProcessors;
    const gpuCounters = profile.gpuCounters !== false;
    const withOwn = samples.filter(sample => typeof sample.ownCpu === 'number');
    const ofAllProcessors = mean(withOwn.map(sample => Math.max(0, sample.cpuTotal / 100 - sample.ownCpu / profile.logicalProcessors)));
    const ofHeldProcessors = held
        ? mean(withOwn.map(sample => Math.max(0, held.reduce((sum, index) => sum + Number(sample.cores?.[index] ?? 0) / 100, 0) - sample.ownCpu) / held.length))
        : null;
    const brokenLimits = [];
    if (ofAllProcessors > OUTSIDE_LOAD.ofAllProcessors) {
        brokenLimits.push('processors');
    }
    if (ofHeldProcessors !== null && ofHeldProcessors > OUTSIDE_LOAD.ofHeldProcessors) {
        brokenLimits.push('held processors');
    }
    if (gpuCounters && mean(samples.map(sample => Number(sample.gpuOutside ?? 0))) > OUTSIDE_LOAD.gpuPercent) {
        brokenLimits.push('graphics card');
    }
    return {
        ofAllProcessors,
        ...(ofHeldProcessors === null ? {} : { ofHeldProcessors }),
        ...(gpuCounters ? {
            gpuPercent: mean(samples.map(sample => Number(sample.gpuOutside ?? 0))),
            videoMemoryMb: mean(samples.map(sample => Number(sample.videoMemoryOutside ?? 0))) / (1024 * 1024),
        } : {}),
        brokenLimits,
    };
};

/** The one-line-a-second sampler (win.ps1 on Windows, darwinSampler.mjs on macOS) for a set of processes. */
export const startSampler = ({ pids, processors, selfMask }) => {
    let child;
    if (process.platform === 'darwin') {
        child = startDarwinSampler({ pids });
    } else {
        const args = [...POWERSHELL, '-Action', 'sample'];
        if (pids.length) {
            args.push('-Pids', pids.join(','));
        }
        if (processors?.length) {
            args.push('-Cores', processors.join(','));
        }
        if (selfMask) {
            args.push('-Mask', selfMask);
        }
        // The sampler ends by itself once this process is gone: a runner that was killed cannot stop it.
        args.push('-RunnerPid', String(process.pid));
        child = spawn('powershell.exe', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    }
    const samples = [];
    let header = null;
    let pending = '';
    let failure = '';
    let exited = false;
    let onReady;
    const ready = new Promise((resolve) => { onReady = resolve; });
    child.stdout.on('data', (chunk) => {
        pending += String(chunk);
        let newline = pending.indexOf('\n');
        while (newline >= 0) {
            const line = pending.slice(0, newline).trim();
            pending = pending.slice(newline + 1);
            newline = pending.indexOf('\n');
            if (!line.startsWith('{')) {
                continue;
            }
            const record = JSON.parse(line);
            if (record.ready) {
                header = record;
            } else {
                samples.push(record);
                // The first line of numbers shows the counters answer.
                if (samples.length === 1) {
                    sampler.readyAt = Date.now();
                }
                onReady();
            }
        }
    });
    child.stderr.on('data', (chunk) => { failure += String(chunk); });
    child.on('exit', () => {
        exited = true;
        onReady();
    });
    const sampler = {
        pids,
        samples,
        /** The sampler's own `ready` line: on macOS it says `gpuCounters: false` (darwin.mjs). */
        header: () => header,
        /** True when the sampler counts the graphics card (Windows only); false on macOS. */
        gpuCounters: () => header?.gpuCounters !== false,
        /** When the first line of numbers came (Date.now()). The lines of the seconds after it read high: the sampler's own start-up. */
        readyAt: 0,
        /** True once the sampler process has ended: no more lines will come. */
        hasExited: () => exited,
        ready: ready.then(() => {
            if (samples.length === 0) {
                throw new Error(`[perf] the counter sampler gave nothing: ${failure.slice(0, 400)}`);
            }
            return header;
        }),
        stop: () => { child.kill(); },
    };
    return sampler;
};

/**
 * Stops the engines an earlier run of this checkout's rig left behind. A runner that was killed
 * cannot close its engine, and an engine nobody sees keeps drawing and holds the user-data folder
 * the next launch wants to clear. Returns the process ids it stopped.
 */
export const stopStrayEngines = () => (process.platform === 'darwin'
    ? { stopped: stopDarwinStrays(SHELL) }
    : winAction('strays', ['-ShellPath', SHELL]))?.stopped ?? [];

/**
 * Turns the screen on and keeps it on for as long as this process lives: a helper tells Windows
 * every two seconds that the screen and the PC are in use, and ends by itself when this process is
 * gone. The window takes its frame rate from the screen only while the screen is on; the shell's
 * own hold (powerSaveBlocker) keeps a screen from going off but does not turn one on. `ready`
 * resolves when the helper has spoken to Windows once (or could not be started: the run then goes
 * on without it, and every launch still checks what rate its window is paced at).
 */
export const keepAwake = () => {
    if (process.platform === 'darwin') {
        return keepDarwinAwake();
    }
    const child = spawn('powershell.exe', [...POWERSHELL, '-Action', 'awake', '-RunnerPid', String(process.pid)], { stdio: ['ignore', 'pipe', 'ignore'] });
    const ready = new Promise((resolve) => {
        child.stdout.once('data', () => resolve(true));
        child.once('exit', () => resolve(false));
        child.once('error', () => resolve(false));
        setTimeout(() => resolve(false), 15_000);
    });
    return { ready, close: async () => { child.kill(); } };
};

// ---------------------------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------------------------

/** A minimal DevTools-protocol client over the browser's WebSocket. */
export class Cdp {
    static async connect(url) {
        const socket = new WebSocket(url);
        await new Promise((resolve, reject) => {
            socket.addEventListener('open', resolve, { once: true });
            socket.addEventListener('error', () => reject(new Error('[perf] DevTools socket failed')), { once: true });
        });
        return new Cdp(socket);
    }

    constructor(socket) {
        this.socket = socket;
        this.nextId = 1;
        this.pending = new Map();
        this.listeners = new Set();
        socket.addEventListener('message', (event) => {
            const message = JSON.parse(event.data);
            if (message.id) {
                const waiting = this.pending.get(message.id);
                this.pending.delete(message.id);
                if (!waiting) {
                    return;
                }
                clearTimeout(waiting.timer);
                if (message.error) {
                    waiting.reject(new Error(`[perf] ${waiting.method}: ${message.error.message}`));
                } else {
                    waiting.resolve(message.result);
                }
                return;
            }
            this.listeners.forEach(listener => listener(message.method, message.params, message.sessionId));
        });
    }

    send(method, params = {}, sessionId = undefined, timeoutMs = 30_000) {
        return new Promise((resolve, reject) => {
            const id = this.nextId;
            this.nextId += 1;
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new Error(`[perf] ${method} did not answer in ${timeoutMs} ms`));
            }, timeoutMs);
            this.pending.set(id, { resolve, reject, timer, method });
            this.socket.send(JSON.stringify({ id, method, params, sessionId }));
        });
    }
}

/**
 * Starts the Electron shell (dev/perf/shell.cjs) and attaches to its page.
 * With `affinityMask` it is started through `start /affinity`, so the browser process and every
 * process it starts are held to those processors from their first instruction.
 */
export const launchEngine = async ({ width, height, deviceScale, affinityMask = null, windowMode = 'offscreen', userDataName = 'userdata' }) => {
    if (process.platform === 'darwin' && affinityMask) {
        throw new Error('[perf] processor affinity is a Windows thing; macOS runs the host profile only (resolveProfile)');
    }
    // shots.mjs runs several engines at once and gives each a folder of its own.
    const userData = path.join(BUILD_DIR, userDataName);
    fs.rmSync(userData, { recursive: true, force: true });
    const env = {
        ...process.env,
        PERF_WIDTH: String(width),
        PERF_HEIGHT: String(height),
        PERF_DEVICE_SCALE: String(deviceScale),
        PERF_WINDOW_MODE: windowMode,
        PERF_USER_DATA: userData,
        // The shell quits by itself once this process is gone (dev/perf/shell.cjs).
        PERF_RUNNER_PID: String(process.pid),
    };
    delete env.ELECTRON_RUN_AS_NODE;
    // Port 0: the engine picks a free DevTools port and prints it, so two rigs never attach to each other's engine.
    const child = affinityMask
        ? spawn('cmd.exe', ['/d', '/s', '/c', `"start "" /affinity ${affinityMask} /b /wait "${ELECTRON}" --remote-debugging-port=0 "${SHELL}""`], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsVerbatimArguments: true })
        : spawn(ELECTRON, ['--remote-debugging-port=0', SHELL], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    const shellLog = [];
    child.stdout.on('data', chunk => String(chunk).split(/\r?\n/).filter(line => line.includes('[perf]')).forEach(line => shellLog.push(line.trim())));
    try {
        return await attachToEngine(child, shellLog);
    } catch (error) {
        // Nothing can close an engine that never answered: its whole process tree is stopped here.
        killTree(process.platform, child.pid);
        throw error;
    }
};

/**
 * Stops an engine that cannot be closed politely. On Windows `taskkill /t /f` kills the whole
 * process tree; on macOS only the root gets SIGKILL, and Electron's helpers are expected to exit
 * with it.
 */
const killTree = (platform, pid) => {
    if (!pid) return;
    if (platform === 'win32') {
        spawnSync('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
        return;
    }
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Already gone.
    }
};

/** Waits for a started shell's DevTools port, attaches to its page and returns the engine. */
const attachToEngine = async (child, shellLog) => {
    const devtoolsUrl = await new Promise((resolve, reject) => {
        let printed = '';
        const timer = setTimeout(() => reject(new Error('[perf] the engine did not open a DevTools port')), 30_000);
        child.stderr.on('data', (chunk) => {
            printed += String(chunk);
            const match = /DevTools listening on (ws:\S+)/.exec(printed);
            if (match) {
                clearTimeout(timer);
                resolve(match[1]);
            }
        });
        child.once('exit', () => reject(new Error('[perf] the engine stopped before it was up')));
    });

    const cdp = await Cdp.connect(devtoolsUrl);
    const version = await cdp.send('Browser.getVersion');
    let page = null;
    for (let attempt = 0; attempt < 50 && !page; attempt += 1) {
        const { targetInfos } = await cdp.send('Target.getTargets');
        page = targetInfos.find(target => target.type === 'page') ?? null;
        if (!page) {
            await sleep(200);
        }
    }
    if (!page) {
        throw new Error('[perf] the shell opened no window');
    }
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: page.targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Performance.enable', { timeDomain: 'timeTicks' }, sessionId);

    const pageLog = [];
    let onLoad = null;
    cdp.listeners.add((method, params) => {
        if (method === 'Runtime.exceptionThrown') {
            pageLog.push(`exception: ${params.exceptionDetails?.exception?.description ?? params.exceptionDetails?.text ?? ''}`.slice(0, 300));
        } else if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
            pageLog.push(`${params.type}: ${params.args.map(arg => arg.value ?? arg.description ?? '').join(' ')}`.slice(0, 300));
        } else if (method === 'Page.loadEventFired' && onLoad) {
            onLoad();
            onLoad = null;
        }
    });

    const processes = async () => (await cdp.send('SystemInfo.getProcessInfo')).processInfo;
    const browserPid = (await processes()).find(process => process.type === 'browser').id;

    const engine = {
        browser: version.product,
        userAgent: version.userAgent,
        browserPid,
        shellLog,
        pageLog,
        send: (method, params, timeoutMs) => cdp.send(method, params, sessionId, timeoutMs),
        /** Calls `listener(method, params)` for every DevTools event of the page (shots.mjs watches the network with it). */
        on: (listener) => {
            cdp.listeners.add((method, params, session) => {
                if (session === sessionId) {
                    listener(method, params);
                }
            });
        },
        processes,
        /** Evaluates an expression in the page and waits for its promise. */
        evaluate: async (expression, timeoutMs = 60_000) => {
            const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId, timeoutMs);
            if (result.exceptionDetails) {
                throw new Error(`[perf] in the page: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
            }
            return result.result.value;
        },
        navigate: async (url) => {
            pageLog.length = 0;
            const loaded = new Promise((resolve) => { onLoad = resolve; });
            await cdp.send('Page.navigate', { url }, sessionId);
            await Promise.race([loaded, sleep(60_000).then(() => { throw new Error(`[perf] ${url} did not load`); })]);
        },
        /** Every process of the app with the processors it is held to (asked of the OS, not of the engine). */
        tree: () => {
            if (process.platform === 'darwin') {
                return darwinProcessTree(browserPid);
            }
            const found = winAction('tree', ['-RootPid', String(browserPid)]);
            return found === null ? [] : (Array.isArray(found) ? found : [found]);
        },
        close: async () => {
            try {
                await cdp.send('Browser.close', {}, undefined, 3000);
            } catch {
                // It is going away either way.
            }
            await sleep(800);
            killTree(process.platform, browserPid);
            child.kill();
        },
    };
    return engine;
};

/** The address of the measuring page for one scenario. */
export const pageUrl = (scenario, { shot = false } = {}) => {
    const input = { style: scenario.style, background: scenario.background, tunings: scenario.tunings };
    return `${pageOrigin}/dev/perf/page.html?scenario=${encodeURIComponent(JSON.stringify(input))}${shot ? '&shot=1' : ''}`;
};

/** Loads a scenario's page and waits until its style has drawn. */
export const openScenario = async (engine, scenario, options) => {
    await engine.navigate(pageUrl(scenario, options));
    const deadline = Date.now() + 90_000;
    for (;;) {
        const state = await engine.evaluate('window.__perf ? "up" : (document.documentElement.getAttribute("data-perf-error") || "")');
        if (state === 'up') {
            break;
        }
        if (state || Date.now() > deadline) {
            throw new Error(`[perf] ${scenario.id}: the page did not start: ${state || 'timed out'}`);
        }
        await sleep(100);
    }
    await engine.evaluate('window.__perf.ready', 90_000);
    return engine.evaluate('window.__perf.info()');
};
