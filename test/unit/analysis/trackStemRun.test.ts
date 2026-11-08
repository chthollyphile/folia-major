import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/trackStemRun.test.ts
// A track's stem run (analysis/trackStemRun.ts): one decode and one pass for every task that reads its
// stems - a task asked for part way joins the pass, the same kind asked twice is one task, one let go
// stops while the rest carry on, and leaving the track stops them all.

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu }));
const { decodeAtRate } = vi.hoisted(() => ({ decodeAtRate: vi.fn() }));
vi.mock('@/services/analysis/trackAudio', () => ({ decodeAtRate }));

const { startStemReader, wholeStemWindow } = await import('@/services/analysis/stemPass');
const { releaseTrackStems, runTrackStems, setWantedStemTrack } = await import('@/services/analysis/trackStemRun');
const { resetStemSegmentsForTests } = await import('@/services/analysis/stemRange');
type StemSource = import('@/services/analysis/stemPass').StemSource;
type StemReader = import('@/services/analysis/stemPass').StemReader;

// Starts every 12: 0, 12, 24, 36, 48 - five segments.
const TOTAL = 50;
const signal = Float32Array.from({ length: TOTAL }, (_, i) => Math.sin(i * 1.3));
const model = async (l: Float32Array, r: Float32Array) => {
    const stems = [0.7, 0.2, 0.1, -0.5].map(k => ({ left: l.map(v => v * k), right: r.map(v => v * k) }));
    return { left: stems[0].left, right: stems[0].right, stems };
};

/** A task reading `source` from segment `from`: answers `finished` with the segments it read, or `stopped` with them. */
const task = (kind: string, source: StemSource, from = 0) => {
    const segments: number[] = [];
    const stop = vi.fn();
    return {
        segments,
        stop,
        task: {
            kind,
            open: () => {
                const reader: StemReader = {
                    source,
                    ...startStemReader(TOTAL, from),
                    window: wholeStemWindow(TOTAL),
                    read: () => { segments.push(reader.next - 1); },
                };
                return {
                    readers: [reader],
                    finish: async () => `${kind} finished`,
                    stop: async () => { stop(); return `${kind} stopped`; },
                };
            },
        },
    };
};

const bytes = async () => new ArrayBuffer(8);

describe('track stem run', () => {
    beforeEach(() => {
        resetStemSegmentsForTests();
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        decodeAtRate.mockReset();
        decodeAtRate.mockImplementation(async () => ({ length: TOTAL, numberOfChannels: 1, getChannelData: () => signal }));
    });

    it('opens a task asked for part way on the same decode and pass, and joins one of the same kind', async () => {
        setWantedStemTrack('one');
        const drums = task('drums', 'drums');
        const voice = task('voice', 'vocals', 1);
        let joined: Promise<unknown>[] = [];
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 3) joined = [runTrackStems('one', bytes, voice.task), runTrackStems('one', bytes, task('drums', 'drums').task)];
            return model(l, r);
        });
        const first = runTrackStems('one', bytes, drums.task);
        expect(await first).toBe('drums finished');
        expect(await Promise.all(joined)).toEqual(['voice finished', 'drums finished']);
        expect(decodeAtRate).toHaveBeenCalledTimes(1);
        // The voice came in while segment 2 ran for the drums: 1 and 2 for it alone, 3 and 4 shared.
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
        expect(voice.segments).toEqual([1, 2, 3, 4]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(7);
    });

    it('stops a task let go, and carries the rest on', async () => {
        setWantedStemTrack('two');
        const drums = task('drums', 'drums');
        const voice = task('voice', 'vocals');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) releaseTrackStems('two', 'voice');
            return model(l, r);
        });
        const answers = Promise.all([runTrackStems('two', bytes, drums.task), runTrackStems('two', bytes, voice.task)]);
        expect(await answers).toEqual(['drums finished', 'voice stopped']);
        expect(voice.stop).toHaveBeenCalledTimes(1);
        expect(voice.segments).toEqual([0]);
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('stops every task once the track is left, and answers null without bytes', async () => {
        setWantedStemTrack('three');
        const drums = task('drums', 'drums');
        const voice = task('voice', 'vocals');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) setWantedStemTrack(null);
            return model(l, r);
        });
        expect(await Promise.all([runTrackStems('three', bytes, drums.task), runTrackStems('three', bytes, voice.task)]))
            .toEqual(['drums stopped', 'voice stopped']);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);

        setWantedStemTrack('four');
        expect(await runTrackStems('four', async () => null, task('drums', 'drums').task)).toBeNull();
        expect(decodeAtRate).toHaveBeenCalledTimes(1);
    });
});
