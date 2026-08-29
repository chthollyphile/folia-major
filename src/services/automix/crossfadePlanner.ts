import {
    AUTOMIX_MAX_OVERLAP_SEC,
    AUTOMIX_MIN_OVERLAP_SEC,
    ENTRY_MARGIN_SEC,
    endsOf,
    hardCut,
    type TransitionPlan,
    type TransitionTrack,
} from './transitionPlanner';

// src/services/automix/crossfadePlanner.ts
// The plain crossfade: the length the listener asked for, the same shape every time.
//
// Deliberately blind, by design not shortcut. `transitionPlanner` next door decides whether to blend
// at all, which of four joins, how long, and on which beat; this one decides none of that - it always
// blends, always equal-power, always ending where the music does, for as close to the requested
// seconds as the pair affords. Nothing it reads makes two runs of the same pair differ, which is what
// "predictable" has to mean to be worth choosing.
//
// It does read two numbers off an offline profile when one exists - where each file stops being
// digitally silent - and that is fact, not judgement, the same class as `duration`: without it a
// track with eight seconds of master padding would blend the next song into nothing. Everything else
// on the profile (tempo, key, sections, tone, vocal windows) is ignored here on purpose; the other
// mode's job.

/** Slider floor. Below a second a crossfade stops being one; that is the other mode's cut. */
export const CROSSFADE_MIN_SEC = 1;
/**
 * Slider ceiling, shared with automix.
 *
 * The same number for both modes because it is the same physical limit - past it two masters
 * stacked on each other stop reading as one song ending - not a property of either strategy.
 */
export const CROSSFADE_MAX_SEC = AUTOMIX_MAX_OVERLAP_SEC;
/** Where the slider starts. The length the planner already falls back to when nothing points. */
export const CROSSFADE_DEFAULT_SEC = 5;

/** Whole seconds inside the slider's range. The one place a stored or typed value is trusted. */
export const clampCrossfadeSeconds = (seconds: number): number => (
    Number.isFinite(seconds)
        ? Math.min(CROSSFADE_MAX_SEC, Math.max(CROSSFADE_MIN_SEC, Math.round(seconds)))
        : CROSSFADE_DEFAULT_SEC
);

const round = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * Plans one crossfade of the requested length.
 *
 * `seconds` is a MAXIMUM, as the setting is labelled: three ceilings can shorten it, all facts not
 * taste - how much of the outgoing track is still ahead of the playhead, how much of the incoming
 * track exists after its own leading silence, and a quarter of a short track so a two-minute
 * interlude is not half crossfade. Under the floor there is no fade to schedule and the song change
 * happens as it always did.
 */
export const planCrossfade = (
    from: TransitionTrack,
    to: TransitionTrack,
    seconds: number,
    /** Where the outgoing track is now. Everything behind it is history, not room. */
    at = 0,
): TransitionPlan => {
    if (!Number.isFinite(from.duration) || from.duration <= 0) {
        return hardCut('outgoing duration unknown, nothing to schedule a fade against');
    }

    // Trailing digital silence is not part of the song, so not part of the tail a fade lays against.
    // The decay below it is left alone - judging a fade-out "not really the song" is the other mode's job.
    const { sounding: end } = endsOf(from);
    const inStart = Math.max(0, (to.profile?.leadIn ?? 0) - ENTRY_MARGIN_SEC);
    const asked = clampCrossfadeSeconds(seconds);
    const incoming = Number.isFinite(to.duration) ? Math.max(0, to.duration - inStart) : Infinity;
    const room = Math.min(Math.max(0, end - at), incoming, end / 4);
    const overlap = Math.min(asked, room);

    if (overlap < AUTOMIX_MIN_OVERLAP_SEC) {
        return hardCut(`no room to crossfade - ${round(Math.max(0, room))}s available`);
    }

    const capped = overlap < asked - 0.05 ? `, capped from ${asked}s by ${round(room)}s of room` : '';
    const entry = inStart > 0.05 ? `, entering the next track at ${round(inStart)}s` : '';
    return {
        kind: 'fade',
        style: 'plainBlend',
        // These fields state the crossfade as the absence of automix's four moves - no key argument,
        // no tempo bend, no tone match, no echo throw - spelled out rather than defaulted so it can
        // never quietly grow one and stop being the predictable half of this setting.
        relation: 'unknown',
        tempo: 'unknown',
        stretch: 1,
        tiltDb: [0, 0],
        echoThrow: false,
        outStart: round(end - overlap),
        inStart: round(inStart),
        overlap: round(overlap),
        minOverlap: AUTOMIX_MIN_OVERLAP_SEC,
        reason: `crossfade ${round(overlap)}s${capped}${entry}`,
    };
};
