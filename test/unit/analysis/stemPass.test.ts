import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/stemPass.test.ts
// One pass over a track's segments for every stem reader (analysis/stemPass.ts): a segment separated
// once for all the readers at it, a reader starting further back fed alone until it catches up, the
// same stem bits whether laid into the whole track or a moving window, and readers added or let go
// between segments.

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu, gpuStemsOnScreenUsable: () => true }));

const { movingStemWindow, runStemPass, startStemReader, stemWholeFrom, wholeStemWindow } = await import('@/services/analysis/stemPass');
const { resetStemSegmentsForTests } = await import('@/services/analysis/stemRange');
type StemReader = import('@/services/analysis/stemPass').StemReader;
type StemSource = import('@/services/analysis/stemPass').StemSource;

// Starts every 12 (0, 12, 24, 36, 48), 16 long.
const TOTAL = 50;
const left = Float32Array.from({ length: TOTAL }, (_, i) => Math.sin(i * 1.3));
const right = Float32Array.from({ length: TOTAL }, (_, i) => Math.cos(i * 0.7));

/** A stand-in model: four different stems, each a gain of the input plus an offset. */
const model = async (l: Float32Array, r: Float32Array) => {
    const stems = [0.7, 0.2, 0.1, -0.5].map(k => ({ left: l.map(v => v * k + 0.01), right: r.map(v => v * k - 0.02) }));
    return { left: stems[0].left, right: stems[0].right, stems };
};

/**
 * A reader of `source` from segment `from` that copies what is final into one whole-track array, and
 * notes the segments it read. With `keepBefore` its window moves on; without it, it is the whole track.
 */
const reader = (source: StemSource, from = 0, keepBefore?: number, channel?: 'left' | 'right') => {
    const all = new Float32Array(TOTAL);
    const segments: number[] = [];
    let got = 0;
    const r: StemReader = {
        source,
        ...(channel ? { channel } : {}),
        ...startStemReader(TOTAL, from),
        window: keepBefore === undefined ? wholeStemWindow(TOTAL) : movingStemWindow(TOTAL, from, keepBefore),
        read: (final) => {
            segments.push(r.next - 1);
            for (let at = Math.max(got, r.window.base); at < final; at += 1) all[at] = r.window.samples[at - r.window.base];
            got = final;
            return final;
        },
    };
    return { r, all, segments };
};

describe('stem pass', () => {
    beforeEach(() => {
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        resetStemSegmentsForTests();
    });

    it('lays a stem into a moving window to the same bits as into the whole track', async () => {
        const whole = reader('vocals');
        expect(await runStemPass({ left, right, readers: () => [whole.r] })).toBe(true);
        const moving = reader('vocals', 0, 0);
        expect(await runStemPass({ left, right, readers: () => [moving.r] })).toBe(true);
        expect(moving.r.window.samples.length).toBe(16);
        expect(Array.from(moving.all)).toEqual(Array.from(whole.all));
        // The fourth stem: -0.5 x the mono mix, the two channels' offsets averaged (the window is 0 at sample 0).
        for (let i = 1; i < TOTAL; i += 1) expect(whole.all[i]).toBeCloseTo(-0.5 * (left[i] + right[i]) / 2 - 0.005, 5);
    });

    it('reads one channel of a stem alongside the mono readers, which stay as they were', async () => {
        const alone = reader('vocals');
        await runStemPass({ left, right, readers: () => [alone.r] });
        runHtdemucsGpu.mockClear();
        const mono = reader('vocals');
        const l = reader('vocals', 0, 0, 'left');
        const r = reader('vocals', 0, 0, 'right');
        expect(await runStemPass({ left, right, readers: () => [mono.r, l.r, r.r] })).toBe(true);
        // One separation per segment for all three.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
        expect(Array.from(mono.all)).toEqual(Array.from(alone.all));
        for (let i = 1; i < TOTAL; i += 1) {
            expect(l.all[i]).toBeCloseTo(-0.5 * left[i] + 0.01, 5);
            expect(r.all[i]).toBeCloseTo(-0.5 * right[i] - 0.02, 5);
        }
    });

    it('goes on for the others while a reader is held, and feeds it first once it is not', async () => {
        const drums = reader('drums');
        const mixer = reader('vocals', 3, 0);
        const order: string[] = [];
        const held: StemReader = Object.assign(mixer.r, { urgent: () => true, held: () => drums.segments.length < 2 });
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            order.push(held.held!() ? `d${drums.r.next}` : (held.next < 5 ? `m${held.next}` : `d${drums.r.next}`));
            return model(l, r);
        });
        expect(await runStemPass({ left, right, readers: () => [drums.r, held] })).toBe(true);
        expect(order).toEqual(['d0', 'd1', 'm3', 'm4', 'd2', 'd3', 'd4']);
        expect(mixer.segments).toEqual([3, 4]);
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
    });

    it('feeds an urgent reader at a later segment first', async () => {
        const drums = reader('drums');
        const mixer = reader('vocals', 3, 0);
        const urgent: StemReader = Object.assign(mixer.r, { urgent: () => true });
        const seen: number[] = [];
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            seen.push(Math.min(drums.r.next, urgent.next < 5 ? urgent.next : 99));
            return model(l, r);
        });
        expect(await runStemPass({ left, right, readers: () => [drums.r, urgent] })).toBe(true);
        // Segments 3 and 4 for the urgent reader first (shared with the drums? no: the drums are at 0), then 0..4 for the drums.
        expect(mixer.segments).toEqual([3, 4]);
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
        expect(runHtdemucsGpu.mock.calls.length).toBe(7);
    });

    it('feeds the lowest segment once the urgent reader is no longer urgent', async () => {
        const drums = reader('drums');
        const mixer = reader('vocals', 3, 0);
        const order: string[] = [];
        // Urgent for its first segment only.
        const soon: StemReader = Object.assign(mixer.r, { urgent: () => mixer.segments.length < 1 });
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            order.push(soon.next < 5 && (soon.urgent!() || soon.next <= drums.r.next) ? `m${soon.next}` : `d${drums.r.next}`);
            return model(l, r);
        });
        expect(await runStemPass({ left, right, readers: () => [drums.r, soon] })).toBe(true);
        // Segment 4 is the two readers' together (one run).
        expect(order).toEqual(['m3', 'd0', 'd1', 'd2', 'd3', 'm4']);
        expect(mixer.segments).toEqual([3, 4]);
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
    });

    it('keeps the others behind a pacing reader, so each segment runs once', async () => {
        vi.useFakeTimers();
        try {
            const drums = reader('drums');
            const mixer = reader('vocals');
            let released = false;
            const pacing: StemReader = Object.assign(mixer.r, { paces: true, held: () => !released && mixer.segments.length >= 2 });
            const pass = runStemPass({ left, right, readers: () => [drums.r, pacing] });
            await vi.advanceTimersByTimeAsync(1000);
            // Held after two segments: the drums wait at its next one.
            expect(drums.segments).toEqual([0, 1]);
            expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
            released = true;
            await vi.advanceTimersByTimeAsync(1000);
            expect(await pass).toBe(true);
            expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
            expect(mixer.segments).toEqual([0, 1, 2, 3, 4]);
            expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
        } finally {
            vi.useRealTimers();
        }
    });

    it('lets the others alone once the pacing reader is through or gone', async () => {
        const drums = reader('drums');
        const mixer = reader('vocals', 3, 0);
        const pacing: StemReader = Object.assign(mixer.r, { paces: true });
        expect(await runStemPass({ left, right, readers: () => [drums.r, pacing] })).toBe(true);
        expect(drums.segments).toEqual([0, 1, 2, 3, 4]);
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('waits while all its readers are held and stops if no longer wanted', async () => {
        const voice = reader('vocals');
        let wanted = true;
        let polls = 0;
        const held: StemReader = Object.assign(voice.r, { held: () => { polls += 1; if (polls > 2) wanted = false; return true; } });
        expect(await runStemPass({ left, right, readers: () => [held], keepGoing: () => wanted })).toBe(false);
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
    });

    it('separates a segment once for every reader at it, and feeds one starting further back alone first', async () => {
        const whole = reader('vocals');
        await runStemPass({ left, right, readers: () => [whole.r] });
        runHtdemucsGpu.mockClear();
        const drums = reader('drums', 3);
        const voice = reader('vocals', 1, 0);
        expect(await runStemPass({ left, right, readers: () => [drums.r, voice.r] })).toBe(true);
        // Segments 1 to 4: 1 and 2 for the voice alone, 3 and 4 shared.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(4);
        expect(voice.segments).toEqual([1, 2, 3, 4]);
        expect(drums.segments).toEqual([3, 4]);
        // Whole from where segment 0 ends; zero before.
        expect(stemWholeFrom(TOTAL, 1)).toBe(16);
        expect(Array.from(voice.all.subarray(16))).toEqual(Array.from(whole.all.subarray(16)));
        expect(voice.all.subarray(0, 16).every(v => v === 0)).toBe(true);
    });

    it('takes readers added and let go between segments', async () => {
        const drums = reader('drums');
        const late = reader('bass', 2, 0);
        let readers: StemReader[] = [drums.r];
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            const calls = runHtdemucsGpu.mock.calls.length;
            // After the third segment the bass comes in; after the fourth the drums go.
            if (calls === 3) readers = [drums.r, late.r];
            if (calls === 4) readers = [late.r];
            return model(l, r);
        });
        expect(await runStemPass({ left, right, readers: () => readers })).toBe(true);
        expect(drums.segments).toEqual([0, 1, 2]);
        expect(late.segments).toEqual([2, 3, 4]);
        // The bass came in while segment 2 ran for the drums: 2 again for it alone, then 3 and 4.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(6);
    });

    it('stops before the next segment once not wanted, keeping where each reader is', async () => {
        const drums = reader('drums');
        let segments = 0;
        expect(await runStemPass({ left, right, readers: () => [drums.r], keepGoing: () => segments++ < 2 })).toBe(false);
        expect([drums.r.next, drums.r.divided]).toEqual([2, 24]);
    });
});
