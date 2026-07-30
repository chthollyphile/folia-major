import type { SonnetTuning, Theme } from '../../../types';

// src/components/visualizer/sonnet/sonnetPostProcess.ts
// Builds PV style Post Processing (Noise, Color shifts, high contrast)
type PixiModule = typeof import('pixi.js');

export interface SonnetPostProcessProfile {
    glowStrength: number;
    glowAlpha: number;
    noise: number;
    contrast: number;
    glitchIntensity: number;
}

export const resolveSonnetPostProcessProfile = (
    theme: Theme,
    tuning: SonnetTuning,
    staticMode: boolean,
): SonnetPostProcessProfile => {
    if (staticMode) return { glowStrength: 0, glowAlpha: 0, noise: 0, contrast: 1, glitchIntensity: 0 };
    return {
        glowStrength: (2.8 + tuning.typographyMotion * 1.8),
        glowAlpha: Math.min(0.62, (0.28 + tuning.typographyMotion * 0.12)),
        noise: 0, // Removed noise per user request
        contrast: 1.2, // High contrast
        glitchIntensity: 1, // Used during transitions
    };
};

export const createSonnetHaloLayer = (
    pixi: PixiModule,
    profile: SonnetPostProcessProfile,
) => {
    const layer = new pixi.Container();
    const filters: import('pixi.js').Filter[] = [];
    if (profile.glowStrength > 0) {
        const blur = new pixi.BlurFilter({
            strength: profile.glowStrength,
            quality: 2,
            kernelSize: 5,
            resolution: 0.75,
        });
        layer.filters = [blur];
        layer.alpha = profile.glowAlpha;
        layer.blendMode = 'screen';
        filters.push(blur);
    }
    return { layer, filters };
};

export const applySonnetScenePostProcess = (
    pixi: PixiModule,
    container: import('pixi.js').Container,
    profile: SonnetPostProcessProfile,
    seed: number,
) => {
    const filters: import('pixi.js').Filter[] = [];
    
    // Noise Filter for print/film grain texture
    if (profile.noise > 0) {
        const noise = new pixi.NoiseFilter({
            noise: profile.noise,
            seed: (seed % 10_000) / 10_000,
            resolution: 0.75,
        });
        filters.push(noise);
    }

    // ColorMatrix for contrast removed to fix jaggedness (aliasing) on background elements
    // const colorMatrix = new pixi.ColorMatrixFilter();
    // colorMatrix.contrast(profile.contrast, false);
    // filters.push(colorMatrix);

    if (filters.length > 0) {
        container.filters = filters;
    }
    return filters;
};
