import { describe, expect, it } from 'vitest';
import {
    normalizeVisualizerAudioLevel,
    toVisualizerAudioLevel,
} from '@/components/visualizer/audioLevels';
import {
    BRUT_LIGHT_MAX_INTENSITY,
    BRUT_LIGHT_MIN_INTENSITY,
    resolveBrutLightIntensity,
    stepBrutAudioEnvelope,
} from '@/components/visualizer/brut/brutLighting';

// test/unit/visualizer/audioLevels.test.ts
// Locks the shared 0..255 analyser contract used by live playback and visualizer previews.

describe('visualizer audio levels', () => {
    it('normalizes analyser magnitudes into a bounded unit interval', () => {
        expect(normalizeVisualizerAudioLevel(0)).toBe(0);
        expect(normalizeVisualizerAudioLevel(127.5)).toBe(0.5);
        expect(normalizeVisualizerAudioLevel(255)).toBe(1);
    });

    it('clamps invalid or out-of-range analyser values', () => {
        expect(normalizeVisualizerAudioLevel(Number.NaN)).toBe(0);
        expect(normalizeVisualizerAudioLevel(-20)).toBe(0);
        expect(normalizeVisualizerAudioLevel(400)).toBe(1);
    });

    it('converts normalized preview values to the analyser scale', () => {
        expect(toVisualizerAudioLevel(0.24)).toBeCloseTo(61.2);
        expect(toVisualizerAudioLevel(Number.NaN)).toBe(0);
        expect(toVisualizerAudioLevel(-1)).toBe(0);
        expect(toVisualizerAudioLevel(2)).toBe(255);
    });

    it('keeps Brut light response smooth and strictly bounded', () => {
        const attack = stepBrutAudioEnvelope(0, 255, 1 / 60);
        const release = stepBrutAudioEnvelope(attack, 0, 1 / 60);

        expect(attack).toBeGreaterThan(0);
        expect(attack).toBeLessThan(1);
        expect(release).toBeLessThan(attack);
        expect(resolveBrutLightIntensity(-10)).toBe(BRUT_LIGHT_MIN_INTENSITY);
        expect(resolveBrutLightIntensity(10)).toBe(BRUT_LIGHT_MAX_INTENSITY);
    });
});
