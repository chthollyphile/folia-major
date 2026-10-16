import { describe, expect, it } from 'vitest';
import {
    createBeatFxClockState,
    mergeBeatFxEvents,
    stepBeatFxClock,
} from '../../../src/services/beatFx/clock';
import { resolveSonnetBeatFxFrame, resolveSonnetIconOnsetPop } from '../../../src/components/visualizer/sonnet/sonnetBeatFx';

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
