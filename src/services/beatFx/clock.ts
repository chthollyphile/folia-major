import type { BeatAccents } from '../analysis/beatAccents';

// src/services/beatFx/clock.ts
// Pure beat clock for the beat FX (Sonnet 智能动感模式): walks a sorted beat/downbeat event list against the
// heard playback time and produces two decaying impact envelopes. No React, no MotionValues - the
// caller owns the frame loop and writes the envelopes wherever it needs them.
//
// When the track's beats come with accents (analysis/beatAccents.ts), each one peaks at
// `resolveBeatFxAccentGain` instead of 1 and carries its tone and bar position for the modes that
// vary by them. Without accents every value below is the one it was before they existed.

export type BeatFxEventKind = 'beat' | 'downbeat';

export interface BeatFxEvent {
    /** Seconds from the start of the track. */
    t: number;
    kind: BeatFxEventKind;
    /** 0..1 how hard this beat hits; absent without accents. */
    impact?: number;
    /** Each band's share of the hit (sum 1); absent without accents. */
    tone?: { low: number; mid: number; high: number };
    /** Beats since the last downbeat (0 = the downbeat); null before the first one; absent without accents. */
    barPos?: number | null;
    /** False in a bar with no rhythm (sustained sound only): the beat fires no FX. Absent without accents. */
    rhythmic?: boolean;
}

/** A weak beat still peaks this high, so it is seen, just less. */
export const BEAT_FX_WEAK_BEAT_FLOOR = 0.35;

/**
 * How high a beat's envelopes peak: 1 without accents, else its impact over the floor, times the
 * track's dynamics scale; 0 in a bar with no rhythm. Also what the discrete effects (a ripple per
 * beat) scale by.
 */
export const resolveBeatFxAccentGain = (
    event: Pick<BeatFxEvent, 'impact' | 'rhythmic'> | null | undefined,
    trackScale: number,
): number => {
    if (event?.rhythmic === false) return 0;
    if (!event || event.impact === undefined) return trackScale;
    return (BEAT_FX_WEAK_BEAT_FLOOR + (1 - BEAT_FX_WEAK_BEAT_FLOOR) * event.impact) * trackScale;
};

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
    /** The track's dynamics scale (0.45..1); 1 without accents. */
    trackScale: number;
    /** The last fired plain beat and downbeat, for effects that vary by accent. */
    lastBeat: BeatFxEvent | null;
    lastDownbeat: BeatFxEvent | null;
}

export const createBeatFxClockState = (events: BeatFxEvent[] = [], trackScale = 1): BeatFxClockState => ({
    events,
    trackScale,
    lastBeat: null,
    lastDownbeat: null,
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

/**
 * Merges raw beat_this output into one sorted list; a downbeat replaces the beat it sits on. With
 * `accents` (one entry per beat) every beat also carries its impact, tone and bar position, and a
 * beat the accents mark as no felt beat (`pulse` 0, the eighth notes of compound time) is left out.
 */
export const mergeBeatFxEvents = (
    allBeats: readonly number[],
    downbeats: readonly number[],
    allAccents?: BeatAccents,
): BeatFxEvent[] => {
    const downbeatSet = new Set(downbeats);
    // Compound time: the dotted-quarter pulse only, each kept beat with its own accents.
    const kept = allBeats.map((_, index) => index).filter(index => !allAccents || allAccents.pulse[index] !== 0);
    const beats = kept.length < allBeats.length ? kept.map(index => allBeats[index]) : allBeats;
    const accents = allAccents && kept.length < allBeats.length
        ? {
            ...allAccents,
            impact: kept.map(index => allAccents.impact[index]),
            low: kept.map(index => allAccents.low[index]),
            mid: kept.map(index => allAccents.mid[index]),
            high: kept.map(index => allAccents.high[index]),
            rhythmic: kept.map(index => allAccents.rhythmic[index]),
            pulse: kept.map(() => 1),
        }
        : allAccents;
    const events: BeatFxEvent[] = beats.map((t, index) => {
        const event: BeatFxEvent = { t, kind: downbeatSet.has(t) ? 'downbeat' : 'beat' };
        if (accents) {
            event.impact = accents.impact[index];
            event.tone = { low: accents.low[index], mid: accents.mid[index], high: accents.high[index] };
            event.rhythmic = accents.rhythmic[index] !== 0;
        }
        return event;
    });
    // beat_this snaps every downbeat onto a beat, but keep any stray one rather than drop it.
    // Every beat the model found: one the pulse left out is no stray downbeat.
    const beatSet = new Set(allBeats);
    downbeats.forEach((t) => {
        if (!beatSet.has(t)) events.push({ t, kind: 'downbeat' });
    });
    events.sort((a, b) => a.t - b.t);
    if (accents) {
        // Counted from the model's own downbeats, so a missed or extra beat re-aligns at the next bar.
        let barPos: number | null = null;
        events.forEach((event) => {
            barPos = event.kind === 'downbeat' ? 0 : barPos === null ? null : barPos + 1;
            event.barPos = barPos;
        });
    }
    return events;
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
        const gain = resolveBeatFxAccentGain(event, state.trackScale);
        state.beatImpact = Math.max(state.beatImpact, gain * Math.exp(-lateMs / BEAT_FX_BEAT_DECAY_MS * 2.3));
        state.rotationSign = -state.rotationSign;
        state.lastFiredT = event.t;
        if (isDownbeat) {
            state.downbeatImpact = Math.max(
                state.downbeatImpact,
                gain * Math.exp(-lateMs / BEAT_FX_DOWNBEAT_DECAY_MS * 2.3),
            );
            state.firedDownbeats += 1;
            state.lastDownbeat = event;
        } else {
            state.lastBeat = event;
        }
        // A downbeat is also a beat, so it counts towards both.
        state.firedBeats += 1;
    }
    return state;
};
