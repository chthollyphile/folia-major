import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/stemRange.test.ts
// Stretches of a track's four stems on the one segment grid (analysis/stemRange.ts): the same bits as
// the whole track's at those samples, and the segments one caller separated taken by the other - the
// drum hits' tail by automix, automix's head by the drum hits - instead of run again.

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu }));

const { dropStemDrums, forgetStemRange, peekStemSegment, resetStemSegmentsForTests, segmentsOver, separateStemRange, setStemDrumsWanted, stemRangeSpan, wantStemRange } = await import('@/services/analysis/stemRange');
const { separateDrumStem } = await import('@/services/analysis/drumStem');

/** A stand-in model: four different, non-linear stems per segment, so the sums and weights matter. */
const model = async (left: Float32Array, right: Float32Array) => {
    const stems = [0.8, -0.3, 0.5, 1.1].map((gain, source) => ({
        left: left.map(v => gain * v + 0.01 * source * v * v),
        right: right.map(v => gain * v - 0.02 * source),
    }));
    return { left: stems[0].left, right: stems[0].right, stems };
};

const track = (total: number) => ({
    left: Float32Array.from({ length: total }, (_, i) => Math.sin(i * 1.7) * 0.6),
    right: Float32Array.from({ length: total }, (_, i) => Math.cos(i * 0.9) * 0.4),
});

const options = { urgency: 'background' as const };

describe('stem ranges', () => {
    beforeEach(() => {
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        resetStemSegmentsForTests();
    });

    it('separates only the segments that reach into a stretch, from just the samples they cover', () => {
        // Starts every 12: 0, 12, 24, 36, 48.
        expect(segmentsOver(50, 30, 40)).toEqual([2, 3]);
        expect(stemRangeSpan(50, 30, 40)).toEqual({ start: 24, end: 50 });
        expect(stemRangeSpan(50, 0, 10)).toEqual({ start: 0, end: 16 });
    });

    it('gives a stretch the same bits as the whole track there, cut from a decode of its span alone', async () => {
        const total = 50;
        const { left, right } = track(total);
        const whole = await separateStemRange({ left, right, offset: 0, total, from: 0, to: total, options });
        for (const [from, to] of [[30, 50], [0, 20], [13, 37]]) {
            const span = stemRangeSpan(total, from, to);
            const part = await separateStemRange({
                left: left.slice(span.start, span.end), right: right.slice(span.start, span.end), offset: span.start, total, from, to, options,
            });
            for (let source = 0; source < 4; source += 1) {
                expect(Array.from(part![source].left)).toEqual(Array.from(whole![source].left.subarray(from, to)));
                expect(Array.from(part![source].right)).toEqual(Array.from(whole![source].right.subarray(from, to)));
            }
        }
    });

    it('lets automix take a tail the drum hits separated, and shrinks it to the drums once taken', async () => {
        const total = 50;
        const { left, right } = track(total);
        const fresh = await separateStemRange({ left, right, offset: 0, total, from: 30, to: 50, options });
        runHtdemucsGpu.mockClear();
        wantStemRange('song', 30, 50, total);
        expect(await separateDrumStem(left, right, undefined, undefined, undefined, 'song')).not.toBeNull();
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
        runHtdemucsGpu.mockClear();
        const taken = await separateStemRange({ key: 'song', left, right, offset: 0, total, from: 30, to: 50, options });
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        for (let source = 0; source < 4; source += 1) expect(Array.from(taken![source].left)).toEqual(Array.from(fresh![source].left));
        forgetStemRange('song', 30, 50, total);
        expect(peekStemSegment('song', 3)).toHaveLength(1);
        // A segment no stretch wanted was not kept.
        expect(peekStemSegment('song', 0)).toBeNull();
    });

    it('lets the drum hits take the drums of a head automix separated, to the same stem', async () => {
        const total = 50;
        const { left, right } = track(total);
        const own = await separateDrumStem(left, right);
        runHtdemucsGpu.mockClear();
        expect(await separateStemRange({ key: 'next', left, right, offset: 0, total, from: 0, to: 30, options })).not.toBeNull();
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(3);
        runHtdemucsGpu.mockClear();
        const shared = await separateDrumStem(left, right, undefined, undefined, undefined, 'next');
        // Only the two segments past the head ran.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
        expect(Array.from(shared!)).toEqual(Array.from(own!));
    });

    it('is null once the stretch is no longer wanted, before the next segment', async () => {
        const { left, right } = track(50);
        let asked = 0;
        const result = await separateStemRange({ left, right, offset: 0, total: 50, from: 0, to: 50, options: { ...options, stillWanted: () => asked++ < 2 } });
        expect(result).toBeNull();
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
    });
});

describe('stem ranges, from review', () => {
    beforeEach(() => {
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        resetStemSegmentsForTests();
    });

    it('counts wants: a short track\'s head and tail are one stretch, and the first done leaves the other its segments', async () => {
        const total = 20;
        const { left, right } = track(total);
        wantStemRange('short', 0, total, total);
        wantStemRange('short', 0, total, total);
        expect(await separateDrumStem(left, right, undefined, undefined, undefined, 'short')).not.toBeNull();
        forgetStemRange('short', 0, total, total);
        expect(peekStemSegment('short', 0)).toHaveLength(4);
        runHtdemucsGpu.mockClear();
        expect(await separateStemRange({ key: 'short', left, right, offset: 0, total, from: 0, to: total, options })).not.toBeNull();
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
    });

    it('does not keep a caller\'s own segments whole for itself, only their drums', async () => {
        const total = 50;
        const { left, right } = track(total);
        wantStemRange('own', 30, 50, total);
        expect(await separateStemRange({ key: 'own', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        expect(peekStemSegment('own', 3)).toHaveLength(1);
    });

    it('keeps no drums for the drum hits from a stem pass that reads the voice beside them', async () => {
        const total = 50;
        const { left, right } = track(total);
        const { runStemPass, startStemReader, wholeStemWindow } = await import('@/services/analysis/stemPass');
        const reader = (source: 'drums' | 'vocals') => ({ source, ...startStemReader(total), window: wholeStemWindow(total), read: () => undefined });
        // The drum hits of 'self' may still be separated (the default): automix's run would keep its drums.
        const readers = [reader('drums'), reader('vocals')];
        expect(await runStemPass({ left, right, key: 'self', readers: () => readers })).toBe(true);
        for (let index = 0; index < 5; index += 1) expect(peekStemSegment('self', index)).toBeNull();
    });

    it('keeps the drums alone in buffers of their own, not views that hold the other stems', async () => {
        const total = 50;
        const { left, right } = track(total);
        // The stand-in returns four separate arrays; the GPU's are views of one readback.
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            const out = await model(l, r);
            const shared = new Float32Array(8 * l.length);
            const stems = out.stems.map((stem, source) => {
                shared.set(stem.left, 2 * source * l.length);
                shared.set(stem.right, (2 * source + 1) * l.length);
                return {
                    left: shared.subarray(2 * source * l.length, (2 * source + 1) * l.length),
                    right: shared.subarray((2 * source + 1) * l.length, (2 * source + 2) * l.length),
                };
            });
            return { left: stems[0].left, right: stems[0].right, stems };
        });
        expect(await separateStemRange({ key: 'views', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        const drums = peekStemSegment('views', 3)!;
        expect(drums).toHaveLength(1);
        expect(drums[0].left.buffer.byteLength).toBe(drums[0].left.byteLength);
        expect(drums[0].right.buffer.byteLength).toBe(drums[0].right.byteLength);
    });

    it('joins a segment another caller is separating rather than running it twice', async () => {
        const total = 50;
        const { left, right } = track(total);
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        runHtdemucsGpu.mockImplementation(async (l: Float32Array, r: Float32Array) => {
            await gate;
            return model(l, r);
        });
        const drums = separateDrumStem(left, right, undefined, undefined, undefined, 'both');
        const stems = separateStemRange({ key: 'both', left, right, offset: 0, total, from: 0, to: 10, options });
        await new Promise(resolve => setTimeout(resolve, 0));
        release();
        expect(await stems).not.toBeNull();
        expect(await drums).not.toBeNull();
        // Segment 0 once for the two of them, then the drum stem's other four.
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(5);
    });

    it('does not hand a segment kept for one track length to another', async () => {
        const { left, right } = track(50);
        expect(await separateStemRange({ key: 'len', left, right, offset: 0, total: 50, from: 0, to: 10, options })).not.toBeNull();
        expect(peekStemSegment('len', 0, 50)).not.toBeNull();
        expect(peekStemSegment('len', 0, 49)).toBeNull();
    });
});

describe('stem ranges, from the PR #750 review', () => {
    beforeEach(() => {
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(model);
        resetStemSegmentsForTests();
    });

    it('keeps no drums of automix\'s own segments for a track whose drum hits will not run', async () => {
        const total = 50;
        const { left, right } = track(total);
        setStemDrumsWanted(key => key !== 'done');
        wantStemRange('done', 30, 50, total);
        expect(await separateStemRange({ key: 'done', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        expect(peekStemSegment('done', 3)).toBeNull();
    });

    it('drops a taken segment rather than shrink it to the drums, when they will not be read', async () => {
        const total = 50;
        const { left, right } = track(total);
        wantStemRange('song', 30, 50, total);
        expect(await separateDrumStem(left, right, undefined, undefined, undefined, 'song')).not.toBeNull();
        setStemDrumsWanted(() => false);
        forgetStemRange('song', 30, 50, total);
        expect(peekStemSegment('song', 3)).toBeNull();
    });

    it('drops the drums already kept for a track it now says no to, and only those', async () => {
        const total = 50;
        const { left, right } = track(total);
        wantStemRange('a', 30, 50, total);
        wantStemRange('b', 30, 50, total);
        expect(await separateStemRange({ key: 'a', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        expect(await separateStemRange({ key: 'b', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        expect(peekStemSegment('a', 3)).toHaveLength(1);
        setStemDrumsWanted(key => key !== 'a');
        expect(peekStemSegment('a', 3)).toBeNull();
        expect(peekStemSegment('b', 3)).toHaveLength(1);
    });

    it('drops the drums kept for a track whose hits come in, and only those', async () => {
        const total = 50;
        const { left, right } = track(total);
        wantStemRange('a', 30, 50, total);
        wantStemRange('b', 30, 50, total);
        expect(await separateStemRange({ key: 'a', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        expect(await separateStemRange({ key: 'b', left, right, offset: 0, total, from: 30, to: 50, options })).not.toBeNull();
        dropStemDrums('a');
        expect(peekStemSegment('a', 3)).toBeNull();
        expect(peekStemSegment('b', 3)).toHaveLength(1);
    });
});
