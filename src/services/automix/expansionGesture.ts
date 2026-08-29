import { curveOf } from './stemGesture';
import type { StemName } from './stems';

// src/services/automix/expansionGesture.ts
// The build-up: the DJ gesture that runs INTO a handover instead of merely arriving at one.
//
// Everything else in automix is aimed at not being noticed. This is the opposite move, and a separate
// mode for that reason - the listener asked to hear the mix. It is not a second transition engine: it
// occupies the bars immediately before the drum swap the existing gesture already plans, and hands
// over to it untouched. The drop is `planStemHandover`'s swap.
//
// Pure, like stemGesture: sample arrays in, sample arrays out, no audio nodes and no clock.
//
// WHY THIS IS RENDERED RATHER THAN PLAYED
//
// The obvious build is: retrigger the drum stem on a grid and ramp its `playbackRate`. Both halves are
// unavailable here. An `AudioBufferSourceNode` is one-shot - `start()` cannot be called twice - so N
// repeats mean N nodes, while `connectStemDeck` deliberately starts all four stems at ONE absolute
// time to keep them sample-aligned. And a rate ramp on a running source decouples buffer time from
// wall time, which every curve in `scheduleStemWindow` assumes is 1:1; the shipped handover would come
// apart rather than gain a build.
//
// Written as samples, none of that exists: a repeat is a loop in an index, a spinback is a negative
// step, and the rise is our own resampling - so it also sounds the same on both builds instead of
// depending on `preservesPitch`, which the element path gets wrong for us (tempoBend.ts). What plays
// is one ordinary source at rate 1.0.

/** Shortest build worth scheduling. Under this it is a dropout, not a gesture. */
const MIN_SPAN_SEC = 0.35;
/** Fade at both ends of every repeat. Two milliseconds - inaudible, and no click at a wrap. */
const EDGE_SEC = 0.002;
/** Rate the reverse tail accelerates to. A hand pulling a record back, not a rewind. */
const SPINBACK_TOP_RATE = 2.6;
/** Share of the reverse tail spent falling to silence, so the drop lands in a hole. */
const SPINBACK_DECAY = 0.35;

/**
 * Shallowest division a build may use, as a fraction of a beat.
 *
 * A HALF beat, the correction a listening report bought. The first version started at a whole beat,
 * which on real transitions came out as "0.89 to 1.18 beats, two or three times" - not a roll, a skip.
 * Two repetitions are too few to read as an effect, so the ear calls "the beat I just heard is here
 * again" a rewind. Reported as 倒带感 / 重播感, arriving BEFORE the rush rather than as part of it,
 * which located it exactly: the top of the build.
 *
 * A DJ roll never repeats a whole beat for the same reason. Below half a beat the repetition is heard
 * as a rate, not a replay.
 */
const SHALLOWEST_DIVISION = 2;

/**
 * The four strengths, and what each one actually changes.
 *
 * `levels` are beat-repeat divisions, starting at SHALLOWEST_DIVISION and doubling: half a beat, a
 * quarter, an eighth. Deepening is what makes a build sound like it is accelerating, far stronger than
 * the rate rise - which is why 25% is one level rather than a shorter version of the same thing, and
 * why 100% is LONGER than 75% rather than deeper. Past an eighth of a beat a roll stops being rhythm
 * and becomes a 30ms buzz, so no strength goes there.
 *
 * `other` joins at 75%: it is the pad and guitar bed, and stuttering it below that reads as a fault,
 * not a build - a chopped pad has no transient for the grid to land on. Bass and vocals never join at
 * any strength - a stuttered bass is mud and a stuttered voice is a glitch, and both staying whole
 * while the drums do the work is the entire difference between this and putting the effect on the master.
 */
const STEPS = [
    { at: 0.25, beats: 2, levels: 1, topRate: 1.02, spinbackBeats: 0 },
    { at: 0.5, beats: 4, levels: 2, topRate: 1.06, spinbackBeats: 0 },
    { at: 0.75, beats: 8, levels: 3, topRate: 1.12, spinbackBeats: 0.5 },
    { at: 1, beats: 12, levels: 3, topRate: 1.2, spinbackBeats: 1 },
] as const;

/** Stems the build takes over. Never bass, never vocals - see STEPS. */
export const expansionStems = (intensity: number): StemName[] => (
    intensity >= 0.75 ? ['drums', 'other'] : ['drums']
);

export interface ExpansionRepeat {
    /** Seconds from the start of the build where this repeat begins. */
    at: number;
    /** How long it sounds for. */
    length: number;
    /** Seconds into the WINDOW where the slice it loops starts. */
    sourceAt: number;
    /** How long that slice is. Read faster than it is long, it wraps - see `renderExpansion`. */
    sourceLength: number;
    /** Read rate. Above one is faster AND higher: real resampling, not a time-stretch. */
    rate: number;
}

export interface ExpansionPlan {
    /** One of the four steps. Never zero - the mode is a switch, so it always does the thing. */
    intensity: number;
    /** Seconds into the window where the build starts. */
    from: number;
    /** Seconds into the window where it ends. The drop is the handover's swap, not a new event. */
    to: number;
    stems: StemName[];
    repeats: ExpansionRepeat[];
    /** Seconds of reverse tail at the end, inside [from, to). Zero below 75%. */
    spinbackSec: number;
    /** How the strength was chosen and what had to give to fit it. Printed, not cosmetic. */
    reason: string;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * What share of the build level `level` of `levels` occupies. Halving, so the first level gets
 * about half the build and the deepest one a fraction of it.
 *
 * Equal shares was the first version and made the build feel rushed - reported as 太快. With three
 * levels over four seconds it spends 1.3s at every division including the fastest, so a third of the
 * gesture is the frantic part with no slow half to be frantic AGAINST. A real build sits in the
 * comfortable division for most of its length and only goes off at the end, which is what halving
 * gives: 4/7, 2/7, 1/7. Same total span - this changes where the time goes, not how much there is.
 */
const levelShare = (level: number, levels: number) =>
    (1 / 2 ** level) / (2 - 1 / 2 ** (levels - 1));

const nearestStep = (intensity: number) => STEPS.reduce(
    (best, candidate) => (
        Math.abs(candidate.at - intensity) < Math.abs(best.at - intensity) ? candidate : best
    ),
    STEPS[0],
);

/**
 * How hard to go, from what the two tracks measure.
 *
 * The question a build answers is "is there anything to land on". A drop into a track that arrives
 * quieter than the one it replaced is the one way this gesture is actively worse than doing nothing,
 * so that is the case that pulls the strength down; everything else pushes it up.
 *
 * It NEVER returns zero, and that is the point. A strength of nothing is the heuristic overruling the
 * switch, which this codebase has paid for once: the stem gesture shipped and ran zero times for a
 * day, invisible because the only thing it printed was its own failures. The measurement picks how
 * hard - the listener already answered whether.
 */
export const chooseExpansionIntensity = (evidence: {
    /** Level of the outgoing track's closing window, LUFS. Null when unmeasured. */
    tailDb?: number | null;
    /** Level of the incoming track's opening window, LUFS. Null when unmeasured. */
    headDb?: number | null;
    /** The incoming track is already at full level as it starts - a real drop to land on. */
    startsHot?: boolean | null;
}): number => {
    const measured = (value: number | null | undefined): value is number =>
        value !== null && value !== undefined && Number.isFinite(value);
    const lift = measured(evidence.tailDb) && measured(evidence.headDb)
        ? evidence.headDb - evidence.tailDb
        : null;

    let score = 0.5;
    if (evidence.startsHot) score += 0.25;
    if (lift !== null) {
        if (lift >= 3) score += 0.25;
        else if (lift <= -3) score -= 0.5;
        else if (lift <= -1) score -= 0.25;
    }
    // Snapped to a step rather than left continuous: the four are distinguishable settings, and a
    // continuum would be four times the tuning surface for a difference nobody can name.
    return nearestStep(clamp(score, 0.25, 1)).at;
};

/**
 * Lays the build out on the outgoing track's own grid, ending exactly at the swap.
 *
 * Ending AT the handover rather than across it is deliberate. The swap is already a six-millisecond
 * changeover between two drum kits - the hardest edge in the gesture - and a build is the one thing
 * that makes an edge like that read as intended rather than as a seam. So this schedules no drop of
 * its own; it arrives at the one that was always there.
 *
 * Returns null only when there is genuinely no room in front of the swap, which the caller must LOG
 * rather than swallow.
 */
export const planExpansion = (
    intensity: number,
    /** Seconds into the window where the drums change hands. */
    swapAt: number,
    /** Bar length of the outgoing track, seconds. Null falls back the way planStemHandover does. */
    barSec: number | null,
    windowSec: number,
    beatsPerBar = 4,
): ExpansionPlan | null => {
    const step = nearestStep(intensity);
    const bar = barSec && barSec > 0 ? barSec : windowSec / 4;
    const beat = bar / Math.max(1, beatsPerBar);

    // What the step asks for, cut down to what is in front of the swap. Shortening the build is
    // always better than moving the drop: the drop is where the music says it is.
    const asked = step.beats * beat;
    const span = Math.min(asked, swapAt);
    if (!Number.isFinite(span) || span < MIN_SPAN_SEC) return null;

    const from = swapAt - span;
    const divisionAt = (level: number) => beat / (SHALLOWEST_DIVISION * 2 ** level);
    // Levels are dropped rather than squeezed when the span was cut. A level narrower than two of
    // its own repeats is a division that never audibly divides.
    let levels = step.levels;
    while (levels > 1 && span * levelShare(levels - 1, levels) < divisionAt(levels - 1) * 2) {
        levels -= 1;
    }

    const repeats: ExpansionRepeat[] = [];
    let levelStart = 0;
    for (let level = 0; level < levels; level += 1) {
        const levelSpan = span * levelShare(level, levels);
        const division = divisionAt(level);
        const count = Math.max(1, Math.round(levelSpan / division));
        const length = levelSpan / count;
        // Where this level's slice is TAKEN FROM, snapped to the beat grid.
        //
        // A beat-repeat loops a fragment that starts on a transient; a fragment that starts in the
        // decay between two hits is a loop of nothing. `levelStart` is a running sum of 4/7, 2/7 and
        // 1/7 of the span, landing on 4.571 and 6.857 beats - measured on the 176 BPM demo, where level
        // two's source slice peaked at 0.000 and level one's at 0.022 against level zero's 0.938.
        // Reported by ear as "very quiet roll", which is what looping silence sounds like next to
        // looping a kick.
        //
        // Introduced by the halving that fixed 太快: equal thirds happened to land on 4 and 8 beats of
        // a twelve-beat span, on the grid by accident, so nothing flagged it as load bearing. The two
        // are independent - halving decides how the TIME is split, this decides where the MATERIAL
        // comes from - so the fix keeps both.
        //
        // Counted back from the swap rather than forward from `from`, because the swap is the end known
        // to sit on a bar line (`planStemHandover` put it there) while `from` is `swap - span` and only
        // lands on a beat when the span was not cut.
        const wanted = from + levelStart;
        const snapped = swapAt - Math.round((swapAt - wanted) / beat) * beat;
        const sourceAt = Math.max(0, Math.min(snapped, swapAt - length));
        for (let i = 0; i < count; i += 1) {
            repeats.push({
                at: levelStart + i * length,
                length,
                // Every repeat in a level loops that level's FIRST slice. That is what a
                // beat-repeat is: the music stops advancing and starts insisting. Reading each
                // repeat from its own position would just be the original audio with edges in it.
                sourceAt,
                sourceLength: length,
                rate: 1,
            });
        }
        levelStart += levelSpan;
    }
    // Spread over the whole build rather than restarted per level, so it keeps climbing through a
    // level boundary instead of resetting at the moment the division doubles.
    const last = Math.max(1, repeats.length - 1);
    for (let i = 0; i < repeats.length; i += 1) {
        repeats[i].rate = 1 + (step.topRate - 1) * (i / last);
    }

    // Never more than a third of the build, so a spinback stays a flourish on the end of a gesture
    // rather than becoming the gesture.
    const spinbackSec = Math.min(step.spinbackBeats * beat, span / 3);
    const shortened = span < asked - 1e-6;

    return {
        intensity: step.at,
        from,
        to: swapAt,
        stems: expansionStems(step.at),
        repeats,
        spinbackSec,
        reason: `${Math.round(step.at * 100)}% build, ${span.toFixed(2)}s`
            + ` (${levels} level${levels === 1 ? '' : 's'}, ${repeats.length} repeats`
            + `${spinbackSec > 0 ? `, ${spinbackSec.toFixed(2)}s spinback` : ''})`
            + `${shortened ? `, shortened from ${asked.toFixed(2)}s to clear the swap` : ''}`,
    };
};

/**
 * Renders the build to samples, reading the outgoing stem it is replacing.
 *
 * `channels` is one stem of the outgoing window, index 0 being the window's first sample. The
 * result has the same channel count and covers exactly [plan.from, plan.to).
 *
 * Reads wrap inside their slice rather than running off the end, which is what makes the rate rise
 * survivable: a repeat sped up 25% consumes 25% more source than its slot holds, so wrapping is the
 * difference between a tighter loop and a click into silence.
 */
export const renderExpansion = (
    channels: readonly Float32Array[],
    plan: ExpansionPlan,
    sampleRate: number,
): Float32Array[] => {
    const total = Math.max(1, Math.round((plan.to - plan.from) * sampleRate));
    const out = channels.map(() => new Float32Array(total));
    const edge = Math.max(1, Math.round(EDGE_SEC * sampleRate));
    const spinFrom = plan.spinbackSec > 0
        ? Math.max(0, total - Math.round(plan.spinbackSec * sampleRate))
        : total;

    for (const repeat of plan.repeats) {
        const start = Math.round(repeat.at * sampleRate);
        // A repeat the spinback has already claimed is not rendered underneath it.
        const stop = Math.min(total, spinFrom, start + Math.round(repeat.length * sampleRate));
        if (stop <= start) continue;
        const sliceAt = Math.round(repeat.sourceAt * sampleRate);
        const sliceLength = Math.max(1, Math.round(repeat.sourceLength * sampleRate));
        const run = stop - start;
        const fade = Math.max(1, Math.min(edge, Math.floor(run / 2)));
        for (let channel = 0; channel < channels.length; channel += 1) {
            const source = channels[channel];
            const target = out[channel];
            for (let i = 0; i < run; i += 1) {
                const phase = (i * repeat.rate) % sliceLength;
                const read = sliceAt + Math.floor(phase);
                const sample = read >= 0 && read < source.length ? source[read] : 0;
                // Faded around the WRAP, not merely at the two ends of the slot. Read faster than it
                // is long, a slice wraps part way through - at rate 1.2 that is 83% in - and the wrap
                // is a jump BACKWARDS in the source. Unfaded it is a hard discontinuity in the middle
                // of every repeat, growing as the rise does - a second thing that can be heard as a
                // rewind on top of the one the divisions used to cause.
                const toWrap = Math.min(phase, sliceLength - phase) / repeat.rate;
                const shape = Math.min(1, toWrap / fade, (run - 1 - i) / fade);
                target[start + i] = sample * Math.max(0, shape);
            }
        }
    }

    if (spinFrom < total) {
        const run = total - spinFrom;
        // Starts where the record was and is dragged backwards at a growing rate, which is the
        // shape of a hand on a platter: slowest at the moment of contact, fastest as it lets go.
        const origin = Math.round(plan.to * sampleRate);
        const decay = Math.max(1, Math.round(run * SPINBACK_DECAY));
        for (let channel = 0; channel < channels.length; channel += 1) {
            const source = channels[channel];
            const target = out[channel];
            let read = origin;
            for (let i = 0; i < run; i += 1) {
                read -= 1 + (SPINBACK_TOP_RATE - 1) * (i / run);
                const at = Math.floor(read);
                const sample = at >= 0 && at < source.length ? source[at] : 0;
                // `run - 1 - i`, so the last sample is exactly zero. Off by one it lands at
                // 1/decay of full scale instead - inaudible as a level and a step as an edge,
                // which is the one thing that would put a click on the drop itself.
                const left = run - 1 - i;
                target[spinFrom + i] = sample * (left < decay ? left / decay : 1);
            }
        }
    }
    return out;
};

/**
 * What the outgoing stems this build has taken over get multiplied by across the window.
 *
 * Zero for the length of the build and one everywhere else, because the rendered buffer is playing
 * that material instead - without it the listener hears the stutter AND the drums it was made from.
 * Multiplied into `outgoingCurves`' result at the call site, exactly where ReplayGain already is, so
 * `stemGesture` stays a function of the handover alone and the shipped gesture is unchanged by a
 * sample everywhere outside [from, to).
 */
export const expansionMask = (windowSec: number, plan: ExpansionPlan): Float32Array =>
    curveOf(windowSec, at => (at >= plan.from && at < plan.to ? 0 : 1));
