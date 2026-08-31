// src/services/automix/transitionCue.ts
// Announces to the screen that a transition is happening, and its shape.
//
// A channel rather than a port on `createAutomixSession`: the audience is a decorative overlay far
// from the decks, and threading a port through would re-render App on every song change just to feed
// a component that draws a circle.
//
// Announced, and the one in flight is also recorded. Which of the two is the source of truth is the
// one thing to get right here: **the announcement is a nudge, `active` is the fact**. A renderer
// answers "what should I be drawing" by asking `getActiveTransitionCue`, and subscribes only to know
// when to ask again.
//
// That split is what makes the timing questions go away, and there are several. There are two
// renderers for one blend (the full-screen ring and the now playing card's border), each with its
// own switch. The card comes and goes mid-blend - it lives on the lyrics page and optionally the
// home page, so walking between pages mounts and unmounts it while the transition runs. The ring is
// mounted by its own switch, and the settings page flips that switch and announces a preview from
// two consecutive lines of one click handler, which React does not commit between - so the ring is
// provably not subscribed yet when its own preview goes out. A renderer that treats the
// announcement as the fact draws nothing in every one of those cases; one that asks `active` draws
// correctly in all of them without knowing which case it is in.

export interface TransitionCue {
    /** Wall-clock seconds from the announcement until the blend is over. */
    seconds: number;
    /** Where in those seconds the two tracks change places, 0..1. */
    crossover: number;
    /** Wall-clock seconds per beat of the outgoing track, or null when nothing measured a tempo. */
    periodSec: number | null;
    /**
     * This handover is a plain fade rather than a mix.
     *
     * Marked rather than withheld, because the two audiences want opposite things from it. The
     * animations draw automix at work and must not claim it over a crossfade; the remote window
     * aligns its cover and title to the audio and wants every handover there is, plain ones
     * included. One channel with the fact on it answers both - a channel that stayed silent for
     * plain fades left the remote nothing to align to.
     */
    plain?: true;
    /**
     * Settings-only demonstration, and which of the two drawings asked for it. Never publish this
     * as a real track handoff.
     *
     * Addressed, not merely flagged, because `announceTransition` reaches every renderer at once
     * and a demonstration is owed to exactly one of them - the switch that was just flipped. With
     * only a flag, the other drawing replayed itself every time its neighbour's switch was touched,
     * whenever it happened to be switched on already. That is the two switches behaving as one.
     */
    preview?: TransitionRenderer;
}

/** A blend already under way, as a renderer mounting mid-transition needs to see it. */
export interface ActiveTransitionCue {
    cue: TransitionCue;
    /** Milliseconds since it was announced. Where to start drawing from. */
    elapsedMs: number;
}

/** The two drawings of one blend. Each has its own switch, and so its own preview. */
export type TransitionRenderer = 'ring' | 'card';

type TransitionCueListener = (cue: TransitionCue | null) => void;

const listeners = new Set<TransitionCueListener>();

/** The blend in flight and when it was announced, or null between transitions. */
let active: { cue: TransitionCue; startedAt: number } | null = null;

/** A blend is starting, or - with null - has finished, however it finished. */
export const announceTransition = (cue: TransitionCue | null): void => {
    // A demonstration never speaks over the real thing. `active` is the one answer given to anyone
    // who turns up mid-blend, so a ten-second preview landing on top of a twenty-second mix would
    // hand the next renderer the preview's length and have it draw a clock the audio is not on.
    // The remote window guards the same way for its own reasons - see useElectronPlaybackBridge.
    // Only this direction is blocked: a real handover always replaces a preview.
    if (cue?.preview) {
        const running = getActiveTransitionCue();
        if (running && !running.cue.preview) return;
    }
    active = cue === null ? null : { cue, startedAt: performance.now() };
    listeners.forEach(listener => listener(cue));
};

/**
 * The blend in flight, or null when there is none - including one whose own clock has run out
 * without a settle ever being announced, so a renderer mounting late never picks up a stale cue and
 * draws a finished transition. Pure: callers read it from a render-phase initialiser.
 */
export const getActiveTransitionCue = (): ActiveTransitionCue | null => {
    if (!active) return null;
    const elapsedMs = performance.now() - active.startedAt;
    if (elapsedMs >= active.cue.seconds * 1000) return null;
    return { cue: active.cue, elapsedMs };
};

/**
 * The shortest blend worth drawing.
 *
 * Below this a renderer spends most of its life entering and leaving and the listener gets a flash
 * rather than a picture. Automix's short shapes - the beat cut, the splice - are all well under it,
 * which is the point: those are meant to pass unnoticed, and an animation is the opposite.
 */
export const MIN_DRAWN_SECONDS = 5;

/**
 * Whether a cue is one to draw. Asked by both animations, so they can never disagree about it.
 *
 * Two of the four parts belong to the caller: `switchedOn` is its setting, `renderer` is which of
 * the two drawings it is. The other two are properties of the transition itself - a plain fade is
 * not a mix and nothing on screen should say it is, and a blend too short to watch is a flash
 * rather than a picture.
 *
 * `renderer` is what holds the two switches apart. A settings preview goes out on the same channel
 * as every real handover, so without a name on it the drawing that was already switched on replays
 * itself whenever the other switch is touched.
 *
 * The remote's subscriber does not ask this, deliberately: see `plain` above.
 */
export const shouldDrawCue = (
    cue: TransitionCue,
    switchedOn: boolean,
    renderer: TransitionRenderer,
): boolean => (
    switchedOn
    && !cue.plain
    && cue.seconds >= MIN_DRAWN_SECONDS
    && (!cue.preview || cue.preview === renderer)
);

export const subscribeToTransitionCue = (listener: TransitionCueListener): (() => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};
