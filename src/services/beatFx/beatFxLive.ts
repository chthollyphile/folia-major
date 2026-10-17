import { beatImpact, downbeatImpact } from '../../stores/motionSignals';
import { createBeatFxClockState, stepBeatFxClock, type BeatFxEvent } from './clock';
import type { BeatFxSourceKind } from './beatFxSource';

// src/services/beatFx/beatFxLive.ts
// The one live beat clock: fed the current track's beat list, stepped once per frame from the
// existing playback RAF loop, and written into the `beatImpact` / `downbeatImpact` MotionValues.
// No React state anywhere on this path.
//
// The MotionValues carry the envelopes already scaled by 智能动感模式's 轻拍 / 重拍 strengths
// (`setBeatFxIntensities`), so every visualizer reading them gets the user's strengths without
// reading settings itself. Discrete effects (a ripple per beat) count `getBeatFxFiredCounts` instead
// and scale by `getBeatFxIntensities`.
//
// With accents (analysis/beatAccents.ts) the envelopes already peak lower on a weak beat and on a
// track whose beats barely stand out; a discrete effect reads the beat it fires for with
// `getBeatFxLastBeat` / `getBeatFxLastDownbeat` and scales by `resolveBeatFxAccentGain`.
//
// Diagnostics (`window.__foliaBeatFx`: beats fired, source, latency, the two envelopes) exist in a
// dev build, or in any build with localStorage['folia.dev.beatFxDebug'] = '1' at startup.

interface BeatFxDebug {
    beats: number;
    downbeats: number;
    lastT: number | null;
    heardT: number | null;
    source: BeatFxSourceKind | 'loading';
    note: string | null;
    trackKey: string | null;
    eventCount: number;
    latencyMs: number;
    beatImpact: number;
    downbeatImpact: number;
}

declare global {
    interface Window {
        __foliaBeatFx?: BeatFxDebug;
    }
}

/**
 * How long a track change keeps the previous track's "ready" while the new one's beats load.
 *
 * Without it every change - a skip, an automix handover, exactly the moments meant to be seamless -
 * dropped the visualizer to its original frame for the few frames a stored list takes to read, and
 * jumped back. Held, the frame stays a beat FX frame whose envelopes simply decay to rest; only a
 * track that really has no beats after this long drops back, once.
 */
const READY_HOLD_MS = 1500;

const readDebugFlag = (): boolean => {
    try {
        return typeof localStorage !== 'undefined' && localStorage.getItem('folia.dev.beatFxDebug') === '1';
    } catch {
        return false;
    }
};

const debug: BeatFxDebug | null = (import.meta.env.DEV || readDebugFlag())
    ? {
        beats: 0,
        downbeats: 0,
        lastT: null,
        heardT: null,
        source: 'none',
        note: null,
        trackKey: null,
        eventCount: 0,
        latencyMs: 0,
        beatImpact: 0,
        downbeatImpact: 0,
    }
    : null;
if (debug && typeof window !== 'undefined') window.__foliaBeatFx = debug;

const state = createBeatFxClockState();
let trackKey: string | null = null;
let lastStepAt: number | null = null;
/** `performance.now()` until which a track change counts as ready; see READY_HOLD_MS. */
let holdUntil = 0;
/** Whether the last step had a deck being heard; false while paused or stopped. */
let hearing = false;
const intensities = { beat: 1, downbeat: 1 };
const firedCounts = { beats: 0, downbeats: 0 };

/** The 轻拍 / 重拍 strengths (0..2) the envelopes are scaled by from the next step on. */
export const setBeatFxIntensities = (beat: number, downbeat: number) => {
    intensities.beat = beat;
    intensities.downbeat = downbeat;
};

/** The current 轻拍 / 重拍 strengths; one shared object, read it rather than keep it. */
export const getBeatFxIntensities = (): Readonly<{ beat: number; downbeat: number }> => intensities;

/**
 * How many beats and downbeats the clock has fired since the app started - only ever growing, across
 * tracks and seeks - so a frame loop that remembers last frame's counts sees exactly the ones fired
 * since. One shared object, read it rather than keep it.
 */
export const getBeatFxFiredCounts = (): Readonly<{ beats: number; downbeats: number }> => firedCounts;

/** Switches the clock to a new track; events arrive later via `setBeatFxEvents`. */
export const beginBeatFxTrack = (key: string | null) => {
    // Held only from a track that was ready: its beats in, or itself still inside a hold. Keyed on the
    // events alone, a run of quick skips dropped the frame at the second one.
    const wasReady = isBeatFxReady();
    holdUntil = key && wasReady ? Math.max(holdUntil, performance.now() + READY_HOLD_MS) : 0;
    trackKey = key;
    state.events = [];
    state.cursor = 0;
    state.lastTime = null;
    state.lastBeat = null;
    state.lastDownbeat = null;
    if (debug) {
        debug.trackKey = key;
        debug.source = key ? 'loading' : 'none';
        debug.note = null;
        debug.eventCount = 0;
    }
};

/**
 * Installs the beat list for `key`, with its dynamics scale; ignored if the track changed while it was
 * loading. Called again for the same track when its accents arrive.
 */
export const setBeatFxEvents = (
    key: string,
    events: BeatFxEvent[],
    source: BeatFxSourceKind,
    note?: string,
    trackScale = 1,
) => {
    if (key !== trackKey) return;
    state.events = events;
    state.trackScale = trackScale;
    holdUntil = 0;
    // Resync on the next step rather than firing everything before the current position.
    state.lastTime = null;
    if (debug) {
        debug.source = source;
        debug.note = note ?? null;
        debug.eventCount = events.length;
    }
};

/**
 * Whether the playing track's beat list is installed - or a track change is still inside its hold.
 * Until then (analysing, not cached, no model, a GPU that could not take it) a visualizer draws its
 * original frame rather than a beat FX frame with nothing driving it.
 */
export const isBeatFxReady = (): boolean =>
    trackKey !== null && (state.events.length > 0 || (holdUntil > 0 && performance.now() < holdUntil));

/** Whether a deck was being heard at the last step; continuous effects rest while it is not. */
export const isBeatFxHearing = (): boolean => hearing;

/** Stops the clock and zeroes both envelopes; called when the FX are switched off. */
export const stopBeatFx = () => {
    beginBeatFxTrack(null);
    state.beatImpact = 0;
    state.downbeatImpact = 0;
    beatImpact.set(0);
    downbeatImpact.set(0);
    lastStepAt = null;
    hearing = false;
};

/** The last fired plain beat (not a downbeat) of this track, or null. */
export const getBeatFxLastBeat = (): BeatFxEvent | null => state.lastBeat;

/** The last fired downbeat of this track, or null. */
export const getBeatFxLastDownbeat = (): BeatFxEvent | null => state.lastDownbeat;

/** The playing track's dynamics scale (0.45..1); 1 without accents. */
export const getBeatFxTrackScale = (): number => state.trackScale;

/** Alternating ±1 for the camera tilt; flips on every fired beat. */
export const getBeatFxRotationSign = (): number => state.rotationSign;

/**
 * One frame of the beat clock. `audioElement` is the deck being heard, or null when nothing is
 * playing; `context` is the AudioContext it is routed through, used for output latency.
 */
export const tickBeatFx = (audioElement: HTMLMediaElement | null, context: BaseAudioContext | null | undefined) => {
    const now = performance.now();
    const dtSec = lastStepAt === null ? 0 : Math.min(0.1, (now - lastStepAt) / 1000);
    lastStepAt = now;

    let heardTime: number | null = null;
    if (audioElement && !audioElement.paused && !audioElement.ended) {
        const live = context as (BaseAudioContext & { outputLatency?: number; baseLatency?: number }) | null | undefined;
        const latency = (Number(live?.outputLatency) || 0) + (Number(live?.baseLatency) || 0);
        // What the listener hears lags what the element has decoded by the output latency.
        heardTime = audioElement.currentTime - latency;
        if (debug) debug.latencyMs = latency * 1000;
    }
    hearing = heardTime !== null;

    stepBeatFxClock(state, heardTime, dtSec);
    firedCounts.beats = state.firedBeats;
    firedCounts.downbeats = state.firedDownbeats;
    beatImpact.set(state.beatImpact * intensities.beat);
    downbeatImpact.set(state.downbeatImpact * intensities.downbeat);

    if (debug) {
        debug.beats = state.firedBeats;
        debug.downbeats = state.firedDownbeats;
        debug.lastT = state.lastFiredT;
        debug.heardT = heardTime;
        debug.beatImpact = state.beatImpact;
        debug.downbeatImpact = state.downbeatImpact;
    }
};
