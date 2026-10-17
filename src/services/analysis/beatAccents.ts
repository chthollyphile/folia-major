import { BEAT_THIS_FPS, MEL_BANDS, melBandCentresHz, type MelSpectrogram } from './beatThis';
import type { PercussiveEnergyFrames } from './beatThisGpu';

// src/services/analysis/beatAccents.ts
// What each beat sounds like, for 智能动感模式: how hard it hits, whether the hit is low, mid or high,
// and how much the beats of the whole track stand out at all. Read off the mel spectrogram the
// Beat This! run already computed, in the same run (analysis/beatGrid.ts), so it costs a few
// milliseconds and no second decode.
//
//   impact      0..1, how hard the beat lands: its rise (the spectrum at the beat against just before
//               it) and how loud the music around it is (the mean log-mel over ~half a second), each
//               normalised over the track (p10 -> 0, p90 -> 1) and mixed, then a gentle curve that
//               lifts the middle, so one huge hit does not flatten the rest. The rise alone (v2) read
//               a sparse intro, where every hit stands out of silence, as the strongest part of
//               玛丽亚 and its full vocal sections, where hits land on an already loud mix, as weak
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
//               could not run it) every beat is rhythmic, as before the gate. Nor is a track gated whose
//               median bar is under MIN_GATED_SHARE percussive: with no drums at all (雪绒花, 0.10) the
//               share only follows the arrangement, and the gate switched whole phrases off and on.
//               Also 0 through a stretch the model is unsure of (resolveUnsureBeats): 夢灯籠's free piano
//               and voice intro, where it laid an even grid at logit ~3 against ~7 once the band is in,
//               and the FX flashed at nothing.
//   pulse       per beat, 1 when it is a felt beat. Beat This! now and then counts a level below the
//               felt beat. In compound time (6/8, 9/8, 12/8) it counts the eighth notes - 小半 and
//               麦恩莉 came out at 144 and 166 BPM, six a bar - while the music is felt in dotted
//               quarters, every third of them; a slow song can come out at twice its tempo (走马, ~70
//               BPM felt, counted at 143 with bars of 4 and 8; 理想三旬 and 绝对占有 相对自由 at 100 and
//               111). Either way the beat FX ran two or three
//               times the felt pace. The model gives no meter, so it is read off the bars: the usual
//               bar is a multiple of the group (3, else 2), and the head of every group stands clearly
//               above the beats either side of it, both in rise and in the model's own confidence (its
//               beat logit) - 小半 0.93 against 0.32 / 0.36 at position 4 and 7.8 against 5.9 / 5.6,
//               走马 0.63 against 0.30 / 0.33 at position 3 and 7.4 against 5.5 / 5.2, where tracks
//               counted right stay under 0.5. An evenly strummed song (理想三旬) rises alike on every
//               eighth, and one with hi-hats and snare on the eighths (夢灯籠, counted at 176 once the
//               band is in, 86 felt) rises more off the beat than on it, so for a pair the logits
//               decide alone. A slow waltz counted in quarters (雪绒花 at 107, 1.29 against 0.38 / 0.52 and
//               6.6 against 5.8 / 5.5) is felt a bar at a time, and so is a fast one (第二圆舞曲 at 187):
//               there the bar is the group. Then only the heads are 1, counted from every
//               downbeat. And wherever the model slips to a finer level for a while - 雪绒花's intro goes
//               between quarters (0.58 s) and eighths (0.30 s) bar by bar - a beat closer than
//               MIN_PULSE_SPACING of the felt beat to the last one kept is dropped too.
//
// Idea from Mineradio (GPL-3.0, github.com/XxHuberrr/Mineradio-paused, dj-analyzer.js): give every
// beat a strength and a character instead of firing them all alike. Nothing of its code is used - it
// measures only a 32-178 Hz band and derives the "character" from the beat's index modulo four.

/** Bumped when the measurement changes; a stored list of another version is recomputed. */
export const BEAT_ACCENTS_VERSION = 10;

export interface BeatAccents {
    v: number;
    /** One entry per beat of the grid, in the grid's order. */
    impact: number[];
    low: number[];
    mid: number[];
    high: number[];
    /** 1 when the beat's bar has rhythm, 0 when it is sustained sound only (no beat FX there). */
    rhythmic: number[];
    /** 1 when the beat is a felt beat, 0 for one the model counted between them (see above). */
    pulse: number[];
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
/** How the three rises add up into one rise; the low end carries most of what is felt as a hit. */
const IMPACT_WEIGHTS = { low: 0.5, mid: 0.3, high: 0.2 } as const;
/** The loudness around a beat: frames either side (50 fps), ~a quarter second each way. */
const LOUDNESS_HALF = 12;
/** The rise's share of the impact; the rest is the loudness around the beat. */
const IMPACT_RISE_SHARE = 0.4;
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
/**
 * The groups a counted beat can be a part of, tried in order: three (compound time, eighth notes to a
 * dotted quarter) before two (a track counted at twice its tempo), so a bar of 6 reads as 6/8 first.
 *   ratio      how much more the head's mean rise must be than the beats either side of it, with the
 *              logits to go by too: 麦恩莉 clears 1.2 at 1.26, 小半 at 2.6; 0 for a pair, whose
 *              logits decide alone (理想三旬 rises alike on every eighth, 夢灯籠 more off the beat)
 *   riseRatio  the same without the logits (a refill whose GPU run failed): the rise alone must then
 *              be clear - 走马 1.9, tracks counted right up to 1.09 at the head of a pair
 *   minBpm     the counted tempo it takes, so what is left is still a beat: 40 BPM felt for three, 45
 *              for two (理想三旬 is counted at 100)
 */
const PULSE_GROUPS = [
    { size: 3, ratio: 1.2, riseRatio: 1.2, minBpm: 120 },
    // 0: the rise is not asked (夢灯籠's head rises 0.83 against 0.93 / 0.94, its logit 1.0 above).
    { size: 2, ratio: 0, riseRatio: 1.5, minBpm: 90 },
] as const;
/**
 * A bar of three counted as the group itself (a waltz felt a bar at a time), its head the downbeat
 * against the beats either side of it. 30 BPM felt at the least: 雪绒花 is counted at 107 (36 felt).
 */
const WHOLE_BAR_GROUP = { size: 3, ratio: 1.2, riseRatio: 1.5, minBpm: 90 } as const;
/**
 * A felt beat closer than this share of the usual felt spacing to the last one kept is dropped:
 * the model slipping to a level below for a stretch, as in 雪绒花's intro (0.30 s among 0.58 s).
 */
const MIN_PULSE_SPACING = 0.7;
/** A track whose median bar is less percussive than this is not rhythm-gated (see `rhythmic`). */
const MIN_GATED_SHARE = 0.15;
/**
 * A felt beat is unsure when the mean logit of the felt beats around it (UNSURE_HALF either side) is
 * under this share of the track's p75 felt-beat logit, and only in a run of UNSURE_RUN or more. Read
 * on the felt beats so a track counted at twice its tempo (走马), whose off-beats are faint, is not
 * cut up. At 0.55 it takes 夢灯籠's intro whole (0-27 s), the quiet openings of パラジクロロベンゼン
 * (0-16 s) and 裏表ラバーズ (0-3 s), and nothing of 走马, 雪绒花, 理想三旬 or the 6/8 tracks.
 */
const UNSURE_SHARE = 0.55;
/**
 * A track this percussive (whole-track share) is driven by its drums, and a stretch of it counted at
 * twice its tempo may really run at that tempo: 夢灯籠 (0.36) is counted at 176 once the band is in,
 * its verse with the off-beats faint (logit 0.53 to 0.57 of the felt beats') and its second half
 * with them nearly as sure (0.63 to 0.92) - the hard-driving part, which halved lost its drive.
 * There every beat is kept again. 理想三旬 (0.23) and 走马 (0.19), strummed, stay halved throughout
 * though their off-beats read 0.7 to 0.85: logits alone cannot tell them from 夢灯籠's chorus.
 */
const DRIVEN_TRACK_SHARE = 0.3;
/** The off-beats' mean logit against the felt beats' around a group, at or above which it runs at the counted tempo. */
const DRIVEN_OFFBEAT_SHARE = 0.6;
/** Groups either side the off-beats' and felt beats' logits are averaged over. */
const DRIVEN_HALF = 8;
const UNSURE_HALF = 4;
const UNSURE_RUN = 8;
/**
 * How far above the beats either side of it the head's median beat logit must be. Measured on small0:
 * 小半 1.9, 麦恩莉 1.1, 走马 1.9, 绝对占有 相对自由 1.6, 理想三旬 1.1, another slow song ~0.8; the
 * third beat of the 4/4 tracks counted right 0.29 to 0.42.
 */
const PULSE_CONFIDENCE_GAP = 0.7;
/** Fewer bars of the usual length than this and the positions are not worth averaging. */
const MIN_PULSE_BARS = 8;
/** Frames either side of a beat its logit peak is looked for in. */
const CONFIDENCE_HALF = 2;

interface BandTracks {
    low: Float32Array;
    mid: Float32Array;
    high: Float32Array;
    /** Mean log-mel over every band. */
    all: Float32Array;
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
        all: new Float32Array(mel.frames),
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
        tracks.all[frame] = (low + mid + high) / MEL_BANDS;
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

/** The mean of `track` over LOUDNESS_HALF frames either side of `frame`. */
const loudnessAt = (track: Float32Array, frame: number): number => {
    const last = track.length - 1;
    if (last < 0) return 0;
    let sum = 0;
    for (let at = frame - LOUDNESS_HALF; at <= frame + LOUDNESS_HALF; at += 1) sum += track[Math.min(last, Math.max(0, at))];
    return sum / (2 * LOUDNESS_HALF + 1);
};

const percentile = (sorted: readonly number[], p: number): number => {
    if (!sorted.length) return 0;
    const at = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
    return sorted[at];
};

/** p10 -> 0 and p90 -> 1 over `sorted`, clamped; null when they are all alike. */
const normaliser = (sorted: readonly number[]): ((value: number) => number) | null => {
    const floor = percentile(sorted, NORMALISE_LOW_PERCENTILE);
    const ceiling = percentile(sorted, NORMALISE_HIGH_PERCENTILE);
    if (!(ceiling - floor > 1e-6)) return null;
    return value => Math.min(1, Math.max(0, (value - floor) / (ceiling - floor)));
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

/** The whole track's percussive share of the energy, null without the energy. */
const resolveTrackPercussiveShare = (energy: PercussiveEnergyFrames | null): number | null => {
    if (!energy) return null;
    let hit = 0;
    let all = 0;
    for (let frame = 0; frame < energy.total.length; frame += 1) {
        hit += energy.percussive[frame];
        all += energy.total[frame];
    }
    return all > 0 ? hit / all : null;
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
    const usual = median(shares);
    if (usual < MIN_GATED_SHARE) return rhythmic;
    const threshold = usual * PERCUSSIVE_GATE;
    starts.forEach((first, bar) => {
        if (shares[bar] >= threshold) return;
        const end = bar + 1 < starts.length ? starts[bar + 1] : beats.length;
        for (let index = first; index < end; index += 1) rhythmic[index] = 0;
    });
    return rhythmic;
};

/**
 * Each beat's beat logit (its peak within CONFIDENCE_HALF frames): how sure the model was that a
 * beat is there. `logits` is the whole track's, one per frame.
 */
export const resolveBeatConfidence = (logits: ArrayLike<number>, beats: readonly number[]): number[] => beats.map((time) => {
    const frame = Math.round(time * BEAT_THIS_FPS);
    let peak = Number.NEGATIVE_INFINITY;
    for (let at = frame - CONFIDENCE_HALF; at <= frame + CONFIDENCE_HALF; at += 1) {
        if (at >= 0 && at < logits.length) peak = Math.max(peak, logits[at]);
    }
    return Number.isFinite(peak) ? round3(peak) : 0;
});

/** How a track's bars read, for `pulse` and for the diagnostic line beatGrid.ts logs per analysis. */
export interface BeatMeter {
    /** Beats per minute as the model counted them (median spacing). */
    bpm: number;
    /** [beats in the bar, how many such bars], most common first. */
    barLengths: [number, number][];
    /** The most common bar length, 0 without two downbeats. */
    usual: number;
    /** Mean rise of each position of the usual bar. */
    byPosition: number[];
    /** Median beat logit of each position of the usual bar; empty without the logits. */
    confidenceByPosition: number[];
    /** Beats per felt beat: 3 in compound time or a waltz felt by the bar, 2 for a track counted at twice its tempo, else 1. */
    group: number;
    /** Beats left silent as the model was unsure of them (resolveUnsureBeats). */
    unsure: number;
    /** Beats put back where a drum-driven track runs at its counted tempo (restoreDrivenBeats). */
    driven: number;
}

/** Each downbeat's beat index. */
const resolveDownbeatStarts = (beats: readonly number[], downbeats: readonly number[]): number[] => {
    const downbeatSet = new Set(downbeats);
    const starts: number[] = [];
    beats.forEach((time, index) => {
        if (downbeatSet.has(time)) starts.push(index);
    });
    return starts;
};

/**
 * Reads the track's bars off each beat's rise (`rises`), the model's downbeats and, when there are
 * any, each beat's logit (`confidence`, resolveBeatConfidence); without them the rise decides alone.
 */
export const readBeatMeter = (
    rises: readonly number[],
    beats: readonly number[],
    downbeats: readonly number[],
    confidence: readonly number[] | null = null,
): BeatMeter => {
    const gaps = beats.slice(1).map((time, index) => time - beats[index]);
    const gap = median(gaps);
    const meter: BeatMeter = {
        bpm: gap > 0 ? Math.round(60 / gap) : 0,
        barLengths: [],
        usual: 0,
        byPosition: [],
        confidenceByPosition: [],
        group: 1,
        unsure: 0,
        driven: 0,
    };
    const starts = resolveDownbeatStarts(beats, downbeats);
    if (starts.length < 2) return meter;
    const counts = new Map<number, number>();
    for (let bar = 0; bar + 1 < starts.length; bar += 1) {
        const length = starts[bar + 1] - starts[bar];
        counts.set(length, (counts.get(length) ?? 0) + 1);
    }
    // Most common first; a tie goes to the length met first, as before the list was kept.
    meter.barLengths = [...counts].sort((a, b) => b[1] - a[1]);
    const [usual, bars] = meter.barLengths[0];
    meter.usual = usual;
    meter.byPosition = Array.from({ length: usual }, () => 0);
    const logits: number[][] = Array.from({ length: usual }, () => []);
    for (let bar = 0; bar + 1 < starts.length; bar += 1) {
        if (starts[bar + 1] - starts[bar] !== usual) continue;
        for (let position = 0; position < usual; position += 1) {
            meter.byPosition[position] += rises[starts[bar] + position] / bars;
            if (confidence) logits[position].push(confidence[starts[bar] + position]);
        }
    }
    if (confidence) meter.confidenceByPosition = logits.map(median);
    if (bars < MIN_PULSE_BARS) return meter;
    const { byPosition, confidenceByPosition } = meter;
    // A head against the beats either side of it, the one before it wrapping round to the bar's last.
    const standsOut = (head: number, needed: number) => {
        const before = (head + usual - 1) % usual;
        const after = (head + 1) % usual;
        if (needed > 0 && !(byPosition[head] > needed * Math.max(byPosition[before], byPosition[after]))) return false;
        return !confidence || confidenceByPosition[head] - Math.max(confidenceByPosition[before], confidenceByPosition[after]) > PULSE_CONFIDENCE_GAP;
    };
    const found = [...PULSE_GROUPS, WHOLE_BAR_GROUP].find(({ size, ratio, riseRatio, minBpm }) => {
        if (usual % size !== 0 || meter.bpm < minBpm) return false;
        const needed = confidence ? ratio : riseRatio;
        // A bar of one group: its downbeat is the head; else every head after the downbeat.
        if (usual === size) return standsOut(0, needed);
        for (let head = size; head < usual; head += size) {
            if (!standsOut(head, needed)) return false;
        }
        return true;
    });
    if (found) meter.group = found.size;
    return meter;
};

/** Per beat: 1 for every beat, or for the head of each group when the model counted below the felt beat. */
const resolveGroupHeads = (meter: BeatMeter, beats: readonly number[], downbeats: readonly number[]): number[] => {
    const pulse = beats.map(() => 1);
    const { group } = meter;
    if (group === 1) return pulse;
    const starts = resolveDownbeatStarts(beats, downbeats);
    // Every bar, whatever its length: the model now and then puts a downbeat a beat or two off (小半
    // has 27 bars of 3, 4 or 5 among its 92 of 6), and keeping all the beats of such a bar ran it at
    // two or three times the pace of its neighbours. Counted from each downbeat, so a misplaced one only
    // shifts the groups until the next; the beats before the first downbeat count back from it.
    for (let index = 0; index < starts[0]; index += 1) pulse[index] = (starts[0] - index) % group === 0 ? 1 : 0;
    starts.forEach((start, bar) => {
        const end = bar + 1 < starts.length ? starts[bar + 1] : beats.length;
        for (let index = start; index < end; index += 1) pulse[index] = (index - start) % group === 0 ? 1 : 0;
    });
    return pulse;
};

/**
 * Per beat: 1 when it is felt - every beat, or the head of each group when the model counted below
 * the felt beat - and no closer than MIN_PULSE_SPACING of the felt beat to the last one kept.
 */
const resolvePulseFromMeter = (meter: BeatMeter, beats: readonly number[], downbeats: readonly number[]): number[] => {
    const pulse = resolveGroupHeads(meter, beats, downbeats);
    const gap = median(beats.slice(1).map((time, index) => time - beats[index]));
    if (!(gap > 0) || beats.length < MIN_BEATS) return pulse;
    const spacing = MIN_PULSE_SPACING * gap * meter.group;
    const downbeatSet = new Set(downbeats);
    let last = -1;
    beats.forEach((time, index) => {
        if (!pulse[index]) return;
        if (last < 0 || time - beats[last] >= spacing) {
            last = index;
            return;
        }
        // Too close: a downbeat wins over the beat before it (the bar's shake and sparks hang on it).
        if (downbeatSet.has(time) && !downbeatSet.has(beats[last])) {
            pulse[last] = 0;
            last = index;
        } else {
            pulse[index] = 0;
        }
    });
    return pulse;
};

/**
 * Per beat: 1 when it is felt, from each beat's rise (`rises`), the model's downbeats and its logits
 * (`confidence`). All 1 unless the model counted below the felt beat (see `pulse` above); then only
 * the head of each group, counted from every downbeat, is 1.
 */
export const resolvePulseBeats = (
    rises: readonly number[],
    beats: readonly number[],
    downbeats: readonly number[],
    confidence: readonly number[] | null = null,
): number[] => resolvePulseFromMeter(readBeatMeter(rises, beats, downbeats, confidence), beats, downbeats);

/**
 * Per beat: 1 inside a stretch the model is unsure of (see UNSURE_SHARE), read on the felt beats
 * (`pulse`); a beat between two unsure felt beats is unsure too. All 0 without the logits.
 */
export const resolveUnsureBeats = (confidence: readonly number[] | null, pulse: readonly number[]): number[] => {
    const unsure = pulse.map(() => 0);
    if (!confidence) return unsure;
    const felt = pulse.map((_, index) => index).filter(index => pulse[index]);
    if (felt.length < UNSURE_RUN) return unsure;
    const logits = felt.map(index => confidence[index]);
    const sorted = [...logits].sort((a, b) => a - b);
    const floor = UNSURE_SHARE * percentile(sorted, 0.75);
    const low = logits.map((_, at) => {
        const around = logits.slice(Math.max(0, at - UNSURE_HALF), at + UNSURE_HALF + 1);
        return around.reduce((sum, value) => sum + value, 0) / around.length < floor;
    });
    let start = -1;
    for (let at = 0; at <= low.length; at += 1) {
        if (at < low.length && low[at]) {
            if (start < 0) start = at;
            continue;
        }
        if (start >= 0 && at - start >= UNSURE_RUN) {
            for (let index = felt[start]; index <= felt[at - 1]; index += 1) unsure[index] = 1;
        }
        start = -1;
    }
    return unsure;
};

/**
 * In a drum-driven track (`percussiveShare` at least DRIVEN_TRACK_SHARE) halved for being counted at
 * twice its tempo (`group` 2), puts back the beats between felt beats wherever the model is nearly as
 * sure of them (DRIVEN_OFFBEAT_SHARE); returns how many it put back. `pulse` is changed in place.
 * A group in a stretch left silent as unsure (`unsure`) is neither read nor put back: 夢灯籠's free
 * intro, counted at the felt tempo, would otherwise read as driven and bleed into its verse.
 */
export const restoreDrivenBeats = (
    pulse: number[],
    group: number,
    confidence: readonly number[] | null,
    percussiveShare: number | null,
    unsure: readonly number[] = [],
): number => {
    if (group !== 2 || !confidence || percussiveShare === null || percussiveShare < DRIVEN_TRACK_SHARE) return 0;
    const felt = pulse.map((_, index) => index).filter(index => pulse[index]);
    // Per group (a felt beat and the beats up to the next): the mean logit of its felt beat and of the rest.
    const groups = felt.slice(0, -1).map((head, at) => {
        const between: number[] = [];
        for (let index = head + 1; index < felt[at + 1]; index += 1) between.push(index);
        return { head, between };
    }).filter(({ head }) => !unsure[head]);
    const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
    const driven = groups.map((_, at) => {
        const around = groups.slice(Math.max(0, at - DRIVEN_HALF), at + DRIVEN_HALF + 1);
        const offbeats = around.flatMap(entry => entry.between.map(index => confidence[index]));
        if (!offbeats.length) return false;
        const heads = mean(around.map(entry => confidence[entry.head]));
        return heads > 0 && mean(offbeats) >= DRIVEN_OFFBEAT_SHARE * heads;
    });
    let restored = 0;
    groups.forEach(({ between }, at) => {
        if (!driven[at]) return;
        between.forEach((index) => {
            pulse[index] = 1;
            restored += 1;
        });
    });
    return restored;
};

/**
 * One line on how a track's bars read, for the log:
 * 'bpm 143 | bars 4x66 8x21 | usual 4 rise by position .. | logit by position .. | 1 in 2 (255/509)'.
 */
export const formatBeatMeter = (meter: BeatMeter, pulse: readonly number[]): string => {
    const kept = pulse.filter(Boolean).length;
    return `bpm ${meter.bpm} | bars ${meter.barLengths.slice(0, 5).map(([length, count]) => `${length}x${count}`).join(' ') || '-'}`
        + ` | usual ${meter.usual} rise by position ${meter.byPosition.map(value => value.toFixed(2)).join(' ') || '-'}`
        + ` | logit by position ${meter.confidenceByPosition.map(value => value.toFixed(1)).join(' ') || '-'}`
        + ` | ${meter.group === 1 ? 'every beat' : `1 in ${meter.group}`} (${kept}/${pulse.length})`
        + (meter.unsure ? ` | unsure ${meter.unsure}` : '')
        + (meter.driven ? ` | driven ${meter.driven}` : '');
};

interface Rise {
    low: number;
    mid: number;
    high: number;
    raw: number;
    loudness: number;
}

const measure = (tracks: BandTracks, time: number): Rise => {
    const frame = Math.round(time * BEAT_THIS_FPS);
    const low = riseAt(tracks.low, frame);
    const mid = riseAt(tracks.mid, frame);
    const high = riseAt(tracks.high, frame);
    return {
        low,
        mid,
        high,
        raw: low * IMPACT_WEIGHTS.low + mid * IMPACT_WEIGHTS.mid + high * IMPACT_WEIGHTS.high,
        loudness: loudnessAt(tracks.all, frame),
    };
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
    { confidence = null, onMeter }: {
        /** Each beat's logit (resolveBeatConfidence), for `pulse`; without it the rise decides alone. */
        confidence?: readonly number[] | null;
        /** Handed how the bars read, for the log. */
        onMeter?: (meter: BeatMeter, pulse: readonly number[]) => void;
    } = {},
): BeatAccents => {
    const tracks = splitBands(mel);
    const rises = beats.map(time => measure(tracks, time));
    const meter = readBeatMeter(rises.map(entry => entry.raw), beats, downbeats, confidence);

    const accents: BeatAccents = {
        v: BEAT_ACCENTS_VERSION,
        impact: [],
        low: [],
        mid: [],
        high: [],
        rhythmic: resolveRhythmicBeats(energy, beats, downbeats),
        pulse: resolvePulseFromMeter(meter, beats, downbeats),
        trackScale: 1,
    };
    const sortedRaw = rises.map(rise => rise.raw).sort((a, b) => a - b);
    const rise = normaliser(sortedRaw);
    const loudness = normaliser(rises.map(entry => entry.loudness).sort((a, b) => a - b));
    // Too few beats, or all alike: nothing to tell apart, every beat is a full one. A track of one
    // loudness throughout goes by the rise alone, and the other way round.
    const flat = beats.length < MIN_BEATS || (!rise && !loudness);
    const riseShare = !loudness ? 1 : !rise ? 0 : IMPACT_RISE_SHARE;

    rises.forEach((entry) => {
        const mixed = riseShare * (rise ? rise(entry.raw) : 0) + (1 - riseShare) * (loudness ? loudness(entry.loudness) : 0);
        accents.impact.push(flat ? 1 : round3(mixed ** IMPACT_CURVE));
        const { low, mid, high } = entry;
        const sum = low + mid + high;
        accents.low.push(sum > 0 ? round3(low / sum) : round3(1 / 3));
        accents.mid.push(sum > 0 ? round3(mid / sum) : round3(1 / 3));
        accents.high.push(sum > 0 ? round3(high / sum) : round3(1 / 3));
    });

    if (beats.length >= MIN_BEATS) accents.trackScale = resolveTrackScale(median(sortedRaw));
    // Silent where the model is unsure of the beats, on top of the rhythm gate.
    const unsure = resolveUnsureBeats(confidence, accents.pulse);
    unsure.forEach((value, index) => {
        if (value) accents.rhythmic[index] = 0;
    });
    meter.unsure = unsure.filter(Boolean).length;
    // After the unsure read, which goes by the felt beats alone.
    meter.driven = restoreDrivenBeats(accents.pulse, meter.group, confidence, resolveTrackPercussiveShare(energy), unsure);
    onMeter?.(meter, accents.pulse);
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
        && isUnitList(accents.rhythmic, beatCount)
        && isUnitList(accents.pulse, beatCount);
};
