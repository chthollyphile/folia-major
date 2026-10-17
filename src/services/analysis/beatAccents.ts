import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './beatThis';
import type { PercussiveEnergyFrames } from './beatThisGpu';

// src/services/analysis/beatAccents.ts
// What each beat sounds like, for 智能动感模式: how hard it hits, whether the hit is low, mid or high,
// and how much the beats of the whole track stand out at all. Read off the mel spectrogram the
// Beat This! run already computed, in the same run (analysis/beatGrid.ts), so it costs a few
// milliseconds and no second decode.
//
//   impact      0..1, the rise of the spectrum at the beat against just before it, normalised over
//               the track (p10 -> 0, p90 -> 1, then a gentle curve that lifts the middle), so one
//               huge hit does not flatten the rest
//   low/mid/high  each band's share of that rise (sum 1): measured, not assigned by bar position
//   trackScale  0.45..1, from how much the track's beats rise at all (their median rise); a ballad
//               whose beats barely rise gets less motion. Only ever lowers: the user's strength stays
//               the ceiling.
//   rhythmic    per beat, 0 when its bar has next to no percussive sound - an intro of horns or pads
//               alone - so no beat FX fire there. A bar's percussive share of the energy comes from
//               HPSS on the same spectrogram, run on the GPU with the model (beatThisWgsl/
//               percussive.ts); a bar is off below PERCUSSIVE_GATE of the track's median share. From
//               the demo's method 9 (「无节奏关」), where it took out exactly the horn intro of
//               裏表ラバーズ and kept every bar once the drums come in. Without the energy (the GPU
//               could not run it) every beat is rhythmic, as before the gate.
//
// Idea from Mineradio (GPL-3.0, github.com/XxHuberrr/Mineradio-paused, dj-analyzer.js): give every
// beat a strength and a character instead of firing them all alike. Nothing of its code is used - it
// measures only a 32-178 Hz band and derives the "character" from the beat's index modulo four.

/** Bumped when the measurement changes; a stored list of another version is recomputed. */
export const BEAT_ACCENTS_VERSION = 2;

export interface BeatAccents {
    v: number;
    /** One entry per beat of the grid, in the grid's order. */
    impact: number[];
    low: number[];
    mid: number[];
    high: number[];
    /** 1 when the beat's bar has rhythm, 0 when it is sustained sound only (no beat FX there). */
    rhythmic: number[];
    trackScale: number;
}

const LOW_MAX_HZ = 150;
const MID_MAX_HZ = 2000;
/** The peak window around a beat, in frames (50 fps): one before to two after, covering the snap. */
const PEAK_BEFORE = 1;
const PEAK_AFTER = 2;
/** The baseline it rises from: frames 6..2 before the beat, ~120..40 ms. */
const BASE_FROM = 6;
const BASE_TO = 2;
/** How the three rises add up into one impact; the low end carries most of what is felt as a hit. */
const IMPACT_WEIGHTS = { low: 0.5, mid: 0.3, high: 0.2 } as const;
const NORMALISE_LOW_PERCENTILE = 0.1;
const NORMALISE_HIGH_PERCENTILE = 0.9;
/** Below 1 lifts the middle of the range: most beats of a driving track read as real hits. */
const IMPACT_CURVE = 0.7;
/** Fewer beats than this and no distribution is worth normalising over: every beat is a full one. */
const MIN_BEATS = 8;
export const TRACK_SCALE_MIN = 0.45;
/**
 * Median beat rise (log-mel units) mapped onto TRACK_SCALE_MIN..1. Provisional, to be tuned on a
 * wider set of tracks: the two driving test tracks (裏表ラバーズ, パラジクロロベンゼン) measure
 * 0.57 and 0.38 and take the full scale. A beat / off-beat ratio was tried first and dropped - at
 * 160 BPM with eighth-note drums the off-beats rise as much as the beats (ratio ~1 on both).
 */
const TRACK_SCALE_RISE_LOW = 0.1;
const TRACK_SCALE_RISE_HIGH = 0.35;
/**
 * A bar whose percussive share is under this share of the track's median bar has no rhythm. Measured
 * on the two test tracks: the horn intro of 裏表ラバーズ at 0.10 and 0.31 of the median, every other
 * bar of both tracks at 0.54 or more (the sparse-drum breakdowns of パラジクロロベンゼン ~0.6). The
 * demo's 0.5 sits too close to 0.54 on the mel bands; 0.45 is the middle of the gap.
 */
export const PERCUSSIVE_GATE = 0.45;
/** Fewer bars than this and there is no "usual" share to compare with: every bar is rhythmic. */
const MIN_BARS = 4;
/** Bars without downbeats to go by: groups of this many beats. */
const FALLBACK_BAR_BEATS = 4;

interface BandTracks {
    low: Float32Array;
    mid: Float32Array;
    high: Float32Array;
}

let bandOf: Uint8Array | null = null;

/** Which of low (0) / mid (1) / high (2) each mel band belongs to, by its centre frequency. */
const resolveBandOf = (): Uint8Array => {
    if (bandOf) return bandOf;
    bandOf = Uint8Array.from(melBandCentresHz(), hz => (hz < LOW_MAX_HZ ? 0 : hz < MID_MAX_HZ ? 1 : 2));
    return bandOf;
};

/** Mean log-mel energy of each of the three bands, per frame. */
const splitBands = (mel: MelSpectrogram): BandTracks => {
    const of = resolveBandOf();
    const counts = [0, 0, 0];
    of.forEach((band) => { counts[band] += 1; });
    const tracks: BandTracks = {
        low: new Float32Array(mel.frames),
        mid: new Float32Array(mel.frames),
        high: new Float32Array(mel.frames),
    };
    const rows = [tracks.low, tracks.mid, tracks.high];
    for (let frame = 0; frame < mel.frames; frame += 1) {
        const offset = frame * MEL_BANDS;
        let low = 0;
        let mid = 0;
        let high = 0;
        for (let band = 0; band < MEL_BANDS; band += 1) {
            const value = mel.data[offset + band];
            const which = of[band];
            if (which === 0) low += value;
            else if (which === 1) mid += value;
            else high += value;
        }
        rows[0][frame] = counts[0] ? low / counts[0] : 0;
        rows[1][frame] = counts[1] ? mid / counts[1] : 0;
        rows[2][frame] = counts[2] ? high / counts[2] : 0;
    }
    return tracks;
};

/** How far `track` rises at `frame` above the stretch just before it; 0 when it falls. */
const riseAt = (track: Float32Array, frame: number): number => {
    const last = track.length - 1;
    if (last < 0) return 0;
    let peak = Number.NEGATIVE_INFINITY;
    for (let at = frame - PEAK_BEFORE; at <= frame + PEAK_AFTER; at += 1) {
        peak = Math.max(peak, track[Math.min(last, Math.max(0, at))]);
    }
    let base = 0;
    for (let at = frame - BASE_FROM; at <= frame - BASE_TO; at += 1) base += track[Math.min(last, Math.max(0, at))];
    base /= BASE_FROM - BASE_TO + 1;
    return Math.max(0, peak - base);
};

const percentile = (sorted: readonly number[], p: number): number => {
    if (!sorted.length) return 0;
    const at = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[at];
};

const median = (values: readonly number[]): number => percentile([...values].sort((a, b) => a - b), 0.5);

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** Which beat starts each bar: at the downbeats, else every FALLBACK_BAR_BEATS beats. */
const resolveBarStarts = (beats: readonly number[], downbeats: readonly number[]): number[] => {
    const downbeatSet = new Set(downbeats);
    const starts: number[] = [];
    if (downbeats.length >= 2) {
        beats.forEach((time, index) => {
            if (index === 0 || downbeatSet.has(time)) starts.push(index);
        });
        return starts;
    }
    for (let index = 0; index < beats.length; index += FALLBACK_BAR_BEATS) starts.push(index);
    return starts;
};

/** Each bar's first beat and its percussive share of the energy (0..1), from per-frame energy. */
export const resolveBarPercussiveShares = (
    energy: PercussiveEnergyFrames,
    beats: readonly number[],
    downbeats: readonly number[],
): { starts: number[]; shares: number[] } => {
    const starts = resolveBarStarts(beats, downbeats);
    if (starts.length < MIN_BARS) return { starts, shares: [] };
    const { percussive, total } = energy;
    const stepOf = (time: number) => Math.min(total.length, Math.max(0, Math.floor(time * BEAT_THIS_FPS)));
    const lastGap = beats.length > 1 ? beats[beats.length - 1] - beats[beats.length - 2] : 0.5;
    const shares = starts.map((first, bar) => {
        const from = stepOf(beats[first]);
        const until = bar + 1 < starts.length ? stepOf(beats[starts[bar + 1]]) : stepOf(beats[beats.length - 1] + lastGap);
        let hit = 0;
        let all = 0;
        for (let frame = from; frame < until; frame += 1) {
            hit += percussive[frame];
            all += total[frame];
        }
        return all > 0 ? hit / all : 0;
    });
    return { starts, shares };
};

/**
 * Per beat: 1 when its bar's percussive share reaches PERCUSSIVE_GATE x the median bar's, else 0;
 * all 1 without the energy.
 */
export const resolveRhythmicBeats = (
    energy: PercussiveEnergyFrames | null | undefined,
    beats: readonly number[],
    downbeats: readonly number[],
): number[] => {
    const rhythmic = beats.map(() => 1);
    if (!energy) return rhythmic;
    const { starts, shares } = resolveBarPercussiveShares(energy, beats, downbeats);
    if (!shares.length) return rhythmic;
    const threshold = median(shares) * PERCUSSIVE_GATE;
    starts.forEach((first, bar) => {
        if (shares[bar] >= threshold) return;
        const end = bar + 1 < starts.length ? starts[bar + 1] : beats.length;
        for (let index = first; index < end; index += 1) rhythmic[index] = 0;
    });
    return rhythmic;
};

interface Rise {
    low: number;
    mid: number;
    high: number;
    raw: number;
}

const measure = (tracks: BandTracks, time: number): Rise => {
    const frame = Math.round(time * BEAT_THIS_FPS);
    const low = riseAt(tracks.low, frame);
    const mid = riseAt(tracks.mid, frame);
    const high = riseAt(tracks.high, frame);
    return { low, mid, high, raw: low * IMPACT_WEIGHTS.low + mid * IMPACT_WEIGHTS.mid + high * IMPACT_WEIGHTS.high };
};

/** The track's median beat rise onto TRACK_SCALE_MIN..1. */
export const resolveTrackScale = (medianBeatRise: number): number => {
    if (!(medianBeatRise > 0)) return TRACK_SCALE_MIN;
    const amount = (medianBeatRise - TRACK_SCALE_RISE_LOW) / (TRACK_SCALE_RISE_HIGH - TRACK_SCALE_RISE_LOW);
    return round3(TRACK_SCALE_MIN + (1 - TRACK_SCALE_MIN) * Math.min(1, Math.max(0, amount)));
};

/**
 * The accents of `beats` (seconds, sorted) on the spectrogram they were found on; `downbeats` mark
 * the bars and `energy` (the GPU run's percussive energy) gates them.
 */
export const computeBeatAccents = (
    mel: MelSpectrogram,
    beats: readonly number[],
    downbeats: readonly number[] = [],
    energy: PercussiveEnergyFrames | null = null,
): BeatAccents => {
    const tracks = splitBands(mel);
    const rises = beats.map(time => measure(tracks, time));

    const accents: BeatAccents = {
        v: BEAT_ACCENTS_VERSION,
        impact: [],
        low: [],
        mid: [],
        high: [],
        rhythmic: resolveRhythmicBeats(energy, beats, downbeats),
        trackScale: 1,
    };
    const sortedRaw = rises.map(rise => rise.raw).sort((a, b) => a - b);
    const floor = percentile(sortedRaw, NORMALISE_LOW_PERCENTILE);
    const ceiling = percentile(sortedRaw, NORMALISE_HIGH_PERCENTILE);
    // Too few beats, or all alike: nothing to tell apart, every beat is a full one.
    const flat = beats.length < MIN_BEATS || ceiling - floor < 1e-6;

    rises.forEach((rise) => {
        const linear = Math.min(1, Math.max(0, (rise.raw - floor) / (ceiling - floor)));
        accents.impact.push(flat ? 1 : round3(linear ** IMPACT_CURVE));
        const sum = rise.low + rise.mid + rise.high;
        accents.low.push(sum > 0 ? round3(rise.low / sum) : round3(1 / 3));
        accents.mid.push(sum > 0 ? round3(rise.mid / sum) : round3(1 / 3));
        accents.high.push(sum > 0 ? round3(rise.high / sum) : round3(1 / 3));
    });

    if (beats.length >= MIN_BEATS) accents.trackScale = resolveTrackScale(median(sortedRaw));
    return accents;
};

const isUnitList = (value: unknown, length: number): value is number[] =>
    Array.isArray(value) && value.length === length
    && value.every(entry => typeof entry === 'number' && Number.isFinite(entry) && entry >= 0 && entry <= 1);

/** Whether `value` is a current-version accent list for a grid of `beatCount` beats. */
export const isBeatAccents = (value: unknown, beatCount: number): value is BeatAccents => {
    if (!value || typeof value !== 'object') return false;
    const accents = value as Partial<BeatAccents>;
    return accents.v === BEAT_ACCENTS_VERSION
        && typeof accents.trackScale === 'number'
        && accents.trackScale >= TRACK_SCALE_MIN && accents.trackScale <= 1
        && isUnitList(accents.impact, beatCount)
        && isUnitList(accents.low, beatCount)
        && isUnitList(accents.mid, beatCount)
        && isUnitList(accents.high, beatCount)
        && isUnitList(accents.rhythmic, beatCount);
};
