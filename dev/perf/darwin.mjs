import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// dev/perf/darwin.mjs
// The macOS side of the rig (dev/perf/README.md): the pieces that on Windows are win.ps1 actions
// and the electron.exe path. Everything the two platforms share - the page, the scenarios, the
// DevTools client, the report - stays in rig.mjs and run.mjs, which branch on process.platform.
//
// What is deliberately NOT here:
//   - CPU profiles. Windows holds the app to slow cores by affinity (`start /affinity`); macOS
//     offers no processor pinning for an unprivileged process, and a QoS class would be a different
//     kind of slow. Only the `host` profile (no limits) runs on macOS; the others are refused with
//     a message that says so (resolveProfile in rig.mjs).
//   - GPU and video-memory counters. Windows reads its `GPU Engine` performance counters; macOS
//     keeps its equivalents behind root-only powermetrics. The sampler (darwinSampler.mjs) reports
//     none, the results carry no GPU numbers, and nothing is invented in their place.
//   - The screen's refresh rate. system_profiler does not tell it on this macOS for the built-in
//     display, so it is null: the "does the window follow the screen" check is then off, and every
//     launch still records the rate its empty window was paced at (emptyFrameRate).

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../..');
/** The project's Electron as installed by npm on macOS. */
export const ELECTRON_DARWIN = path.join(ROOT, 'node_modules', 'electron', 'dist', 'Electron.app', 'Contents', 'MacOS', 'Electron');
const SAMPLER = path.join(HERE, 'darwinSampler.mjs');

// LC_ALL=C: ps, sysctl and system_profiler print numbers the C locale's way, the one the patterns
// here read (a comma-decimal locale would otherwise write `1,5`).
const run = (file, args) => {
    const result = spawnSync(file, args, { encoding: 'utf8', timeout: 20_000, env: { ...process.env, LC_ALL: 'C' } });
    return result.status === 0 ? result.stdout : null;
};

/**
 * The machine once per run: what resolveProfile needs on macOS. `cpuName` is the chip,
 * `videoCard` the same (one GPU), `screen` the main display's resolution as text, `refreshRate`
 * null (see the header), and no efficiency classes: Apple Silicon has E and P cores but tells an
 * unprivileged process nothing about which logical processor sits on which.
 */
export const darwinTopology = () => {
    const cpuName = run('sysctl', ['-n', 'machdep.cpu.brand_string'])?.trim() || 'Apple Silicon';
    let videoCard = cpuName;
    let screen = null;
    const displays = run('system_profiler', ['SPDisplaysDataType']);
    if (displays) {
        videoCard = /Chipset Model:\s*(.+)$/m.exec(displays)?.[1]?.trim() ?? cpuName;
        screen = /^\s*Resolution:\s*(.+)$/m.exec(displays)?.[1]?.trim() ?? null;
    }
    return {
        name: cpuName,
        logicalProcessors: os.cpus().length,
        memoryGb: Math.round(os.totalmem() / (1024 ** 3)),
        videoCard,
        screen,
        refreshRate: null,
        cores: [{ mask: '', efficiencyClass: 0 }],
    };
};

/**
 * The macOS sampler: dev/perf/darwinSampler.mjs as a child, printing one JSON line a second in
 * win.ps1's shape (see that file for what it cannot measure). The rig's startSampler consumes it.
 */
export const startDarwinSampler = ({ pids }) => {
    const child = spawn(process.execPath, [SAMPLER, '--pids', pids.join(','), '--runner-pid', String(process.pid)], { stdio: ['ignore', 'pipe', 'pipe'] });
    return child;
};

/**
 * Stops every Electron whose command line names this checkout's dev/perf/shell.cjs - an engine a
 * killed runner left behind, still drawing off-screen and holding its user-data folder. Returns
 * the process ids it stopped, like win.ps1 -Action strays.
 */
export const stopDarwinStrays = (shellPath) => {
    const listed = run('pgrep', ['-f', shellPath]);
    if (!listed) return [];
    const mine = new Set([process.pid]);
    const stopped = [];
    for (const line of listed.split('\n')) {
        const pid = Number(line.trim());
        if (!Number.isInteger(pid) || pid <= 1 || mine.has(pid)) continue;
        try {
            process.kill(pid, 'SIGKILL');
            stopped.push(pid);
        } catch {
            // Gone between pgrep and kill: it stopped itself.
        }
    }
    return stopped;
};

/**
 * Keeps the display on until this process ends, turning one that is off on first: `caffeinate -u`
 * asserts user activity (which wakes the display), `-d` holds display sleep off, `-w` ends the
 * assertion when the runner is gone - the same contract as win.ps1 -Action awake, without a
 * helper loop. Resolves once caffeinate is running (it prints nothing to say so itself).
 */
export const keepDarwinAwake = () => {
    const child = spawn('caffeinate', ['-u', '-d', '-w', String(process.pid)], { stdio: 'ignore' });
    const ready = new Promise((resolve) => {
        child.once('spawn', () => resolve(true));
        child.once('error', () => resolve(false));
        child.once('exit', () => resolve(false));
    });
    return { ready, close: async () => { child.kill(); } };
};

/**
 * Every process below `rootPid` (itself included), in a reduced form of win.ps1 -Action tree's
 * entries: only `pid`, `name`, `kind` and `affinity`. `kind` is 'root' for `rootPid` and 'process'
 * for the rest, not the command line's --type (browser / renderer / gpu-process ...); there is no
 * `parent` or `workingSetMb`; and macOS has no affinity masks to report, so `affinity` is null and
 * the rig checks none under the host profile.
 */
export const darwinProcessTree = (rootPid) => {
    const text = run('ps', ['-A', '-o', 'pid=,ppid=,comm=']);
    if (!text) return [];
    const rows = [];
    for (const line of text.split('\n')) {
        const match = /^\s*(\d+)\s+(\d+)\s+(.+)$/.exec(line);
        if (match) rows.push({ pid: Number(match[1]), ppid: Number(match[2]), name: match[3].trim() });
    }
    const byParent = new Map();
    const byPid = new Map();
    for (const row of rows) {
        byPid.set(row.pid, row);
        byParent.set(row.ppid, [...(byParent.get(row.ppid) ?? []), row]);
    }
    // The root itself first (win.ps1 lists it too), then everything below it.
    const root = byPid.get(rootPid);
    const tree = root ? [{ pid: root.pid, kind: 'root', name: path.basename(root.name), affinity: null }] : [];
    const walk = (pid) => {
        for (const row of byParent.get(pid) ?? []) {
            tree.push({ pid: row.pid, kind: 'process', name: path.basename(row.name), affinity: null });
            walk(row.pid);
        }
    };
    walk(rootPid);
    return tree;
};
