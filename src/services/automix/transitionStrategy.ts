import { CROSSFADE_DEFAULT_SEC, clampCrossfadeSeconds, planCrossfade } from './crossfadePlanner';
import { chooseExpansionIntensity } from './expansionGesture';
import { planTransition, type TransitionPlan, type TransitionTrack } from './transitionPlanner';

// src/services/automix/transitionStrategy.ts
// Which of the two strategies gets this song change. Nothing else lives here.
//
// The seam already existed: both planners answer with the same `TransitionPlan`, and `automixSession`
// has always executed a plan without caring who wrote it. So the two modes are genuinely two
// strategies, not one strategy with a flag threaded through - the shapes they produce differ, not the
// switches they set. A third would be another file here and no change downstream.
//
// Pure, like both planners it dispatches to. The one impure question - can this build measure audio
// at all - is a separate export, and no planning path calls it.

export type TransitionMode =
    /** Fixed-length equal-power crossfade. The listener sets the maximum. */
    | 'crossfade'
    /** Measured evidence decides whether, when, how and how long. The listener sets nothing. */
    | 'automix';

export interface TransitionSettings {
    mode: TransitionMode;
    /** Seconds. The crossfade mode's ceiling; automix ignores it and computes its own. */
    crossfadeMaxSec: number;
    /**
     * Let the mix be heard: a build-up runs into the drum handover instead of merely arriving at it.
     *
     * A modifier on automix, not a third mode - as in the settings too: its shapes are automix's
     * shapes with a gesture in front of one, every measured decision underneath unchanged.
     * `planForMode` ignores it outside automix for the same reason: the crossfade mode has no
     * handover for a build to run into.
     */
    performance: boolean;
}

export const DEFAULT_TRANSITION_SETTINGS: TransitionSettings = {
    // Automix, because it is what the existing switch has always done: a listener who already had
    // blending on must not find it behaving differently after an update.
    mode: 'automix',
    crossfadeMaxSec: CROSSFADE_DEFAULT_SEC,
    // Off. Every other default here is "what this already did", and this did nothing.
    performance: false,
};

export const isTransitionMode = (value: unknown): value is TransitionMode =>
    value === 'crossfade' || value === 'automix';

/**
 * Whether this mode's planner reads a beat grid, and therefore whether analysis should pay for one.
 *
 * Here rather than at the prefetcher that asks, because the answer is a property of the planners in
 * this file: `planCrossfade` sets `tempo: 'unknown'` and `stretch: 1` outright and reads nothing off
 * the profile but its silence edges, so running the beat model for it produces an answer with no
 * reader. It did exactly that on every prefetched track for a while, surviving because the fact lived
 * two layers away from the code it was about.
 *
 * Held by test: crossfadePlanner.test.ts plans the same pair with a full profile and with none and
 * requires the same plan, so a crossfade that started using bar lines fails there and lands whoever
 * changed it back on this line.
 */
export const modeNeedsBeatGrid = (mode: TransitionMode): boolean => mode === 'automix';

/**
 * Whether a track can be measured at all in this environment.
 *
 * Every automix decision is downstream of one offline analysis pass, which needs an
 * OfflineAudioContext to decode into. Without one the mode is only a crossfade wearing its name, so
 * the setting says so instead of pretending. This is the only HARD block; the common soft one - an
 * online library with song caching off, so no bytes anyone agreed to download - is a coverage
 * question the settings page explains, not a capability.
 */
export const canAnalyseTracks = (): boolean => {
    if (typeof window === 'undefined') return false;
    const offline = window.OfflineAudioContext
        || (window as Window & { webkitOfflineAudioContext?: typeof OfflineAudioContext })
            .webkitOfflineAudioContext;
    return typeof offline === 'function';
};

/**
 * Whether automix has anything at all to be clever with.
 *
 * All THREE, because they are three separate inputs to three separate decisions and any one puts
 * automix somewhere a crossfade cannot go. First written as "is there an offline profile", which a
 * test caught within the minute: a track with no profile still has a tempo, measured live off the
 * sounding deck, and that tempo is what makes a blend eight BARS long instead of five seconds.
 * Reading only the profile threw a 21.3s musical blend away for a 5s crossfade - the feature switched
 * off by a guard meant to protect it.
 *
 * - a profile on either side: the style, the tone match, the placement, the length ceiling
 * - a tempo from anywhere: the length's unit, the entry alignment, whether a cut can be placed
 * - lyrics on the outgoing side: where the singing stops, which is where a handover may start
 */
const hasEvidence = (
    from: TransitionTrack,
    to: TransitionTrack,
    bpm: number | null,
): boolean => Boolean(
    from.profile
    || to.profile
    || (bpm !== null && Number.isFinite(bpm) && bpm > 0)
    || from.lines?.length,
);

/**
 * Picks the planner and runs it.
 *
 * The last branch is the one worth reading twice. Automix with no evidence is not automix being
 * cautious, it is automix with nothing to reason from: `chooseTransitionStyle` falls through every
 * measured rule to `plainBlend` and the length comes from a constant. That IS a crossfade, so it goes
 * to the crossfade planner, which places it against the same measured ends and says so in the log.
 * Same audible result, one behaviour to reason about, and none of the moves that need evidence - a
 * tempo bend, a beat cut, an echo throw - can be reached out of an empty profile by accident.
 */
export const planForMode = (
    settings: TransitionSettings,
    from: TransitionTrack,
    to: TransitionTrack,
    bpm: number | null = null,
    at = 0,
): TransitionPlan => {
    if (settings.mode === 'crossfade') {
        return planCrossfade(from, to, clampCrossfadeSeconds(settings.crossfadeMaxSec), at);
    }
    if (hasEvidence(from, to, bpm)) {
        const plan = planTransition(from, to, bpm, at);
        if (!settings.performance) return plan;
        // Strength only. WHERE the build goes needs the swap, which does not exist until the stem
        // handover is planned against real audio - so the planner decides how hard and the session
        // lays it out, the same split `style` already has with `shapeBlend`.
        return {
            ...plan,
            expansion: chooseExpansionIntensity({
                tailDb: from.profile?.tailDb,
                headDb: to.profile?.headDb,
                startsHot: to.profile?.startsHot,
            }),
        };
    }

    const plan = planCrossfade(from, to, CROSSFADE_DEFAULT_SEC, at);
    // Deliberately not phrased like `chooseTransitionStyle`'s own "nothing measured about either
    // track" fallback - that one is about picking a STYLE and reads identically in the log. These two
    // failures are different sizes and want telling apart at a glance.
    return { ...plan, fellBack: true, reason: `automix has no evidence here, ${plan.reason} instead` };
};
