import { melSpectrogramOffThread } from '../automix/analysisOffThread';
import { getFromCache, saveToCache } from '../db';
import { BEAT_THIS_FPS, BEAT_THIS_SAMPLE_RATE, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './beatThis';
import { DRUM_HITS_PREFIX } from './beatGridKeys';
import { createDrumBandStream, type DrumBands } from './drumHitStream';
import { separateDrumStem } from './drumStem';
import { modelCanRun } from './modelAvailability';
import { decodeAtRate } from './trackAudio';

// src/services/analysis/drumHits.ts
// A whole track's drum hits, read off htdemucs' drum stem (drumStem.ts, the renderer's GPU) and kept:
// in memory, on disk under the track's analysis key (DRUM_HITS_PREFIX, registered with the beat lists
// in services/repositories/cacheRepository.ts as analysis data), and in flight for as long as one run
// is going - the layering of beatGrid.ts. 时计 plays them under 智能动感模式
// (components/visualizer/pendolo/usePendoloBeatFx.ts): the user found the drums' own hits far truer
// than any rule over beat_this' beats (2026-10-17).
//
// A hit is where the stem rises: each of three bands (kick below KICK_MAX_HZ, snare up to SNARE_MAX_HZ,
// hats from HAT_MIN_HZ) against that band's own loud hits (HIT_TOP), a hit wherever the largest of the
// three peaks (a local maximum over PEAK_HALF frames either side, at least MIN_HIT_GAP apart) above
// HIT_ONSET_FLOOR, filed under the band that rose most, as strong as that share (0..1).
//
// A track with next to no drums has none (`getDrumHits` null): htdemucs still hands back a stem, and
// in a track without drums it is what leaked in - a bass line read as kicks (雪绒花). The guard is how
// much of the track the drums play in (`drumCoverage`), not how loud they are on the median: a song
// with drums in only half of it (小半, 麦恩莉) reads near 0 on the median like 雪绒花. Measured on the
// user's 21 separated tracks (2026-10-17): Edelweiss 0.006, 理想三旬 0.024, 第二圆舞曲 0.043, then
// every track with a drum kit from 0.135 up (走马 0.148), so DRUMLESS_COVERAGE sits in that gap. The
// stem's and the mix's energy are stored beside the hits so the guard can be tuned without separating
// anything again.
//
// GPU only, and only with htdemucs_gpu installed (`canRunDrumStem`): without them there are no hits,
// and 时计 plays beat_this' beats as it always did. A separation takes ~15 s of GPU for a four-minute
// track, so it runs only for the track the picture wants (`setWantedDrumTrack`) and stops at its next
// segment once another is wanted - skipping through tracks does not queue their separations up.
//
// A track separating now has hits before it is done: the stem is read as its head is finished
// (drumHitStream.ts), and about once a second (LIVE_EVERY_MS) the hits so far are picked again and
// handed over with `until`, the time they reach. Picked again, not appended: a band's loud hits
// (HIT_TOP), which every strength is a share of, are known only over what has been heard, so each
// pick rescales what came before - online softmax's running normaliser, and the hits ahead of the
// playhead are the better for it. The drumless guard is the same, over the head so far, and only
// from LIVE_MIN_SECONDS of it: before that, 时计 plays the beats. Separation runs far ahead of
// playback (some 15x on an M-series GPU), so the hits are there in about a second, and the stored
// analysis is the last pick - the whole track's.

/** htdemucs' rate. A change to the stem or the picking bumps the version in DRUM_HITS_PREFIX. */
const STEM_RATE = 44100;

export type DrumHitKind = 0 | 1 | 2;
export const DRUM_KICK: DrumHitKind = 0;
export const DRUM_SNARE: DrumHitKind = 1;
export const DRUM_HAT: DrumHitKind = 2;
export interface DrumHits {
    times: Float64Array;
    strengths: Float32Array;
    kinds: Uint8Array;
    /** While the track is still separating: the time (s) the hits reach, none after it known yet. */
    until?: number;
}

/** What one separation leaves behind: the hits, and the stem's and the mix's energy per ENERGY_HOP. */
export interface DrumAnalysis {
    hits: DrumHits;
    drumEnergy: Float32Array;
    mixEnergy: Float32Array;
}

/** The rise window around a frame, at 50 fps - the same as beatAccents.ts. */
const PEAK_BEFORE = 1;
const PEAK_AFTER = 2;
const BASE_FROM = 6;
const BASE_TO = 2;
const HIT_TOP = 0.99;
const HIT_ONSET_FLOOR = 0.15;
const PEAK_HALF = 3;
const MIN_HIT_GAP = 0.09;
const KICK_MAX_HZ = 150;
const SNARE_MAX_HZ = 4000;
const HAT_MIN_HZ = 6000;

/** Energy frames: 10 ms at 44.1 kHz. */
const ENERGY_HOP = 441;
/** The coverage is counted over windows of this many energy frames (0.25 s)... */
const SHARE_WINDOW = 25;
/** ...where the mix is louder than this share of its median window (silence and fades left out)... */
const SHARE_AUDIBLE = 0.05;
/** ...a window having drums when the stem holds at least this share of its energy (about -15 dB). */
const DRUMS_PLAYING_SHARE = 0.03;
/** A track whose drums play in less than this share of its audible windows is drumless. */
export const DRUMLESS_COVERAGE = 0.08;

/** A track still separating has hits from this much of its stem on (s); the guard needs a stretch. */
const LIVE_MIN_SECONDS = 10;
/** And they are picked again about this often (ms) while it separates. */
const LIVE_EVERY_MS = 1000;
/**
 * The last frames of the head are left out of a pick: a peak there may be beaten by one just after it
 * (PEAK_HALF, MIN_HIT_GAP), and a rise needs PEAK_AFTER frames past it.
 */
const liveTailFrames = () => PEAK_AFTER + PEAK_HALF + Math.ceil(MIN_HIT_GAP * BEAT_THIS_FPS);

const quantile = (values: number[], q: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};

/** Whether the GPU drum stem can run here: htdemucs_gpu installed and a WebGPU to run it on. */
export const canRunDrumStem = (): boolean =>
    typeof window !== 'undefined'
    && typeof window.electron?.getHtdemucsGpuWeights === 'function'
    && typeof navigator !== 'undefined' && 'gpu' in navigator
    && modelCanRun('htdemucs_gpu');

/** 44.1 kHz mono to the 22.05 kHz beat_this rate, by the browser's own resampler. */
const resample = async (signal: Float32Array): Promise<Float32Array> => {
    const length = Math.ceil(signal.length * BEAT_THIS_SAMPLE_RATE / STEM_RATE);
    const context = new OfflineAudioContext(1, length, BEAT_THIS_SAMPLE_RATE);
    const source = context.createBufferSource();
    const input = context.createBuffer(1, signal.length, STEM_RATE);
    input.copyToChannel(signal as Float32Array<ArrayBuffer>, 0);
    source.buffer = input;
    source.connect(context.destination);
    source.start();
    return (await context.startRendering()).getChannelData(0);
};

/** Per frame, the mean of the drum mel's bands centred in [fromHz, toHz). */
const bandTrack = (mel: MelSpectrogram, fromHz: number, toHz: number): Float32Array => {
    const bands = melBandCentresHz().map((hz, band) => (hz >= fromHz && hz < toHz ? band : -1)).filter(band => band >= 0);
    const out = new Float32Array(mel.frames);
    for (let frame = 0; frame < mel.frames; frame += 1) {
        let sum = 0;
        for (const band of bands) sum += mel.data[frame * MEL_BANDS + band];
        out[frame] = bands.length ? sum / bands.length : 0;
    }
    return out;
};

const riseAt = (track: Float32Array, frame: number): number => {
    let peak = 0;
    for (let at = frame - PEAK_BEFORE; at <= frame + PEAK_AFTER; at += 1) {
        if (at >= 0 && at < track.length) peak = Math.max(peak, track[at]);
    }
    let base = 0;
    let count = 0;
    for (let at = frame - BASE_FROM; at <= frame - BASE_TO; at += 1) {
        if (at >= 0 && at < track.length) { base += track[at]; count += 1; }
    }
    return Math.max(0, peak - (count ? base / count : 0));
};

/** A band's rise per frame as a share of its loud hits, capped at 1. */
const riseShares = (track: Float32Array): Float32Array => {
    const rise = new Float32Array(track.length);
    for (let frame = 0; frame < track.length; frame += 1) rise[frame] = riseAt(track, frame);
    // Sorted as a typed array: picked again every second while a track separates, on the UI thread.
    const loud = rise.filter(value => value > 0).sort();
    const top = (loud.length ? loud[Math.min(loud.length - 1, Math.floor(HIT_TOP * loud.length))] : 0) || 1;
    return rise.map(value => Math.min(1, value / top));
};

/** A drum stem spectrogram's kick, snare and hat bands per frame. */
export const drumBandTracks = (mel: MelSpectrogram): DrumBands => [
    bandTrack(mel, 0, KICK_MAX_HZ),
    bandTrack(mel, KICK_MAX_HZ, SNARE_MAX_HZ),
    bandTrack(mel, HAT_MIN_HZ, Infinity),
];

/** The hits of a drum stem's spectrogram (see the header). */
export const pickDrumHits = (mel: MelSpectrogram): DrumHits => pickBandHits(drumBandTracks(mel), mel.frames);

/** The hits of the first `frames` frames of a drum stem's three bands. */
export const pickBandHits = (tracks: DrumBands, frames: number): DrumHits => {
    const bands = tracks.map(track => riseShares(track.subarray(0, frames)));
    const top = new Float32Array(frames);
    const kindOf = new Uint8Array(frames);
    for (let frame = 0; frame < frames; frame += 1) {
        for (let kind = 0; kind < bands.length; kind += 1) {
            if (bands[kind][frame] > top[frame]) { top[frame] = bands[kind][frame]; kindOf[frame] = kind; }
        }
    }
    const times: number[] = [];
    const strengths: number[] = [];
    const kinds: number[] = [];
    for (let frame = 0; frame < frames; frame += 1) {
        const share = top[frame];
        if (share < HIT_ONSET_FLOOR) continue;
        let peak = true;
        for (let at = Math.max(0, frame - PEAK_HALF); at <= Math.min(frames - 1, frame + PEAK_HALF) && peak; at += 1) {
            if (top[at] > share || (top[at] === share && at < frame)) peak = false;
        }
        if (!peak) continue;
        const time = frame / BEAT_THIS_FPS;
        const last = times.length - 1;
        if (last >= 0 && time - times[last] < MIN_HIT_GAP) {
            if (share > strengths[last]) { times[last] = time; strengths[last] = share; kinds[last] = kindOf[frame]; }
            continue;
        }
        times.push(time);
        strengths.push(share);
        kinds.push(kindOf[frame]);
    }
    return { times: Float64Array.from(times), strengths: Float32Array.from(strengths), kinds: Uint8Array.from(kinds) };
};

export const energyFrames = (signal: Float32Array): Float32Array => {
    const out = new Float32Array(Math.ceil(signal.length / ENERGY_HOP));
    for (let at = 0; at < signal.length; at += 1) out[Math.floor(at / ENERGY_HOP)] += signal[at] * signal[at];
    return out;
};

/**
 * How much of the track the drums play in: of the SHARE_WINDOW windows where the mix is audible, the
 * share whose stem holds DRUMS_PLAYING_SHARE of the energy. 0 for a silent track.
 */
export const drumCoverage = (drumEnergy: Float32Array, mixEnergy: Float32Array): number => {
    const windows: Array<{ drum: number; mix: number }> = [];
    for (let from = 0; from < mixEnergy.length; from += SHARE_WINDOW) {
        let drum = 0;
        let mix = 0;
        for (let at = from; at < Math.min(mixEnergy.length, from + SHARE_WINDOW); at += 1) {
            drum += drumEnergy[at] ?? 0;
            mix += mixEnergy[at];
        }
        windows.push({ drum, mix });
    }
    const floor = quantile(windows.map(window => window.mix), 0.5) * SHARE_AUDIBLE;
    const audible = windows.filter(window => window.mix > floor && window.mix > 0);
    if (!audible.length) return 0;
    return audible.filter(window => window.drum >= DRUMS_PLAYING_SHARE * window.mix).length / audible.length;
};

const isDrumAnalysis = (value: unknown): value is DrumAnalysis => {
    const entry = value as DrumAnalysis | null;
    return Boolean(entry?.hits?.times instanceof Float64Array && entry.hits.strengths instanceof Float32Array
        && entry.hits.kinds instanceof Uint8Array && entry.drumEnergy instanceof Float32Array
        && entry.mixEnergy instanceof Float32Array);
};

/** Per key, the hits 时计 plays, set once a track's analysis is in and it has drums. */
const hitLists = new Map<string, DrumHits>();
const runs = new Map<string, Promise<DrumAnalysis | null>>();
/** Hit lists kept in memory; the analyses themselves are on disk. */
const MAX_TRACKS = 24;

/** The track whose separation may run; any other in flight stops at its next segment. */
let wanted: string | null = null;

/** Names the track the picture plays drum hits for now, or null for none (it was left or closed). */
export const setWantedDrumTrack = (key: string | null): void => {
    wanted = key;
};

/** The drum hits of `key`, or null when the track has none (yet, or drumless). */
export const getDrumHits = (key: string | null): DrumHits | null => (key ? hitLists.get(key) ?? null : null);

const keep = (key: string, hits: DrumHits) => {
    hitLists.delete(key);
    hitLists.set(key, hits);
    while (hitLists.size > MAX_TRACKS) {
        const oldest = hitLists.keys().next().value;
        if (oldest === undefined) break;
        hitLists.delete(oldest);
    }
};

const remember = (key: string, analysis: DrumAnalysis, note: string) => {
    const coverage = drumCoverage(analysis.drumEnergy, analysis.mixEnergy);
    const counted = [0, 0, 0];
    analysis.hits.kinds.forEach((kind) => { counted[kind] += 1; });
    const drumless = coverage < DRUMLESS_COVERAGE;
    console.info(`[DrumHits] ${key}: ${drumless ? 'drumless' : `${analysis.hits.times.length} hits`} | drum coverage ${coverage.toFixed(3)} | kick ${counted[DRUM_KICK]} snare ${counted[DRUM_SNARE]} hat ${counted[DRUM_HAT]} | ${note}`);
    // A track whose head looked drummed may still be judged drumless as a whole: its live hits go.
    if (drumless) hitLists.delete(key);
    else keep(key, analysis.hits);
};

const separateAndRead = async (key: string, bytes: ArrayBuffer): Promise<DrumAnalysis | null> => {
    const started = performance.now();
    const buffer = await decodeAtRate(bytes, STEM_RATE);
    if (!buffer) return null;
    const left = buffer.getChannelData(0);
    const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;
    const mix = new Float32Array(buffer.length);
    for (let at = 0; at < mix.length; at += 1) mix[at] = (left[at] + right[at]) / 2;
    const mixEnergy = energyFrames(mix);
    const drumEnergy = new Float32Array(mixEnergy.length);
    let measured = 0;
    const stream = createDrumBandStream(buffer.length, { resample, mel: melSpectrogramOffThread, bands: drumBandTracks });
    // The hits of the head so far, for 时计 while the rest separates (see the header).
    const pickLive = async (drums: Float32Array, final: number) => {
        for (; measured < final; measured += 1) drumEnergy[Math.floor(measured / ENERGY_HOP)] += drums[measured] * drums[measured];
        await stream.advance(drums, final, false);
        if (wanted !== key) return;
        const windows = Math.floor(final / ENERGY_HOP / SHARE_WINDOW) * SHARE_WINDOW;
        if (drumCoverage(drumEnergy.subarray(0, windows), mixEnergy.subarray(0, windows)) < DRUMLESS_COVERAGE) {
            hitLists.delete(key);
            return;
        }
        const until = Math.max(0, stream.done - liveTailFrames()) / BEAT_THIS_FPS;
        const hits = pickBandHits(stream.bands, stream.done);
        const count = hits.times.findIndex(time => time >= until);
        const head = count < 0 ? hits.times.length : count;
        if (!shown) {
            shown = true;
            console.info(`[DrumHits] ${key}: live hits ${((performance.now() - started) / 1000).toFixed(1)}s in, to ${until.toFixed(1)}s of the track`);
        }
        keep(key, {
            times: hits.times.slice(0, head),
            strengths: hits.strengths.slice(0, head),
            kinds: hits.kinds.slice(0, head),
            until,
        });
    };
    let shown = false;
    let live: Promise<void> | null = null;
    let liveAt = -Infinity;
    let complete = false;
    try {
        const drums = await separateDrumStem(left, right, (_done, _count, stem, final) => {
            if (live || final < LIVE_MIN_SECONDS * STEM_RATE || performance.now() - liveAt < LIVE_EVERY_MS) return;
            liveAt = performance.now();
            live = pickLive(stem, final)
                .catch(error => console.warn(`[DrumHits] ${key}: live hits failed`, error))
                .finally(() => { live = null; });
        }, () => wanted === key);
        await live;
        if (!drums) {
            if (wanted !== key) console.info(`[DrumHits] ${key}: separation stopped, the track was left`);
            return null;
        }
        await stream.advance(drums, drums.length, true);
        const analysis: DrumAnalysis = {
            hits: pickBandHits(stream.bands, stream.frames),
            drumEnergy: energyFrames(drums),
            mixEnergy,
        };
        complete = true;
        remember(key, analysis, `separated in ${((performance.now() - started) / 1000).toFixed(1)}s`);
        await saveToCache(`${DRUM_HITS_PREFIX}${key}`, analysis);
        return analysis;
    } finally {
        // A separation left or failed part way leaves no hits behind: a later play would read them as whole.
        if (!complete && getDrumHits(key)?.until !== undefined) hitLists.delete(key);
    }
};

/**
 * A track's drum analysis: from the cache, joined from a run in flight, or a separation of
 * `readBytes`' bytes now (only when `canRunDrumStem`). Once it is in, `getDrumHits(key)` answers its
 * hits. Null when none can be had now, which is not remembered: a later play may find the bytes.
 * Separates only while `key` is the wanted track (`setWantedDrumTrack`).
 */
export const loadTrackDrumHits = (key: string, readBytes: () => Promise<ArrayBuffer | null>): Promise<DrumAnalysis | null> => {
    const existing = runs.get(key);
    if (existing) return existing;
    const run = (async (): Promise<DrumAnalysis | null> => {
        const stored = await getFromCache<DrumAnalysis>(`${DRUM_HITS_PREFIX}${key}`);
        if (isDrumAnalysis(stored)) {
            remember(key, stored, 'from the cache');
            return stored;
        }
        if (!canRunDrumStem() || wanted !== key) return null;
        const bytes = await readBytes();
        return bytes ? separateAndRead(key, bytes) : null;
    })().catch((error) => {
        console.warn(`[DrumHits] ${key}: failed`, error);
        return null;
    });
    runs.set(key, run);
    // Only the run in flight is kept: an answer lives on in `hitLists` and on disk, a null is retried.
    void run.then(() => {
        if (runs.get(key) === run) runs.delete(key);
    });
    return run;
};
