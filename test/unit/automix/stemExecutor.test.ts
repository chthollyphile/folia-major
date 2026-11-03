import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '@/types';

// test/unit/automix/stemExecutor.test.ts
// Where automix's stem windows are separated since the analysis service's phase 3: on the GPU by
// default, through the analysis scheduler on the shared segment grid (analysis/stemRange.ts); on the
// CPU (the analysis worker's MNN) without a GPU, after a GPU run that could not, or when the GPU would
// be late for a deadline - and then with the scheduler's thread level.

const { getCachedSongAudioBlob } = vi.hoisted(() => ({
    getCachedSongAudioBlob: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/services/audioCache', () => ({
    onAudioCached: () => () => { },
    getCachedAudioBlob: vi.fn(),
    hasCachedAudio: vi.fn().mockResolvedValue(false),
    saveAudioBlob: vi.fn(),
}));
vi.mock('@/services/onlineMusic/resourceCache', () => ({ getCachedSongAudioBlob }));

const gpu = vi.hoisted(() => ({ finish: 0, works: true, usable: true }));
const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({
    HTDEMUCS_GPU_SEGMENT: 256,
    runHtdemucsGpu,
    estimateGpuFinish: () => gpu.finish,
    gpuStemsUsable: () => gpu.usable,
}));

import { refreshModelAvailability } from '@/services/analysis/modelAvailability';
import { cpuThreads } from '@/services/analysis/scheduler';
import { clearStemDeadlines, ensureStems, getStemsByKey, resetStemExecutorForTests, setWantedStems, stemWindowKey } from '@/services/automix/stems';
import { getPlaybackAnalysisKey } from '@/services/playbackRecovery/representationRegistry';

const SAMPLES = 1024;
const signal = (phase: number) => Float32Array.from({ length: SAMPLES }, (_, i) => Math.sin(i * 0.37 + phase) * 0.5);
const decoded = {
    length: SAMPLES,
    numberOfChannels: 2,
    getChannelData: (channel: number) => signal(channel),
};
const rows = () => ({ left: new Float32Array(SAMPLES), right: new Float32Array(SAMPLES) });

let songs = 0;
const nextSong = (): SongResult => {
    songs += 1;
    return { id: `s${songs}`, name: `track ${songs}`, sourceRef: { kind: 'online', providerId: 'kugou', mediaId: `s${songs}` } } as unknown as SongResult;
};

/** What the renderer sends the analysis worker for one window (src/vite-env.d.ts separateStems). */
type SeparateRequest = { left: Float32Array; right: Float32Array; threads?: number };
/** What the worker answers: the stems, and how long it spent building the model when it says. */
type SeparateAnswer = Record<'drums' | 'bass' | 'vocals', ReturnType<typeof rows>> & { buildMs?: number };

const setUp = ({ withGpu = true, withCpu = true, cores = 8 } = {}) => {
    const separateStems = vi.fn(async (_request: SeparateRequest): Promise<SeparateAnswer> => ({ drums: rows(), bass: rows(), vocals: rows() }));
    (globalThis as { window?: object }).window = {
        electron: {
            ...(withCpu ? { separateStems } : {}),
            ...(withGpu ? { getHtdemucsGpuWeights: vi.fn() } : {}),
            getAutomixModelsPresent: vi.fn().mockResolvedValue({ beat_this: true, htdemucs: withCpu, htdemucs_gpu: withGpu }),
        },
        OfflineAudioContext: class {
            decodeAudioData() { return Promise.resolve(decoded); }
        },
    };
    vi.stubGlobal('navigator', withGpu ? { gpu: {}, hardwareConcurrency: cores } : { hardwareConcurrency: cores });
    return { separateStems, ready: refreshModelAvailability() };
};

const separate = (song: SongResult, deadline?: number) => {
    setWantedStems([stemWindowKey(song, 'tail')]);
    return ensureStems({ song, role: 'tail', readBytes: () => Promise.resolve(new ArrayBuffer(8)), deadline });
};

describe('where a stem window is separated', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            if (!gpu.works) return null;
            const stems = [0.5, 0.2, 0.1, 0.2].map(gain => ({ left: left.map(v => v * gain), right: right.map(v => v * gain) }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        gpu.finish = 0;
        gpu.works = true;
        gpu.usable = true;
        resetStemExecutorForTests();
    });

    it('takes the GPU by default, on the segment grid, and never asks the CPU', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        const song = nextSong();
        await separate(song);
        // 1024 samples on 256-sample segments a step of 192 apart: six segments.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(6);
        expect(separateStems).not.toHaveBeenCalled();
        const stems = getStemsByKey(getPlaybackAnalysisKey(song), 'tail');
        expect(stems).not.toBeNull();
        expect(stems!.duration).toBeCloseTo(SAMPLES / 44100);
    });

    it('falls back to the CPU at the quiet level when the GPU run cannot', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        gpu.works = false;
        await separate(nextSong());
        expect(separateStems).toHaveBeenCalledTimes(1);
        // A GPU machine's fallback: not kept loaded (phase 4).
        // (From the PR #750 re-review, 2026-10-19: no run is, so no `resident` is sent.)
        expect(separateStems.mock.calls[0]).toMatchObject([{ threads: cpuThreads(8, 'quiet', 'htdemucs') }]);
        expect(separateStems.mock.calls[0][0]).not.toHaveProperty('resident');
    });

    it('runs on the CPU without a GPU', async () => {
        const { separateStems, ready } = setUp({ withGpu: false });
        await ready;
        await separate(nextSong());
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems).toHaveBeenCalledTimes(1);
        // The CPU is this machine's separator: kept loaded while automix is on, as before.
        // (From the PR #750 re-review, 2026-10-19: not kept here either - the worker releases it a
        // minute after the run - so no `resident` is sent.)
        expect(separateStems.mock.calls[0][0]).not.toHaveProperty('resident');
    });

    // From the PR #750 re-review, 2026-10-19: the worker releases the CPU model a minute after every
    // run, a machine without a GPU included, so the estimate counts the rebuild again after that.
    it('counts the rebuild once the worker has let the CPU model go, without a GPU too', async () => {
        const { separateStems, ready } = setUp({ withGpu: false });
        await ready;
        // A clock the test moves, standing still in between.
        let now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        // The first window builds the model, at the quiet level: there is no deadline.
        await separate(nextSong());
        // Due 5 s (the margin) and 100 ms out: the quiet level's ~5.6 ms is on time while the model
        // is built, and late by the 0.6 s rebuild once it is not - which takes the hurry level.
        // (Measured after PR #750, 2026-10-19: ~9.9 ms at the quiet level and ~7.0 ms hurried; the
        // hurry level is taken because it is sooner, the same rebuild before either.)
        now += 59_000;
        await separate(nextSong(), now + 5000 + 100);
        now += 61_000;
        await separate(nextSong(), now + 5000 + 100);
        clock.mockRestore();
        const quiet = cpuThreads(8, 'quiet', 'htdemucs');
        expect(separateStems.mock.calls.map(([request]) => request.threads))
            .toEqual([quiet, quiet, cpuThreads(8, 'hurry', 'htdemucs')]);
    });

    it('takes the CPU, hurried, when the GPU would be late for the deadline and the quiet CPU too', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        // A window of 1024 samples is ~5.6 ms of CPU at the quiet level (two threads of eight cores),
        // ~2.8 ms hurried (four), each after the 0.6 s build (none yet): due 5 s, 0.6 s and 4 ms out,
        // only the hurried CPU is on time by the 5 s margin; the GPU is an hour late.
        // (Measured after PR #750, 2026-10-19: ~9.9 ms quiet and ~7.0 ms hurried before this machine
        // has measured a run - 0.3 s a second at four threads, the square root of 4/threads either
        // side - so due 8 ms after the build.)
        // A still clock, so the few ms the decode takes do not eat the ms between the two levels.
        const now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
        gpu.finish = now + 3_600_000;
        await separate(nextSong(), now + 5000 + 600 + 8);
        clock.mockRestore();
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems).toHaveBeenCalledTimes(1);
        expect(separateStems.mock.calls[0]).toMatchObject([{ threads: cpuThreads(8, 'hurry', 'htdemucs') }]);
    });

    // Measured after PR #750, 2026-10-19: building the CPU model takes about 0.6 s, a worker the host
    // had stopped included, where the estimate charged 1.5 s - after every idle release.
    it('charges the CPU build what it measures, so the quiet level takes a window the old 1.5 s gave the late GPU', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        const now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
        gpu.finish = now + 3_600_000;
        // Due 5 s (the margin) and 1 s out, the model not built: the quiet level is on time after a
        // 0.6 s build. After a 1.5 s one neither level was, and the window went to the GPU an hour late.
        await separate(nextSong(), now + 5000 + 1000);
        clock.mockRestore();
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems.mock.calls.map(([request]) => request.threads)).toEqual([cpuThreads(8, 'quiet', 'htdemucs')]);
    });

    // Measured after PR #750, 2026-10-19: a second of window took a Ryzen 7 9700X twice the M4's figure,
    // and a worker that had built for fewer threads ran a build for more on the fewer. So the estimate
    // learns from each window's wait, at each thread count, and hurries only when that is sooner.
    it('learns what a second of window takes from the wait, at each thread count, and hurries only when sooner', async () => {
        const { separateStems, ready } = setUp({ withGpu: false });
        await ready;
        let now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        // Every window is waited on for 605 ms, 600 of them building the model: 5 ms of separating,
        // faster than the guess's ~9.9 ms at two threads, as on an M4.
        separateStems.mockImplementation(async () => {
            now += 605;
            return { drums: rows(), bass: rows(), vocals: rows(), buildMs: 600 };
        });
        // The quiet level, with no deadline: two threads measured.
        await separate(nextSong());
        // A minute on, the model released. Due 5 s and 604 ms out: the quiet level is late by its
        // measured 5 ms after the 0.6 s build, and four threads, not measured yet, are taken from
        // two's measurement (~3.5 ms, sooner) rather than from the guess (~7.0 ms, which is not).
        now += 61_000;
        await separate(nextSong(), now + 5000 + 604);
        // Four threads measured at 5 ms too, no faster than two: the same deadline stays quiet.
        now += 61_000;
        await separate(nextSong(), now + 5000 + 604);
        clock.mockRestore();
        const quiet = cpuThreads(8, 'quiet', 'htdemucs');
        expect(separateStems.mock.calls.map(([request]) => request.threads))
            .toEqual([quiet, cpuThreads(8, 'hurry', 'htdemucs'), quiet]);
    });

    // Measured after PR #750, 2026-10-19: the build is charged apart (CPU_REBUILD_MS), so the worker
    // says how long it took and the estimate learns from the rest of the wait.
    it('learns from the wait less the build, which the estimate charges apart', async () => {
        const { separateStems, ready } = setUp({ withGpu: false });
        await ready;
        let now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
        separateStems.mockImplementation(async () => {
            now += 605;
            return { drums: rows(), bass: rows(), vocals: rows(), buildMs: 600 };
        });
        await separate(nextSong());
        // A minute on, the model released. Due 5 s and 700 ms out: 5 ms of separating after the 0.6 s
        // build is on time. With the build counted in, the window would take 0.6 s after a 0.6 s build,
        // late - and four threads, taken from that, sooner.
        now += 61_000;
        await separate(nextSong(), now + 5000 + 700);
        clock.mockRestore();
        const quiet = cpuThreads(8, 'quiet', 'htdemucs');
        expect(separateStems.mock.calls.map(([request]) => request.threads)).toEqual([quiet, quiet]);
    });

    // Measured after PR #750, 2026-10-19: hurrying needs the model built for the other count, 0.6 s,
    // which the few ms a short window's threads save do not pay for. Sixteen logical cores, as on the
    // Ryzen 7 9700X: four threads quiet, eight hurried.
    it('does not hurry into a rebuild that costs more than the threads save', async () => {
        const { separateStems, ready } = setUp({ withGpu: false, cores: 16 });
        await ready;
        const now = 1_000_000;
        const clock = vi.spyOn(performance, 'now').mockReturnValue(now);
        // Built for four threads by the first window.
        await separate(nextSong());
        // Due 5 s and 5 ms out: four threads, built, take ~7.0 ms - late; eight would take ~4.9 ms
        // after a 0.6 s build for that count. Late was reason enough to hurry before.
        await separate(nextSong(), now + 5000 + 5);
        clock.mockRestore();
        const quiet = cpuThreads(16, 'quiet', 'htdemucs');
        expect(separateStems.mock.calls.map(([request]) => request.threads)).toEqual([quiet, quiet]);
    });

    it('stays on the GPU without a CPU model, however late', async () => {
        const { separateStems, ready } = setUp({ withCpu: false });
        await ready;
        gpu.finish = performance.now() + 3_600_000;
        await separate(nextSong(), performance.now() + 1000);
        expect(runHtdemucsGpu).toHaveBeenCalled();
        expect(separateStems).not.toHaveBeenCalled();
    });
});


describe('where a stem window is separated, from review', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => { });
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            const stems = [0.5, 0.2, 0.1, 0.2].map(gain => ({ left: left.map(v => v * gain), right: right.map(v => v * gain) }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        gpu.finish = 0;
        gpu.works = true;
        gpu.usable = true;
        resetStemExecutorForTests();
    });

    // From the PR #750 re-review, 2026-10-19: was "..., and keeps the CPU model loaded there" - it is
    // not kept anywhere now, so the request carries no `resident`.
    it('does not send windows to a GPU that turned out unusable, nor keeps the CPU model loaded there', async () => {
        const { separateStems, ready } = setUp();
        await ready;
        gpu.usable = false;
        await separate(nextSong());
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(separateStems).toHaveBeenCalledTimes(1);
        expect(separateStems.mock.calls[0][0]).not.toHaveProperty('resident');
    });

    it('gives a window under way the deadline a later call brings, at its next GPU segment', async () => {
        const { ready } = setUp({ withCpu: false });
        await ready;
        const song = nextSong();
        const seen: Array<number | undefined> = [];
        let first = true;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array, options: { deadline?: number }) => {
            seen.push(options.deadline);
            if (first) {
                first = false;
                // The duration arrives while the first segment runs: the effect asks again, with it.
                await ensureStems({ song, role: 'tail', readBytes: () => Promise.resolve(new ArrayBuffer(8)), deadline: 123_456 });
            }
            const stems = [0, 1, 2, 3].map(() => ({ left: left.slice(), right: right.slice() }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        await separate(song);
        expect(seen[0]).toBeUndefined();
        expect(seen.slice(1).every(deadline => deadline === 123_456)).toBe(true);
    });

    it('drops the deadlines of windows under way while paused', async () => {
        const { ready } = setUp({ withCpu: false });
        await ready;
        const seen: Array<number | undefined> = [];
        let first = true;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array, options: { deadline?: number }) => {
            seen.push(options.deadline);
            if (first) {
                first = false;
                clearStemDeadlines();
            }
            const stems = [0, 1, 2, 3].map(() => ({ left: left.slice(), right: right.slice() }));
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        await separate(nextSong(), 999_999);
        expect(seen[0]).toBe(999_999);
        expect(seen.slice(1).every(deadline => deadline === undefined)).toBe(true);
    });
});
