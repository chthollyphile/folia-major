import { describe, expect, it, vi } from 'vitest';

// test/unit/analysis/drumHitsResume.test.ts
// A track's drum separation stopped part way (its picture left: `setWantedDrumTrack(null)`) and carried
// on later through `loadTrackDrumHits` (analysis service plan, 2b): the hits kept play at once, only
// the segments not yet separated run, and what is stored is the same bits as a run straight through.
// The model, the decode and the resampler are stand-ins; the segments, the band stream, the energy and
// the resume state are the real ones.

const store = new Map<string, unknown>();
vi.mock('@/services/db', () => ({
    getFromCache: vi.fn(async (key: string) => store.get(key) ?? null),
    saveToCache: vi.fn(async (key: string, data: unknown) => {
        store.set(key, data);
    }),
}));

const RATE = 44100;
// One second a segment (a step of 0.75 s): a 20 s track is 27 of them, live hits from 10 s on.
const { runHtdemucsGpu } = vi.hoisted(() => ({ runHtdemucsGpu: vi.fn() }));
vi.mock('@/services/analysis/beatThisGpu', () => ({ HTDEMUCS_GPU_SEGMENT: 44100, runHtdemucsGpu }));
vi.mock('@/services/analysis/modelAvailability', async importOriginal => ({
    ...(await importOriginal<object>()),
    modelCanRun: () => true,
}));

// The decode hands back the track the test made, under whatever bytes.
const track = vi.hoisted(() => ({ left: new Float32Array(0) as Float32Array, right: new Float32Array(0) as Float32Array }));
vi.mock('@/services/analysis/trackAudio', () => ({
    decodeAtRate: vi.fn(async () => ({
        length: track.left.length,
        numberOfChannels: 2,
        sampleRate: 44100,
        getChannelData: (channel: number) => (channel ? track.right : track.left),
    })),
}));
const { melSpectrogram } = await import('@/services/analysis/beatThis');
vi.mock('@/services/automix/analysisOffThread', () => ({
    melSpectrogramOffThread: (signal: Float32Array) => melSpectrogram(signal),
}));

// The browser's resampler, as every other sample: reaches nowhere, so a stretch reads as the whole.
class FakeOfflineAudioContext {
    constructor(_channels: number, private length: number) {}
    private input = new Float32Array(0);
    destination = {};
    createBufferSource() {
        return { buffer: null, connect: () => undefined, start: () => undefined };
    }
    createBuffer() {
        return { copyToChannel: (signal: Float32Array) => { this.input = signal.slice(); } };
    }
    async startRendering() {
        const out = this.input.filter((_, at) => at % 2 === 0).slice(0, this.length);
        return { getChannelData: () => out };
    }
}
vi.stubGlobal('OfflineAudioContext', FakeOfflineAudioContext);
vi.stubGlobal('window', { electron: { getHtdemucsGpuWeights: () => undefined } });
vi.stubGlobal('navigator', { gpu: {} });

const { getDrumHits, loadTrackDrumHits, setWantedDrumTrack } = await import('@/services/analysis/drumHits');
const { DRUM_HITS_PREFIX } = await import('@/services/analysis/beatGridKeys');

/** A click track: a kick every half second, a hat between, a snare on every other kick's off-beat. */
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

interface Stored {
    hits: { times: Float64Array; strengths: Float32Array; kinds: Uint8Array };
    drumEnergy: Float32Array;
    mixEnergy: Float32Array;
}

describe('a drum separation stopped and carried on', () => {
    it('plays the kept hits at once, separates only the rest, and stores the same bits as one run', async () => {
        track.left = clicks(20);
        track.right = track.left.map(v => v * 0.9);
        // Not the identity: the channels apart and offset, so the sum and the weight carried over matter.
        let calls = 0;
        let stopAfter = Infinity;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            calls += 1;
            // A segment takes a while on the GPU: the live picks between catch up, as they do there.
            await new Promise(resolve => setTimeout(resolve, 2));
            if (calls === stopAfter) setWantedDrumTrack(null);
            return { left: left.map(v => v * 0.8 + 0.001), right: right.map(v => v * 0.6) };
        });
        const bytes = async () => new ArrayBuffer(8);

        setWantedDrumTrack('through');
        expect(await loadTrackDrumHits('through', bytes)).not.toBeNull();
        const segments = calls;
        expect(segments).toBeGreaterThan(20);

        // Left after 17 segments (past the first live hits), then come back to.
        calls = 0;
        stopAfter = 17;
        setWantedDrumTrack('carried');
        expect(await loadTrackDrumHits('carried', bytes)).toBeNull();
        expect(calls).toBe(17);
        expect(getDrumHits('carried')).toBeNull();
        expect(store.has(`${DRUM_HITS_PREFIX}carried`)).toBe(false);

        calls = 0;
        stopAfter = Infinity;
        setWantedDrumTrack('carried');
        let keptHits: ReturnType<typeof getDrumHits> = null;
        const again = await loadTrackDrumHits('carried', async () => {
            keptHits = getDrumHits('carried');
            return bytes();
        });
        expect(again).not.toBeNull();
        // The hits kept were back before the bytes were read, and only the segments left ran.
        expect(keptHits).not.toBeNull();
        expect(keptHits!.until).toBeGreaterThan(5);
        expect(keptHits!.times.length).toBeGreaterThan(5);
        expect(calls).toBe(segments - 17);

        const through = store.get(`${DRUM_HITS_PREFIX}through`) as Stored;
        const carried = store.get(`${DRUM_HITS_PREFIX}carried`) as Stored;
        expect(through.hits.times.length).toBeGreaterThan(20);
        expect(Array.from(carried.hits.times)).toEqual(Array.from(through.hits.times));
        expect(Array.from(carried.hits.strengths)).toEqual(Array.from(through.hits.strengths));
        expect(Array.from(carried.hits.kinds)).toEqual(Array.from(through.hits.kinds));
        expect(Array.from(carried.drumEnergy)).toEqual(Array.from(through.drumEnergy));
        expect(Array.from(carried.mixEnergy)).toEqual(Array.from(through.mixEnergy));
        // Finished: nothing left to carry on from, and the next play reads the cache.
        calls = 0;
        expect(await loadTrackDrumHits('carried', bytes)).not.toBeNull();
        expect(calls).toBe(0);
    });

    it('takes the kept hits off again when the bytes cannot be read on the way back', async () => {
        track.left = clicks(14);
        track.right = track.left.slice();
        let calls = 0;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            calls += 1;
            await new Promise(resolve => setTimeout(resolve, 2));
            if (calls === 16) setWantedDrumTrack(null);
            return { left: left.slice(), right: right.slice() };
        });
        setWantedDrumTrack('missing');
        expect(await loadTrackDrumHits('missing', async () => new ArrayBuffer(8))).toBeNull();
        setWantedDrumTrack('missing');
        let keptHits: ReturnType<typeof getDrumHits> = null;
        expect(await loadTrackDrumHits('missing', async () => {
            keptHits = getDrumHits('missing');
            return null;
        })).toBeNull();
        expect(keptHits).not.toBeNull();
        expect(getDrumHits('missing')).toBeNull();
    });
});
