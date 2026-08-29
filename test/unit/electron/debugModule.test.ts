import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/electron/debugModule.test.ts
// The two halves of the debug module that have arithmetic or a filesystem in them. The wiring in
// debugHost.cjs is left to the app - it is IPC registration and timers, and mocking Electron to
// watch a setInterval fire proves nothing the code does not already say.

const { createMemoryMonitor } = require('../../../electron/debug/memoryMonitor.cjs');
const { createDebugLogWriter } = require('../../../electron/debug/debugLogWriter.cjs');

/** A metrics row shaped like Electron's, sizes in KB. */
const metric = (pid: number, type: string, workingSetMB: number, peakMB = workingSetMB, privateMB: number | null = null) => ({
    pid,
    type,
    cpu: { percentCPUUsage: 1 },
    memory: {
        workingSetSize: workingSetMB * 1024,
        peakWorkingSetSize: peakMB * 1024,
        ...(privateMB === null ? {} : { privateBytes: privateMB * 1024 }),
    },
});

describe('the memory monitor', () => {
    it('reports the peak of the simultaneous total, never the sum of per-process peaks', () => {
        const monitor = createMemoryMonitor();

        // Two processes that each peaked at 1000MB, but never at the same moment: one was at its
        // peak in the first sample and the other in the second. Summing their own high-water marks
        // would claim 2000MB, a state this app was never in. That mistake is exactly the one the
        // automix memory work spent an afternoon on.
        monitor.sample({ metrics: [metric(1, 'Browser', 1000, 1000), metric(2, 'Tab', 100, 1000)] });
        const second = monitor.sample({ metrics: [metric(1, 'Browser', 100, 1000), metric(2, 'Tab', 1000, 1000)] });

        expect(second.peakMB).toBe(1100);
        expect(second.totalWorkingSetMB).toBe(1100);
        // The per-process high-water marks are still carried - they are worth reading, just not
        // worth adding up.
        expect(second.processes.map((row: { peakWorkingSetMB: number }) => row.peakWorkingSetMB)).toEqual([1000, 1000]);
    });

    it('tracks floor and mean across the run, and resets with it', () => {
        const monitor = createMemoryMonitor();
        monitor.sample({ metrics: [metric(1, 'Browser', 400)] });
        monitor.sample({ metrics: [metric(1, 'Browser', 800)] });
        const third = monitor.sample({ metrics: [metric(1, 'Browser', 600)] });

        expect(third.floorMB).toBe(400);
        expect(third.peakMB).toBe(800);
        expect(third.avgMB).toBe(600);
        expect(third.samples).toBe(3);

        // Switching the monitor off and on again starts a new run; carrying the old peak forward
        // would make the first sample of the new one report a number nothing in it produced.
        monitor.reset();
        const fresh = monitor.sample({ metrics: [metric(1, 'Browser', 500)] });
        expect(fresh.peakMB).toBe(500);
        expect(fresh.floorMB).toBe(500);
        expect(fresh.samples).toBe(1);
    });

    it('keeps an unreported private figure as null rather than zero', () => {
        const monitor = createMemoryMonitor();
        // privateBytes is Windows-only in Chromium. A zero here would be read months later as "this
        // process shares everything", which is a different and false claim.
        const absent = monitor.sample({ metrics: [metric(1, 'Browser', 400)] });
        expect(absent.processes[0].privateMB).toBeNull();
        expect(absent.totalPrivateMB).toBeNull();

        const present = monitor.sample({ metrics: [metric(1, 'Browser', 400, 400, 300)] });
        expect(present.processes[0].privateMB).toBe(300);
        expect(present.totalPrivateMB).toBe(300);

        // And the total is all-or-nothing: summing only the processes that answered produces a
        // figure labelled "total" that is short by however many did not.
        const partial = monitor.sample({ metrics: [metric(1, 'Browser', 400, 400, 300), metric(2, 'Tab', 900)] });
        expect(partial.totalPrivateMB).toBeNull();
    });

    it('fills a missing private figure from what the process said about itself', () => {
        const monitor = createMemoryMonitor();
        // The non-Windows case. `privateBytes` is guarded `#if IS_WIN` in Chromium, so the metrics
        // table has nothing for any process here - but a process asked directly answers on every
        // platform, and on macOS its `private` is the MORE meaningful of the two figures, because
        // in-memory page compression makes the resident set smaller than the memory really in use.
        const reports = new Map([
            [2, { pid: 2, privateKB: 800 * 1024, sharedKB: 90 * 1024, heapUsedKB: 140 * 1024, blinkAllocatedKB: 60 * 1024 }],
        ]);
        const sample = monitor.sample({
            metrics: [metric(1, 'GPU', 200), metric(2, 'Tab', 900)],
            reports,
        });

        const [tab, gpu] = sample.processes;
        expect(tab.privateMB).toBe(800);
        expect(tab.sharedMB).toBe(90);
        expect(tab.heapMB).toBe(140);
        expect(tab.blinkMB).toBe(60);
        // Nothing can ask the GPU process, so its row keeps its nulls rather than inventing them.
        expect(gpu.privateMB).toBeNull();
        expect(gpu.heapMB).toBeNull();
        // And the renderer's heap is lifted out, because that is the series the chart plots: a
        // climbing heap means leaked JS objects, a flat one under a climbing working set means
        // native memory.
        expect(sample.rendererHeapUsedMB).toBe(140);
    });

    it('still has a private figure to plot where no whole-app total can exist', () => {
        const monitor = createMemoryMonitor();
        // The macOS / Linux shape: nothing reports privateBytes, and the GPU process cannot be
        // asked, so a whole-app total is genuinely unavailable and stays null rather than being
        // faked out of the processes that did answer.
        const sample = monitor.sample({
            metrics: [metric(1, 'GPU', 200), metric(2, 'Tab', 900), metric(3, 'Browser', 300)],
            reports: new Map([
                [2, { pid: 2, privateKB: 800 * 1024 }],
                [3, { pid: 3, privateKB: 260 * 1024 }],
            ]),
        });

        expect(sample.totalPrivateMB).toBeNull();
        // But one process's private memory needs no summing, so the curve is not empty on those
        // platforms - and the renderer is the process worth watching anyway.
        expect(sample.rendererPrivateMB).toBe(800);
    });

    it('reads the renderer figures off the largest renderer, not the first', () => {
        const monitor = createMemoryMonitor();
        // A session can hold several: the remote control window, an OBS browser source. The one
        // that answers the question is the player.
        const sample = monitor.sample({
            metrics: [metric(1, 'Tab', 120), metric(2, 'Tab', 900)],
            reports: new Map([
                [1, { pid: 1, privateKB: 90 * 1024, heapUsedKB: 20 * 1024 }],
                [2, { pid: 2, privateKB: 780 * 1024, heapUsedKB: 210 * 1024 }],
            ]),
        });
        expect(sample.rendererPrivateMB).toBe(780);
        expect(sample.rendererHeapUsedMB).toBe(210);
    });

    it('does not let a self-report overwrite what the platform already measured', () => {
        const monitor = createMemoryMonitor();
        // Windows reports both. They are different definitions of the same idea, and the one the
        // rest of the table is expressed in wins, so a column is never half one and half the other.
        const sample = monitor.sample({
            metrics: [metric(1, 'Tab', 900, 900, 700)],
            reports: new Map([[1, { pid: 1, privateKB: 650 * 1024 }]]),
        });
        expect(sample.processes[0].privateMB).toBe(700);
    });

    it('puts the biggest process first', () => {
        const monitor = createMemoryMonitor();
        const sample = monitor.sample({
            metrics: [metric(1, 'Browser', 120), metric(2, 'Tab', 900), metric(3, 'GPU', 300)],
        });
        expect(sample.processes.map((row: { pid: number }) => row.pid)).toEqual([2, 3, 1]);
    });
});

describe('the debug log writer', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-debug-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const read = (file: string) => fs.readFileSync(file, 'utf-8');

    it('keeps the two logs in separate directories', () => {
        const runtime = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: 'append' });
        const memory = createDebugLogWriter({ root, folder: 'memory', extension: '.jsonl', mode: 'append' });
        runtime.write('a runtime line');
        memory.write('{"totalWorkingSetMB":1}');
        runtime.flush();
        memory.flush();

        expect(path.dirname(runtime.file)).toBe(path.join(root, 'runtime'));
        expect(path.dirname(memory.file)).toBe(path.join(root, 'memory'));
        // The whole point of the split: a memory sample at one every two seconds would bury the
        // runtime lines in a file they shared.
        expect(read(runtime.file)).not.toContain('totalWorkingSetMB');
        expect(read(memory.file)).not.toContain('a runtime line');

        runtime.close();
        memory.close();
    });

    it('creates the directory it was pointed at', () => {
        // First launch: `logs/runtime` does not exist yet, and a debug module that throws on that
        // would take startup with it.
        expect(fs.existsSync(path.join(root, 'runtime'))).toBe(false);
        const writer = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: 'append' });
        expect(fs.existsSync(path.join(root, 'runtime'))).toBe(true);
        writer.close();
    });

    it('appends across sessions, and truncates when told to overwrite', () => {
        const first = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: 'append' });
        first.write('session one');
        first.close();

        const second = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: 'append' });
        second.write('session two');
        second.close();
        expect(read(second.file)).toBe('session one\nsession two\n');

        // Overwrite is per SESSION, not per line: the file is truncated when the writer opens and
        // then written normally, so a run being recorded is never erased under itself.
        const third = createDebugLogWriter({ root, folder: 'runtime', extension: '.log', mode: 'overwrite' });
        third.write('session three');
        third.write('still session three');
        third.close();
        expect(read(third.file)).toBe('session three\nstill session three\n');
    });

    it('drops log files older than a week when it opens', () => {
        const dir = path.join(root, 'memory');
        fs.mkdirSync(dir, { recursive: true });
        const stale = path.join(dir, '2020-01-01.jsonl');
        const unrelated = path.join(dir, 'notes.txt');
        fs.writeFileSync(stale, 'old');
        fs.writeFileSync(unrelated, 'not ours');

        const writer = createDebugLogWriter({ root, folder: 'memory', extension: '.jsonl', mode: 'append' });
        writer.close();

        // 40k lines a day, and nothing else in the app would ever clean it up.
        expect(fs.existsSync(stale)).toBe(false);
        // Only files this writer's own naming produces are its business.
        expect(fs.existsSync(unrelated)).toBe(true);
    });
});
