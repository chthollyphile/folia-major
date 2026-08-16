import { describe, expect, it } from 'vitest';
import { motionValue } from 'framer-motion';
import {
    BRUT_CHANNEL_MAX_INTENSITY,
    BRUT_CHANNEL_MIN_INTENSITY,
    BRUT_DAYLIGHT_MAX_INTENSITY,
    BRUT_DAYLIGHT_MIN_INTENSITY,
    createBrutBandEnvelopes,
    resolveBrutChannelIntensity,
    resolveBrutDaylightIntensity,
    stepBrutAudioEnvelope,
    stepBrutBandEnvelopes,
} from '@/components/visualizer/brut/brutLighting';
import type { AudioBands } from '@/types';

// test/unit/visualizer/brutAudio.test.ts
// The global frame-rate limiter can hand useFrame very different deltas, so every envelope has to
// converge identically regardless of how the time is sliced.

const bands = (values: Partial<Record<keyof AudioBands, number>>): AudioBands => ({
    bass: motionValue(values.bass ?? 0),
    lowMid: motionValue(values.lowMid ?? 0),
    mid: motionValue(values.mid ?? 0),
    vocal: motionValue(values.vocal ?? 0),
    treble: motionValue(values.treble ?? 0),
}) as AudioBands;

describe('stepBrutAudioEnvelope', () => {
    it('is frame-rate independent', () => {
        const single = stepBrutAudioEnvelope(0, 255, 1 / 60);
        let split = 0;
        split = stepBrutAudioEnvelope(split, 255, 1 / 120);
        split = stepBrutAudioEnvelope(split, 255, 1 / 120);
        expect(split).toBeCloseTo(single, 12);
    });

    it('attacks faster than it releases', () => {
        const attack = stepBrutAudioEnvelope(0.5, 255, 1 / 60) - 0.5;
        const release = 0.5 - stepBrutAudioEnvelope(0.5, 0, 1 / 60);
        expect(attack).toBeGreaterThan(release);
    });

    it('stays inside the unit interval for hostile input', () => {
        [Number.NaN, -400, 1e9].forEach((raw) => {
            const value = stepBrutAudioEnvelope(0.5, raw, 1 / 60);
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        });
        expect(stepBrutAudioEnvelope(0.5, 255, -1)).toBeCloseTo(0.5, 12);
    });
});

describe('brut light intensity mapping', () => {
    it('bounds the daylight and the channels', () => {
        expect(resolveBrutDaylightIntensity(-3)).toBe(BRUT_DAYLIGHT_MIN_INTENSITY);
        expect(resolveBrutDaylightIntensity(9)).toBe(BRUT_DAYLIGHT_MAX_INTENSITY);
        expect(resolveBrutChannelIntensity(-3)).toBe(BRUT_CHANNEL_MIN_INTENSITY);
        expect(resolveBrutChannelIntensity(9)).toBe(BRUT_CHANNEL_MAX_INTENSITY);
    });
});

describe('stepBrutBandEnvelopes', () => {
    it('advances every band and never leaves the unit interval', () => {
        const envelopes = createBrutBandEnvelopes();
        stepBrutBandEnvelopes(envelopes, bands({ bass: 255, vocal: 128, treble: 64 }), 1 / 60);
        expect(envelopes.bass).toBeGreaterThan(0);
        expect(envelopes.vocal).toBeGreaterThan(0);
        expect(envelopes.mid).toBe(0);
        Object.values(envelopes).forEach((value) => {
            expect(value).toBeGreaterThanOrEqual(0);
            expect(value).toBeLessThanOrEqual(1);
        });
    });

    it('decays toward silence without an analyser', () => {
        const envelopes = createBrutBandEnvelopes();
        envelopes.bass = 1;
        for (let step = 0; step < 200; step += 1) {
            stepBrutBandEnvelopes(envelopes, undefined, 1 / 60);
        }
        expect(envelopes.bass).toBeLessThan(0.02);
    });
});
