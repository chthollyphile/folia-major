import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/automix/analysisHostLifecycle.test.ts
// When electron/analysis/host.cjs keeps the analysis worker, and what it tells it.
//
// While automix is switched on the worker must never be stopped for being idle: htdemucs stays loaded
// across the gaps between tracks, which is what switching it on asked for. Switching it off must tell
// the worker to release htdemucs - in that process, not by killing it - and only then does the idle
// timer apply again. And a worker that dies under a request is re-forked and asked once more, so a
// restart is invisible to the caller.
// (From the PR #750 re-review, 2026-10-19: an idle worker is stopped with automix on too - no
// htdemucs is kept now, the worker lets it go a minute after each run - and switching automix off
// still tells a running worker to release it, in its own process.)
// (Measured after PR #750, 2026-10-19: and which worker a request goes to. MNN makes one thread pool
// per process, so a request for another thread count than the worker's pool waits for whatever is in
// flight there and then goes to a new worker - never one stopped under a request.)
//
// This exercises the host with utilityProcess stubbed to a worker whose replies we control.

const require = createRequire(import.meta.url);
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const IDLE_MS = 30;

type Message = { id: number; kind: string; payload?: unknown };

/** A stand-in for the forked worker: records what it was sent, replies through `reply`. */
class FakeWorker extends EventEmitter {
    stdout = null;
    stderr = null;
    killed = false;
    sent: string[] = [];
    constructor(private reply: (msg: Message) => unknown) { super(); }
    postMessage(msg: Message) {
        this.sent.push(msg.kind);
        // A promise is an answer that comes when it settles: the request is in flight until then.
        void Promise.resolve(this.reply(msg)).then((result) => {
            // A killed process answers nothing.
            if (this.killed) return;
            if (result === DIE) {
                // Dies under the request, the way a native crash would.
                this.emit('exit', 1);
                return;
            }
            this.emit('message', result instanceof Declined
                ? { id: msg.id, result: null, reason: result.reason }
                : { id: msg.id, result });
        });
    }
    kill() { this.killed = true; }
}

const DIE = Symbol('die');
/** A null answer with the worker's reason beside it, the way worker.cjs' `decline` replies. */
class Declined { constructor(public reason: string) { } }
const forks: FakeWorker[] = [];
/** Behaviour handed to the NEXT worker fork. */
let replyForNextFork: (msg: Message) => unknown = () => null;

const handlers = new Map<string, (...args: unknown[]) => unknown>();
const listeners = new Map<string, (...args: unknown[]) => unknown>();

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const setAutomix = (enabled: boolean) => listeners.get('automix-enabled')!({}, enabled);
const separate = (threads?: number) => handlers.get('automix-htdemucs')!({}, { left: new Float32Array(4), right: new Float32Array(4), threads });
const findBeats = () => handlers.get('automix-beat-this')!({}, [{ frames: 1, data: new Float32Array(128) }]);
/** An answer the test hands over when it chooses; the request it answers stays in flight until then. */
const later = <T>(value: T) => {
    let give = () => { };
    const answer = new Promise<T>((resolve) => { give = () => resolve(value); });
    return { answer, give: () => give() };
};
/** What each worker was sent, in the order they were forked. */
const sentByFork = () => forks.map(worker => worker.sent);

beforeAll(() => {
    // A 24-core machine, as threads.cjs reads it when it loads: beat_this asks for a quarter of the
    // cores, six, while htdemucs' quiet level stops at four - a machine where the two meet different
    // thread pools.
    const core = os.cpus()[0];
    const cpus = vi.spyOn(os, 'cpus').mockReturnValue(Array.from({ length: 24 }, () => core));

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
    cpus.mockRestore();
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

    // From the PR #750 re-review, 2026-10-19: was "keeps the worker however long it idles while automix
    // is on, and releases in-process when it goes off" - the first half is the rule that changed.
    it('stops an idle worker while automix is on too, and releases in-process when it goes off', async () => {
        setAutomix(true);
        await separate();
        await wait(IDLE_MS * 3);
        // Stopped, and nothing told it to release first: the worker lets htdemucs go on its own.
        expect(forks[0].sent).toEqual(['htdemucs']);
        expect(forks[0].killed).toBe(true);

        await separate();
        expect(forks).toHaveLength(2);
        setAutomix(false);
        await wait(0);
        // Released by message, in the worker's own process - not by killing it.
        expect(forks[1].sent).toEqual(['htdemucs', 'release']);
        expect(forks[1].killed).toBe(false);
        // ...after which the ordinary idle rule applies again.
        // (From the PR #750 re-review, 2026-10-19: it applied all along; the release does not change it.)
        await wait(IDLE_MS * 3);
        expect(forks[1].killed).toBe(true);
    });

    it('does not disarm the idle timer when automix is switched on', async () => {
        await separate();
        setAutomix(true);
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

    it("hands the renderer the worker's reason when it ran nothing", async () => {
        replyForNextFork = (msg) => (msg.kind === 'htdemucs' ? new Declined('cannot enable executable stack') : true);
        expect(await separate()).toEqual({ declined: 'cannot enable executable stack' });
    });

    it('says the worker died when it dies under the retry as well', async () => {
        replyForNextFork = () => DIE;
        expect(await separate()).toEqual({ declined: 'the analysis worker died twice in a row' });
    });
});

// Measured after PR #750, 2026-10-19: a worker that had built htdemucs for four threads ran a build for
// eight on four (MNN's one thread pool per process), and one built for eight kept 7.7 cores busy for a
// build of four. Every build now runs in a worker whose pool is its own thread count.
describe('analysis host thread pools', () => {
    it('replaces the worker for another thread count, and keeps it for the same one', async () => {
        await separate(4);
        await separate(4);
        expect(forks).toHaveLength(1);
        await separate(8);
        expect(sentByFork()).toEqual([['htdemucs', 'htdemucs'], ['htdemucs']]);
        expect(forks[0].killed).toBe(true);
        // One thread uses no pool, so it runs in whichever worker is there.
        await separate(1);
        await separate(8);
        expect(sentByFork()).toEqual([['htdemucs', 'htdemucs'], ['htdemucs', 'htdemucs', 'htdemucs']]);
        // Back to the quiet level: a pool of four again, not the eight's.
        await separate(4);
        expect(forks).toHaveLength(3);
        expect(forks[1].killed).toBe(true);
    });

    it('lets a worker without a pool make it for the first count above one', async () => {
        await separate(1);
        await separate(8);
        expect(sentByFork()).toEqual([['htdemucs', 'htdemucs']]);
    });

    it('waits for the request in flight before replacing the worker under it', async () => {
        const quietAnswer = later({ stems: 'four' });
        let first = true;
        replyForNextFork = () => {
            if (first) { first = false; return quietAnswer.answer; }
            return { stems: 'eight' };
        };
        const quiet = separate(4);
        const hurried = separate(8);
        // Longer than the idle timer as well: a worker with a request held for another is not idle.
        await wait(IDLE_MS * 3);
        expect(sentByFork()).toEqual([['htdemucs']]);
        expect(forks[0].killed).toBe(false);

        quietAnswer.give();
        expect(await quiet).toEqual({ stems: 'four' });
        expect(await hurried).toEqual({ stems: 'eight' });
        // Each asked once, of the worker it went to: nothing was answered CRASHED and asked again.
        expect(sentByFork()).toEqual([['htdemucs'], ['htdemucs']]);
        expect(forks[0].killed).toBe(true);
    });

    it('gives beat_this its own pool between two separations', async () => {
        // Six threads for beat_this against four for htdemucs (the 24 cores of beforeAll).
        expect(await separate(4)).toEqual({ stems: true });
        expect(await findBeats()).toBe(true);
        expect(await separate(4)).toEqual({ stems: true });
        expect(sentByFork()).toEqual([['htdemucs'], ['beat-this'], ['htdemucs']]);
        expect(forks[0].killed && forks[1].killed).toBe(true);
    });

    it('lets a beat_this run finish, and keeps the order of what was asked behind it', async () => {
        const gridAnswer = later(true);
        let first = true;
        replyForNextFork = (msg) => {
            if (first) { first = false; return gridAnswer.answer; }
            return msg.kind === 'htdemucs' ? { stems: true } : true;
        };
        const grid = findBeats();
        const stems = separate(4);
        // Fits the worker the first grid is in, but was asked after the separation held for another.
        const nextGrid = findBeats();
        await wait(0);
        expect(sentByFork()).toEqual([['beat-this']]);

        gridAnswer.give();
        expect(await grid).toBe(true);
        expect(await stems).toEqual({ stems: true });
        expect(await nextGrid).toBe(true);
        expect(sentByFork()).toEqual([['beat-this'], ['htdemucs'], ['beat-this']]);
    });

    it('sends a held request on when the worker dies under the one ahead of it', async () => {
        let first = true;
        replyForNextFork = (msg) => {
            if (first) { first = false; return DIE; }
            return msg.kind === 'htdemucs' ? { stems: true } : true;
        };
        const stems = separate(4);
        const grid = findBeats();
        // The separation is asked again, as for any crash; the grid held behind it goes first, to a
        // worker of its own, and the retry gets a pool of four after it.
        expect(await stems).toEqual({ stems: true });
        expect(await grid).toBe(true);
        expect(sentByFork()).toEqual([['htdemucs'], ['beat-this'], ['htdemucs']]);
    });

    it('fails only the request whose post throws, though it was sent from another answer', async () => {
        const gridAnswer = later(true);
        let first = true;
        replyForNextFork = (msg) => {
            if (first) { first = false; return gridAnswer.answer; }
            if (msg.kind === 'htdemucs') throw new Error('could not clone the request');
            return true;
        };
        const grid = findBeats();
        const failed = expect(separate(4)).rejects.toThrow('could not clone the request');
        const nextGrid = findBeats();
        gridAnswer.give();
        expect(await grid).toBe(true);
        await failed;
        expect(await nextGrid).toBe(true);
    });
});
