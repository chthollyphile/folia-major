import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatThisGpu.test.ts
// The renderer's GPU client holds Beat This! final0 (automix and the beat FX) and htdemucs (the beat
// FX' drum stem) in one worker: each model loaded once and kept, and a failure kept to the model it
// belongs to unless it is the machine's (no adapter or device).

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
const getHtdemucsGpuWeights = vi.fn(async () => ({ weights: new Uint8Array(4), manifest: {} }));
const SEGMENT = new Float32Array(172032);
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
        getHtdemucsGpuWeights.mockClear();
        host.window = { electron: { getBeatThisGpuWeights, getHtdemucsGpuWeights } };
        host.Worker = FakeWorker;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        delete host.window;
        delete host.Worker;
        vi.restoreAllMocks();
    });

    it('loads final0 once, in one worker, however many runs', async () => {
        const { runBeatThisGpu } = await fresh();
        for (let run = 0; run < 3; run += 1) expect(await runBeatThisGpu(chunks)).not.toBeNull();
        expect(getBeatThisGpuWeights.mock.calls).toEqual([['beat_this']]);
        expect(workers).toHaveLength(1);
        expect(workers[0].received.filter(m => m.kind === 'run').map(m => m.model))
            .toEqual(['beat_this', 'beat_this', 'beat_this']);
    });

    it('defaults to final0, so automix callers are unchanged', async () => {
        const { runBeatThisGpu } = await fresh();
        await runBeatThisGpu(chunks);
        expect(getBeatThisGpuWeights).toHaveBeenCalledWith('beat_this');
    });

    it('keeps a model that would not build to itself: the other still runs on the GPU', async () => {
        loadFailure = { htdemucs: 'model' };
        const { runBeatThisGpu, runHtdemucsGpu } = await fresh();
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).toBeNull();
        expect(await runBeatThisGpu(chunks)).not.toBeNull();
        // Not asked again for the session.
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).toBeNull();
        expect(getHtdemucsGpuWeights).toHaveBeenCalledTimes(1);
    });

    it('gives up on the GPU for both when the machine has no device', async () => {
        loadFailure = { beat_this: 'device' };
        const { runBeatThisGpu, runHtdemucsGpu } = await fresh();
        expect(await runBeatThisGpu(chunks)).toBeNull();
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).toBeNull();
        expect(getHtdemucsGpuWeights).not.toHaveBeenCalled();
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
