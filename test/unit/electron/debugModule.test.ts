import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/electron/debugModule.test.ts
// The two halves of the debug module that have arithmetic or a filesystem in them. The wiring in
// debugHost.cjs is left to the app - it is IPC registration and timers, and mocking Electron to
// watch a setInterval fire proves nothing the code does not already say.

const { createMemoryMonitor } = require('../../../electron/debug/memoryMonitor.cjs');
const { createDebugLogWriter } = require('../../../electron/debug/debugLogWriter.cjs');
const { consoleText, createDebugHost, createPanelFeed, migrateMemoryLogEnabled, readFdCounts } = require('../../../electron/debug/debugHost.cjs');

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
    it('carries open fd counts where the platform reports them, and null where it does not', () => {
        const monitor = createMemoryMonitor();
        // The Linux shm leak shows up as a steady fd climb in the renderer and GPU process, so both
        // are lifted out for the chart. A process missing from the map was not counted - null, not 0.
        const sample = monitor.sample({
            metrics: [metric(1, 'GPU', 200), metric(2, 'Tab', 900), metric(3, 'Browser', 300)],
            fdCounts: new Map([[1, 410], [2, 380]]),
        });

        const byPid = new Map(sample.processes.map((row: { pid: number; fdCount: number | null }) => [row.pid, row.fdCount]));
        expect(byPid.get(1)).toBe(410);
        expect(byPid.get(2)).toBe(380);
        expect(byPid.get(3)).toBeNull();
        expect(sample.rendererFdCount).toBe(380);
        expect(sample.gpuFdCount).toBe(410);

        const elsewhere = monitor.sample({ metrics: [metric(1, 'GPU', 200), metric(2, 'Tab', 900)] });
        expect(elsewhere.rendererFdCount).toBeNull();
        expect(elsewhere.gpuFdCount).toBeNull();
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

describe('the runtime log file and the session-log switch', () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'folia-debug-'));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    it('is written only while both switches are on, and the main process remembers the session-log switch', () => {
        // The host takes over console for good; the spy underneath keeps the test output clean.
        const silent = vi.spyOn(console, 'log').mockImplementation(() => {});
        const stored: Record<string, unknown> = { debug_runtime_log_enabled: true };
        const handlers: Record<string, (event: unknown, payload?: unknown) => any> = {};
        const host = createDebugHost({
            app: { getPath: () => root, on: () => {}, getAppMetrics: () => [] },
            ipcMain: { handle: (channel: string, run: any) => { handlers[channel] = run; }, on: (channel: string, run: any) => { handlers[channel] = run; } },
            store: { get: (key: string) => stored[key], set: (key: string, value: unknown) => { stored[key] = value; } },
            BrowserWindow: { getAllWindows: () => [] },
        });
        const fromPage = (text: string) => handlers['debug-runtime-lines']({}, [{ at: Date.now(), level: 'log', tag: 'Page', text }]);
        const backlog = () => {
            let lines: Array<{ text: string }> = [];
            handlers['debug-main-lines-ready']({ sender: { isDestroyed: () => false, isCrashed: () => false, send: (_channel: string, sent: typeof lines) => { lines = sent; } } });
            return lines.map(line => line.text);
        };

        expect(host.describe().runtimeFile).not.toBeNull();
        console.log('[Main] one');
        fromPage('[Page] one');

        expect(handlers['debug-set-state']({}, { consoleCaptureEnabled: false })).toMatchObject({ consoleCaptureEnabled: false, runtimeLogEnabled: true, runtimeFile: null });
        expect(stored.debug_console_capture_enabled).toBe(false);
        console.log('[Main] two, while it is off');
        fromPage('[Page] two, while it is off');
        host.runtimeLine('automix', 'a stage mark, while it is off');
        expect(backlog()).toEqual([]);
        // The file switch flipped meanwhile opens nothing.
        handlers['debug-set-state']({}, { runtimeLogEnabled: false });
        expect(handlers['debug-set-state']({}, { runtimeLogEnabled: true }).runtimeFile).toBeNull();

        expect(handlers['debug-set-state']({}, { consoleCaptureEnabled: true }).runtimeFile).not.toBeNull();
        console.log('[Main] three');
        expect(backlog()).toEqual(['[Main] three']);
        host.stop();
        silent.mockRestore();

        const written = fs.readdirSync(path.join(root, 'logs', 'runtime')).map(name => fs.readFileSync(path.join(root, 'logs', 'runtime', name), 'utf-8')).join('');
        expect(written).toContain('[Main] one');
        expect(written).toContain('[Page] one');
        expect(written).toContain('[Main] three');
        expect(written).not.toContain('while it is off');
    });

    it('keeps credential values out of the file and the panel, from main and from the page', () => {
        const silent = vi.spyOn(console, 'info').mockImplementation(() => {});
        const stored: Record<string, unknown> = { debug_runtime_log_enabled: true };
        const handlers: Record<string, (event: unknown, payload?: unknown) => any> = {};
        const host = createDebugHost({
            app: { getPath: () => root, on: () => {}, getAppMetrics: () => [] },
            ipcMain: { handle: (channel: string, run: any) => { handlers[channel] = run; }, on: (channel: string, run: any) => { handlers[channel] = run; } },
            store: { get: (key: string) => stored[key], set: (key: string, value: unknown) => { stored[key] = value; } },
            BrowserWindow: { getAllWindows: () => [] },
        });
        // The line the NetEase API package writes for every request, with the cookie the page put in the address.
        console.info('[INFO]', 'Request Success: [eapi] /song/url/v1?id=1&cookie=MUSIC_U=secret-u; __csrf=secret-csrf; os=pc&level=lossless');
        handlers['debug-runtime-lines']({}, [{ at: Date.now(), level: 'log', tag: 'Page', text: 'qq search {"cookie":"qqmusic_key=secret-q"}' }]);
        let panel: Array<{ text: string }> = [];
        handlers['debug-main-lines-ready']({ sender: { isDestroyed: () => false, isCrashed: () => false, send: (_channel: string, sent: typeof panel) => { panel = sent; } } });
        host.stop();
        silent.mockRestore();

        const written = fs.readdirSync(path.join(root, 'logs', 'runtime')).map(name => fs.readFileSync(path.join(root, 'logs', 'runtime', name), 'utf-8')).join('');
        expect(written).toContain('/song/url/v1?id=1&cookie=<redacted>&level=lossless');
        expect(written).toContain('qq search {"cookie":"<redacted>"}');
        expect(written).not.toMatch(/secret/);
        expect(panel.map(line => line.text).join('\n')).not.toMatch(/secret/);
    });
});

describe('the split memory log switch', () => {
    it('inherits an enabled old monitor once, preserving disk recording after an upgrade', () => {
        const store = { set: vi.fn() };

        expect(migrateMemoryLogEnabled(store, {
            memoryMonitorEnabled: true,
            memoryLogEnabled: undefined,
        })).toBe(true);
        expect(store.set).toHaveBeenCalledWith('debug_memory_log_enabled', true);
    });

    it('keeps an explicit file choice instead of re-inheriting the monitor switch', () => {
        const store = { set: vi.fn() };

        expect(migrateMemoryLogEnabled(store, {
            memoryMonitorEnabled: true,
            memoryLogEnabled: false,
        })).toBe(false);
        expect(store.set).not.toHaveBeenCalled();
    });

    it('keeps both switches off on a fresh install', () => {
        const store = { set: vi.fn() };

        expect(migrateMemoryLogEnabled(store, {
            memoryMonitorEnabled: undefined,
            memoryLogEnabled: undefined,
        })).toBe(false);
        expect(store.set).toHaveBeenCalledWith('debug_memory_log_enabled', false);
    });
});

describe('the fd counter', () => {
    it('counts /proc/<pid>/fd entries on Linux and skips processes it cannot read', () => {
        const readdirSync = vi.fn((dir: string) => {
            if (dir === '/proc/7/fd') return ['0', '1', '2', '3'];
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
        });
        const counts = readFdCounts([{ pid: 7 }, { pid: 8 }], { platform: 'linux', readdirSync });

        expect(counts.get(7)).toBe(4);
        // Gone between getAppMetrics and the read: left out, so its row keeps null.
        expect(counts.has(8)).toBe(false);
    });

    it('reads nothing off Linux', () => {
        const readdirSync = vi.fn();
        expect(readFdCounts([{ pid: 7 }], { platform: 'win32', readdirSync }).size).toBe(0);
        expect(readdirSync).not.toHaveBeenCalled();
    });
});

describe('the main-process lines for the log panel', () => {
    const fakeWindow = () => {
        const received: Array<Array<{ at: number; level: string; text: string }>> = [];
        const backlogFlags: boolean[] = [];
        const target = {
            gone: false,
            crashed: false,
            isDestroyed: () => target.gone,
            isCrashed: () => target.crashed,
            send: (channel: string, lines: typeof received[number], isBacklog: boolean) => {
                expect(channel).toBe('debug-main-lines');
                received.push(lines);
                backlogFlags.push(isBacklog);
            },
        };
        return { target, received, backlogFlags, texts: () => received.map(lines => lines.map(line => line.text)) };
    };
    const feed = (limit?: number) => {
        const deferred: Array<() => void> = [];
        return { ...createPanelFeed({ limit, defer: (run: () => void) => deferred.push(run) }), deferred, runDeferred: () => deferred.splice(0).forEach(run => run()) };
    };

    it('gives a window what was said before it asked, then each burst as one message', () => {
        const panel = feed();
        panel.add(1, 'log', 'early');
        expect(panel.deferred).toHaveLength(0);
        const first = fakeWindow();
        panel.subscribe(first.target);
        expect(first.received).toEqual([[{ at: 1, level: 'log', text: 'early' }]]);
        panel.add(2, 'warn', 'a');
        panel.add(3, 'log', 'b');
        expect(panel.deferred).toHaveLength(1);
        panel.runDeferred();
        expect(first.texts()).toEqual([['early'], ['a', 'b']]);
        // The page tells the two kinds of message apart: nothing counts for it until the backlog.
        expect(first.backlogFlags).toEqual([true, false]);
        // What the window was first given does not change under it.
        expect(first.received[0]).toHaveLength(1);
    });

    it('gives a reloaded page the lines of a burst once', () => {
        const panel = feed();
        const other = fakeWindow();
        const reloaded = fakeWindow();
        panel.subscribe(other.target);
        panel.subscribe(reloaded.target);
        panel.add(1, 'log', 'a');
        panel.subscribe(reloaded.target);
        panel.runDeferred();
        expect(reloaded.texts()).toEqual([[], ['a']]);
        expect(reloaded.backlogFlags).toEqual([true, true]);
        expect(other.texts()).toEqual([[], ['a']]);
    });

    it('does not take in what Electron says about a send that failed', () => {
        const panel = feed();
        const healthy = fakeWindow();
        // Electron's own send catches the failure and reports it through console.error, which is
        // the patched console, which is this feed.
        const failing = { isDestroyed: () => false, isCrashed: () => false, send: () => panel.add(9, 'error', 'Error sending from webFrameMain') };
        panel.subscribe(healthy.target);
        panel.subscribe(failing);
        panel.add(1, 'log', 'a');
        panel.runDeferred();
        expect(panel.deferred).toHaveLength(0);
        expect(healthy.texts()).toEqual([[], ['a']]);
        const late = fakeWindow();
        panel.subscribe(late.target);
        expect(late.texts()).toEqual([['a']]);
        // And the feed takes lines again once the send is over.
        panel.add(2, 'log', 'b');
        panel.runDeferred();
        expect(healthy.texts()).toEqual([[], ['a'], ['b']]);
    });

    it('does not give a line twice when a second window asks in the middle of a burst', () => {
        const panel = feed();
        const first = fakeWindow();
        const second = fakeWindow();
        panel.subscribe(first.target);
        panel.add(1, 'log', 'a');
        panel.subscribe(second.target);
        panel.add(2, 'log', 'b');
        panel.runDeferred();
        expect(first.texts()).toEqual([[], ['a'], ['b']]);
        expect(second.texts()).toEqual([['a'], ['b']]);
    });

    it('keeps only the newest lines for a window that asks late', () => {
        const panel = feed(2);
        for (const text of ['a', 'b', 'c']) panel.add(0, 'log', text);
        const late = fakeWindow();
        panel.subscribe(late.target);
        expect(late.texts()).toEqual([['b', 'c']]);
    });

    it('sends nothing to a closed or crashed window, and a send that throws stays inside', () => {
        const panel = feed();
        const closed = fakeWindow();
        const crashed = fakeWindow();
        const broken = { isDestroyed: () => false, isCrashed: () => false, send: () => { throw new Error('closing'); } };
        const open = fakeWindow();
        panel.subscribe(closed.target);
        panel.subscribe(crashed.target);
        panel.subscribe(broken);
        panel.subscribe(open.target);
        closed.target.gone = true;
        crashed.target.crashed = true;
        panel.add(1, 'log', 'a');
        expect(() => panel.runDeferred()).not.toThrow();
        expect(closed.texts()).toEqual([[]]);
        expect(crashed.texts()).toEqual([[]]);
        expect(open.texts()).toEqual([[], ['a']]);
        // The crashed window's page is loaded again and asks: it gets what it missed.
        crashed.target.crashed = false;
        panel.subscribe(crashed.target);
        expect(crashed.texts()).toEqual([[], ['a']]);
    });

    it('drops what it was holding when the session log is switched off', () => {
        const panel = feed();
        const open = fakeWindow();
        panel.subscribe(open.target);
        panel.add(1, 'log', 'a');
        panel.clear();
        panel.runDeferred();
        expect(open.texts()).toEqual([[]]);
        const late = fakeWindow();
        panel.subscribe(late.target);
        expect(late.texts()).toEqual([[]]);
        // Switched back on, it takes lines as before.
        panel.add(2, 'log', 'b');
        panel.runDeferred();
        expect(open.texts()).toEqual([[], ['b']]);
    });

    it('writes a console call as one line, whatever was passed to it', () => {
        const circular: Record<string, unknown> = { name: 'loop' };
        circular.self = circular;
        expect(consoleText(['[Ytm] plan', { route: 'web' }, 12])).toBe('[Ytm] plan {"route":"web"} 12');
        expect(consoleText(['[Ytm] kept', circular, 10n])).toBe('[Ytm] kept [object Object] 10');
        expect(consoleText([new Error('broke')])).toMatch(/^Error: broke\n\s+at /);
        // An error inside an object: JSON.stringify alone writes it as {}.
        expect(consoleText(['[App] failed', { error: new TypeError('no sink') }])).toBe('[App] failed {"error":"TypeError: no sink"}');
    });
});
