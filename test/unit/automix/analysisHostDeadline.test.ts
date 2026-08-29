import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

// test/unit/automix/analysisHostDeadline.test.ts
// The guard behind DEADLINE_MS in electron/analysis/host.cjs: a worker that takes a request and never
// replies - the shape onnxruntime's synchronous run() gives when a GPU provider takes the graph and
// hangs - must not wedge the caller forever. The host has to kill it, answer the request bounded, pin
// the model off the GPU so the re-fork does not hang the same way, and still serve the next request.
//
// The worker's own GPU_ABANDON_MS check cannot cover this: it runs AFTER the call that never returned.
// So this exercises the host, with utilityProcess stubbed to a worker whose reply behaviour we control.

const require = createRequire(import.meta.url);
const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A stand-in for the forked worker. Replies through `reply`, or never replies when it is null. */
class FakeWorker extends EventEmitter {
    stdout = null;
    stderr = null;
    killed = false;
    constructor(private reply: ((msg: { id: number; kind: string }) => unknown) | null) { super(); }
    postMessage(msg: { id: number; kind: string }) {
        if (!this.reply) return; // the hang this test is about
        const result = this.reply(msg);
        queueMicrotask(() => this.emit('message', { id: msg.id, result }));
    }
    kill() { this.killed = true; }
}

const forks: { options: { env: Record<string, string> }; worker: FakeWorker }[] = [];
/** Behaviour handed to the NEXT worker fork. Set before the call that triggers the fork. */
let replyForNextFork: ((msg: { id: number; kind: string }) => unknown) | null = null;

const handlers = new Map<string, (...args: unknown[]) => unknown>();
let createAnalysisHost: (config: unknown) => unknown;

beforeAll(() => {
    // Seed a fake electron before host.cjs's lazy require('electron') runs. require.cache is the real
    // Node cache here (host.cjs is loaded through this same createRequire), so the stub is what spawn sees.
    const electronPath = require.resolve('electron');
    require.cache[electronPath] = {
        id: electronPath, filename: electronPath, loaded: true,
        exports: {
            utilityProcess: {
                fork: (_module: string, _args: string[], options: { env: Record<string, string> }) => {
                    const worker = new FakeWorker(replyForNextFork);
                    forks.push({ options, worker });
                    return worker;
                },
            },
        },
    } as unknown as NodeModule;

    ({ createAnalysisHost } = require(path.join(REPO, 'electron/analysis/host.cjs')));
    createAnalysisHost({
        app: null,
        ipcMain: { handle: (ch: string, fn: (...a: unknown[]) => unknown) => handlers.set(ch, fn), on: () => { } },
        getModelsDirs: () => [path.join(REPO, 'models')],
        deadlines: { 'beat-this': 25 }, // the real 90s, compressed so the test is not the wait
    });
});

const chunks = [{ frames: 8, data: new Float32Array(8 * 128) }];

describe('analysis host deadline', () => {
    it('kills a hung worker, answers bounded, pins the retry to the CPU, and recovers', async () => {
        // A worker that takes the request and never replies.
        replyForNextFork = null;
        const beatThis = handlers.get('automix-beat-this')!;

        const answer = await beatThis({}, chunks);
        // Bounded: the caller got an answer instead of hanging. Null is the "use your estimator" signal
        // the renderer already handles - see analyseBeatGrid.
        expect(answer).toBeNull();

        // The initial fork plus at least the one retry, and the retry must carry the force-CPU flag so a
        // fresh worker does not pick the provider that just hung and hang again.
        expect(forks.length).toBeGreaterThanOrEqual(2);
        expect(forks[0].options.env.FOLIA_ANALYSIS_FORCE_CPU).toBeUndefined();
        expect(forks.at(-1)!.options.env.FOLIA_ANALYSIS_FORCE_CPU).toBe('1');

        // And the next request still works: a worker that DOES reply is served normally.
        const grid = { beat: [new Float32Array(1)], downbeat: [new Float32Array(1)] };
        replyForNextFork = (msg) => (msg.kind === 'beat-this' ? grid : null);
        const next = await beatThis({}, chunks);
        expect(next).toBe(grid);
    });
});
