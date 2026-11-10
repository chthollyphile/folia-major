import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './beatThis';
import type { DrumBands } from './drumHitStream';

// src/services/analysis/drumHitPicking.ts
// The drum hits' arithmetic, apart from running anything (split out of drumHits.ts, which separates
// and keeps them): the bands of a drum stem's spectrogram, the hits picked off them, and the energy
// the drumless guard compares.
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
export const ENERGY_HOP = 441;
/** The coverage is counted over windows of this many energy frames (0.25 s)... */
export const SHARE_WINDOW = 25;
/** ...where the mix is louder than this share of its median window (silence and fades left out)... */
const SHARE_AUDIBLE = 0.05;
/** ...a window having drums when the stem holds at least this share of its energy (about -15 dB). */
const DRUMS_PLAYING_SHARE = 0.03;
/** A track whose drums play in less than this share of its audible windows is drumless. */
export const DRUMLESS_COVERAGE = 0.08;

/** A track still separating has hits from this much of its stem on (s); the guard needs a stretch. */
export const LIVE_MIN_SECONDS = 10;
/** And they are picked again about this often (ms) while it separates. */
export const LIVE_EVERY_MS = 1000;
/**
 * The last frames of the head are left out of a pick: a peak there may be beaten by one just after it
 * (PEAK_HALF, MIN_HIT_GAP), and a rise needs PEAK_AFTER frames past it.
 */
export const liveTailFrames = () => PEAK_AFTER + PEAK_HALF + Math.ceil(MIN_HIT_GAP * BEAT_THIS_FPS);

const quantile = (values: number[], q: number): number => {
    if (!values.length) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
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

export const isDrumAnalysis = (value: unknown): value is DrumAnalysis => {
    const entry = value as DrumAnalysis | null;
    return Boolean(entry?.hits?.times instanceof Float64Array && entry.hits.strengths instanceof Float32Array
        && entry.hits.kinds instanceof Uint8Array && entry.drumEnergy instanceof Float32Array
        && entry.mixEnergy instanceof Float32Array);
};
