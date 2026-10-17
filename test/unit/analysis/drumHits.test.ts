import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/analysis/drumHits.test.ts
// The drum stem of a whole track (drumStem.ts: segments, overlap-add) and its hits (drumHits.ts: the
// drumless guard, the cache layering, the cache key's registration as analysis data), and the hits
// read a stretch at a time while it separates (drumHitStream.ts): the same as the whole track's.

const store = new Map<string, unknown>();
vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, data: unknown) => {
        store.set(key, data);
    }),
}));

const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 16, runHtdemucsGpu }));

const { drumStemSegments, drumStemWindow, separateDrumStem } = await import('@/services/analysis/drumStem');
const { DRUMLESS_COVERAGE, drumBandTracks, drumCoverage, getDrumHits, loadTrackDrumHits, pickBandHits, pickDrumHits } = await import('@/services/analysis/drumHits');
const { createDrumBandStream } = await import('@/services/analysis/drumHitStream');
const { melSpectrogram } = await import('@/services/analysis/beatThis');
const { DRUM_HITS_PREFIX, isBeatGridKey, isDrumHitsKey } = await import('@/services/analysis/beatGridKeys');

describe('drum stem', () => {
    beforeEach(() => {
        runHtdemucsGpu.mockReset();
    });

    it('steps segments by three quarters, the window ramping across the shared quarter', () => {
        expect(drumStemSegments(40, 16)).toEqual([0, 12, 24, 36]);
        expect(drumStemSegments(10, 16)).toEqual([0]);
        const win = drumStemWindow(16);
        [0, 1 / 3, 2 / 3, 1].forEach((ramp, i) => expect(win[i]).toBeCloseTo(ramp, 6));
        expect(win[15]).toBe(0);
        expect(win[8]).toBe(1);
    });

    it('lays segments back together without a seam: an identity model gives the input back', async () => {
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => ({ left: left.slice(), right: right.slice() }));
        const left = Float32Array.from({ length: 50 }, (_, i) => Math.sin(i));
        const right = Float32Array.from({ length: 50 }, (_, i) => Math.cos(i));
        const drums = await separateDrumStem(left, right);
        expect(drums).not.toBeNull();
        // The track's first sample has no weight but the window's zero; every other sample is the mono mix.
        for (let i = 1; i < 50; i += 1) expect(drums![i]).toBeCloseTo((left[i] + right[i]) / 2, 5);
    });

    it('hands over a finished head after every segment that the whole stem keeps', async () => {
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => ({ left: left.slice(), right: right.slice() }));
        const left = Float32Array.from({ length: 50 }, (_, i) => Math.sin(i));
        const right = Float32Array.from({ length: 50 }, (_, i) => Math.cos(i));
        const heads: Array<{ final: number; head: Float32Array }> = [];
        const drums = await separateDrumStem(left, right, (_done, _count, stem, final) => {
            heads.push({ final, head: stem.slice(0, final) });
        });
        expect(heads.map(head => head.final)).toEqual([12, 24, 36, 48, 50]);
        for (const { head } of heads) expect(head).toEqual(drums!.subarray(0, head.length));
    });

    it('stops before the next segment once the track is no longer wanted', async () => {
        runHtdemucsGpu.mockResolvedValue({ left: new Float32Array(16), right: new Float32Array(16) });
        let calls = 0;
        expect(await separateDrumStem(new Float32Array(40), new Float32Array(40), undefined, () => calls++ < 2)).toBeNull();
        expect(runHtdemucsGpu).toHaveBeenCalledTimes(2);
    });

    it('is null as soon as one segment cannot be separated', async () => {
        runHtdemucsGpu.mockResolvedValueOnce({ left: new Float32Array(16), right: new Float32Array(16) }).mockResolvedValueOnce(null);
        expect(await separateDrumStem(new Float32Array(40), new Float32Array(40))).toBeNull();
    });
});

describe('drum hits', () => {
    beforeEach(() => store.clear());

    it('reads how much of the audible track the drums play in', () => {
        const mix = new Float32Array(100).fill(1);
        // Drums in the second half only (four 25-frame windows): half the track, however quiet the first.
        const drums = new Float32Array(100);
        drums.fill(0.2, 50);
        expect(drumCoverage(drums, mix)).toBeCloseTo(0.5);
        // Silence is left out rather than counted as drumless.
        const quiet = new Float32Array(200).fill(1);
        quiet.fill(0, 100);
        expect(drumCoverage(new Float32Array(200).fill(0.2), quiet)).toBeCloseTo(1);
        // A stem at -20 dB under the mix (a bass line leaking in) is not drums playing.
        expect(drumCoverage(new Float32Array(100).fill(0.01), mix)).toBeLessThan(DRUMLESS_COVERAGE);
    });

    const analysis = (share: number) => ({
        hits: { times: Float64Array.from([0.5, 1]), strengths: Float32Array.from([1, 0.5]), kinds: Uint8Array.from([0, 1]) },
        drumEnergy: new Float32Array(100).fill(share),
        mixEnergy: new Float32Array(100).fill(1),
    });

    it('answers a stored track with drums, and none for a drumless one', async () => {
        store.set(`${DRUM_HITS_PREFIX}song-1`, analysis(0.3));
        store.set(`${DRUM_HITS_PREFIX}song-2`, analysis(0.001));
        const readBytes = vi.fn(async () => null);
        expect(await loadTrackDrumHits('song-1', readBytes)).not.toBeNull();
        expect(getDrumHits('song-1')?.times.length).toBe(2);
        expect(await loadTrackDrumHits('song-2', readBytes)).not.toBeNull();
        expect(getDrumHits('song-2')).toBeNull();
        expect(readBytes).not.toHaveBeenCalled();
    });

    it('separates nothing without htdemucs_gpu, and does not remember the miss', async () => {
        const readBytes = vi.fn(async () => new ArrayBuffer(8));
        expect(await loadTrackDrumHits('song-3', readBytes)).toBeNull();
        expect(readBytes).not.toHaveBeenCalled();
        store.set(`${DRUM_HITS_PREFIX}song-3`, analysis(0.3));
        expect(await loadTrackDrumHits('song-3', readBytes)).not.toBeNull();
    });

    it('files its key apart from the beat lists, as analysis data', () => {
        expect(isDrumHitsKey(`${DRUM_HITS_PREFIX}x`)).toBe(true);
        expect(isBeatGridKey(`${DRUM_HITS_PREFIX}x`)).toBe(false);
    });
});

describe('drum hits while separating', () => {
    // A click track: a kick every half second, a hat between, a snare on every other kick's off-beat.
    const RATE = 44100;
    const clicks = (seconds: number): Float32Array => {
        const out = new Float32Array(seconds * RATE);
        let seed = 1;
        const noise = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 1073741824 - 1;
        };
        for (let at = 0; at < out.length; at += 1) {
            const t = at / RATE;
            const beat = t % 0.5;
            const off = (t + 0.25) % 0.5;
            out[at] = Math.exp(-beat * 30) * Math.sin(2 * Math.PI * 60 * beat) * 0.8
                + Math.exp(-off * 80) * noise() * 0.2
                + (Math.floor(t) % 2 ? Math.exp(-off * 25) * noise() * 0.4 : 0);
        }
        return out;
    };
    // Every other sample: a resampler that reaches nowhere, so a stretch's frames can be held to the
    // whole stem's exactly (the browser's own filter is checked on real tracks).
    const halve = async (signal: Float32Array) => signal.filter((_, at) => at % 2 === 0);

    it('reads the same bands a stretch at a time as over the whole stem, with no hit at a cut', async () => {
        const stem = clicks(12);
        const whole = await melSpectrogram(await halve(stem));
        const bands = drumBandTracks(whole);
        const stream = createDrumBandStream(stem.length, { resample: halve, mel: melSpectrogram, bands: drumBandTracks });
        expect(stream.frames).toBe(whole.frames);
        // Cuts where htdemucs' segments end, nowhere near a frame boundary.
        for (let final = 129024; final < stem.length; final += 129024) {
            await stream.advance(stem, final, false);
            expect(stream.done).toBeLessThan(final / 882);
        }
        await stream.advance(stem, stem.length, true);
        expect(stream.done).toBe(whole.frames);
        for (let band = 0; band < 3; band += 1) {
            for (let frame = 0; frame < whole.frames; frame += 1) {
                expect(stream.bands[band][frame]).toBeCloseTo(bands[band][frame], 4);
            }
        }
        const streamed = pickBandHits(stream.bands, stream.frames);
        const reference = pickDrumHits(whole);
        expect(streamed.times.length).toBeGreaterThan(20);
        expect(Array.from(streamed.times)).toEqual(Array.from(reference.times));
        expect(Array.from(streamed.kinds)).toEqual(Array.from(reference.kinds));
    });

    it('picks over the frames so far alone', async () => {
        const mel = await melSpectrogram(await halve(clicks(6)));
        const bands = drumBandTracks(mel);
        const head = pickBandHits(bands, 150);
        expect(head.times.length).toBeGreaterThan(0);
        expect(Math.max(...head.times)).toBeLessThan(3);
    });
});
