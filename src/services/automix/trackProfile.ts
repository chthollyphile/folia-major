import { gridFromBeats, type BeatGrid } from './beatThis';
import { YIELD_BUDGET_MS, yieldToUi } from './uiYield';
import {
    estimateDownbeat,
    estimateTempo,
    fft,
    kWeight,
    rmsDb,
    spectralFlux,
    BEATS_PER_BAR,
    LUFS_OFFSET_DB,
    SILENCE_DB,
    TONE_EDGE_HZ,
} from './signalAnalysis';

// src/services/automix/trackProfile.ts
// One pass over a decoded track, producing the couple of hundred bytes a transition needs to know
// about a song it has not played yet. Pure: a mono Float32Array in, a plain object out.
//
// This is the half the live analyser can never do. An AnalyserNode can only describe the track that is
// currently sounding, and the whole problem with a song change is that the interesting track is the one
// that has not started. Everything here - where the silence is, whether the ends are loud or decaying,
// the beat grid, the key - is about the *incoming* song.

/** Bumped whenever the maths changes, so stored profiles from an older build are re-measured. */
export const TRACK_PROFILE_VERSION = 9;

/**
 * What the analysis runs at.
 *
 * Everything measured here lives well under 11kHz, and decodeAudioData resamples to whatever rate
 * the context was created at, so asking for 22.05kHz turns a four-minute track from ~80MB of
 * float samples into ~10MB for free - no second render pass, no resampler of our own.
 */
export const PROFILE_SAMPLE_RATE = 22050;

const FFT_SIZE = 2048;
const HOP = 512;
/** Onsets live below ~5kHz; above it is mostly cymbal wash, which blurs the beat. */
const FLUX_CEILING_HZ = 5000;
/** Chroma from C2 up: below it the bins are too wide to tell one semitone from the next. */
const CHROMA_MIN_HZ = 65;
/** Above this it is mostly harmonics and noise, which flatten the profile. */
const CHROMA_MAX_HZ = 2000;
/** Relative to the track's own loudest frame - a threshold in absolute dBFS would be a guess. */
const SILENCE_BELOW_PEAK_DB = 40;
/** How much of each end the slope is measured over. Long enough to see a fade develop. */
const EDGE_WINDOW_SEC = 10;
/**
 * How much of each end decides whether it is "hot".
 *
 * Deliberately much shorter than the slope window: the question is whether the track is at full
 * level *at the moment it stops*, and averaging that over ten seconds of a twelve-second track
 * compares the edge against itself and answers yes every time.
 */
const HOT_WINDOW_SEC = 1.5;
/** Within this of the track's own average level, an edge counts as being at full level. */
const HOT_EDGE_DB = 6;
/**
 * The band a lead vocal lives in.
 *
 * Bottom end above the kick and the bass fundamental, top end at the edge of speech - the same
 * range a telephone was built around, for the same reason. Everything outside it is mostly other
 * instruments, and including it only makes them louder in the answer.
 */
const VOCAL_LOW_HZ = 300;
const VOCAL_HIGH_HZ = 3400;
/** A voice holds. A centred snare or a stab does not, and this is what tells them apart. */
const VOCAL_MIN_SEC = 0.8;
/** The centre-ness curve is a ratio of two noisy sums; unsmoothed it never holds a threshold. */
const VOCAL_SMOOTH_SEC = 0.5;
/**
 * How far up the track's own range of centre-ness counts as a voice arriving.
 *
 * A fixed ratio would be a guess about mastering width, which varies more than the thing being
 * measured. Halfway between the track's quietest-centred and most-centred moment is a statement
 * about THIS mix and needs no such guess.
 */
const VOCAL_RISE = 0.5;

/**
 * Ceiling for the onset envelope the downbeat is read off.
 *
 * The bar line is marked by the kick drum on essentially all of this music, and the kick is the only
 * thing down here. Including anything above it lets the snare - which marks the BACKbeat, the exact
 * phase we are trying to rule out - vote on where the "one" is.
 */
const DOWNBEAT_CEILING_HZ = 150;
/** How much of each end gets its own key. Long enough to be a section, short enough to be an end. */
const ENDPOINT_CHROMA_SEC = 20;
/**
 * How much of the tail is re-measured for its own tempo.
 *
 * Mandarin and Cantonese pop routinely ritardando into the last chorus, and a whole-track average
 * then puts the grid systematically late exactly where a transition needs it. Thirty seconds is
 * three periods of the slowest tempo the estimator will look for, which is its own floor.
 */
const OUTRO_TEMPO_SEC = 30;
/**
 * How far the head's own pulse may sit from the track's before its bar line is thrown away.
 *
 * Not a drift tolerance, and setting it as one would defeat the reading: a song that slows into its
 * last chorus is exactly the case the head pass exists for, so a head that disagrees by a few percent
 * is the answer, not the error. What has to be caught is a head window that locked onto a subdivision
 * instead of the beat, and those land a third or a half away. Ten percent sits in the wide gap between
 * the two, well past any performance and well short of a 4:3.
 */
const HEAD_TEMPO_TOLERANCE = 0.1;
/**
 * Frames whose spectrum is this flat are noise, and noise is not a chord.
 *
 * A kick and a snare are broadband: they pour energy into all twelve chroma bins evenly, dragging every
 * key template's correlation towards the same middling number. Dropping the flattest frames is the
 * cheapest thing that can be done about the low confidences the key estimate reports.
 */
const CHROMA_MAX_FLATNESS = 0.28;

/** Positive remainder. `%` is not it for negatives, and every phase folded here can be one. */
const modulo = (value: number, span: number) => ((value % span) + span) % span;

/** Feature rate for the structural analysis. Sections are tens of seconds; frames are wasted here. */
const NOVELTY_BIN_SEC = 1;
/** Half the checkerboard kernel, in bins. Eight seconds total is about two bars either side. */
const NOVELTY_HALF_KERNEL = 4;
/** How far the kernel is allowed to shrink at the ends. Below a bar either side it is guessing. */
const NOVELTY_MIN_KERNEL = 2;
/** A boundary earlier than this is a count-in or a fade-in, not the end of a section. */
const NOVELTY_MIN_SEC = 2;
/** How far above the novelty curve's own mean a peak has to stand to count as a boundary. */
const NOVELTY_SIGMAS = 1;

export interface TrackProfile {
    version: number;
    /**
     * Only the beginning of the file was analysed, so every field about the END of the track is
     * null rather than wrong.
     *
     * What a track looks like when the only bytes we were allowed to read were a range request off the
     * front of it. A tail range cannot be used: strip a file's container header and nothing will decode
     * the rest, so the end of an uncached track is simply not knowable without downloading it.
     */
    partial: boolean;
    /**
     * The beat model was never RUN on this track - not that it ran and found nothing.
     *
     * That distinction is the whole field, and getting it backwards is an infinite loop: a track the
     * model looked at and could not grid (too short, too few beats, an inference error) is settled, and
     * marking it "gridless" would have it re-decoded on every prefetch pass forever.
     *
     * Sibling of `partial` otherwise: a profile that answers everything the caller who asked for it
     * needed and not everything the next caller might. Two ways here - crossfade was selected, which
     * never wants a grid, or this machine had no weights - both worth redoing if that changes. See
     * `needsGrid` in profileService.
     *
     * Absent on every profile written before this field existed, which reads as "unknown" and so as
     * worth redoing once - the right answer, since the weights are a new optional download and most
     * caches out there were built with no model at all.
     */
    gridless?: boolean;
    /** Seconds actually analysed - NOT the track length when `partial`. */
    duration: number;
    /** Seconds of near-silence before the track starts sounding. */
    leadIn: number;
    /**
     * Seconds to the first sustained centre-panned sound in the vocal band - where the singing
     * starts, as far as the audio can tell.
     *
     * Null when the file is mono (nothing to cancel), or when nothing centred ever holds long enough -
     * an instrumental. Deliberately measured rather than read off the lyric timeline: every online
     * lyric source opens with a credit block and the three of them format it three incompatible ways,
     * so "the first line" is not "the first sung moment" in any of them. The audio has no such problem,
     * and it also answers for tracks with no lyric file.
     *
     * Weaker evidence than `sectionStart`, deliberately: a centred pad or lead synth is a voice as far
     * as this measurement is concerned. It is here to CAP the structural answer, never to replace it.
     */
    vocalStart: number | null;
    /**
     * Seconds to the first structural boundary - where the arrangement stops being an intro.
     *
     * Foote novelty over a self-similarity matrix: the standard way a DJ tool or music-structure
     * analyser finds section edges, and what Mixed In Key's mix-in points and Spotify's `sections` are
     * built on. It asks "did the music just become a different thing", answerable without knowing what a
     * voice is - so unlike `vocalStart` it is not fooled by a centred synth.
     *
     * Null when the analysed window is too short to hold the kernel, or nothing in it stands out as a
     * boundary.
     */
    sectionStart: number | null;
    /**
     * Every boundary the novelty curve found, in seconds. `sectionStart` is the first of them.
     *
     * The whole sequence rather than one edge, because "where does the intro end" and "where are
     * the seams in this arrangement" are the same measurement asked twice, and a handover placed on
     * a section edge of the OUTGOING track is the single largest quality lever the literature
     * reports. Empty when the window analysed was too short to hold the kernel.
     */
    sections: number[];
    /** Seconds of near-silence after it stops. Null when only the head was read. */
    leadOut: number | null;
    /**
     * Seconds from where the track stops holding its level to the end of the file - the decaying
     * tail plus whatever silence follows it. Never smaller than `leadOut`. Null with only the head.
     *
     * Kept as a distance from the END rather than an absolute time so it stays true of the file
     * regardless of which of the two durations - the profile's or the media element's - is asked.
     */
    bodyOut: number | null;
    /** The track is already at full level as it starts - no intro to hide a blend in. */
    startsHot: boolean;
    /** It is still at full level when it stops - no decaying tail to blend under. */
    endsHot: boolean | null;
    /** dB per second across the first EDGE_WINDOW_SEC of sound. Positive = building. */
    introSlope: number;
    /** dB per second across the last EDGE_WINDOW_SEC. Negative = fading or decaying out. */
    outroSlope: number | null;
    /** RMS of the sounding part, dBFS. */
    loudness: number;
    /** K-weighted level of the opening EDGE_WINDOW_SEC of sound, LUFS. */
    headDb: number;
    /** The same for the closing window. Null when only the head was read. */
    tailDb: number | null;
    /**
     * Share of the energy in each of the three regions a blend treats separately, over the opening
     * window: [below 250Hz, 250Hz to 4kHz, above 4kHz]. Sums to one.
     *
     * This is what "how bright is this master" reduces to once loudness has been matched, and the
     * step between two of them at a handover is the timbre step that makes an otherwise clean
     * transition sound like two records.
     */
    introTone: number[];
    /** The same for the closing window. Null when only the head was read. */
    outroTone: number[] | null;
    bpm: number | null;
    /**
     * Tempo of the last OUTRO_TEMPO_SEC of the track. Null with only the head, or nothing periodic.
     *
     * A track has one tempo only if nobody slowed down at the end, and a transition only ever cares
     * about the end.
     */
    outroBpm: number | null;
    /** Seconds from the start of the track to a beat of the grid. Meaningless without bpm. */
    beatOffset: number;
    /**
     * Seconds from the start of the track to a DOWNbeat - the first beat of a bar.
     *
     * The beat grid says when the pulses are. It does not say which of them a bar starts on, and a
     * handover on the wrong one of the four is out by a quarter note for its entire length however
     * accurately it was scheduled. Null when there is no grid, or when the low end carries no
     * pattern to read a bar line off.
     */
    downbeatOffset: number | null;
    /**
     * The same bar line, read at the START of the track instead of extrapolated back to it.
     *
     * `downbeatOffset` is anchored on the last beat of the file, where the tempo estimator can see one;
     * the offset near zero is what is left after walking that phase back across the whole song. A period
     * known to a tenth of a percent is half a beat out after five hundred of them, so the whole-track
     * grid is exact where a track is LEFT and worthless where one is ENTERED - and entering is the only
     * thing the incoming side of a transition does.
     *
     * Null when the head carries no readable bar line, or its pulse disagrees with the track's: two
     * different tempos are two different grids, and this field only exists to give the existing one a
     * better phase.
     */
    headDownbeatOffset: number | null;
    /** Beats to the bar. Four; stated rather than assumed silently in three different files. */
    beatsPerBar: number;
    /** Tonic as a pitch class, 0 = C. -1 when nothing correlated well enough. */
    key: number;
    major: boolean;
    /** 0..1, from how far the winning key stands above the runner-up. */
    keyConfidence: number;
    /**
     * The key of the opening and closing windows, measured separately from the whole-track one.
     *
     * Songs change key, and a transition is a statement about two ENDS - how this one finishes
     * against how the next one starts. Averaging the chroma over four minutes to answer a question
     * about twenty seconds is the wrong question, cheaply asked. `outroKey` is null with only the
     * head, like everything else about the end of a file.
     */
    introKey: KeyEstimate;
    outroKey: KeyEstimate | null;
}

/** Krumhansl-Schmuckler key profiles: how much each scale degree is used in major and minor. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const correlate = (a: readonly number[], b: readonly number[]) => {
    const meanA = a.reduce((sum, value) => sum + value, 0) / a.length;
    const meanB = b.reduce((sum, value) => sum + value, 0) / b.length;
    let top = 0;
    let leftSq = 0;
    let rightSq = 0;
    for (let index = 0; index < a.length; index += 1) {
        const left = a[index] - meanA;
        const right = b[index] - meanB;
        top += left * right;
        leftSq += left * left;
        rightSq += right * right;
    }
    return leftSq > 0 && rightSq > 0 ? top / Math.sqrt(leftSq * rightSq) : 0;
};

export interface KeyEstimate {
    key: number;
    major: boolean;
    confidence: number;
}

/**
 * Best-correlating key for a 12-bin chroma vector, and how clearly it won.
 *
 * Correlation against both templates at all twelve rotations is the standard method and is right
 * roughly three times in four on real pop - good enough to *choose between transitions*, which is
 * the only thing the answer is ever used for. It is nowhere near good enough to act on, and the
 * confidence is reported so a caller can decline rather than trust a coin flip.
 */
export const keyFromChroma = (chroma: readonly number[]): KeyEstimate => {
    let best = { key: -1, major: true, score: -Infinity };
    let runnerUp = -Infinity;

    for (let rotation = 0; rotation < 12; rotation += 1) {
        const rotated = chroma.map((_, index) => chroma[(index + rotation) % 12]);
        for (const major of [true, false]) {
            const score = correlate(rotated, major ? MAJOR_PROFILE : MINOR_PROFILE);
            if (score > best.score) {
                runnerUp = best.score;
                best = { key: rotation, major, score };
            } else if (score > runnerUp) {
                runnerUp = score;
            }
        }
    }

    if (best.key < 0 || !Number.isFinite(best.score) || best.score <= 0) {
        return { key: -1, major: true, confidence: 0 };
    }
    const margin = Number.isFinite(runnerUp) ? Math.max(0, best.score - runnerUp) : 0;
    return {
        key: best.key,
        major: best.major,
        // Both halves matter: a strong fit that a dozen other keys fit equally well says nothing.
        confidence: Math.min(1, Math.max(0, best.score) * Math.min(1, margin / 0.15)),
    };
};

/** Boxcar smoothing, off a prefix sum. The curve below is a ratio of noisy sums and holds no
 *  threshold raw - a voice reads as a hundred frames straddling it rather than a run above it. */
const smooth = (values: readonly number[], window: number): number[] => {
    const half = Math.max(0, Math.floor(window / 2));
    if (!half) return [...values];
    const prefix = new Float64Array(values.length + 1);
    for (let index = 0; index < values.length; index += 1) prefix[index + 1] = prefix[index] + values[index];
    return values.map((_, index) => {
        const from = Math.max(0, index - half);
        const to = Math.min(values.length, index + half + 1);
        return (prefix[to] - prefix[from]) / (to - from);
    });
};

/**
 * Where a voice first arrives, from a per-frame "how centred is this track right now" curve.
 *
 * The curve is a RATIO - centred energy against total energy in the vocal band - and that is the whole
 * of why it works. Measuring centred energy on its own tracks the track's volume, so a loud
 * instrumental section reads as more centred than a quiet sung one and the answer is whatever the
 * arrangement is doing rather than where the voice is.
 *
 * Thresholded halfway up the track's own range for the same reason the silence floor is relative:
 * mastering width varies more than the thing being measured. The sustain requirement separates a voice
 * from the other things that sit in the middle of a mix - a snare, a stab - there for a frame or two
 * and gone.
 */
const firstSustained = (centre: readonly number[], hopSec: number): number | null => {
    if (!centre.length) return null;
    const curve = smooth(centre, Math.round(VOCAL_SMOOTH_SEC / hopSec));

    let low = Infinity;
    let high = -Infinity;
    for (const value of curve) {
        if (value < low) low = value;
        if (value > high) high = value;
    }
    // A mix whose centre-ness never moves has no arrival in it to find.
    if (!(high - low > 0.02)) return null;

    const threshold = low + (high - low) * VOCAL_RISE;
    const needed = Math.max(1, Math.round(VOCAL_MIN_SEC / hopSec));
    let run = 0;
    for (let index = 0; index < curve.length; index += 1) {
        if (curve[index] <= threshold) {
            run = 0;
            continue;
        }
        run += 1;
        if (run >= needed) return (index - run + 1) * hopSec;
    }
    return null;
};

/**
 * First structural boundary, by Foote novelty over a self-similarity matrix.
 *
 * Every bin is compared with every other (cosine distance between their chroma), making a matrix whose
 * block structure IS the song's structure - a section looks like a bright square, and the corner where
 * one square meets the next is a section change. Sliding a checkerboard kernel down the diagonal scores
 * exactly that corner shape: high where the music before and after are each self-similar but unlike
 * each other.
 *
 * Published by Foote in 2000 and still the standard non-neural method; librosa and msaf ship it. It
 * matters here because it answers a question that can be answered from a finished mix - "did this just
 * become a different piece of music" - rather than "is that a human", which needs a separated stem.
 */
const findBoundaries = (bins: readonly Float64Array[], binSec: number): number[] => {
    const half = NOVELTY_HALF_KERNEL;
    if (bins.length < half * 2 + 3) return [];

    const unit = bins.map(bin => {
        let energy = 0;
        for (const value of bin) energy += value * value;
        const scale = energy > 0 ? 1 / Math.sqrt(energy) : 0;
        return bin.map(value => value * scale);
    });
    const similarity = (a: number, b: number) => {
        let dot = 0;
        for (let index = 0; index < 12; index += 1) dot += unit[a][index] * unit[b][index];
        return dot;
    };

    // Gaussian-tapered checkerboard: +1 on the two on-diagonal quadrants, -1 on the off-diagonal ones,
    // faded at the edges so a boundary is not scored by the far corners of the window.
    //
    // The kernel SHRINKS towards the two ends rather than refusing to score there. Refusing looks safe
    // and is not: with the first scorable bin four seconds in, a track whose intro ends before that does
    // not report "no boundary", it reports its SECOND boundary as its first - so the shortest intros
    // come out as the longest, the one direction this number must never be wrong in.
    //
    // It shrinks symmetrically, because a lopsided window is not a smaller measurement but a different
    // one: with more future than past inside it, the two on-diagonal quadrants outweigh the off-diagonal
    // pair and every edge bin scores high whatever the music is doing. Kept square and divided by its
    // own taper mass, a four-second kernel and a two-second one answer on the same scale and share one
    // threshold.
    const novelty = new Array<number>(bins.length).fill(0);
    const first = NOVELTY_MIN_KERNEL;
    const last = bins.length - 1 - NOVELTY_MIN_KERNEL;
    for (let centre = first; centre <= last; centre += 1) {
        const reach = Math.min(half, centre, bins.length - 1 - centre);
        let score = 0;
        let mass = 0;
        for (let a = -reach; a < reach; a += 1) {
            for (let b = -reach; b < reach; b += 1) {
                const sign = (a < 0) === (b < 0) ? 1 : -1;
                const taper = Math.exp(-(a * a + b * b) / (2 * (half / 2) ** 2));
                score += sign * taper * similarity(centre + a, centre + b);
                mass += taper;
            }
        }
        novelty[centre] = mass > 0 ? score / mass : 0;
    }

    const scored = novelty.slice(half, bins.length - half);
    // Music that never changes scores a flat zero (the kernel's two halves cancel), and a flat
    // curve has no peaks - only floating-point noise, which a sigma test would happily promote.
    if (Math.max(...scored) - Math.min(...scored) < 1e-6) return [];

    const mean = scored.reduce((sum, value) => sum + value, 0) / scored.length;
    const variance = scored.reduce((sum, value) => sum + (value - mean) ** 2, 0) / scored.length;
    const threshold = mean + NOVELTY_SIGMAS * Math.sqrt(variance);

    // Where inside its own bin the peak really sits, from how it leans against its two neighbours.
    //
    // A bin is a whole second and is reported by its LEFT edge, so an unrefined peak is `floor(boundary)`
    // - never late, never right, and short by half a second on average. Not a rounding nicety
    // downstream: the ceiling this number sets is spent by `quantiseToMusic` in whole bars, so a bar
    // that misses by a tenth of a second is not shortened, it is dropped.
    //
    // Three points around a maximum define a parabola, whose vertex is the sub-bin position - the same
    // refinement the tempo estimator uses on its peaks. Clamped to the bin because a near-flat top makes
    // the denominator vanish and the vertex fly off.
    const lean = (index: number) => {
        const left = novelty[index - 1];
        const right = novelty[index + 1];
        const curve = left - 2 * novelty[index] + right;
        if (!(Math.abs(curve) > 1e-12)) return 0;
        return Math.max(-0.5, Math.min(0.5, (left - right) / (2 * curve)));
    };

    // One bin inside the scored range at each end, never on its edge: novelty is zero outside it, and a
    // zero next to a real value wins "is a local maximum" by default. On real tracks that artefact put
    // four songs out of six at exactly the same boundary. With the kernel now reaching the ends,
    // `NOVELTY_MIN_SEC` is what actually sets the floor - which is what it was written to be.
    const earliest = Math.max(first + 1, Math.ceil(NOVELTY_MIN_SEC / binSec));
    const boundaries: number[] = [];
    for (let index = earliest; index < last; index += 1) {
        const isPeak = novelty[index] > novelty[index - 1] && novelty[index] >= novelty[index + 1];
        if (isPeak && novelty[index] > threshold) boundaries.push((index + lean(index)) * binSec);
    }
    return boundaries;
};

/** Least-squares slope of a dB series, per second. */
const slopePerSec = (values: readonly number[], hopSec: number) => {
    const count = values.length;
    if (count < 2) return 0;
    const meanX = (count - 1) / 2;
    const meanY = values.reduce((sum, value) => sum + value, 0) / count;
    let top = 0;
    let bottom = 0;
    for (let index = 0; index < count; index += 1) {
        const dx = index - meanX;
        top += dx * (values[index] - meanY);
        bottom += dx * dx;
    }
    return bottom > 0 ? (top / bottom) / hopSec : 0;
};

/** The half of a profile that is a function of a level envelope and nothing else. */
export interface TrackEdges {
    leadIn: number;
    /** Seconds from the start of the measured span to the end of its last sounding frame. */
    soundingEnd: number;
    /**
     * Seconds to where the track stops HOLDING its level, which is well before it stops sounding.
     *
     * `soundingEnd` is a silence threshold - forty dB under the track's own peak, some thirty dB under
     * the music on a modern master. Everything between the two is the decay: the last chord ringing off,
     * a produced fade-out, reverb. Scheduling a handover backwards from `soundingEnd` therefore runs the
     * whole of it against a track already fifteen to thirty dB down, a crossfade with nothing on one
     * side.
     *
     * Equal to `soundingEnd` on a track that stops at full level - the two questions only come apart
     * where there is a decay to come apart over.
     */
    bodyEnd: number;
    startsHot: boolean;
    endsHot: boolean;
    introSlope: number;
    outroSlope: number;
    loudness: number;
    /**
     * Level of the opening and closing EDGE_WINDOW_SEC of sound, in the same unit as `loudness`.
     *
     * A whole-track average cannot answer the question a song change actually asks: going from a
     * hushed outro into a track that opens on its chorus is a step up, and the reverse is a hole,
     * and both want a longer overlap for the ear to walk across. Two averages of the two ends is
     * the cheapest thing that answers it, and the frames were already being read.
     */
    headDb: number;
    tailDb: number;
}

/**
 * Everything about a track's two ends, from a series of frame levels in dBFS.
 *
 * Split out of the analysis because these same questions get asked of two sources: a decoded file
 * offline, and the deck analyser's own readings as a track plays out. The tail of an uncached track
 * cannot be downloaded - strip a file's header and nothing decodes what is left - but it does not have
 * to be, because those bytes go past the deck to the speakers anyway. Two definitions of "still at full
 * level when it stops" would drift apart the first time either was touched, so there is one.
 *
 * `frameSec` is the length of a single measurement frame, which the file path knows and the live
 * path does not; it only affects where the last sounding frame is considered to end.
 */
export const measureEdges = (
    levels: readonly number[],
    hopSec: number,
    frameSec = 0,
): TrackEdges | null => {
    if (!levels.length || !(hopSec > 0)) return null;

    // Looped rather than spread: a long track has tens of thousands of frames, and Math.max(...)
    // passes every one of them as an argument.
    let peak = SILENCE_DB;
    for (const level of levels) if (level > peak) peak = level;
    // Nothing ever sounded. Every threshold below is relative to the peak, so without this a span
    // of pure digital silence describes itself as a track that is loud from end to end.
    if (peak <= SILENCE_DB) return null;

    const floor = peak - SILENCE_BELOW_PEAK_DB;
    const first = levels.findIndex(level => level > floor);
    let last = -1;
    for (let index = levels.length - 1; index >= 0; index -= 1) {
        if (levels[index] > floor) { last = index; break; }
    }
    if (first < 0 || last < first) return null;

    const sounding = levels.slice(first, last + 1);
    const mean = (values: readonly number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
    const edgeFrames = Math.max(2, Math.round(EDGE_WINDOW_SEC / hopSec));
    const hotFrames = Math.max(2, Math.round(HOT_WINDOW_SEC / hopSec));
    const average = mean(sounding);
    const head = (frames: number) => sounding.slice(0, Math.min(frames, sounding.length));
    const tail = (frames: number) => sounding.slice(Math.max(0, sounding.length - frames));

    // `endsHot` asked at every position rather than only at the last one, walked backwards until it
    // passes. Prefix-summed because this is a sliding mean over tens of thousands of frames, and
    // because one definition of "at full level" for both answers is the point of measuring it here.
    const prefix = new Float64Array(sounding.length + 1);
    for (let index = 0; index < sounding.length; index += 1) {
        prefix[index + 1] = prefix[index] + sounding[index];
    }
    const holdsLevelAt = (endExclusive: number) => {
        const from = Math.max(0, endExclusive - hotFrames);
        return (prefix[endExclusive] - prefix[from]) / (endExclusive - from) > average - HOT_EDGE_DB;
    };
    let body = sounding.length;
    while (body > 1 && !holdsLevelAt(body)) body -= 1;

    let energy = 0;
    let counted = 0;
    for (const level of levels) {
        if (level <= SILENCE_DB) continue;
        energy += 10 ** (level / 10);
        counted += 1;
    }

    // Mean power, not mean dB. Averaging decibels is averaging logarithms, which lets one silent
    // frame drag a window down further than a loud one lifts it.
    const integrated = (values: readonly number[]) => {
        if (!values.length) return SILENCE_DB;
        let sum = 0;
        for (const value of values) sum += 10 ** (value / 10);
        return Math.max(SILENCE_DB, 10 * Math.log10(sum / values.length) + LUFS_OFFSET_DB);
    };

    return {
        leadIn: first * hopSec,
        soundingEnd: last * hopSec + frameSec,
        bodyEnd: Math.max(0, (first + body - 1) * hopSec + frameSec),
        // Averaged over a second or so rather than read off one frame: a single loud transient at
        // the top of a track is a count-in, not a track that starts at full tilt.
        startsHot: mean(head(hotFrames)) > average - HOT_EDGE_DB,
        endsHot: mean(tail(hotFrames)) > average - HOT_EDGE_DB,
        introSlope: slopePerSec(head(edgeFrames), hopSec),
        outroSlope: slopePerSec(tail(edgeFrames), hopSec),
        loudness: counted ? 10 * Math.log10(energy / counted) + LUFS_OFFSET_DB : SILENCE_DB,
        headDb: integrated(head(edgeFrames)),
        tailDb: integrated(tail(edgeFrames)),
    };
};

/**
 * Measures one decoded track.
 *
 * Async because of where it USED to run. A four-minute track is about ten thousand transforms,
 * which is a second or two of work and an obvious stutter if it happens in one block while lyrics
 * are animating - so the scan lets go of the thread every YIELD_BUDGET_MS. It normally runs in a
 * worker now, where `yieldToUi` is a no-op and this is one long synchronous block, but the main
 * thread is still where every environment without workers puts it.
 */
export const analyseTrack = async (
    mono: Float32Array,
    sampleRate: number,
    options: {
        /** Set when these samples are the head of a longer file, so the tail fields must stay null. */
        partial?: boolean;
        /** (L-R)/2, the off-centre half of the mix. Null for a mono file; then no voice is findable. */
        side?: Float32Array | null;
        /**
         * Beats and downbeats from Beat This!, when the model was able to run.
         *
         * Replaces the six grid fields outright rather than correcting them. The autocorrelation and the
         * downbeat vote below stay as the fallback for every environment the model is not in - the
         * browser build, a missing weights file, an inference error - and are still the ONLY answer for
         * those. Two estimates are not blended: a phase is meaningful against the grid it was measured
         * on, and half of one grid with half of another is neither.
         */
        grid?: BeatGrid | null;
        /**
         * The model was not run at all, as opposed to run and unable to answer.
         *
         * Passed in rather than inferred from `grid` being null because only the caller knows
         * which of the two happened, and the profile has to be able to say. See the field.
         */
        gridless?: boolean;
    } = {},
): Promise<TrackProfile | null> => {
    const duration = mono.length / sampleRate;
    if (!(duration > 1) || !(sampleRate > 0)) return null;

    const hopSec = HOP / sampleRate;
    const bins = FFT_SIZE / 2;
    const binHz = sampleRate / FFT_SIZE;
    const fluxBins = Math.max(8, Math.round(FLUX_CEILING_HZ / binHz));
    const lowFluxBins = Math.max(4, Math.round(DOWNBEAT_CEILING_HZ / binHz));
    const toneEdgeBins = TONE_EDGE_HZ.map(hz => Math.min(bins, Math.round(hz / binHz)));
    // Levels only. The weighting is a statement about how loud something SOUNDS, which is the
    // question every level here is asked; chroma, flux and the vocal ratio are asked different
    // questions and are measured off the signal as it is.
    const weighted = kWeight(mono, sampleRate);
    const real = new Float64Array(FFT_SIZE);
    const imag = new Float64Array(FFT_SIZE);
    const spectrum = new Float32Array(bins);
    const previous = new Float32Array(bins);
    const frame = new Float32Array(FFT_SIZE);

    // Hann, precomputed: a rectangular window smears every partial across neighbouring bins, which
    // is fatal for chroma - the leakage from one note lands squarely on its neighbours.
    const window = new Float64Array(FFT_SIZE);
    for (let index = 0; index < FFT_SIZE; index += 1) {
        window[index] = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1));
    }

    // Which pitch class each bin belongs to, or -1 for the bins chroma ignores.
    const binPitchClass = new Int8Array(bins);
    for (let index = 0; index < bins; index += 1) {
        const hz = index * binHz;
        binPitchClass[index] = hz >= CHROMA_MIN_HZ && hz <= CHROMA_MAX_HZ
            ? ((Math.round(12 * Math.log2(hz / 440) + 69) % 12) + 12) % 12
            : -1;
    }
    const chromaBinList: number[] = [];
    for (let index = 0; index < bins; index += 1) if (binPitchClass[index] >= 0) chromaBinList.push(index);
    const magnitudes = new Float64Array(bins);

    // The vocal band, as bin indices. Sums over it are the only thing the side channel is for.
    const side = options.side && options.side.length >= mono.length ? options.side : null;
    const vocalLowBin = Math.max(1, Math.floor(VOCAL_LOW_HZ / binHz));
    const vocalHighBin = Math.min(bins - 1, Math.ceil(VOCAL_HIGH_HZ / binHz));
    const sideReal = new Float64Array(side ? FFT_SIZE : 0);
    const sideImag = new Float64Array(side ? FFT_SIZE : 0);

    const levels: number[] = [];
    const envelope: number[] = [];
    const lowEnvelope: number[] = [];
    const centre: number[] = [];
    const chroma = new Array<number>(12).fill(0);
    const binCount = Math.max(1, Math.ceil(duration / NOVELTY_BIN_SEC));
    // The same chroma again, but kept per second rather than summed over the track. One is the
    // key, the second is the shape the structural analysis compares against itself, and the third
    // is what the two ENDS are in - which is the only part a transition ever asks about.
    const sectionBins: Float64Array[] = Array.from({ length: binCount }, () => new Float64Array(12));
    /** Energy in each of the three regions, per second. Summed over an end, that end's tone. */
    const toneBins: Float64Array[] = Array.from({ length: binCount }, () => new Float64Array(3));
    // The fourth use of the same chroma: this frame's alone, as a share, against the last frame
    // that had any. Its flux is the second evidence for where the bar line is - see
    // `estimateDownbeat`, which is blind to four-on-the-floor without it.
    const frameChroma = new Float64Array(12);
    const previousChroma = new Float64Array(12);
    const chromaEnvelope: number[] = [];
    let frames = 0;
    let yieldBy = performance.now() + YIELD_BUDGET_MS;

    for (let start = 0; start + FFT_SIZE <= mono.length; start += HOP) {
        frame.set(mono.subarray(start, start + FFT_SIZE));
        levels.push(rmsDb(weighted.subarray(start, start + FFT_SIZE)));

        for (let index = 0; index < FFT_SIZE; index += 1) {
            real[index] = frame[index] * window[index];
            imag[index] = 0;
        }
        fft(real, imag);

        const binIndex = Math.min(binCount - 1, Math.floor((start / sampleRate) / NOVELTY_BIN_SEC));
        const sectionBin = sectionBins[binIndex];
        const toneBin = toneBins[binIndex];

        let midBand = 0;
        let peak = 0;
        for (let index = 0; index < bins; index += 1) {
            const magnitude = Math.hypot(real[index], imag[index]);
            magnitudes[index] = magnitude;
            // dB domain, matching the live analyser's input so the same flux maths applies.
            spectrum[index] = magnitude > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(magnitude)) : SILENCE_DB;
            const power = magnitude * magnitude;
            if (index < toneEdgeBins[0]) toneBin[0] += power;
            else if (index < toneEdgeBins[1]) toneBin[1] += power;
            else toneBin[2] += power;
            if (index >= vocalLowBin && index <= vocalHighBin) midBand += power;
            if (binPitchClass[index] >= 0 && magnitude > peak) peak = magnitude;
        }

        // How noise-like this frame is over the chroma range: the geometric mean of the spectrum
        // against its arithmetic mean. One for white noise, near zero for a held chord.
        //
        // Floored 60dB under the frame's own peak first, and that floor is what makes the number mean
        // anything: without it the geometric mean is dominated by the hundreds of essentially empty
        // bins, every frame reads as perfectly tonal, and the test never fires.
        const floor = peak * 1e-3;
        let arithmetic = 0;
        let logSum = 0;
        for (const index of chromaBinList) {
            const magnitude = Math.max(magnitudes[index], floor);
            arithmetic += magnitude;
            logSum += Math.log(magnitude);
        }
        const flatness = arithmetic > 0 && chromaBinList.length
            ? Math.exp(logSum / chromaBinList.length) / (arithmetic / chromaBinList.length)
            : 1;
        // Continuous rather than a cutoff: a chord played over a drum fill still counts, just for
        // less than the same chord over nothing. A cutoff would make the answer depend on which
        // side of one number a snare happened to land.
        const tonality = Math.max(0, 1 - flatness / CHROMA_MAX_FLATNESS);
        frameChroma.fill(0);
        if (tonality > 0) {
            for (const index of chromaBinList) {
                const contribution = magnitudes[index] * tonality;
                chroma[binPitchClass[index]] += contribution;
                sectionBin[binPitchClass[index]] += contribution;
                frameChroma[binPitchClass[index]] += contribution;
            }
        }

        // How much of the harmony CHANGED since the last frame that had any.
        //
        // Normalised to a share of the frame before differencing, which is the whole point: without it
        // this reads the arrangement getting louder, and the loudest moment of a bar is its downbeat
        // only in music where the kick could already have said so. As a share, a chord change reads the
        // same whether it happens in a verse or a chorus.
        //
        // Only rises are counted. A chord change puts energy into pitch classes that were not
        // there; adding the ones that left counts the same event twice.
        let harmonicChange = 0;
        let chromaSum = 0;
        for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) chromaSum += frameChroma[pitchClass];
        if (chromaSum > 0) {
            for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
                const share = frameChroma[pitchClass] / chromaSum;
                harmonicChange += Math.max(0, share - previousChroma[pitchClass]);
                frameChroma[pitchClass] = share;
            }
            // Carried forward only over frames that had harmony in them. A drum fill between two
            // chords is not a chord change, and comparing the chord after it against the fill
            // would report one exactly where fills like to sit - just before the bar line.
            previousChroma.set(frameChroma);
        }

        if (side) {
            for (let index = 0; index < FFT_SIZE; index += 1) {
                sideReal[index] = side[start + index] * window[index];
                sideImag[index] = 0;
            }
            fft(sideReal, sideImag);
            let sideBand = 0;
            for (let index = vocalLowBin; index <= vocalHighBin; index += 1) {
                sideBand += sideReal[index] * sideReal[index] + sideImag[index] * sideImag[index];
            }
            // A RATIO, not the centred energy itself. The energy rises and falls with the whole
            // arrangement, so thresholding it finds the loudest passage rather than the voice;
            // the share of the band that survives cancellation does not care how loud the track is.
            const total = midBand + sideBand;
            centre.push(total > 0 ? midBand / total : 0.5);
        }

        if (frames > 0) {
            envelope.push(spectralFlux(spectrum, previous, fluxBins));
            // The same measurement over the bottom of the spectrum only. That band is the kick
            // drum and nothing else, which is what marks the bar line.
            lowEnvelope.push(spectralFlux(spectrum, previous, lowFluxBins));
            chromaEnvelope.push(harmonicChange);
        }
        previous.set(spectrum);

        frames += 1;
        // Checked every frame: `performance.now()` is tens of nanoseconds against a frame that
        // costs tens of microseconds, so asking is free next to what it is measuring.
        if (performance.now() >= yieldBy) {
            await yieldToUi();
            yieldBy = performance.now() + YIELD_BUDGET_MS;
        }
    }

    const edges = measureEdges(levels, hopSec, FFT_SIZE / sampleRate);
    if (!edges) return null;

    // Null whenever the model did not run, or ran and produced too few beats to fit a grid to -
    // and then every line that reads it falls through to the estimator below, unchanged.
    const measured = options.grid ? gridFromBeats(options.grid, { partial: options.partial }) : null;

    const tempo = estimateTempo(envelope, hopSec);
    // estimateTempo reports the phase relative to the END of the envelope; the grid is wanted from
    // the start of the track, so it is walked back a whole number of periods.
    const lastBeatSec = tempo
        ? (envelope.length - 1 - tempo.beatOffsetHops) * hopSec + FFT_SIZE / (2 * sampleRate)
        : 0;
    const beatOffset = tempo && tempo.periodSec > 0
        ? ((lastBeatSec % tempo.periodSec) + tempo.periodSec) % tempo.periodSec
        : 0;

    const key = keyFromChroma(chroma);

    // Everything about the end of a truncated file describes the truncation, not the music.
    const partial = options.partial === true;

    // Which beat of the bar is the "one". Asked in the envelope's own time base and answered back
    // in the track's, because every consumer of this counts from the start of the file.
    const envelopeStartSec = FFT_SIZE / (2 * sampleRate);
    const barSec = tempo && tempo.periodSec > 0 ? tempo.periodSec * BEATS_PER_BAR : 0;
    // Skipped outright when the model answered: this is the estimate it replaces, it is the most
    // expensive thing in this pass, and running it to throw the answer away is how an analysis
    // budget gets spent on nothing.
    const downbeat = !measured && tempo && barSec > 0
        ? estimateDownbeat(
            lowEnvelope,
            hopSec,
            tempo.periodSec,
            ((beatOffset - envelopeStartSec) % tempo.periodSec + tempo.periodSec) % tempo.periodSec,
            BEATS_PER_BAR,
            chromaEnvelope,
        )
        : null;

    // A second pass over the last half minute only. The same code, a different slice - which is
    // the whole of what "a track has one tempo" was getting wrong.
    const tempoFrames = Math.round(OUTRO_TEMPO_SEC / hopSec);
    const outroTempo = partial || envelope.length <= tempoFrames
        ? null
        : estimateTempo(envelope.slice(-tempoFrames), hopSec);

    // A third pass, at the other end, for the phase alone.
    //
    // The grid above is anchored on the newest beat in the file and everything before it is
    // extrapolation. That is the right end to be exact at for the track being left, and the wrong one
    // for the track being entered: `alignEntry` walks the incoming bar grid forward from the first few
    // seconds, as far from the anchor as it is possible to get. Measuring the head directly turns that
    // walk from five hundred periods into thirty seconds of them.
    //
    // Only the PHASE is taken. The period stays the whole-track one, so the result drops into the
    // `barGrid(bpm, offset)` every consumer already calls without a second tempo entering the system -
    // and a head window whose pulse is not the track's is dropped rather than reconciled, because a
    // phase is only meaningful against the grid it was measured on.
    const headTempo = tempo && envelope.length > tempoFrames
        ? estimateTempo(envelope.slice(0, tempoFrames), hopSec)
        : null;
    // Everything inside the head window is counted in the head's OWN period, including the walk
    // back from the beat it anchors on. Folding its phase with the whole-track period instead would
    // reintroduce the error being removed, half a minute of it, which is most of what there is to
    // lose here.
    const headDownbeat = !measured && tempo && headTempo
        && Math.abs(headTempo.periodSec / tempo.periodSec - 1) <= HEAD_TEMPO_TOLERANCE
        ? estimateDownbeat(
            lowEnvelope.slice(0, tempoFrames),
            hopSec,
            headTempo.periodSec,
            modulo((tempoFrames - 1 - headTempo.beatOffsetHops) * hopSec, headTempo.periodSec),
            BEATS_PER_BAR,
            chromaEnvelope.slice(0, tempoFrames),
        )
        : null;

    // The two ends, in the units they are compared in. Bin indices rather than seconds because the
    // per-second accumulators are what both answers come out of.
    const firstBin = Math.max(0, Math.floor(edges.leadIn / NOVELTY_BIN_SEC));
    const lastBin = Math.min(binCount, Math.ceil(edges.soundingEnd / NOVELTY_BIN_SEC));
    const overBins = (from: number, to: number, read: (bin: number) => void) => {
        for (let index = Math.max(0, from); index < Math.min(binCount, to); index += 1) read(index);
    };
    const chromaOver = (from: number, to: number) => {
        const total = new Array<number>(12).fill(0);
        overBins(from, to, bin => {
            for (let pitchClass = 0; pitchClass < 12; pitchClass += 1) {
                total[pitchClass] += sectionBins[bin][pitchClass];
            }
        });
        return keyFromChroma(total);
    };
    const toneOver = (from: number, to: number) => {
        const total = [0, 0, 0];
        overBins(from, to, bin => {
            for (let band = 0; band < 3; band += 1) total[band] += toneBins[bin][band];
        });
        const all = total[0] + total[1] + total[2];
        // An even split is the honest answer for a window with nothing in it: it says "no tilt",
        // which is what a tone match should do when it cannot see a difference.
        return all > 0 ? total.map(value => value / all) : [1 / 3, 1 / 3, 1 / 3];
    };
    const endpointBins = ENDPOINT_CHROMA_SEC / NOVELTY_BIN_SEC;
    const toneWindow = EDGE_WINDOW_SEC / NOVELTY_BIN_SEC;

    const sections = findBoundaries(sectionBins, NOVELTY_BIN_SEC);

    return {
        version: TRACK_PROFILE_VERSION,
        partial,
        gridless: options.gridless === true,
        duration,
        leadIn: edges.leadIn,
        vocalStart: side ? firstSustained(centre, hopSec) : null,
        sectionStart: sections[0] ?? null,
        sections,
        leadOut: partial ? null : Math.max(0, duration - edges.soundingEnd),
        bodyOut: partial ? null : Math.max(0, duration - edges.bodyEnd),
        startsHot: edges.startsHot,
        endsHot: partial ? null : edges.endsHot,
        introSlope: edges.introSlope,
        outroSlope: partial ? null : edges.outroSlope,
        loudness: edges.loudness,
        headDb: edges.headDb,
        tailDb: partial ? null : edges.tailDb,
        introTone: toneOver(firstBin, firstBin + toneWindow),
        outroTone: partial ? null : toneOver(lastBin - toneWindow, lastBin),
        bpm: measured?.bpm ?? tempo?.bpm ?? null,
        outroBpm: measured ? measured.outroBpm : outroTempo?.bpm ?? null,
        beatOffset: measured?.beatOffset ?? beatOffset,
        downbeatOffset: measured
            ? measured.downbeatOffset
            : downbeat === null ? null : modulo(downbeat + envelopeStartSec, barSec),
        // Folded against the whole-track bar because that is the unit `barGrid` walks in. When the two
        // ends really do run at different tempos the fold can shift the answer by the difference between
        // the two bar lengths - a few hundredths of a second, against a walk of one or two bars.
        // ponytail: good enough at entry range; store the head period too if anything ever needs the
        // head grid further in than that.
        headDownbeatOffset: measured
            ? measured.headDownbeatOffset
            : headDownbeat === null
                ? null
                : modulo(headDownbeat + envelopeStartSec, barSec),
        beatsPerBar: measured?.beatsPerBar ?? BEATS_PER_BAR,
        key: key.key,
        major: key.major,
        keyConfidence: key.confidence,
        introKey: chromaOver(firstBin, firstBin + endpointBins),
        outroKey: partial ? null : chromaOver(lastBin - endpointBins, lastBin),
    };
};
