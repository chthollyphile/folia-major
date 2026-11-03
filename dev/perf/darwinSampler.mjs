#!/usr/bin/env node
import { execFile } from 'node:child_process';
import os from 'node:os';

// dev/perf/darwinSampler.mjs
// The macOS stand-in for `win.ps1 -Action sample` (see the rig's README): one JSON line a second on
// stdout in the same shape the PowerShell sampler prints, consumed by startSampler in rig.mjs.
//
// What macOS can and cannot give a process that is not root:
//   - per-process CPU: exact, from the cumulative CPU time `ps -o time=` reports, differenced
//     between lines (ownCpu, in cores);
//   - per-process working set: `ps -o rss=` (resident, KB), bytes in `workingSet`;
//   - the whole machine's CPU: `ps -A -o pcpu=` summed. That is ps' own decaying average per
//     process, not an instant reading, and kernel time is not in it: an approximation, and it says
//     so in every line (`cpuTotalApproximate: true`). It is enough for the rig's outside-load
//     limits, which ask whether other programs keep the processors busy;
//   - the graphics card: nothing. Windows' GPU Engine counters have no counterpart a user process
//     may read on macOS (powermetrics needs root), so there is no `gpu`, no `videoMemory` and
//     `ownEngines` stays 0; the header says `gpuCounters: false` and the runner leaves those
//     numbers out instead of writing zeros.
//
// One `ps` listing a second serves both per-process numbers and the machine total (one execFile
// where two ran before: a busy machine stretched a tick past its second and windows then held too
// few lines). Ticks are scheduled by the wall clock, not by `setInterval`: a tick that overruns
// does not drift the ones after it.
//
// Ends by itself once the runner that started it is gone (`--runner-pid`), like win.ps1.

const args = new Map(process.argv.slice(2).map((value, index, all) => (
    value.startsWith('--') ? [value.slice(2), all[index + 1]] : undefined
)).filter(Boolean));

const pids = new Set((args.get('pids') ?? '').split(',').filter(Boolean).map(Number));
const runnerPid = Number(args.get('runner-pid') ?? 0);

const say = value => process.stdout.write(`${JSON.stringify(value)}\n`);

/** `ps -o time=` formats: `m:ss.cc`, `h:mm:ss.cc`, `d-hh:mm:ss.cc`. Seconds, or null unparsable. */
const psTimeSeconds = (text) => {
    const days = /^(\d+)-(.*)$/.exec(text);
    const rest = days ? days[2] : text;
    const parts = rest.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part))) return null;
    let seconds = 0;
    for (const part of parts) seconds = seconds * 60 + part;
    return seconds + (days ? Number(days[1]) * 86400 : 0);
};

/** One `ps` listing of every process: pid, cumulative CPU time, resident KB, ps' own cpu average. */
const readAll = () => new Promise((resolve) => {
    // LC_ALL=C: a comma-decimal locale prints `time` and `pcpu` as `0:01,50` / `1,5`, which the
    // line pattern in tick does not read.
    execFile('ps', ['-A', '-o', 'pid=,time=,rss=,pcpu='], { timeout: 8000, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
        resolve(error ? null : stdout);
    });
});

const logicalProcessors = os.cpus().length;
say({ ready: true, processors: logicalProcessors, gpuCounters: false });

let previousCpu = null;
let previousAt = null;
let stopped = false;

const tick = async () => {
    if (stopped) return;
    if (runnerPid > 0) {
        try {
            // Signal 0 only asks whether the runner is there; EPERM means it is (another user's).
            process.kill(runnerPid, 0);
        } catch (error) {
            // The runner is gone (ESRCH): stop without another line, as win.ps1 does. EPERM (or
            // anything else) is still a live runner, and the tick goes on.
            if (error?.code === 'ESRCH') {
                stopped = true;
                process.exit(0);
            }
        }
    }
    try {
        const text = await readAll();
        // A listing that failed is no reading at all: nothing is printed for this tick, and the
        // previous CPU snapshot stands, so the next tick's difference still covers the whole span.
        // (A line with empty working sets would fail a window on "did not find the app's page
        // process", and an empty snapshot would zero the next ownCpu while cpuTotal still counted
        // the app's own use as outside load.)
        if (text === null) return;
        const now = Date.now();
        const cpu = new Map();
        const rss = new Map();
        let machineSum = 0;
        for (const line of text.split('\n')) {
            const match = /^\s*(\d+)\s+(\S+)\s+(\d+)\s+([\d.]+)$/.exec(line);
            if (!match) continue;
            const pid = Number(match[1]);
            machineSum += Number(match[4]);
            if (!pids.has(pid)) continue;
            const seconds = psTimeSeconds(match[2]);
            if (seconds === null) continue;
            cpu.set(pid, seconds);
            rss.set(pid, Number(match[3]) * 1024);
        }
        let cpuSeconds = 0;
        for (const [pid, seconds] of cpu) {
            const earlier = previousCpu?.get(pid);
            if (earlier !== undefined && seconds >= earlier) cpuSeconds += seconds - earlier;
        }
        const ownCpu = previousAt ? cpuSeconds / Math.max(0.001, (now - previousAt) / 1000) : null;
        previousCpu = cpu;
        previousAt = now;
        const workingSet = {};
        for (const [pid, bytes] of rss) workingSet[String(pid)] = bytes;
        say({
            t: now,
            cpuTotal: Math.round(Math.min(100, Math.max(0, machineSum / logicalProcessors)) * 100) / 100,
            cpuTotalApproximate: true,
            cores: null,
            ownCpu,
            ownEngines: 0,
            gpu: {},
            videoMemory: {},
            gpuOutside: 0,
            videoMemoryOutside: 0,
            workingSet,
        });
    } catch {
        // A tick that failed prints nothing; the next one reads again.
    }
};

// Wall-clock scheduling: tick n happens at startedAt + n seconds, however long tick n-1 took.
const startedAt = Date.now();
const schedule = (n) => {
    setTimeout(() => {
        void tick().finally(() => schedule(n + 1));
    }, Math.max(0, startedAt + n * 1000 - Date.now()));
};

await tick();
schedule(1);
