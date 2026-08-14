import { normalizeVisualizerAudioLevel } from '../audioLevels';

// src/components/visualizer/brut/brutLighting.ts
// Keeps the key-light audio response bounded and smooth across analyser peaks.

export const BRUT_LIGHT_MIN_INTENSITY = 56;
export const BRUT_LIGHT_MAX_INTENSITY = 68;

export const stepBrutAudioEnvelope = (
    currentEnvelope: number,
    rawAudioLevel: number,
    deltaSeconds: number,
): number => {
    const target = normalizeVisualizerAudioLevel(rawAudioLevel);
    const rate = target > currentEnvelope ? 7.5 : 2.4;
    const damping = 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
    return currentEnvelope + (target - currentEnvelope) * damping;
};

export const resolveBrutLightIntensity = (envelope: number): number =>
    BRUT_LIGHT_MIN_INTENSITY
    + Math.min(1, Math.max(0, envelope)) * (BRUT_LIGHT_MAX_INTENSITY - BRUT_LIGHT_MIN_INTENSITY);
