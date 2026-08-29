import { settledBpm, tempoMatch, TEMPO_LENGTH_SCALE, type TempoMatch } from './musicalTime';
import { toneTilt } from './signalAnalysis';
import type { KeyEstimate, TrackProfile } from './trackProfile';

// src/services/automix/transitionChooser.ts
// Which KIND of transition two songs should get, and what that kind turns into on the audio clock.
// Pure - profiles and numbers in, a description of a schedule out.
//
// Why this file exists: with only one transition, every song change was a crossfade and the only
// choice was how long. A crossfade is the right answer for maybe a third of song changes and the
// least wrong for the rest - which is what "it leans on fading too much" describes. Four kinds and a
// chooser is the fix; a better curve is not.
//
// What is deliberately NOT here is a fifth kind that did nothing. Consecutive tracks off a run-
// together album used to get a splice too short to hear, on the grounds that the record already joins
// them - correct about the record, wrong about the switch. On a continuous album it fired on two
// thirds of song changes, so the listener turned blending on and heard none. A heuristic may choose
// HOW two songs are joined; it may not decide the feature does not apply.

export type TransitionStyle =
    /** The incoming track starts at full tilt, so the outgoing one is cut rather than faded. */
    | 'beatCut'
    /** Overlapped, but only one track holds the low end at a time. The default when two overlap. */
    | 'bassSwap'
    /** A long overlap that lifts the incoming track out from under a decaying tail. */
    | 'tailRide'
    /** A plain crossfade. What everything used to be; now only what is left when nothing is known. */
    | 'plainBlend';

export type KeyRelation = 'compatible' | 'adjacent' | 'neutral' | 'clashing' | 'unknown';

/** Below this the key estimate is a coin flip and is treated as no answer at all. */
const MIN_KEY_CONFIDENCE = 0.25;
/** Steeper than this over the last ten seconds is a produced fade-out, not a musical ending. */
const FADE_OUT_SLOPE_DB_PER_SEC = -1.5;
/** A lead-in shorter than this is not an intro, it is the file's own leading silence. */
const INTRO_SILENCE_SEC = 0.3;

/** A cut is not instant either - a step in the waveform is a click on every system. */
export const BEAT_CUT_SEC = 0.04;
/** How much of the outgoing track a cut may occupy, and it is spent: what is not waited is cut. */
export const CUT_LEAD_SEC = 1.5;
/**
 * How much of the incoming track's own beginning may be swallowed while waiting.
 *
 * Waiting is the only way to place a handover, because the incoming deck starts when the media element
 * manages to, not when we ask. Anything waited beyond the incoming track's leading silence comes out
 * of its first notes, and a missing downbeat is far more audible than a handover slightly off the grid
 * - so the budget is tight.
 */
export const HEAD_BUDGET_SEC = 0.05;

/** Length multipliers by how well the two keys sit together. Unknown must not be a penalty. */
const LENGTH_SCALE: Record<KeyRelation, number> = {
    compatible: 1,
    adjacent: 0.85,
    neutral: 0.7,
    clashing: 0.4,
    unknown: 1,
};

/**
 * How far apart the two ends can be in level before the overlap wants stretching to cover it.
 *
 * A hushed outro into a track that opens on its chorus is a step up; the reverse is a hole. Either
 * way the ear wants a ramp rather than an edge, and the only thing a transition has to give it is
 * time. Twelve decibels is about the widest step a real library produces once loudness matching has
 * done its part.
 */
const ENERGY_STEP_CEILING_DB = 12;
/** Longest an energy step alone may make a blend. A ramp, not a different transition. */
const ENERGY_STEP_SCALE = 0.4;

/**
 * How much shorter an overlap gets when the incoming track opens at full level.
 *
 * A track with no intro gives the blend nothing to hide under, so the overlap wants to be brief -
 * but brief is not the same as absent, and this is the number that says so.
 */
const HOT_START_SCALE = 0.6;

/** Longer for a style that wants room, shorter for one that wants none. */
const STYLE_SCALE: Record<TransitionStyle, number> = {
    beatCut: 1,
    bassSwap: 1,
    tailRide: 1.4,
    plainBlend: 1,
};

const usableKey = (estimate: KeyEstimate | null | undefined): KeyEstimate | null => (
    estimate && estimate.key >= 0 && estimate.confidence >= MIN_KEY_CONFIDENCE ? estimate : null
);

/**
 * The key of the END of a track that a transition actually touches.
 *
 * Songs change key, and this only ever asks about twenty seconds of one. A whole-track average is
 * the answer to a different question, and it is used only as the fallback - for a track whose ends
 * were too percussive to read, or one completed from a level history that carries no spectrum at
 * all.
 */
const endKey = (
    profile: TrackProfile | null | undefined,
    which: 'intro' | 'outro',
): KeyEstimate | null => {
    if (!profile) return null;
    const endpoint = which === 'outro' ? profile.outroKey : profile.introKey;
    return usableKey(endpoint) ?? usableKey({
        key: profile.key, major: profile.major, confidence: profile.keyConfidence,
    });
};

/**
 * How two keys sit together, in the grades that change what we do.
 *
 * Used to pick a transition, never to modify one. Bending the outgoing track's pitch onto the incoming
 * one looks obvious and is wrong twice over: it would need a real pitch shift, not a rate change, on a
 * full mix, in the one moment of the transition where an artefact has nothing to hide behind - and it
 * would leave the outgoing track out of tune with the three minutes just heard. A clash is answered by
 * not giving it time, which costs nothing.
 */
export const keyRelation = (
    from: TrackProfile | null | undefined,
    to: TrackProfile | null | undefined,
): KeyRelation => {
    const a = endKey(from, 'outro');
    const b = endKey(to, 'intro');
    if (!a || !b) return 'unknown';

    const interval = ((b.key - a.key) % 12 + 12) % 12;
    if (a.major === b.major) {
        // Same key, or one step either way round the circle of fifths.
        if (interval === 0 || interval === 7 || interval === 5) return 'compatible';
        // Two steps round: one accidental apart. Not a clash, and better than an arbitrary pair.
        if (interval === 2 || interval === 10) return 'adjacent';
    } else if ((a.major && interval === 9) || (!a.major && interval === 3)) {
        // Relative minor / relative major: the same seven notes.
        return 'compatible';
    } else if (interval === 0) {
        // The parallel major and minor - C against C minor. A shared tonic, one note different, and
        // one of the more usable moves on the wheel even though it is not the same scale.
        return 'adjacent';
    }
    // A semitone apart or a tritone apart: the two most dissonant things two mixes can do at once.
    if (interval === 1 || interval === 11 || interval === 6) return 'clashing';
    return 'neutral';
};

export interface StyleChoice {
    style: TransitionStyle;
    relation: KeyRelation;
    /** How the two tempos sit, and what would be done about it. */
    tempo: TempoMatch;
    /** Multiplier the planner applies to its default length. */
    lengthScale: number;
    /**
     * Mid and top correction, in dB, for the incoming deck at the start of the blend.
     *
     * The incoming track arrives wearing the outgoing one's character and returns to its own by the
     * time the two change places. Zero when either tone is unmeasured, which is the honest default.
     */
    tiltDb: [number, number];
    /** The outgoing track is thrown into a delay as it goes, instead of simply stopping. */
    echoThrow: boolean;
    reason: string;
}

/**
 * Picks the kind of transition, most seamless first.
 *
 * Ordered rather than scored: each rule states a condition under which one particular join is
 * clearly right, and the last one is the fallback. A scoring function over the same inputs would
 * be harder to argue with when a transition sounds wrong.
 */
export const chooseTransitionStyle = (input: {
    from: TrackProfile | null;
    to: TrackProfile | null;
}): StyleChoice => {
    const { from, to } = input;
    const relation = keyRelation(from, to);
    // The tail's own tempo where the two measurements of it agree. A track that slows into its last
    // chorus has two tempos and only one is what a transition is laid against; a track whose two
    // readings are a third apart has no measured tempo at all, and `settledBpm` is the difference
    // between those cases. Null lands on `unknown`, which bends nothing.
    const tempo = tempoMatch(settledBpm(from?.bpm, from?.outroBpm), to?.bpm);
    const tilt = toneTilt(from?.outroTone, to?.introTone);

    // How far apart the two ends sit in level, in either direction. Both directions want the same
    // answer - more time - so only the size of the step matters.
    const step = from?.tailDb !== null && from?.tailDb !== undefined && to
        ? Math.min(ENERGY_STEP_CEILING_DB, Math.abs(from.tailDb - to.headDb))
        : 0;
    const energyScale = 1 + (step / ENERGY_STEP_CEILING_DB) * ENERGY_STEP_SCALE;

    const decide = (style: TransitionStyle, reason: string, extraScale = 1): StyleChoice => ({
        style,
        relation,
        tempo,
        // Floored, because these five numbers were each reasoned about ALONE and are applied together.
        // Clashing keys say 0.4, tempos too far apart 0.5, an incoming track at full level 0.6 - each a
        // defensible "make this shorter" - and multiplied they say 0.12, which is not shorter but a
        // hard cut arrived at by arithmetic no one wrote down. The gapless mistake in a different
        // costume: a heuristic may choose HOW two songs join, not decide the feature does not apply. A
        // quarter of a phrase is one bar, the shortest span that still reads as a join not a stop.
        lengthScale: Math.max(0.25, LENGTH_SCALE[relation] * STYLE_SCALE[style] * extraScale
            * TEMPO_LENGTH_SCALE[tempo.relation] * (style === 'beatCut' ? 1 : energyScale)),
        // Nothing to match against on a cut: the two tracks are never both sounding.
        tiltDb: style === 'beatCut' || style === 'plainBlend' ? [0, 0] : tilt,
        // A track that stops at full level has an edge on it either way; a delay is what turns that
        // edge into something that sounds chosen.
        echoThrow: style === 'beatCut' || from?.endsHot === true,
        reason,
    });

    // Every test below reads the tail fields strictly against true/false, never for truthiness:
    // on a partial profile they are null, meaning "not knowable without downloading the file",
    // and treating that as "no" would silently pick the same transition a real "no" picks.

    // Nothing to fade into: the incoming track is at full level from its first bar.
    if (to?.startsHot === true && from?.bpm) {
        // A cut is only worth having if it lands somewhere musical, and landing it means waiting for a
        // beat of the outgoing track - a wait paid for only out of the incoming track's leading
        // silence, because the incoming deck starts when it starts. Without at least a beat of silence
        // to spend, the "cut" is an arbitrary chop a fraction of a second from the end, the feature
        // appearing to do nothing.
        if (to.leadIn >= 60 / from.bpm) {
            return decide('beatCut', 'the next track starts at full level, so this one is cut');
        }
        return decide(
            'bassSwap',
            'the next track starts at full level, so the overlap is kept short',
            HOT_START_SCALE,
        );
    }

    // Two tempos too far apart to be held against each other. Over a four second overlap a quarter of
    // a beat per beat becomes a full beat of drift, so the two rhythms end in opposition rather than
    // merely unaligned - and no gain curve, band split or stretch inside the honest range fixes that.
    // The answer is to not overlap them: cut on a beat, so each track is only heard against itself.
    // Needs a beat of the incoming track's own silence to wait in, like every cut.
    if (tempo.relation === 'far' && from?.bpm && to && to.leadIn >= 60 / from.bpm) {
        return decide('beatCut', `the two tempos are ${Math.round(Math.abs(tempo.ratio - 1) * 100)}% apart, so this one is cut`);
    }

    // A produced fade-out. Fading a fade doubles it; overlap earlier and swap the low end instead.
    if (from?.outroSlope !== null && from?.outroSlope !== undefined
        && from.outroSlope <= FADE_OUT_SLOPE_DB_PER_SEC) {
        return decide('bassSwap', 'this track fades out on its own');
    }

    // A tail that decays rather than stops, and a next track with an intro to rise through it.
    if (from?.endsHot === false && to && (to.leadIn > INTRO_SILENCE_SEC || to.startsHot === false)) {
        return decide('tailRide', 'a decaying tail with an intro to come up underneath it');
    }

    if (from || to) return decide('bassSwap', 'overlapped, with the low end handed over');
    return decide('plainBlend', 'nothing measured about either track');
};

export interface BlendShapeRequest {
    style: TransitionStyle;
    /** Room in the outgoing track this transition has to work in, already clamped to what is left. */
    room: number;
    /** Handover length and position a fading style would use. */
    overlap: number;
    crossover: number;
    /** Seconds to the outgoing track's next beat, and its period. Null without a usable grid. */
    nextBeatIn: number | null;
    periodSec: number | null;
    /** Leading silence on the incoming track, which is what a wait can be spent on for free. */
    incomingLeadIn: number | null;
}

export interface StyledBlend {
    style: TransitionStyle;
    /** Seconds the incoming deck stays silent before the handover starts. */
    hold: number;
    /** Length of the handover itself. */
    overlap: number;
    crossover: number;
    /** The three regions get their own seams rather than sharing one gain curve. */
    shapeBands: boolean;
    /** The outgoing track is filtered out of the way as it goes, not only turned down. */
    sweepOut: boolean;
    /**
     * Fraction of the blend both tracks are held at one level instead of sliding past each other.
     *
     * The one number that decides whether a join reads as a mix or as a fade. See
     * `buildCrossfadeCurves` for why it is a shape and not a length, and why it is free.
     */
    together: number;
}

/**
 * How much of each style is spent with both tracks held, rather than sliding.
 *
 * A crossfade is zero by definition - it is the thing being named. Everything else is a mix, and the
 * differences are how much they trust the other mechanisms:
 *
 * - `bassSwap` trusts the low-end handover most, so it holds longest. Both tracks at equal strength
 *   with one low end between them is the move this style exists to perform, and it cannot be
 *   performed while both are sliding.
 * - `tailRide` holds nearly as long but for the opposite reason: the outgoing track is decaying on
 *   its own, so any level curve we impose is a second fade on top of the first. Holding flat lets the
 *   track's own ending BE the fade, which is what riding a tail means.
 */
const TOGETHER: Record<TransitionStyle, number> = {
    beatCut: 0,
    bassSwap: 0.55,
    tailRide: 0.5,
    plainBlend: 0,
};

/**
 * Turns a chosen style into the schedule that realises it.
 *
 * All four come out as the same three numbers - wait this long, hand over for that long, cross at
 * this point - which is why there is one scheduling path in the session rather than four.
 */
export const shapeBlend = (request: BlendShapeRequest): StyledBlend => {
    const { style, room, overlap, crossover, nextBeatIn, periodSec, incomingLeadIn } = request;

    if (style === 'beatCut') {
        const headBudget = (incomingLeadIn ?? 0) + HEAD_BUDGET_SEC;
        const maxHold = Math.min(room - BEAT_CUT_SEC, headBudget);
        // The latest beat of the outgoing track that fits inside what may be waited out. Usually
        // there is none - the incoming deck rarely starts with a beat to spare - and then the cut
        // simply happens now, which is still a cut and still not a fade.
        const steps = periodSec && nextBeatIn !== null && periodSec > 0
            ? Math.floor((maxHold - nextBeatIn) / periodSec)
            : -1;
        const hold = steps >= 0 ? nextBeatIn! + steps * periodSec! : 0;
        return {
            style,
            hold: Math.max(0, hold),
            overlap: BEAT_CUT_SEC,
            crossover: 0.5,
            shapeBands: false,
            sweepOut: false,
            together: TOGETHER[style],
        };
    }

    return {
        style,
        hold: 0,
        overlap,
        crossover,
        together: TOGETHER[style],
        shapeBands: style !== 'plainBlend',
        // Not on a ride: a decaying tail is already leaving of its own accord, and taking the top
        // off it as well removes the shimmer that is the whole reason to blend underneath one.
        sweepOut: style === 'bassSwap',
    };
};
