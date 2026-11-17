import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stemMixer/stemMixerTask.test.ts
// 分轨调音台的任务（services/stemMixer/stemMixerTask.ts）与空缺（stemGaps.ts）：三轨六声道按段交出、
// 从播放头所在的段起、读到下一处已有的地方就答完；空缺先往后找、再回头补。

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu, gpuStemsOnScreenUsable: () => true }));
const { decodeAtRate } = vi.hoisted(() => ({ decodeAtRate: vi.fn() }));
vi.mock('@/services/analysis/trackAudio', () => ({ decodeAtRate }));

const { claimStemTrack, runTrackStems } = await import('@/services/analysis/trackStemRun');
const { resetStemSegmentsForTests } = await import('@/services/analysis/stemRange');
const { stemWholeFrom } = await import('@/services/analysis/stemPass');
const { segmentWholeAt, stemMixerTask } = await import('@/services/stemMixer/stemMixerTask');
const { coveredShare, nextStemGap } = await import('@/services/stemMixer/stemGaps');

// Starts every 12: 0, 12, 24, 36, 48 - five segments of 16.
const TOTAL = 50;
const left = Float32Array.from({ length: TOTAL }, (_, i) => 0.5 * Math.sin(i * 1.3));
const right = Float32Array.from({ length: TOTAL }, (_, i) => 0.5 * Math.cos(i * 0.7));
/** Stems a gain of each channel: drums 0.4, bass 0.3, other 0.2, vocals 0.1. */
const GAINS = [0.4, 0.3, 0.2, 0.1];
const model = async (l: Float32Array, r: Float32Array) => {
    const stems = GAINS.map(k => ({ left: l.map(v => v * k), right: r.map(v => v * k) }));
    return { left: stems[0].left, right: stems[0].right, stems };
};

const run = (from: number, until: number) => {
    const chunks: Array<{ from: number; to: number; data: Int16Array[] }> = [];
    const tracks: number[] = [];
    const answer = runTrackStems('one', async () => new ArrayBuffer(8), stemMixerTask(from, until, {
        onTrack: track => tracks.push(track.left.length),
        onStems: (a, b, data) => chunks.push({ from: a, to: b, data }),
    }));
    return { answer, chunks, tracks };
};

describe('stem mixer task', () => {
    beforeEach(() => {
        resetStemSegmentsForTests();
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        decodeAtRate.mockReset();
        decodeAtRate.mockImplementation(async () => ({ length: TOTAL, numberOfChannels: 2, getChannelData: (c: number) => (c ? right : left) }));
        claimStemTrack('stemMixer', 'one');
    });
    afterEach(() => claimStemTrack('stemMixer', null));

    it('hands the three played stems, both channels, segment by segment to the end', async () => {
        const { answer, chunks, tracks } = run(0, Infinity);
        expect(await answer).toBe(TOTAL);
        expect(tracks).toEqual([TOTAL]);
        expect(chunks.map(c => [c.from, c.to])).toEqual([[0, 12], [12, 24], [24, 36], [36, 48], [48, 50]]);
        // 鼓 L/R、贝斯 L/R、人声 L/R, at ±2 full scale; the window's overlap-add gives each gain of the input back.
        const scale = 32767 / 2;
        for (const { from, data } of chunks) {
            expect(data).toHaveLength(6);
            data.forEach((chunk, k) => {
                const gain = [GAINS[0], GAINS[1], GAINS[3]][Math.floor(k / 2)];
                const channel = k % 2 ? right : left;
                for (let i = 1; i < chunk.length; i += 1) {
                    if (from + i === 0) continue;
                    expect(Math.abs(chunk[i] - Math.round(channel[from + i] * gain * scale))).toBeLessThanOrEqual(1);
                }
            });
        }
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('starts at the segment whole at the playhead and answers once it reaches what is already there', async () => {
        // Segment 2 is whole from where segment 1 ends (12 + 16 = 28).
        expect(stemWholeFrom(TOTAL, 2)).toBe(28);
        expect(segmentWholeAt(TOTAL, 30)).toBe(2);
        expect(segmentWholeAt(TOTAL, 27)).toBe(1);
        const { answer, chunks } = run(30, 40);
        expect(await answer).toBe(48);
        expect(chunks.map(c => [c.from, c.to])).toEqual([[28, 36], [36, 48]]);
        // Segments 2 and 3 only.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
    });
});

describe('stem gaps', () => {
    it('finds the first gap from the playhead on, then the ones behind it', () => {
        expect(nextStemGap([], null, 100)).toEqual({ from: 100, to: Infinity });
        expect(nextStemGap([[0, 50]], 200, 10)).toEqual({ from: 50, to: 200 });
        expect(nextStemGap([[0, 50], [80, 120]], 200, 10)).toEqual({ from: 50, to: 80 });
        expect(nextStemGap([[0, 50], [80, 200]], 200, 90)).toEqual({ from: 50, to: 80 });
        expect(nextStemGap([[30, 200]], 200, 100)).toEqual({ from: 0, to: 30 });
        expect(nextStemGap([[0, 200]], 200, 100)).toBeNull();
        expect(coveredShare([[0, 50], [100, 150]], 200)).toBe(0.5);
    });
});
