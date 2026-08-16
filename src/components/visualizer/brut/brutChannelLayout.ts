import {
    BRUT_CHANNELS_PER_MODULE,
    BRUT_MODULE_HEIGHT,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { hash1, hashSigned } from './brutHash';
import { normalizeBrutFace } from './brutFaceBasis';

// src/components/visualizer/brut/brutChannelLayout.ts
// Recessed linear light channels tucked into the shadow gaps of the facade. Same rule as the
// relief: seeded purely by absolute module index, so they are stable across seeks.

export interface BrutLightChannel {
    face: number;
    lateral: number;
    y: number;
    /** Extent along the wall (horizontal strips) or vertically (vertical strips). */
    length: number;
    vertical: boolean;
    /** Offset into the travelling highlight, so the strips light up in a wave rather than together. */
    phase: number;
}

const STRIP_THICKNESS = 0.075;

export const createBrutModuleChannels = (): BrutLightChannel[] => (
    Array.from({ length: BRUT_CHANNELS_PER_MODULE }, () => ({
        face: 0,
        lateral: 0,
        y: 0,
        length: 1,
        vertical: true,
        phase: 0,
    }))
);

export const BRUT_CHANNEL_THICKNESS = STRIP_THICKNESS;

export const fillBrutModuleChannels = (
    out: BrutLightChannel[],
    patternSeed: number,
    moduleIndex: number,
): void => {
    const moduleBase = moduleIndex * BRUT_MODULE_HEIGHT;
    for (let index = 0; index < BRUT_CHANNELS_PER_MODULE; index += 1) {
        const seed = patternSeed * 5231 + moduleIndex * 87.31 + index * 11.9;
        const channel = out[index];
        const vertical = hash1(seed + 1) > 0.45;
        const length = vertical ? 1.4 + hash1(seed + 2) * 3.6 : 1.1 + hash1(seed + 2) * 3.2;

        channel.face = normalizeBrutFace(Math.floor(hash1(seed + 3) * 4));
        channel.vertical = vertical;
        channel.length = length;
        channel.lateral = hashSigned(seed + 4) * Math.max(0.2, BRUT_SHAFT_HALF * 2 - length - 0.8);
        channel.y = moduleBase + 0.4 + hash1(seed + 5) * Math.max(0.2, BRUT_MODULE_HEIGHT - length - 0.8);
        channel.phase = hash1(seed + 6);
    }
};
