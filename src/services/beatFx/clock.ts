// src/services/beatFx/clock.ts
// Pure beat clock for the beat FX (Sonnet 智能动感模式): walks a sorted beat/downbeat event list against the
// heard playback time and produces two decaying impact envelopes. No React, no MotionValues - the
// caller owns the frame loop and writes the envelopes wherever it needs them.

export type BeatFxEventKind = 'beat' | 'downbeat';

export interface BeatFxEvent {
    /** Seconds from the start of the track. */
    t: number;
    kind: BeatFxEventKind;
}

/** Envelope shape, from the approved Sonnet mockup; both envelopes peak at 1. */
// Beats decay in 160 ms (mockup: 300) so each one lands as a separate jump at ~160 BPM instead of
// overlapping the next, and peak at full strength (mockup: 0.75) so the regular beat is clearly felt.
// How strong that is on screen is each visualizer's setting (Sonnet: 轻拍 / 重拍强度), not the clock's.
export const BEAT_FX_BEAT_DECAY_MS = 160;
export const BEAT_FX_DOWNBEAT_DECAY_MS = 200;
/** A jump in heard time larger than this (or any backwards step) is treated as a seek. */
export const BEAT_FX_SEEK_THRESHOLD_SEC = 0.3;

export interface BeatFxClockState {
    events: BeatFxEvent[];
    /** Index of the next event that has not fired yet. */
    cursor: number;
    /** Heard time of the previous step, or null before the first step / after a reset. */
    lastTime: number | null;
    beatImpact: number;
    downbeatImpact: number;
    /** Alternates on every fired event so the camera tilt swings left/right. */
    rotationSign: number;
    firedBeats: number;
    firedDownbeats: number;
    /** Track time of the last fired event, for diagnostics. */
    lastFiredT: number | null;
}

export const createBeatFxClockState = (events: BeatFxEvent[] = []): BeatFxClockState => ({
    events,
    cursor: 0,
    lastTime: null,
    beatImpact: 0,
    downbeatImpact: 0,
    rotationSign: 1,
    firedBeats: 0,
    firedDownbeats: 0,
    lastFiredT: null,
});

/** First index whose event time is strictly after `time` (binary search). */
export const findNextBeatFxEvent = (events: readonly BeatFxEvent[], time: number): number => {
    let low = 0;
    let high = events.length;
    while (low < high) {
        const mid = (low + high) >> 1;
        if (events[mid].t <= time) low = mid + 1;
        else high = mid;
    }
    return low;
};

/** Merges raw beat_this output into one sorted list; a downbeat replaces the beat it sits on. */
export const mergeBeatFxEvents = (beats: readonly number[], downbeats: readonly number[]): BeatFxEvent[] => {
    const downbeatSet = new Set(downbeats);
    const events: BeatFxEvent[] = beats.map(t => ({ t, kind: downbeatSet.has(t) ? 'downbeat' : 'beat' }));
    // beat_this snaps every downbeat onto a beat, but keep any stray one rather than drop it.
    const beatSet = new Set(beats);
    downbeats.forEach((t) => {
        if (!beatSet.has(t)) events.push({ t, kind: 'downbeat' });
    });
    return events.sort((a, b) => a.t - b.t);
};

/**
 * Advances the clock by one frame.
 *
 * `heardTime` is the track time the listener hears now (latency already removed); `dtSec` is the
 * wall-clock frame interval and drives the decay, so a pause lets the punch settle instead of
 * freezing it mid-flight. Events crossed since the previous step fire; a seek only re-positions the
 * cursor, so jumping into the middle of a song never triggers a burst.
 */
export const stepBeatFxClock = (
    state: BeatFxClockState,
    heardTime: number | null,
    dtSec: number,
): BeatFxClockState => {
    const dtMs = Math.max(0, dtSec) * 1000;
    state.beatImpact *= Math.exp(-dtMs / BEAT_FX_BEAT_DECAY_MS * 2.3);
    state.downbeatImpact *= Math.exp(-dtMs / BEAT_FX_DOWNBEAT_DECAY_MS * 2.3);
    if (state.beatImpact < 1e-4) state.beatImpact = 0;
    if (state.downbeatImpact < 1e-4) state.downbeatImpact = 0;

    if (heardTime === null || !Number.isFinite(heardTime)) {
        // Not playing: keep decaying, forget the position so resuming resyncs instead of firing.
        state.lastTime = null;
        return state;
    }

    const previous = state.lastTime;
    state.lastTime = heardTime;
    const delta = previous === null ? Number.NaN : heardTime - previous;
    if (previous === null || delta < 0 || delta > BEAT_FX_SEEK_THRESHOLD_SEC) {
        state.cursor = findNextBeatFxEvent(state.events, heardTime);
        return state;
    }

    while (state.cursor < state.events.length && state.events[state.cursor].t <= heardTime) {
        const event = state.events[state.cursor];
        state.cursor += 1;
        // How late this frame is relative to the event, so the envelope starts where it should.
        const lateMs = Math.max(0, heardTime - event.t) * 1000;
        const isDownbeat = event.kind === 'downbeat';
        state.beatImpact = Math.max(state.beatImpact, Math.exp(-lateMs / BEAT_FX_BEAT_DECAY_MS * 2.3));
        state.rotationSign = -state.rotationSign;
        state.lastFiredT = event.t;
        if (isDownbeat) {
            state.downbeatImpact = Math.max(
                state.downbeatImpact,
                Math.exp(-lateMs / BEAT_FX_DOWNBEAT_DECAY_MS * 2.3),
            );
            state.firedDownbeats += 1;
        }
        // A downbeat is also a beat, so it counts towards both.
        state.firedBeats += 1;
    }
    return state;
};
