import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/beatThisModel.test.ts
// Beat This! final0, which automix and the beat FX both run: the GPU first, the CPU only for a caller
// that allows it, and the whole spectrogram handed to the GPU when the percussive energy is wanted.

const { runBeatThisGpu } = vi.hoisted(() => ({ runBeatThisGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ runBeatThisGpu }));
const { modelCanRun, noteModelFailed } = vi.hoisted(() => ({ modelCanRun: vi.fn(() => false), noteModelFailed: vi.fn() }));
vi.mock('@/services/analysis/modelAvailability', () => ({ modelCanRun, noteModelFailed }));

const { analyseBeatGrid, canRunBeatThis } = await import('@/services/analysis/beatThis');

const host = globalThis as { window?: object };
const runBeatThis = vi.fn();
const mel = { data: new Float32Array(300 * 128), frames: 300 };

describe('the final0 model', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        host.window = { electron: { getBeatThisGpuWeights: vi.fn(), runBeatThis } };
    });

    afterEach(() => {
        delete host.window;
    });

    it('runs where the desktop bridge is and the weights are', () => {
        modelCanRun.mockReturnValue(true);
        expect(canRunBeatThis()).toBe(true);
        modelCanRun.mockReturnValue(false);
        expect(canRunBeatThis()).toBe(false);
        modelCanRun.mockReturnValue(true);
        host.window = {};
        expect(canRunBeatThis()).toBe(false);
    });

    it('asks the GPU only, unless the caller allows the CPU', async () => {
        modelCanRun.mockReturnValue(true);
        runBeatThisGpu.mockResolvedValue(null);
        expect(await analyseBeatGrid(mel)).toBeNull();
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this', undefined);
        expect(runBeatThis).not.toHaveBeenCalled();
    });

    it('hands the GPU the whole spectrogram for the percussive energy when asked, and returns it', async () => {
        modelCanRun.mockReturnValue(true);
        const energy = { percussive: new Float32Array(1), total: new Float32Array(1) };
        runBeatThisGpu.mockImplementation(async (chunks: Array<{ frames: number }>) => ({
            beat: chunks.map(chunk => new Float32Array(chunk.frames).fill(-10)),
            downbeat: chunks.map(chunk => new Float32Array(chunk.frames).fill(-10)),
            percussive: energy,
        }));
        const grid = await analyseBeatGrid(mel, { percussive: true });
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this', mel);
        expect(grid?.percussive).toBe(energy);
    });

    it('goes the GPU first, then the CPU when allowed', async () => {
        modelCanRun.mockReturnValue(true);
        runBeatThisGpu.mockResolvedValue(null);
        runBeatThis.mockResolvedValue(null);
        await analyseBeatGrid(mel, { cpuFallback: true });
        expect(runBeatThisGpu).toHaveBeenCalledWith(expect.any(Array), 'beat_this', undefined);
        expect(runBeatThis).toHaveBeenCalledTimes(1);
        expect(noteModelFailed).toHaveBeenCalledWith('beat_this');
    });
});
