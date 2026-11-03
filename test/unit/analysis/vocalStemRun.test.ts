import { describe, expect, it, vi } from 'vitest';

// test/unit/analysis/vocalStemRun.test.ts
// 雾笺's vocal envelope as a task on the track's stem run (analysis/vocalStemRun.ts), beside the drum
// hits': a track whose hits are stored is separated again for the voice alone, the hits untouched;
// from the playhead on when switched to mid-track; joining the drums' run mid-way without running
// the track twice, and let go with the drums carrying on.
// The model, the decode and the resampler are stand-ins, as in drumHitsResume.test.ts.

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
const { DRUM_HITS_PREFIX, VOCAL_ENVELOPE_PREFIX } = await import('@/services/analysis/beatGridKeys');
const { getVocalEnvelope } = await import('@/services/analysis/vocalEnvelope');
const { loadTrackVocalEnvelope, releaseTrackVocals, vocalSegmentAt } = await import('@/services/analysis/vocalStemRun');
const { stemWholeFrom } = await import('@/services/analysis/stemPass');

/** 雾笺's ask: the drum hits and the voice, side by side, as beatFxSource.ts asks them. */
const both = (key: string, bytes: () => Promise<ArrayBuffer | null>, options: { at?: () => number; seconds?: number } = {}) =>
    Promise.all([loadTrackDrumHits(key, bytes), loadTrackVocalEnvelope(key, bytes, options)]).then(([hits]) => hits);

/** A kick every half second for the drums, a sung note every 0.8 s for the vocals. */
const song = (seconds: number) => {
    const drums = new Float32Array(seconds * RATE);
    const voice = new Float32Array(seconds * RATE);
    for (let at = 0; at < drums.length; at += 1) {
        const t = at / RATE;
        const beat = t % 0.5;
        drums[at] = Math.exp(-beat * 30) * Math.sin(2 * Math.PI * 60 * beat) * 0.8;
        // Faded in and out over 10 ms, as a voice is: a hard cut would read as a click.
        const inNote = t % 0.8;
        const fade = Math.min(1, inNote / 0.01, Math.max(0, 0.5 - inNote) / 0.01);
        voice[at] = 0.3 * fade * Math.sin(2 * Math.PI * 330 * t);
    }
    return { drums, voice };
};

/** The stand-in model: left the drums, right the voice (see the first test). */
const splitModel = async (left: Float32Array, right: Float32Array) => {
    const d = { left: left.slice(), right: left.slice() };
    const v = { left: right.slice(), right: right.slice() };
    const none = { left: new Float32Array(left.length), right: new Float32Array(left.length) };
    return { left: d.left, right: d.right, stems: [d, none, none, v] };
};

describe('the vocal envelope on the stem run', () => {
    it('starts the vocals a segment before the playhead, whole from where that segment ends', () => {
        // One-second segments step 0.75 s: starts 0, 33075, 66150, ...
        const total = 10 * RATE;
        expect(vocalSegmentAt(total, 0)).toBe(0);
        expect(vocalSegmentAt(total, 33074)).toBe(0);
        expect(vocalSegmentAt(total, 70000)).toBe(1);
        // The playhead is always inside the whole part.
        for (let at = 0; at < total; at += 997) expect(stemWholeFrom(total, vocalSegmentAt(total, at))).toBeLessThanOrEqual(at);
    });

    it('separates the voice of a track stored without it, the hits untouched, then reads both from the store', async () => {
        const { drums, voice } = song(12);
        // The "mix" carries both, side by side: left the drums, right the voice, so the model can split them.
        track.left = drums;
        track.right = voice;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            const d = { left: left.slice(), right: left.slice() };
            const v = { left: right.slice(), right: right.slice() };
            const none = { left: new Float32Array(left.length), right: new Float32Array(left.length) };
            return { left: d.left, right: d.right, stems: [d, none, none, v] };
        });
        const bytes = async () => new ArrayBuffer(8);
        setWantedDrumTrack('song');
        expect(await loadTrackDrumHits('song', bytes)).not.toBeNull();
        const first = store.get(`${DRUM_HITS_PREFIX}song`) as { drumEnergy: Float32Array };
        expect(store.has(`${VOCAL_ENVELOPE_PREFIX}song`)).toBe(false);
        const runs = runHtdemucsGpu.mock.calls.length;

        expect(await both('song', bytes)).not.toBeNull();
        expect(runHtdemucsGpu.mock.calls.length).toBe(2 * runs);
        const again = store.get(`${DRUM_HITS_PREFIX}song`) as { drumEnergy: Float32Array };
        expect(Array.from(again.drumEnergy)).toEqual(Array.from(first.drumEnergy));
        const envelope = getVocalEnvelope('song');
        expect(envelope).not.toBeNull();
        expect(store.get(`${VOCAL_ENVELOPE_PREFIX}song`)).toBe(envelope);
        // A note every 0.8 s: one onset at each, and none elsewhere.
        const onsets = Array.from(envelope!.onsets, frame => frame / envelope!.fps);
        expect(onsets.length).toBeGreaterThanOrEqual(14);
        expect(onsets.every(at => Math.min(at % 0.8, 0.8 - (at % 0.8)) <= 0.06)).toBe(true);
        expect(getDrumHits('song')).not.toBeNull();

        expect(await both('song', bytes)).not.toBeNull();
        expect(runHtdemucsGpu.mock.calls.length).toBe(2 * runs);
    });

    it('separates the voice alone from the playhead on for stored hits, and keeps it for the play only', async () => {
        const { drums, voice } = song(40);
        track.left = drums;
        track.right = voice;
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(splitModel);
        const bytes = async () => new ArrayBuffer(8);
        setWantedDrumTrack('late');
        expect(await loadTrackDrumHits('late', bytes)).not.toBeNull();
        const stored = store.get(`${DRUM_HITS_PREFIX}late`);
        const whole = runHtdemucsGpu.mock.calls.length;
        runHtdemucsGpu.mockClear();

        expect(await both('late', bytes, { at: () => 15 })).not.toBeNull();
        // The playhead at 15 s sits in segment 20 (a step of 0.75 s): from 19 on, the voice whole from 14.5 s.
        expect(runHtdemucsGpu.mock.calls.length).toBe(whole - 19);
        expect(store.get(`${DRUM_HITS_PREFIX}late`)).toBe(stored);
        const envelope = getVocalEnvelope('late')!;
        expect(envelope.from! / envelope.fps).toBeGreaterThan(14.5);
        expect(envelope.from! / envelope.fps).toBeLessThan(15);
        expect(Array.from(envelope.onsets).every(frame => frame > envelope.from!)).toBe(true);
        expect(envelope.onsets.length).toBeGreaterThanOrEqual(25);
        expect(store.has(`${VOCAL_ENVELOPE_PREFIX}late`)).toBe(false);

        // Later in the same play it does; from before its start the voice is separated again.
        runHtdemucsGpu.mockClear();
        await both('late', bytes, { at: () => 20 });
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        await both('late', bytes, { at: () => 0 });
        expect(runHtdemucsGpu.mock.calls.length).toBe(whole);
        expect(getVocalEnvelope('late')!.from).toBeUndefined();
        expect(store.has(`${VOCAL_ENVELOPE_PREFIX}late`)).toBe(true);
    });

    it('joins a drum run for the voice from the playhead, the drums carried on', async () => {
        const { drums, voice } = song(40);
        track.left = drums;
        track.right = voice;
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(splitModel);
        const bytes = async () => new ArrayBuffer(8);
        setWantedDrumTrack('through');
        await loadTrackDrumHits('through', bytes);
        const through = store.get(`${DRUM_HITS_PREFIX}through`) as { drumEnergy: Float32Array };
        const whole = runHtdemucsGpu.mock.calls.length;

        // 时计 separating; after 30 segments the picture switches to 雾笺, the playhead at 5 s.
        runHtdemucsGpu.mockClear();
        let joined: Promise<unknown> | null = null;
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 30) joined = both('switched', bytes, { at: () => 5 });
            return splitModel(left, right);
        });
        setWantedDrumTrack('switched');
        await loadTrackDrumHits('switched', bytes);
        expect(joined).not.toBeNull();
        expect(await joined).not.toBeNull();
        // The drums once through; the voice from segment 5 (the playhead in segment 6) to segment 30 again.
        expect(runHtdemucsGpu.mock.calls.length).toBeLessThanOrEqual(whole + 31 - 5);
        expect(runHtdemucsGpu.mock.calls.length).toBeLessThan(2 * whole - 5);
        expect(await joined).not.toBeNull();
        const switched = store.get(`${DRUM_HITS_PREFIX}switched`) as { drumEnergy: Float32Array };
        expect(Array.from(switched.drumEnergy)).toEqual(Array.from(through.drumEnergy));
        const envelope = getVocalEnvelope('switched')!;
        expect(envelope.from! / envelope.fps).toBeLessThan(5);
        expect(envelope.onsets.length).toBeGreaterThanOrEqual(40);
    });

    it('lets the voice go when only the drums are wanted again, and carries the drums on', async () => {
        const { drums, voice } = song(40);
        track.left = drums;
        track.right = voice;
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(splitModel);
        const bytes = async () => new ArrayBuffer(8);
        setWantedDrumTrack('back');
        await loadTrackDrumHits('back', bytes);
        const through = store.get(`${DRUM_HITS_PREFIX}back`) as { drumEnergy: Float32Array };
        const whole = runHtdemucsGpu.mock.calls.length;

        // 雾笺 separating with the voice; after 30 segments back to 时计, then a second 时计 caller at once.
        runHtdemucsGpu.mockClear();
        const joined: Promise<unknown>[] = [];
        runHtdemucsGpu.mockImplementation(async (left: Float32Array, right: Float32Array) => {
            if (runHtdemucsGpu.mock.calls.length === 30) {
                releaseTrackVocals('flipped');
                joined.push(loadTrackDrumHits('flipped', bytes), loadTrackDrumHits('flipped', bytes));
            }
            return splitModel(left, right);
        });
        setWantedDrumTrack('flipped');
        await both('flipped', bytes);
        const answers = await Promise.all(joined);
        expect(answers.every(answer => answer !== null)).toBe(true);
        // The drums once through, nothing run twice; no voice read.
        expect(runHtdemucsGpu.mock.calls.length).toBe(whole);
        expect(getVocalEnvelope('flipped')).toBeNull();
        const flipped = store.get(`${DRUM_HITS_PREFIX}flipped`) as { drumEnergy: Float32Array };
        expect(Array.from(flipped.drumEnergy)).toEqual(Array.from(through.drumEnergy));
    });

    it('decodes nothing for the voice when too little of a known-length track is left', async () => {
        const { drums, voice } = song(40);
        track.left = drums;
        track.right = voice;
        runHtdemucsGpu.mockReset();
        runHtdemucsGpu.mockImplementation(splitModel);
        const bytes = vi.fn(async () => new ArrayBuffer(8));
        setWantedDrumTrack('tail');
        await loadTrackDrumHits('tail', bytes);
        bytes.mockClear();
        runHtdemucsGpu.mockClear();
        expect(await both('tail', bytes, { at: () => 30, seconds: 40 })).not.toBeNull();
        expect(bytes).not.toHaveBeenCalled();
        expect(runHtdemucsGpu).not.toHaveBeenCalled();
        expect(getVocalEnvelope('tail')).toBeNull();
    });
});
