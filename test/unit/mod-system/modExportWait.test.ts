import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';
import { EventEmitter } from 'events';
import fs from 'fs';
import os from 'os';
import path from 'path';

// test/unit/mod-system/modExportWait.test.ts
// The export service, in the main process, while it waits for the export
// window to be ready to draw. That wait has no end of its own when the lyric
// style belongs to a mod that is slow to start there. What the user cannot see
// by using the app: after a moment the service says which mod it waits for, a
// cancel ends the wait and takes the window and ffmpeg down, and an answer
// that comes in time is never followed by a late "waiting". The window and
// ffmpeg are stand-ins; no process is started.

const require = createRequire(import.meta.url);

interface FakeProcess extends EventEmitter { killed: boolean }
const spawned: FakeProcess[] = [];
const fakeSpawn = () => {
    const child = new EventEmitter() as FakeProcess;
    child.killed = false;
    Object.assign(child, {
        stderr: { on: () => {} },
        stdin: { destroyed: false, end: () => {}, write: () => true, once: () => {}, removeListener: () => {} },
        kill: () => {
            child.killed = true;
            child.emit('exit', null, 'SIGKILL');
        },
    });
    spawned.push(child);
    return child;
};

// The service takes `spawn` off child_process once, when it is loaded: it gets the stand-in.
const childProcess = require('child_process');
const realSpawn = childProcess.spawn;
childProcess.spawn = fakeSpawn;
const { createExportService, WAIT_NOTICE_MS } = require('../../../electron/modSystem/exportService.cjs');
childProcess.spawn = realSpawn;

interface Progress { phase: string; waitingFor?: string }
interface ExportResult { ok: boolean; cancelled?: boolean; error?: string }

let root = '';
// What the page's configure() answers: the test settles it, or never does.
let answerConfigure: (answer: unknown) => void = () => {};
const windows: FakeWindow[] = [];

class FakeWindow {
    destroyed = false;
    webContents = {
        executeJavaScript: (code: string) => {
            if (code.includes('.configure(')) {
                return new Promise((resolve) => { answerConfigure = resolve; });
            }
            // "Is the page there?", and the best-effort dispose at teardown.
            return Promise.resolve(true);
        },
    };
    constructor() { windows.push(this); }
    loadFile = async () => {};
    loadURL = async () => {};
    isDestroyed = () => this.destroyed;
    destroy = () => { this.destroyed = true; };
}

const createService = () => createExportService({
    app: { getPath: () => root },
    BrowserWindow: FakeWindow,
    resolveFfmpeg: async () => ({ available: true, path: 'ffmpeg' }),
    // The style's mod is not the first of the list: the wait names the mod of the style.
    getModClients: () => [
        { id: 'other-mod', name: 'Other Mod', clientUrl: 'folia-mod://other-mod/client.mjs' },
        { id: 'slow-style', name: 'Slow Style', clientUrl: 'folia-mod://slow-style/client.mjs' },
    ],
});

const hostState = (visualizerMode: string) => ({
    lyricData: { lines: [{ startTime: 0, endTime: 1 }] },
    visualizerMode,
});

/* Lets the service get from its start to the wait on configure(): a few awaits, no timer. */
const reachTheWait = async () => {
    for (let index = 0; index < 20; index += 1) {
        await Promise.resolve();
    }
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folium-export-wait-'));
    spawned.length = 0;
    windows.length = 0;
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
});

describe('an export that waits for its lyric style\'s mod to start', () => {
    it('says which mod it waits for once the wait has lasted a moment, and a cancel ends it', async () => {
        const service = createService();
        const progress: Progress[] = [];
        const running: Promise<ExportResult> = service.runExport({
            modId: 'exporter',
            spec: {},
            hostState: hostState('mod:slow-style:main'),
            onProgress: (event: Progress) => { progress.push(event); },
        });
        await reachTheWait();
        expect(windows).toHaveLength(1);
        expect(progress).toEqual([]);

        // Nothing is said in the first moment: a mod that starts as usual answers within it.
        await vi.advanceTimersByTimeAsync(WAIT_NOTICE_MS - 1);
        expect(progress).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(progress).toHaveLength(1);
        expect(progress[0]).toMatchObject({ phase: 'waiting', waitingFor: 'Slow Style' });

        // The wait goes on for as long as the mod takes, and says so once.
        await vi.advanceTimersByTimeAsync(60_000);
        expect(progress).toHaveLength(1);
        expect(service.isExportRunning()).toBe(true);

        expect(service.cancelActiveExport()).toBe(true);
        expect(await running).toMatchObject({ ok: false, cancelled: true });
        expect(windows[0].destroyed).toBe(true);
        expect(spawned[0].killed).toBe(true);
        expect(service.isExportRunning()).toBe(false);
        // A cancel is not a failure: no 'error' goes to the window.
        expect(progress).toHaveLength(1);
    });

    it('says nothing about waiting when the page answers in time, also afterwards', async () => {
        const service = createService();
        const progress: Progress[] = [];
        const running: Promise<ExportResult> = service.runExport({
            modId: 'exporter',
            spec: {},
            hostState: hostState('mod:slow-style:main'),
            onProgress: (event: Progress) => { progress.push(event); },
        });
        await reachTheWait();
        await vi.advanceTimersByTimeAsync(WAIT_NOTICE_MS - 1);
        answerConfigure({ ok: false, error: 'export-mod-style-not-started' });
        expect(await running).toMatchObject({ ok: false, cancelled: false, error: 'export-mod-style-not-started' });

        await vi.advanceTimersByTimeAsync(60_000);
        expect(progress.map((event) => event.phase)).toEqual(['error']);
    });

    it('does not say it waits for a mod when the style is one of Folia\'s own', async () => {
        const service = createService();
        const progress: Progress[] = [];
        const running: Promise<ExportResult> = service.runExport({
            modId: 'exporter',
            spec: {},
            hostState: hostState('classic'),
            onProgress: (event: Progress) => { progress.push(event); },
        });
        await reachTheWait();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(progress).toEqual([]);
        service.cancelActiveExport();
        expect(await running).toMatchObject({ ok: false, cancelled: true });
    });

    it('does not say it waits for a mod that is not among the running ones', async () => {
        const service = createService();
        const progress: Progress[] = [];
        const running: Promise<ExportResult> = service.runExport({
            modId: 'exporter',
            spec: {},
            hostState: hostState('mod:absent-mod:main'),
            onProgress: (event: Progress) => { progress.push(event); },
        });
        await reachTheWait();
        await vi.advanceTimersByTimeAsync(60_000);
        expect(progress).toEqual([]);
        service.cancelActiveExport();
        expect(await running).toMatchObject({ ok: false, cancelled: true });
    });
});
