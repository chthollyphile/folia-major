import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

// test/unit/automix/analysisHostLifecycle.test.ts
// When electron/analysis/host.cjs keeps the analysis worker, and what it tells it.
//
// While automix is switched on the worker must never be stopped for being idle: htdemucs stays loaded
// across the gaps between tracks, which is what switching it on asked for. Switching it off must tell
// the worker to release htdemucs - in that process, not by killing it - and only then does the idle
// timer apply again. And a worker that dies under a request is re-forked and asked once more, so a
// restart is invisible to the caller.
//
// This exercises the host with utilityProcess stubbed to a worker whose replies we control.

const require = createRequire(import.meta.url);
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IDLE_MS = 30;

/** A stand-in for the forked worker: records what it was sent, replies through `reply`. */
class FakeWorker extends EventEmitter {
    stdout = null;
    stderr = null;
    killed = false;
    sent: string[] = [];
    constructor(private reply: (msg: { id: number; kind: string }) => unknown) { super(); }
    postMessage(msg: { id: number; kind: string }) {
        this.sent.push(msg.kind);
        const result = this.reply(msg);
        if (result === DIE) {
            // Dies under the request, the way a native crash would.
            queueMicrotask(() => this.emit('exit', 1));
            return;
        }
        queueMicrotask(() => this.emit('message', { id: msg.id, result }));
    }
    kill() { this.killed = true; }
}

const DIE = Symbol('die');
const forks: FakeWorker[] = [];
/** Behaviour handed to the NEXT worker fork. */
let replyForNextFork: (msg: { id: number; kind: string }) => unknown = () => null;

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const setAutomix = (enabled: boolean) => listeners.get('automix-enabled')!({}, enabled);
const separate = () => handlers.get('automix-htdemucs')!({}, { left: new Float32Array(4), right: new Float32Array(4) });

beforeAll(() => {
    // Seed a fake electron before host.cjs's lazy require('electron') runs. require.cache is the real
    // Node cache here (host.cjs is loaded through this same createRequire), so the stub is what spawn sees.
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: {
            utilityProcess: {
                fork: () => {
                    const worker = new FakeWorker(replyForNextFork);
                    forks.push(worker);
                    return worker;
                },
            },
        },
    } as unknown as NodeModule;

    const { createAnalysisHost } = require(path.join(REPO, 'electron/analysis/host.cjs'));
    createAnalysisHost({
        app: null,
        ipcMain: {
            handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn),
            on: (ch: string, fn: (...a: unknown[]) => unknown) => listeners.set(ch, fn),
        },
        getModelsDirs: () => [path.join(REPO, 'models')],
        idleMs: IDLE_MS, // the real two minutes, compressed so the test is not the wait
    });
});

beforeEach(async () => {
    replyForNextFork = (msg) => (msg.kind === 'htdemucs' ? { stems: true } : true);
    setAutomix(false);
    // Whatever the previous test left running idles out.
    await wait(IDLE_MS * 3);
    forks.length = 0;
});

describe('analysis host lifecycle', () => {
    it('stops an idle worker while automix is off', async () => {
        await separate();
        expect(forks).toHaveLength(1);
        await wait(IDLE_MS * 3);
        expect(forks[0].killed).toBe(true);
    });

    it('keeps the worker however long it idles while automix is on, and releases in-process when it goes off', async () => {
        setAutomix(true);
        await separate();
        await wait(IDLE_MS * 4);
        expect(forks[0].killed).toBe(false);

        setAutomix(false);
        await wait(0);
        // Released by message, in the worker's own process - not by killing it.
        expect(forks[0].sent).toEqual(['htdemucs', 'release']);
        expect(forks[0].killed).toBe(false);
        // ...after which the ordinary idle rule applies again.
        await wait(IDLE_MS * 3);
        expect(forks[0].killed).toBe(true);
    });

    it('does not start a worker just to release nothing', async () => {
        setAutomix(true);
        setAutomix(false);
        await wait(0);
        expect(forks).toHaveLength(0);
    });

    it('asks a fresh worker once more when one dies under a request', async () => {
        // Only the first fork dies; the retry's fork is a healthy worker.
        let first = true;
        replyForNextFork = (msg) => {
            if (first) { first = false; return DIE; }
            return msg.kind === 'htdemucs' ? { stems: true } : true;
        };
        expect(await separate()).toEqual({ stems: true });
        expect(forks).toHaveLength(2);
    });
});
