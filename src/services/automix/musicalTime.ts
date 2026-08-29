import { BEATS_PER_BAR } from './signalAnalysis';

// src/services/automix/musicalTime.ts
// The units music is actually built in - beats, bars, phrases - and the one relationship between
// two tracks that a gain curve can never stand in for: how fast each of them is running.
//
// Everything here is arithmetic on numbers. It sits between the evidence layer, which measures
// tempo, and the two decision files, which both need to reason in bars rather than seconds.

/** A phrase: four bars of four. The span nearly all pop and dance music is written in. */
export const BEATS_PER_PHRASE = BEATS_PER_BAR * 4;

/**
 * How two tempos sit together, in the four grades that lead to four different actions.
 *
 * - `locked`      the two are already the same speed to within a rounding error
 * - `near`        far enough apart to measure, close enough that the stretch does nothing audible
 * - `stretchable` far enough apart to hear, close enough to fix without the fix being the problem
 * - `drifting`    past what a stretch should be asked to do, close enough to still overlap - unbent,
 *                 so the two grids walk apart, which is what shortens the blend
 * - `far`         so far apart that even a short overlap is two rhythms in opposition; cut instead
 *
 * The last two used to be one grade, and collapsing them was a real regression: `far` was answering
 * BOTH "how much may we bend this" and "may these two be overlapped at all", which are different
 * questions with different answers. Lowering the bend limit therefore silently started cutting
 * pairs 11% apart - a difference two tracks can easily be overlapped across, just not beat matched.
 */
export type TempoRelation = 'locked' | 'near' | 'stretchable' | 'drifting' | 'far' | 'unknown';

/** Inside this the two tempos are the same number measured twice. */
const LOCKED_DEVIATION = 0.015;
/**
 * Small enough that the stretch is doing no work worth hearing about, either way.
 *
 * A semitone is 5.946%, and this used to be that number on the grounds that under a semitone the
 * pitch error is inaudible. Pitch is no longer moving at all - the element preserves it - so what
 * the boundary now separates is how long the pair may be held together, not whether a correction is
 * needed.
 */
export const RAW_RATE_LIMIT = 0.0594;
/**
 * Widest the outgoing track may be bent.
 *
 * Two values have been wrong here, in opposite directions, and the reasoning matters more than the
 * number. It was 0.25, where 5:4 lives - and 5:4 and 4:3 are exactly what autocorrelation returns
 * when it locks onto the wrong harmonic of the beat, so the widest bends were disproportionately the
 * pairs where the tempo had been MEASURED WRONG: maximum damage, no benefit. Then it was 0.08,
 * because a turntable's pitch fader stops there - but that is about PITCH, and pitch no longer moves,
 * so carrying the constraint past its justification made 11% differences into hard cuts.
 *
 * What binds now: the stretcher's own texture, clean to about a tenth on a full mix and smeary well
 * before a quarter; and staying clear of the harmonic ratios, the nearest a fifth away. Twelve percent
 * sits inside the first and under the second, applied to a track three seconds from gone with its low
 * end already pulled out from under it - the most forgiving place in the transition to spend an artefact.
 */
const STRETCH_LIMIT = 0.12;
/**
 * Past this two tracks are not overlapped at all.
 *
 * Not the same question as the one above, and conflating them is what made a 0.51 second "blend"
 * out of an 11% tempo difference. Bending asks "can this be corrected"; overlapping asks "can these
 * two be heard at once", and the second tolerates far more, because a bass swap means only one of
 * the two kicks is audible at a time. A quarter is where that stops being true: a four beat overlap
 * at a quarter drifts a full beat, so the two rhythms end in opposition rather than merely
 * unaligned, and no gain curve or band split answers that. `far` routes to a cut, which is the only
 * arrangement in which each track is only ever heard against itself.
 */
const DRIFT_LIMIT = 0.25;

export interface TempoMatch {
    relation: TempoRelation;
    /**
     * Rate the OUTGOING deck should run at to meet the incoming one. 1 when nothing is to be done.
     *
     * The outgoing track is the one that gets bent, a deliberate inversion of what a DJ does. A DJ
     * must not disturb the record the room is dancing to, so they pitch the arriving one. Here the
     * departing track has seconds left and no future to be wrong in, while the arriving one is about
     * to be listened to for three minutes - so anything done to it would have to be walked back, and
     * walking a tempo back under a track that is now alone is the one moment in a transition with
     * nothing to hide behind.
     */
    stretch: number;
    /** Octave-folded incoming/outgoing, for the log. 1.0 when either tempo is unknown. */
    ratio: number;
}

/**
 * Half time and double time are the same tempo.
 *
 * 90 against 180 is not a 100% difference, it is the same pulse counted two ways, and forcing
 * either onto the other would be a two-to-one time stretch to fix a difference nobody can hear.
 * Folding into a factor of root two either side of unity is the standard resolution.
 */
const foldRatio = (ratio: number): number => {
    let folded = ratio;
    while (folded > Math.SQRT2) folded /= 2;
    while (folded < 1 / Math.SQRT2) folded *= 2;
    return folded;
};

export const tempoMatch = (
    fromBpm: number | null | undefined,
    toBpm: number | null | undefined,
): TempoMatch => {
    if (!fromBpm || !toBpm || !(fromBpm > 0) || !(toBpm > 0)) {
        return { relation: 'unknown', stretch: 1, ratio: 1 };
    }
    const ratio = foldRatio(toBpm / fromBpm);
    const deviation = Math.abs(ratio - 1);
    if (deviation < LOCKED_DEVIATION) return { relation: 'locked', stretch: 1, ratio };
    if (deviation <= RAW_RATE_LIMIT) return { relation: 'near', stretch: ratio, ratio };
    if (deviation <= STRETCH_LIMIT) return { relation: 'stretchable', stretch: ratio, ratio };
    // Both of the remaining grades leave the rate alone. What separates them is whether the two are
    // allowed to sound together at all while their grids walk apart.
    if (deviation <= DRIFT_LIMIT) return { relation: 'drifting', stretch: 1, ratio };
    return { relation: 'far', stretch: 1, ratio };
};

/**
 * The tempo of a track's END, or null when its two measurements do not agree about it.
 *
 * A track is measured twice - once whole, once over its last half minute - and the second is
 * preferred, because a song that slows into its final chorus has two tempos and only one is what a
 * transition is laid against. That preference is right; it was being applied without the check that
 * makes it safe.
 *
 * Two measurements of one quantity that disagree do not mean the later is correct - they mean the
 * quantity was not measured. Real logs carry "92 BPM, 123 at the end" and "136 BPM, 86 at the end",
 * a third and a half apart, which no song does: the beat tracker locked onto a 3:2 or 4:3 of the true
 * period in one window and not the other. Taking the tail on faith then bends a track by a third to
 * meet a tempo that was never there.
 *
 * So: agree within a real tempo drift and the tail wins; disagree past that and the answer is null -
 * which routes to the live tap for a grid and to no bend at all, both of which are what "we do not
 * know this track's tempo" should do.
 */
export const settledBpm = (
    whole: number | null | undefined,
    outro: number | null | undefined,
): number | null => {
    const wholeOk = whole && whole > 0 ? whole : null;
    const outroOk = outro && outro > 0 ? outro : null;
    if (!outroOk) return wholeOk;
    if (!wholeOk) return outroOk;
    const folded = foldRatio(outroOk / wholeOk);
    if (Math.abs(folded - 1) > RAW_RATE_LIMIT) return null;
    // Returned in the WHOLE track's octave rather than as measured, and the difference only ever
    // shows up when the two windows counted the same pulse differently - a real log reads "125 BPM,
    // 63 at the end", which `foldRatio` correctly calls one tempo and this function then handed
    // back as a period twice as long as the one everything else in the transition is built on
    // (`beatOffset`, the bar grid, the stem gesture). Downstream that is not a cosmetic difference:
    // `planBlendShape` quantises the overlap to this period, and at double length every candidate
    // missed the snap tolerance, so the blend landed on no beat at all. Measured on 丑, twice, with
    // and without performance mode: same numbers, no `on a beat`, while 烂泥 on the same album
    // snapped fine.
    //
    // `wholeOk * folded` is the tail's tempo expressed in the whole track's counting - identical to
    // `outroOk` whenever the two agree without folding, which is every case but this one.
    return wholeOk * folded;
};

/**
 * How much longer or shorter an overlap wants to be, given how the two tempos sit.
 *
 * Two tracks running at one tempo can be held against each other for a long time - that is what a
 * DJ mix is. Two that are drifting apart cannot: every second of overlap is another fraction of a
 * beat out, so the honest answer to a big difference is less of it.
 */
export const TEMPO_LENGTH_SCALE: Record<TempoRelation, number> = {
    locked: 1.3,
    near: 1.2,
    stretchable: 1.1,
    // The first grade that is NOT put onto one grid, so this is the first one where the length has
    // to pay for the drift instead of the rate paying for it.
    drifting: 0.6,
    far: 0.5,
    unknown: 1,
};

/**
 * Rounds a length to something music is counted in, largest unit that fits.
 *
 * A blend is a musical span, and the spans music has are the phrase, the bar and the beat - in that
 * order of preference, because a four-bar blend lands where the arrangement lands and a 4.8-beat one
 * lands nowhere. Falls back to the raw seconds without a tempo, which is the honest answer when
 * there is no grid to count on.
 */
export const quantiseToMusic = (
    seconds: number,
    beatSec: number | null,
    maxSeconds: number,
): number => {
    if (beatSec === null || !(beatSec > 0)) return Math.min(seconds, maxSeconds);

    const unitFor = (beats: number) => (
        beats >= BEATS_PER_PHRASE ? BEATS_PER_PHRASE : beats >= BEATS_PER_BAR ? BEATS_PER_BAR : 1
    );
    const wanted = seconds / beatSec;
    let unit = unitFor(wanted);
    let beats = Math.round(wanted / unit) * unit;

    // Stepping down rather than clamping: a phrase-length blend trimmed to a ceiling should come
    // out as a shorter whole number of phrases, not as the ceiling itself.
    while (beats * beatSec > maxSeconds && beats > 1) {
        const next = unitFor(beats - unit);
        if (next < unit) unit = next;
        beats = Math.max(1, beats - unit);
    }
    return Math.max(1, beats) * beatSec;
};

export interface Grid {
    /** Seconds from the start of the track to a line of this grid. */
    offset: number;
    /** Seconds between lines. */
    period: number;
}

/** The bar grid of a track, from its beat grid and where its downbeat falls. */
export const barGrid = (
    bpm: number | null | undefined,
    downbeatOffset: number | null | undefined,
    beatsPerBar = BEATS_PER_BAR,
): Grid | null => {
    if (!bpm || !(bpm > 0) || downbeatOffset === null || downbeatOffset === undefined) return null;
    const period = (60 / bpm) * beatsPerBar;
    return { offset: ((downbeatOffset % period) + period) % period, period };
};

/**
 * Moves a moment onto the nearest line of a grid, if there is one close enough to move it to.
 *
 * Tolerance rather than unconditional snapping, and it matters in both directions: a handover
 * dragged half a bar to reach a bar line is no longer the handover that was planned, and one left a
 * twentieth of a beat off a bar line is on it as far as anyone can hear. Returns the input
 * unchanged when there is no grid, which is what "we could not tell where the bars are" should do.
 */
export const snapToGrid = (
    seconds: number,
    grid: Grid | null,
    toleranceSec: number,
): number => {
    if (!grid || !(grid.period > 0) || !(toleranceSec > 0)) return seconds;
    const line = grid.offset + Math.round((seconds - grid.offset) / grid.period) * grid.period;
    return Math.abs(line - seconds) <= toleranceSec && line > 0 ? line : seconds;
};

/**
 * Where the incoming track has to be started from for its bars to line up with the outgoing one's.
 *
 * This is the half of beat matching that a gain curve genuinely cannot do. Two tracks at the same
 * tempo whose bars are a quarter note apart stay a quarter note apart for the whole overlap, however
 * the levels are moved: the only lever is where the second one is started from, and a media element
 * can be seeked. So the entry point is walked forward to whichever bar line of the incoming track
 * puts its downbeat on the outgoing track's downbeat.
 *
 * `earliest` is the entry point everything else already agreed on - past the leading silence, at the
 * planned start - and the answer is never before it: skipping into a track to make the bars agree
 * would delete the beginning of it.
 */
export const alignEntry = (
    earliest: number,
    incoming: Grid | null,
    /** Seconds from the handover to the outgoing track's next bar line. */
    outgoingBarPhase: number | null,
): number => {
    if (!incoming || outgoingBarPhase === null || !(incoming.period > 0)) return earliest;
    // Where the incoming track would have to be so that its own next bar line falls at the same
    // moment as the outgoing track's.
    const barsIn = Math.ceil((earliest - incoming.offset) / incoming.period);
    const line = incoming.offset + Math.max(0, barsIn) * incoming.period;
    const entry = line - outgoingBarPhase;
    return entry >= earliest ? entry : entry + incoming.period;
};
