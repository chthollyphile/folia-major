import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StemReader, StemSource } from '@/services/analysis/stemPass';
import type { StemClaimant } from '@/services/analysis/trackStemRun';

// test/unit/analysis/trackStemRun.test.ts
// A track's stem run (analysis/trackStemRun.ts): one decode and one pass for every task that reads its
// stems - a task asked for part way joins the pass, the same kind asked twice is one task, one let go
// stops while the rest carry on, and leaving the track stops them all. Each claimant wants its own
// track: one leaving lets go only its own tasks while another still wants the run.

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu, gpuStemsOnScreenUsable: () => true }));
const { decodeAtRate } = vi.hoisted(() => ({ decodeAtRate: vi.fn() }));
vi.mock('@/services/analysis/trackAudio', () => ({ decodeAtRate }));

const { startStemReader, wholeStemWindow } = await import('@/services/analysis/stemPass');
const { claimStemTrack, releaseTrackStems, runTrackStems } = await import('@/services/analysis/trackStemRun');
const { resetStemSegmentsForTests } = await import('@/services/analysis/stemRange');

// Starts every 12: 0, 12, 24, 36, 48 - five segments.
const TOTAL = 50;
const signal = Float32Array.from({ length: TOTAL }, (_, i) => Math.sin(i * 1.3));
const model = async (l: Float32Array, r: Float32Array) => {
    const stems = [0.7, 0.2, 0.1, -0.5].map(k => ({ left: l.map(v => v * k), right: r.map(v => v * k) }));
    return { left: stems[0].left, right: stems[0].right, stems };
};

/** A task reading `source` from segment `from`: answers `finished` with the segments it read, or `stopped` with them. */
const task = (kind: string, source: StemSource, from = 0, claimant: StemClaimant = 'beatFx', onRead?: (segment: number) => unknown) => {
    const segments: number[] = [];
    const stop = vi.fn();
    const log: string[] = [];
    return {
        segments,
        stop,
        log,
        task: {
            kind,
            claimant,
            open: () => {
                const reader: StemReader = {
                    source,
                    ...startStemReader(TOTAL, from),
                    window: wholeStemWindow(TOTAL),
                    read: async () => {
                        segments.push(reader.next - 1);
                        log.push(`fed ${reader.next - 1}`);
                        await onRead?.(reader.next - 1);
                    },
                };
                return {
                    readers: [reader],
                    finish: async () => `${kind} finished`,
                    stop: async () => { stop(); log.push('stopped'); return `${kind} stopped`; },
                };
            },
        },
    };
};

const bytes = async () => new ArrayBuffer(8);

describe('track stem run', () => {
    afterEach(() => {
        claimStemTrack('beatFx', null);
        claimStemTrack('stemMixer', null);
    });

    beforeEach(() => {
        resetStemSegmentsForTests();
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        decodeAtRate.mockReset();
        decodeAtRate.mockImplementation(async () => ({ length: TOTAL, numberOfChannels: 1, getChannelData: () => signal }));
    });

    it('opens a task asked for part way on the same decode and pass, and joins one of the same kind', async () => {
        claimStemTrack('beatFx', 'one');
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
        claimStemTrack('beatFx', 'two');
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
        claimStemTrack('beatFx', 'three');
        const drums = task('drums', 'drums');
        const voice = task('voice', 'vocals');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) claimStemTrack('beatFx', null);
            return model(l, r);
        });
        expect(await Promise.all([runTrackStems('three', bytes, drums.task), runTrackStems('three', bytes, voice.task)]))
            .toEqual(['drums stopped', 'voice stopped']);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);

        claimStemTrack('beatFx', 'four');
        expect(await runTrackStems('four', async () => null, task('drums', 'drums').task)).toBeNull();
        expect(decodeAtRate).toHaveBeenCalledTimes(1);
    });

    it('carries a run on for the claimant still wanting it, and lets go only the leaving one\'s tasks', async () => {
        claimStemTrack('beatFx', 'five');
        claimStemTrack('stemMixer', 'five');
        const drums = task('drums', 'drums');
        const mix = task('mix', 'vocals', 0, 'stemMixer');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) claimStemTrack('beatFx', null);
            return model(l, r);
        });
        expect(await Promise.all([runTrackStems('five', bytes, drums.task), runTrackStems('five', bytes, mix.task)]))
            .toEqual(['drums stopped', 'mix finished']);
        // Let go while segment 1 ran: not fed it.
        expect(drums.segments).toEqual([0]);
        expect(mix.segments).toEqual([0, 1, 2, 3, 4]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('stops the run once the last claimant leaves, and when a claimant moves to another track', async () => {
        claimStemTrack('beatFx', 'six');
        claimStemTrack('stemMixer', 'six');
        const drums = task('drums', 'drums');
        const mix = task('mix', 'vocals', 0, 'stemMixer');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) claimStemTrack('beatFx', null);
            if (runHtdemucsGpu.mock.calls.length === 3) claimStemTrack('stemMixer', 'seven');
            return model(l, r);
        });
        expect(await Promise.all([runTrackStems('six', bytes, drums.task), runTrackStems('six', bytes, mix.task)]))
            .toEqual(['drums stopped', 'mix stopped']);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(3);
    });

    it('keeps a claimant\'s tasks when it names the same track again', async () => {
        claimStemTrack('beatFx', 'eight');
        claimStemTrack('stemMixer', 'eight');
        const drums = task('drums', 'drums');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 2) claimStemTrack('beatFx', 'eight');
            return model(l, r);
        });
        expect(await runTrackStems('eight', bytes, drums.task)).toBe('drums finished');
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
    });

    it('feeds a task let go during another reader\'s read nothing more after its stop', async () => {
        claimStemTrack('beatFx', 'nine');
        claimStemTrack('stemMixer', 'nine');
        // The mix reads first on each segment; on segment 1 the drums' claimant leaves while it reads.
        const mix = task('mix', 'vocals', 0, 'stemMixer', async (segment) => {
            if (segment !== 1) return;
            claimStemTrack('beatFx', null);
            await new Promise(resolve => setTimeout(resolve, 0));
        });
        const drums = task('drums', 'drums');
        const answers = Promise.all([runTrackStems('nine', bytes, mix.task), runTrackStems('nine', bytes, drums.task)]);
        expect(await answers).toEqual(['mix finished', 'drums stopped']);
        expect(drums.log).toEqual(['fed 0', 'stopped']);
    });

    it('lets a task go whichever order the claims moved in', async () => {
        claimStemTrack('beatFx', 'ten');
        const drums = task('drums', 'drums');
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            // The drums' claimant leaves first, while no one else wants the track; then the mixer comes to it.
            if (runHtdemucsGpu.mock.calls.length === 2) {
                claimStemTrack('beatFx', 'elsewhere');
                claimStemTrack('stemMixer', 'ten');
            }
            return model(l, r);
        });
        expect(await runTrackStems('ten', bytes, drums.task)).toBe('drums stopped');
        expect(drums.segments).toEqual([0]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
    });

    it('answers a task let go once all its segments are in from its finish', async () => {
        claimStemTrack('beatFx', 'eleven');
        claimStemTrack('stemMixer', 'eleven');
        const drums = task('drums', 'drums');
        // On the last segment the drums are fed first, then the mix lets the drums' claimant go.
        const mix = task('mix', 'vocals', 0, 'stemMixer', (segment) => {
            if (segment === 4) claimStemTrack('beatFx', null);
        });
        expect(await Promise.all([runTrackStems('eleven', bytes, drums.task), runTrackStems('eleven', bytes, mix.task)]))
            .toEqual(['drums finished', 'mix finished']);
        expect(drums.stop).not.toHaveBeenCalled();
    });

    it('answers null for a task let go while its track decodes, and runs the rest', async () => {
        claimStemTrack('beatFx', 'twelve');
        claimStemTrack('stemMixer', 'twelve');
        const drums = task('drums', 'drums');
        const mix = task('mix', 'vocals', 0, 'stemMixer');
        const answers = Promise.all([runTrackStems('twelve', bytes, drums.task), runTrackStems('twelve', bytes, mix.task)]);
        claimStemTrack('beatFx', null);
        expect(await answers).toEqual([null, 'mix finished']);
        expect(drums.segments).toEqual([]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });
});
