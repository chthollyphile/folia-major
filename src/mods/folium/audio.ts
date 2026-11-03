import type { MotionValue } from 'framer-motion';
import type { AudioBands } from '@/types';
import type { FoliumAudio, FoliumAudioBands } from './contract';

// src/mods/folium/audio.ts
// Projects the host's analyser MotionValues into the public FoliumAudio.
// The host carries two scales: the live analyser writes 0..255, while previews
// and the theme editor feed a synthetic 0..1 signal. Mods get one scale, 0..1.

export interface FoliumAudioSource {
    audioPower?: MotionValue<number>;
    audioBands?: AudioBands;
}

/*
 * A value above 1 can only come from the 0..255 analyser; at or below 1 the two
 * scales are indistinguishable only at near-silence (≤ 1/255), where the error
 * does not matter.
 */
const normalize = (value: number | undefined): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
    return value > 1 ? Math.min(1, value / 255) : value;
};

/**
 * `readSource` is called on every read, so the caller can swap the underlying
 * MotionValues (a new props object) without remounting the mod.
 */
export const createFoliumAudio = (readSource: () => FoliumAudioSource): FoliumAudio => {
    const bands: { -readonly [K in keyof FoliumAudioBands]: number } = { bass: 0, lowMid: 0, mid: 0, vocal: 0, treble: 0 };
    return Object.freeze({
        getPower: () => normalize(readSource().audioPower?.get()),
        getBands: () => {
            const source = readSource().audioBands;
            bands.bass = normalize(source?.bass.get());
            bands.lowMid = normalize(source?.lowMid.get());
            bands.mid = normalize(source?.mid.get());
            bands.vocal = normalize(source?.vocal.get());
            bands.treble = normalize(source?.treble.get());
            return bands;
        },
        getSpectrum: () => {
            const spectrum = readSource().audioBands?.spectrum?.get();
            return spectrum && spectrum.length > 0 ? spectrum : null;
        },
    });
};
