import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/stemMixer/stemMixerTask.test.ts
// 分轨调音台的任务（services/stemMixer/stemMixerTask.ts）：原曲与三轨共八个声道按段交出、从播放头所在的段起
// 读到歌尾；held 时这一趟等着，不再 held 了接着分。

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu, gpuStemsOnScreenUsable: () => true }));
const { decodeAtRate } = vi.hoisted(() => ({ decodeAtRate: vi.fn() }));
vi.mock('@/services/analysis/trackAudio', () => ({ decodeAtRate }));

const { claimStemTrack, runTrackStems } = await import('@/services/analysis/trackStemRun');
const { resetStemSegmentsForTests } = await import('@/services/analysis/stemRange');
const { stemWholeFrom } = await import('@/services/analysis/stemPass');
const { segmentWholeAt, stemMixerTask } = await import('@/services/stemMixer/stemMixerTask');

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

const run = (from: number, held: (reached: number) => boolean = () => false) => {
    const chunks: Array<{ from: number; to: number; data: Int16Array[] }> = [];
    const tracks: number[] = [];
    const answer = runTrackStems('one', async () => new ArrayBuffer(8), stemMixerTask(from, {
        onTrack: track => tracks.push(track.left.length),
        onChunk: (a, b, data) => { chunks.push({ from: a, to: b, data }); return true; },
        held,
        urgent: () => true,
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

    it('hands the mix and the three played stems, both channels, segment by segment to the end', async () => {
        const { answer, chunks, tracks } = run(0);
        expect(await answer).toBe(TOTAL);
        expect(tracks).toEqual([TOTAL]);
        expect(chunks.map(c => [c.from, c.to])).toEqual([[0, 12], [12, 24], [24, 36], [36, 48], [48, 50]]);
        // 原曲 L/R、鼓 L/R、贝斯 L/R、人声 L/R, at ±2 full scale; the window's overlap-add gives each gain of the input back.
        const scale = 32767 / 2;
        for (const { from, data } of chunks) {
            expect(data).toHaveLength(8);
            data.forEach((chunk, k) => {
                const gain = [1, GAINS[0], GAINS[1], GAINS[3]][Math.floor(k / 2)];
                const channel = k % 2 ? right : left;
                for (let i = 1; i < chunk.length; i += 1) {
                    if (from + i === 0) continue;
                    expect(Math.abs(chunk[i] - Math.round(channel[from + i] * gain * scale))).toBeLessThanOrEqual(1);
                }
            });
        }
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('starts at the segment whole at the playhead', async () => {
        // Segment 2 is whole from where segment 1 ends (12 + 16 = 28).
        expect(stemWholeFrom(TOTAL, 2)).toBe(28);
        expect(segmentWholeAt(TOTAL, 30)).toBe(2);
        expect(segmentWholeAt(TOTAL, 27)).toBe(1);
        const { answer, chunks } = run(30);
        expect(await answer).toBe(TOTAL);
        expect(chunks.map(c => [c.from, c.to])).toEqual([[28, 36], [36, 48], [48, 50]]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(3);
    });

    it('waits while held and goes on once it is not', async () => {
        vi.useFakeTimers();
        try {
            let ahead = 24;
            const { answer, chunks } = run(0, reached => reached >= ahead);
            await vi.advanceTimersByTimeAsync(1000);
            expect(chunks.map(c => c.to)).toEqual([12, 24]);
            ahead = Infinity;
            await vi.advanceTimersByTimeAsync(1000);
            expect(await answer).toBe(TOTAL);
            expect(chunks.map(c => c.to)).toEqual([12, 24, 36, 48, 50]);
        } finally {
            vi.useRealTimers();
        }
    });

    it('stops at a sink that throws, without failing the run', async () => {
        let n = 0;
        const answer = runTrackStems('one', async () => new ArrayBuffer(8), stemMixerTask(0, {
            onTrack: () => undefined,
            onChunk: () => { n += 1; if (n === 2) throw new Error('boom'); return true; },
            held: () => false,
            urgent: () => true,
        }));
        expect(await answer).toBe(12);
        expect(n).toBe(2);
    });

    it('answers tooLong for a track past the cap, reading nothing', async () => {
        const long = 20 * 60 * 44100 + 1;
        // Only the length is looked at (about 200 MB of silence otherwise).
        const silent = { length: long } as unknown as Float32Array;
        decodeAtRate.mockImplementation(async () => ({ length: long, numberOfChannels: 1, getChannelData: () => silent }));
        const { answer, chunks } = run(0);
        expect(await answer).toBe('tooLong');
        expect(chunks).toEqual([]);
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
    });

    it('stops while held once no longer wanted', async () => {
        vi.useFakeTimers();
        try {
            const { answer, chunks } = run(0, reached => reached >= 12);
            await vi.advanceTimersByTimeAsync(1000);
            claimStemTrack('stemMixer', null);
            await vi.advanceTimersByTimeAsync(1000);
            expect(await answer).toBe(12);
            expect(chunks.map(c => c.to)).toEqual([12]);
        } finally {
            vi.useRealTimers();
        }
    });
});
