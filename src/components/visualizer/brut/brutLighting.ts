import { type AudioBands } from '../../../types';
import { normalizeVisualizerAudioLevel } from '../audioLevels';

// src/components/visualizer/brut/brutLighting.ts
// Keeps every audio-driven light response bounded and smooth across analyser peaks.
// Pure and DOM-free so the frame-rate independence of the envelopes stays unit testable.

export const BRUT_LIGHT_MIN_INTENSITY = 56;
export const BRUT_LIGHT_MAX_INTENSITY = 68;

const DEFAULT_ATTACK = 7.5;
const DEFAULT_RELEASE = 2.4;

export const stepBrutAudioEnvelope = (
    currentEnvelope: number,
    rawAudioLevel: number,
    deltaSeconds: number,
    attack: number = DEFAULT_ATTACK,
    release: number = DEFAULT_RELEASE,
): number => {
    const target = normalizeVisualizerAudioLevel(rawAudioLevel);
    const rate = target > currentEnvelope ? attack : release;
    const damping = 1 - Math.exp(-Math.max(0, deltaSeconds) * rate);
    return currentEnvelope + (target - currentEnvelope) * damping;
};

export const resolveBrutLightIntensity = (envelope: number): number =>
    BRUT_LIGHT_MIN_INTENSITY
    + Math.min(1, Math.max(0, envelope)) * (BRUT_LIGHT_MAX_INTENSITY - BRUT_LIGHT_MIN_INTENSITY);

// Daylight down a shaft is directional and distance-invariant, so it uses a DirectionalLight and
// its own (much smaller) intensity scale rather than the point-light units above.
export const BRUT_DAYLIGHT_MIN_INTENSITY = 2.4;
export const BRUT_DAYLIGHT_MAX_INTENSITY = 3.3;

export const resolveBrutDaylightIntensity = (envelope: number): number =>
    BRUT_DAYLIGHT_MIN_INTENSITY
    + Math.min(1, Math.max(0, envelope)) * (BRUT_DAYLIGHT_MAX_INTENSITY - BRUT_DAYLIGHT_MIN_INTENSITY);

export const BRUT_CHANNEL_MIN_INTENSITY = 0.55;
export const BRUT_CHANNEL_MAX_INTENSITY = 1.45;

export const resolveBrutChannelIntensity = (envelope: number): number =>
    BRUT_CHANNEL_MIN_INTENSITY
    + Math.min(1, Math.max(0, envelope)) * (BRUT_CHANNEL_MAX_INTENSITY - BRUT_CHANNEL_MIN_INTENSITY);

export type BrutBandName = 'bass' | 'lowMid' | 'mid' | 'vocal' | 'treble';

export type BrutBandEnvelopes = Record<BrutBandName, number>;

const BAND_RATES: Record<BrutBandName, { attack: number; release: number; }> = {
    bass: { attack: 12, release: 3.2 },
    lowMid: { attack: 8, release: 2.6 },
    mid: { attack: 7, release: 2.2 },
    vocal: { attack: 9, release: 2.8 },
    treble: { attack: 10, release: 3.6 },
};

const BAND_NAMES = Object.keys(BAND_RATES) as BrutBandName[];

export const createBrutBandEnvelopes = (): BrutBandEnvelopes => ({
    bass: 0,
    lowMid: 0,
    mid: 0,
    vocal: 0,
    treble: 0,
});

/** Advances every band envelope in place. Silence decays toward zero, never to a black scene. */
export const stepBrutBandEnvelopes = (
    envelopes: BrutBandEnvelopes,
    bands: AudioBands | undefined,
    deltaSeconds: number,
): BrutBandEnvelopes => {
    BAND_NAMES.forEach((name) => {
        const raw = bands?.[name]?.get() ?? 0;
        const { attack, release } = BAND_RATES[name];
        envelopes[name] = stepBrutAudioEnvelope(envelopes[name], raw, deltaSeconds, attack, release);
    });
    return envelopes;
};
