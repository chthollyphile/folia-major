import { describe, expect, it } from 'vitest';
import {
    createBeatFxClockState,
    mergeBeatFxEvents,
    resolveBeatFxAccentGain,
    stepBeatFxClock,
} from '../../../src/services/beatFx/clock';
import {
    resolveSonnetBeatFxAccent,
    resolveSonnetBeatFxFrame,
    resolveSonnetIconOnsetPop,
} from '../../../src/components/visualizer/sonnet/sonnetBeatFx';
import { resolveDioramaBeatRipple } from '../../../src/components/visualizer/diorama/dioramaBeatRipples';

// test/unit/beatFx/clock.test.ts

const FRAME = 1 / 60;

/** Plays `state` from `from` to `to` at 60 fps. */
const play = (state: ReturnType<typeof createBeatFxClockState>, from: number, to: number) => {
    for (let t = from; t <= to + 1e-9; t += FRAME) stepBeatFxClock(state, t, FRAME);
    return state;
};

describe('beatFx clock', () => {
    const events = mergeBeatFxEvents([1, 1.5, 2, 2.5, 3], [1, 3]);

    it('merges downbeats onto their beats', () => {
        expect(events.map(event => event.kind)).toEqual(['downbeat', 'beat', 'beat', 'beat', 'downbeat']);
    });

    it('fires each crossed event once, downbeats counting as beats too', () => {
        const state = play(createBeatFxClockState(events), 0.5, 3.1);
        expect(state.firedBeats).toBe(5);
        expect(state.firedDownbeats).toBe(2);
        expect(state.lastFiredT).toBe(3);
        expect(state.downbeatImpact).toBeGreaterThan(0.3);
    });

    it('alternates the tilt sign on each beat', () => {
        const state = createBeatFxClockState(events);
        play(state, 0.9, 1.05);
        const first = state.rotationSign;
        play(state, 1.05 + FRAME, 1.55);
        expect(state.rotationSign).toBe(-first);
    });

    it('decays the beat envelope to ~10% after the decay window', () => {
        const state = play(createBeatFxClockState(events), 0.9, 1.0 + FRAME / 2);
        const peak = state.beatImpact;
        expect(peak).toBeGreaterThan(0.9);
        play(state, 1.0 + FRAME * 1.5, 1.3);
        expect(state.beatImpact / peak).toBeLessThan(0.12);
    });

    it('resyncs on a seek without firing', () => {
        const state = play(createBeatFxClockState(events), 0.5, 0.8);
        stepBeatFxClock(state, 2.6, FRAME);
        expect(state.firedBeats).toBe(0);
        expect(state.beatImpact).toBe(0);
        stepBeatFxClock(state, 2.6 + FRAME, FRAME);
        expect(state.firedBeats).toBe(0);
        play(state, 2.6 + FRAME * 2, 3.05);
        expect(state.firedBeats).toBe(1);
        // A backwards seek also only resyncs.
        stepBeatFxClock(state, 0.95, FRAME);
        stepBeatFxClock(state, 0.95 + FRAME, FRAME);
        expect(state.firedBeats).toBe(1);
    });

    it('does not fire while paused and resyncs on resume', () => {
        const state = play(createBeatFxClockState(events), 0.5, 0.9);
        stepBeatFxClock(state, null, FRAME);
        stepBeatFxClock(state, 1.2, FRAME);
        expect(state.firedBeats).toBe(0);
    });
});

describe('sonnetBeatFx envelopes', () => {
    it('maps impacts to the camera punch, tear and flare', () => {
        const frame = resolveSonnetBeatFxFrame(1, 1, -1, 0, 0);
        expect(frame.zoom).toBeCloseTo(1.11);
        expect(frame.rotation).toBeCloseTo(-0.6 * Math.PI / 180);
        expect(frame.tear).toBeCloseTo(0.6);
        expect(frame.flare).toBeCloseTo(0.7);
        const idle = resolveSonnetBeatFxFrame(0, 0.01, 1, 0, 0);
        expect(idle.zoom).toBeCloseTo(1.0005);
        expect(idle.tear).toBe(0);
    });

    it('pops icons on the latest lyric cue only', () => {
        const cues = [0, 1].map(at => ({ at, duration: 0.3, kind: 'enter' as const, segmentStart: 0, segmentEnd: 1 }));
        expect(resolveSonnetIconOnsetPop(1, cues)).toBeCloseTo(1);
        expect(resolveSonnetIconOnsetPop(1.3, cues)).toBeLessThan(0.11);
        expect(resolveSonnetIconOnsetPop(-1, cues)).toBe(0);
    });
});

describe('beat accents on the clock', () => {
    const beats = [0.5, 1, 1.5, 2, 2.5, 3];
    const downbeats = [1, 3];
    const accents = {
        v: 1,
        impact: [1, 0, 1, 0.5, 0, 1],
        low: [0.8, 0.2, 0.5, 0.6, 0.1, 0.3],
        mid: [0.1, 0.4, 0.3, 0.2, 0.1, 0.3],
        high: [0.1, 0.4, 0.2, 0.2, 0.8, 0.4],
        rhythmic: [1, 1, 1, 1, 1, 1],
        pulse: [1, 1, 1, 1, 1, 1],
        trackScale: 0.6,
    };

    it('counts bar positions from the model downbeats', () => {
        const events = mergeBeatFxEvents(beats, downbeats, accents);
        expect(events.map(event => event.barPos)).toEqual([null, 0, 1, 2, 3, 0]);
        expect(events[1].impact).toBe(0);
        expect(events[4].tone).toEqual({ low: 0.1, mid: 0.1, high: 0.8 });
    });

    it('leaves events without accents exactly as they were', () => {
        const events = mergeBeatFxEvents(beats, downbeats);
        expect(events.every(event => !('impact' in event) && !('barPos' in event) && !('tone' in event))).toBe(true);
    });

    it('produces bit-identical envelopes without accents', () => {
        const plain = createBeatFxClockState(mergeBeatFxEvents(beats, downbeats));
        const before: number[] = [];
        for (let t = 0.4; t <= 3.2; t += FRAME) {
            stepBeatFxClock(plain, t, FRAME);
            before.push(plain.beatImpact, plain.downbeatImpact);
        }
        // The pre-accent formula, written out.
        const reference: number[] = [];
        let k = 0;
        let d = 0;
        let last: number | null = null;
        let cursor = 0;
        const events = mergeBeatFxEvents(beats, downbeats);
        for (let t = 0.4; t <= 3.2; t += FRAME) {
            k *= Math.exp(-FRAME * 1000 / 160 * 2.3);
            d *= Math.exp(-FRAME * 1000 / 200 * 2.3);
            if (k < 1e-4) k = 0;
            if (d < 1e-4) d = 0;
            if (last === null) {
                cursor = events.findIndex(event => event.t > t);
            } else {
                while (cursor < events.length && events[cursor].t <= t) {
                    const lateMs = (t - events[cursor].t) * 1000;
                    k = Math.max(k, Math.exp(-lateMs / 160 * 2.3));
                    if (events[cursor].kind === 'downbeat') d = Math.max(d, Math.exp(-lateMs / 200 * 2.3));
                    cursor += 1;
                }
            }
            last = t;
            reference.push(k, d);
        }
        expect(before).toEqual(reference);
    });

    it('peaks a weak beat lower, scaled by the track', () => {
        expect(resolveBeatFxAccentGain({ impact: 0 }, 1)).toBeCloseTo(0.35);
        expect(resolveBeatFxAccentGain({ impact: 1 }, 0.6)).toBeCloseTo(0.6);
        expect(resolveBeatFxAccentGain({}, 1)).toBe(1);
        expect(resolveBeatFxAccentGain(null, 1)).toBe(1);
        // A beat in a bar with no rhythm fires nothing, whatever its impact.
        expect(resolveBeatFxAccentGain({ impact: 1, rhythmic: false }, 1)).toBe(0);
        expect(mergeBeatFxEvents(beats, downbeats, { ...accents, rhythmic: [0, 1, 1, 1, 1, 1] })[0].rhythmic).toBe(false);
        const state = createBeatFxClockState(mergeBeatFxEvents(beats, downbeats, accents), accents.trackScale);
        // Stepped onto the beats exactly, so each envelope reads its peak.
        stepBeatFxClock(state, 1.45, FRAME);
        stepBeatFxClock(state, 1.5, FRAME);
        // The 1.5 beat: impact 1, so it peaks at the track scale.
        expect(state.beatImpact).toBeCloseTo(0.6);
        // A seek with a long gap lets it settle, then the 2.5 beat (impact 0) fires.
        stepBeatFxClock(state, 2.45, 1);
        stepBeatFxClock(state, 2.5, FRAME);
        expect(state.beatImpact).toBeCloseTo(0.35 * 0.6);
        expect(state.lastBeat?.t).toBe(2.5);
        expect(state.lastDownbeat).toBeNull();
        stepBeatFxClock(state, 2.75, FRAME);
        stepBeatFxClock(state, 3, FRAME);
        expect(state.lastDownbeat?.t).toBe(3);
        expect(state.lastBeat?.t).toBe(2.5);
    });
});

describe('accent-shaped responses', () => {
    it('leaves Sonnet unshaped without an accent', () => {
        expect(resolveSonnetBeatFxAccent(null)).toEqual({ zoom: 1, tilt: 1 });
        expect(resolveSonnetBeatFxAccent({ barPos: 3 })).toEqual({ zoom: 1, tilt: 1 });
        const plain = resolveSonnetBeatFxFrame(1, 0.5, 1, 0, 0);
        const shaped = resolveSonnetBeatFxFrame(1, 0.5, 1, 0, 0, undefined, { zoom: 1, tilt: 1 });
        expect(shaped).toEqual(plain);
    });

    it('pushes in on low beats, tilts on high ones, and swings back before the bar', () => {
        const low = resolveSonnetBeatFxAccent({ tone: { low: 1, mid: 0, high: 0 }, barPos: 1 });
        const high = resolveSonnetBeatFxAccent({ tone: { low: 0, mid: 0, high: 1 }, barPos: 1 });
        expect(low.zoom).toBeGreaterThan(high.zoom);
        expect(high.tilt).toBeGreaterThan(low.tilt);
        const beforeBar = resolveSonnetBeatFxAccent({ tone: { low: 0, mid: 0, high: 1 }, barPos: 3 });
        expect(beforeBar.tilt).toBeCloseTo(high.tilt / 2);
    });

    it('keeps the plain Diorama ripples without accents', () => {
        expect(resolveDioramaBeatRipple('beat', null, 1, 1.2)).toEqual({ index: 1, strength: 0.9 * 1.2 });
        expect(resolveDioramaBeatRipple('downbeat', { }, 1, 0.8)).toEqual({ index: 0, strength: 0.8 });
    });

    it('sizes and scales Diorama ripples by the beat', () => {
        const lowWeak = resolveDioramaBeatRipple('beat', { impact: 0, tone: { low: 0.7, mid: 0.2, high: 0.1 } }, 1, 1);
        expect(lowWeak.index).toBe(0);
        expect(lowWeak.strength).toBeCloseTo(0.9 * 0.35);
        const highFull = resolveDioramaBeatRipple('beat', { impact: 1, tone: { low: 0.1, mid: 0.2, high: 0.7 } }, 0.5, 1);
        expect(highFull).toEqual({ index: 1, strength: 0.9 * 0.5 });
    });
});

describe('compound time', () => {
    // 6/8 as Beat This! counts it, six eighth notes a bar; the accents keep every third (the pulse).
    const eighths = Array.from({ length: 12 }, (_, index) => index * 0.4);
    const bars = [eighths[0], eighths[6]];
    const ones = eighths.map(() => 1);
    const accents = {
        v: 4,
        impact: eighths.map((_, index) => index / 100),
        low: ones,
        mid: ones,
        high: ones,
        rhythmic: ones,
        pulse: eighths.map((_, index) => (index % 3 === 0 ? 1 : 0)),
        trackScale: 1,
    };

    it('fires on the felt beats only, each with its own accents', () => {
        const events = mergeBeatFxEvents(eighths, bars, accents);
        expect(events.map(event => event.t)).toEqual([0, 3, 6, 9].map(index => eighths[index]));
        expect(events.map(event => event.kind)).toEqual(['downbeat', 'beat', 'downbeat', 'beat']);
        expect(events.map(event => event.impact)).toEqual([0, 0.03, 0.06, 0.09]);
        expect(events.map(event => event.barPos)).toEqual([0, 1, 0, 1]);
    });

    it('keeps every beat without accents', () => {
        expect(mergeBeatFxEvents(eighths, bars)).toHaveLength(12);
    });
});
