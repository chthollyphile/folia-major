import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatThisGpu.test.ts
// The renderer's GPU client holds Beat This! final0 (automix and the beat FX) and htdemucs (the beat
// FX' drum stem) in one worker: each model loaded once and kept, and a failure kept to the model it
// belongs to unless it is the machine's (no adapter or device). And each model's residency (phase 4):
// released on its own once idle, never under a run, and the least recently used released for room
// when a load would pass the budget.

type Message = { id: number; kind: string; model?: string };

/** Load replies per model: null answers ok, a scope answers that error. */
let loadFailure: Record<string, 'device' | 'model' | undefined> = {};
/** GPU bytes a load reports per model. */
let loadBytes: Record<string, number> = {};
/** Holds a separate's answer until released, to have a run in flight. */
let holdSeparate: Promise<void> | null = null;
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
            reply(scope ? { error: `${message.model} failed`, scope } : { result: 'fake gpu', bytes: loadBytes[message.model ?? ''] });
        } else if (message.kind === 'separate') {
            const stems = [0, 1, 2, 3].map(() => ({ left: new Float32Array(1), right: new Float32Array(1) }));
            void (holdSeparate ?? Promise.resolve()).then(() => reply({ result: { stems } }));
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

describe('GPU model residency', () => {
    const MB = 1024 * 1024;
    beforeEach(() => {
        workers = [];
        loadFailure = {};
        loadBytes = { beat_this: 106 * MB, htdemucs: 350 * MB };
        holdSeparate = null;
        getBeatThisGpuWeights.mockClear();
        getHtdemucsGpuWeights.mockClear();
        host.window = { electron: { getBeatThisGpuWeights, getHtdemucsGpuWeights } };
        host.Worker = FakeWorker;
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        delete host.window;
        delete host.Worker;
        vi.restoreAllMocks();
    });

    const unloads = () => workers.flatMap(worker => worker.received.filter(m => m.kind === 'unload').map(m => m.model));

    it('releases htdemucs half a minute after its last segment, keeping the worker, and loads it again when asked', async () => {
        const { runBeatThisGpu, runHtdemucsGpu } = await fresh();
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).not.toBeNull();
        expect(await runBeatThisGpu(chunks)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(29_000);
        expect(unloads()).toEqual([]);
        await vi.advanceTimersByTimeAsync(2_000);
        expect(unloads()).toEqual(['htdemucs']);
        // beat_this, used a minute ago, goes at its own minute.
        await vi.advanceTimersByTimeAsync(30_000);
        expect(unloads()).toEqual(['htdemucs', 'beat_this']);
        expect(workers).toHaveLength(1);
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).not.toBeNull();
        expect(getHtdemucsGpuWeights).toHaveBeenCalledTimes(2);
    });

    it('does not release a model under a run that began just before its time', async () => {
        const { runHtdemucsGpu } = await fresh();
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).not.toBeNull();
        await vi.advanceTimersByTimeAsync(29_900);
        let release!: () => void;
        holdSeparate = new Promise((resolve) => { release = resolve; });
        const running = runHtdemucsGpu(SEGMENT, SEGMENT);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(unloads()).toEqual([]);
        release();
        expect(await running).not.toBeNull();
        holdSeparate = null;
        await vi.advanceTimersByTimeAsync(31_000);
        expect(unloads()).toEqual(['htdemucs']);
    });

    it('releases the least recently used model first when a load would pass the budget', async () => {
        loadBytes = { beat_this: 106 * MB, htdemucs: 450 * MB };
        const { runBeatThisGpu, runHtdemucsGpu } = await fresh();
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).not.toBeNull();
        expect(unloads()).toEqual([]);
        // 450 + 106 MB is past 512, but htdemucs ran a moment ago: not released for it (no thrash).
        expect(await runBeatThisGpu(chunks)).not.toBeNull();
        expect(unloads()).toEqual([]);
        // Later, beat_this has gone idle and htdemucs comes back: room is made by releasing beat_this.
        await vi.advanceTimersByTimeAsync(31_000);
        expect(unloads()).toEqual(['htdemucs']);
        await vi.advanceTimersByTimeAsync(5_000);
        expect(await runHtdemucsGpu(SEGMENT, SEGMENT)).not.toBeNull();
        const received = workers[0].received.map(m => `${m.kind}${m.model ? ` ${m.model}` : ''}`);
        expect(unloads()).toEqual(['htdemucs', 'beat_this']);
        // Posted before the load that needed the room.
        expect(received.lastIndexOf('unload beat_this')).toBeLessThan(received.lastIndexOf('load htdemucs'));
    });
});
