import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatThisModel.test.ts
// small0 - the beat FX' model, bundled with the app - is GPU or nothing: it never needs final0's
// download, never reaches the CPU worker whatever the caller allows, and a run that comes back empty
// does not touch automix's on-disk model state.

const { runBeatThisGpu } = vi.hoisted(() => ({ runBeatThisGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ runBeatThisGpu }));
const { modelCanRun, noteModelFailed } = vi.hoisted(() => ({ modelCanRun: vi.fn(() => false), noteModelFailed: vi.fn() }));
vi.mock('@/services/analysis/modelAvailability', () => ({ modelCanRun, noteModelFailed }));

const { analyseBeatGrid, canRunBeatThis } = await import('@/services/analysis/beatThis');

const host = globalThis as { window?: object };
const runBeatThis = vi.fn();
const mel = { data: new Float32Array(300 * 128), frames: 300 };

describe('the small0 model', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        host.window = { electron: { getBeatThisGpuWeights: vi.fn(), runBeatThis } };
    });

    afterEach(() => {
        delete host.window;
    });

    it('can run without final0 downloaded; final0 cannot', () => {
        expect(canRunBeatThis('beat_this_small')).toBe(true);
        expect(canRunBeatThis()).toBe(false);
        host.window = {};
        expect(canRunBeatThis('beat_this_small')).toBe(false);
    });

    it('asks the GPU for small0 and never the CPU, even when the caller allows it', async () => {
        runBeatThisGpu.mockResolvedValue(null);
        expect(await analyseBeatGrid(mel, { model: 'beat_this_small', cpuFallback: true })).toBeNull();
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this_small', undefined);
        expect(runBeatThis).not.toHaveBeenCalled();
        expect(noteModelFailed).not.toHaveBeenCalled();
    });

    it('hands the GPU the whole spectrogram for the percussive energy when asked, and returns it', async () => {
        const energy = { percussive: new Float32Array(1), total: new Float32Array(1) };
        runBeatThisGpu.mockImplementation(async (chunks: Array<{ frames: number }>) => ({
            beat: chunks.map(chunk => new Float32Array(chunk.frames).fill(-10)),
            downbeat: chunks.map(chunk => new Float32Array(chunk.frames).fill(-10)),
            percussive: energy,
        }));
        const grid = await analyseBeatGrid(mel, { model: 'beat_this_small', percussive: true });
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this_small', mel);
        expect(grid?.percussive).toBe(energy);
    });

    it('leaves final0 on its old path: the GPU first, then the CPU when allowed', async () => {
        modelCanRun.mockReturnValue(true);
        runBeatThisGpu.mockResolvedValue(null);
        runBeatThis.mockResolvedValue(null);
        await analyseBeatGrid(mel, { cpuFallback: true });
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this', undefined);
        expect(runBeatThis).toHaveBeenCalledTimes(1);
        expect(noteModelFailed).toHaveBeenCalledWith('beat_this');
    });
});
