import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatThisGpu.test.ts
// The renderer's GPU client holds final0 (automix) and small0 (the beat FX) in one worker: each model
// loaded once and kept, the weights asked for by name, and a failure kept to the model it belongs
// to unless it is the machine's (no adapter or device).

type Message = { id: number; kind: string; model?: string };

/** Load replies per model: null answers ok, a scope answers that error. */
let loadFailure: Record<string, 'device' | 'model' | undefined> = {};
let workers: FakeWorker[] = [];

class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: ((event: { message: string }) => void) | null = null;
    received: Message[] = [];
    terminated = false;

    constructor() {
        workers.push(this);
    }

    postMessage(message: Message) {
        this.received.push(message);
        const reply = (data: object) => queueMicrotask(() => this.onmessage?.({ data: { id: message.id, ...data } }));
        if (message.kind === 'load') {
            const scope = loadFailure[message.model ?? ''];
            reply(scope ? { error: `${message.model} failed`, scope } : { result: 'fake gpu' });
        } else if (message.kind === 'run') {
            const chunks = (message as unknown as { chunks: Float32Array[] }).chunks;
            reply({ result: { beat: chunks.map(() => new Float32Array(1)), downbeat: chunks.map(() => new Float32Array(1)) } });
        } else {
            reply({ result: true });
        }
    }

    terminate() {
        this.terminated = true;
    }
}

const getBeatThisGpuWeights = vi.fn(async () => ({ weights: new Uint8Array(4), manifest: {} }));
const host = globalThis as { window?: object; Worker?: unknown };
const chunks = [{ data: new Float32Array(10 * 128), frames: 10 }];

const fresh = async () => {
    vi.resetModules();
    return import('@/services/analysis/beatThisGpu');
};

describe('runBeatThisGpu', () => {
    beforeEach(() => {
        workers = [];
        loadFailure = {};
        getBeatThisGpuWeights.mockClear();
        host.window = { electron: { getBeatThisGpuWeights } };
        host.Worker = FakeWorker;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete host.window;
        delete host.Worker;
        vi.restoreAllMocks();
    });

    it('loads each model once, by name, in one worker, however the runs alternate', async () => {
        const { runBeatThisGpu } = await fresh();
        for (const model of ['beat_this_small', 'beat_this', 'beat_this_small', 'beat_this'] as const) {
            expect(await runBeatThisGpu(chunks, model)).not.toBeNull();
        }
        expect(getBeatThisGpuWeights.mock.calls).toEqual([['beat_this_small'], ['beat_this']]);
        expect(workers).toHaveLength(1);
        expect(workers[0].received.filter(m => m.kind === 'run').map(m => m.model))
            .toEqual(['beat_this_small', 'beat_this', 'beat_this_small', 'beat_this']);
    });

    it('defaults to final0, so automix callers are unchanged', async () => {
        const { runBeatThisGpu } = await fresh();
        await runBeatThisGpu(chunks);
        expect(getBeatThisGpuWeights).toHaveBeenCalledWith('beat_this');
    });

    it('keeps a model that would not build to itself: the other still runs on the GPU', async () => {
        loadFailure = { beat_this_small: 'model' };
        const { runBeatThisGpu } = await fresh();
        expect(await runBeatThisGpu(chunks, 'beat_this_small')).toBeNull();
        expect(await runBeatThisGpu(chunks, 'beat_this')).not.toBeNull();
        // Not asked again for the session.
        expect(await runBeatThisGpu(chunks, 'beat_this_small')).toBeNull();
        expect(getBeatThisGpuWeights.mock.calls).toEqual([['beat_this_small'], ['beat_this']]);
    });

    it('gives up on the GPU for both when the machine has no device', async () => {
        loadFailure = { beat_this_small: 'device' };
        const { runBeatThisGpu } = await fresh();
        expect(await runBeatThisGpu(chunks, 'beat_this_small')).toBeNull();
        expect(await runBeatThisGpu(chunks, 'beat_this')).toBeNull();
        expect(getBeatThisGpuWeights).toHaveBeenCalledTimes(1);
    });

    it('answers null without a worker when the weights are not there, and asks again next time', async () => {
        getBeatThisGpuWeights.mockResolvedValueOnce(null as never);
        const { runBeatThisGpu } = await fresh();
        expect(await runBeatThisGpu(chunks, 'beat_this')).toBeNull();
        expect(workers).toHaveLength(0);
        expect(await runBeatThisGpu(chunks, 'beat_this')).not.toBeNull();
        expect(getBeatThisGpuWeights).toHaveBeenCalledTimes(2);
    });
});
