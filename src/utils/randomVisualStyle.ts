import {
    DEFAULT_CADENZA_TUNING, DEFAULT_CAPPELLA_TUNING, DEFAULT_CLADDAGH_TUNING, DEFAULT_CLASSIC_TUNING,
    DEFAULT_DIORAMA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING, DEFAULT_LUMIERE_TUNING,
    DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_MONET_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING,
    DEFAULT_PARTITA_TUNING, DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_SORA_BACKGROUND_TUNING,
    DEFAULT_TEMPERA_TUNING, DEFAULT_TILT_TUNING,
} from '../types';
import type { RandomVisualStyleScope, RandomVisualStyleTunings } from '../types/randomVisualStyle';

// src/utils/randomVisualStyle.ts
// Generate readable random values; existing store setters enforce their persisted bounds.

const TUNING_DEFAULTS = {
    classicTuning: DEFAULT_CLASSIC_TUNING, cadenzaTuning: DEFAULT_CADENZA_TUNING,
    partitaTuning: DEFAULT_PARTITA_TUNING, fumeTuning: DEFAULT_FUME_TUNING,
    claddaghTuning: DEFAULT_CLADDAGH_TUNING, cappellaTuning: DEFAULT_CAPPELLA_TUNING,
    tiltTuning: DEFAULT_TILT_TUNING, dioramaTuning: DEFAULT_DIORAMA_TUNING, monetTuning: DEFAULT_MONET_TUNING,
    pendoloTuning: DEFAULT_PENDOLO_TUNING, sonnetTuning: DEFAULT_SONNET_TUNING,
    temperaTuning: DEFAULT_TEMPERA_TUNING, lumiereTuning: DEFAULT_LUMIERE_TUNING,
    monetBackgroundTuning: DEFAULT_MONET_BACKGROUND_TUNING, nomandBackgroundTuning: DEFAULT_NOMAND_BACKGROUND_TUNING,
    latentBackgroundTuning: DEFAULT_LATENT_BACKGROUND_TUNING, soraBackgroundTuning: DEFAULT_SORA_BACKGROUND_TUNING,
};

type VisualStyleTuningKey = keyof typeof TUNING_DEFAULTS;
type NumberRange = readonly [number, number];
const ENUMS: Record<string, readonly unknown[]> = {
    cameraTrackingMode: ['stepped', 'smooth'], colorScheme: ['default', 'swap', 'accentAll', 'primaryAll'],
    showGearDecor: ['none', 'subtle', 'full'], outerFrameMode: ['none', 'frame', 'full'],
    emojiPackSource: ['builtin', 'custom'], avatarSource: ['cover', 'builtin', 'color', 'custom'],
    colorMode: ['duo', 'mono', 'gradient'], layerImageDepth: ['back', 'front'],
    renderQuality: ['full', 'balanced', 'low'], windowNeighbors: [1, 2],
    backgroundSource: ['cover-derived', 'uploaded-global'], imageSource: ['cover-derived', 'uploaded-global'],
    backgroundLayout: ['full-overlay', 'half-pane-gradient'], backgroundWashColorMode: ['theme', 'custom'],
    effect: ['dithering', 'fluted-glass', 'paper-texture', 'halftone-dots', 'lens-distortion'],
    ditheringType: ['2x2', '4x4', '8x8'], displayMode: ['dithering', 'mesh', 'both'],
    colorSource: ['cover-theme', 'cover-only'], audioStyle: ['bar', 'line'], portraitSource: ['cover', 'custom'],
    portraitStyle: ['square', 'rectangular'], mode: ['clouds', 'corridor'],
};

const RANGES: Partial<Record<VisualStyleTuningKey, Record<string, NumberRange>>> = {
    classicTuning: { breathingFloatMultiplier: [0.3, 1.5], wordSpacing: [0.4, 1.2] },
    cadenzaTuning: { fontScale: [0.95, 1.25], widthRatio: [0.62, 0.85], motionAmount: [0.5, 1.25], glowIntensity: [0.4, 1.2], beamIntensity: [0, 0] },
    partitaTuning: { staggerMin: [10, 55], staggerMax: [65, 150] },
    fumeTuning: { backgroundObjectOpacity: [0.15, 0.55], textHoldRatio: [0.75, 1], cameraSpeed: [0.65, 1.2], glowIntensity: [0.4, 1.2], heroScale: [0.85, 1.15] },
    claddaghTuning: { focusScaleRatio: [0.5, 0.8], radiusScale: [0.85, 1.2], ellipseTiltDeg: [25, 60], letterSpacingOffset: [-1, 3] },
    tiltTuning: { splitProbability: [0.2, 0.9], tiltStyleProbability: [0.1, 0.65] },
    pendoloTuning: { arcRadius: [0.35, 0.55], arcAngleDeg: [75, 130], wheelCenterX: [-0.1, 0.2], wheelCenterY: [0.4, 0.6], tickSnappiness: [0.9, 1.7], activeScale: [1.1, 1.4] },
    sonnetTuning: { cameraIntensity: [0.4, 1.25], typographyMotion: [0.5, 1.3], mgDensity: [0.4, 1.2], textureResolution: [1, 1.5], postProcessGrain: [0, 0.25], postProcessContrast: [0, 0.25], postProcessRgbShift: [0, 0.15], postProcessHalftone: [0, 0.2], postProcessVignette: [0.3, 1], postProcessLensDistortion: [0, 0.4], postProcessLensDispersion: [0, 0.25] },
    temperaTuning: { cameraIntensity: [0.4, 1.25], glyphMotion: [0.5, 1.3], glyphSettleStretch: [0.2, 0.8], layerImageFrequency: [0.2, 0.8], textureResolution: [1, 1.5], postProcessGrain: [0, 0.25], postProcessContrast: [0, 0.25], postProcessRgbShift: [0, 0.15], postProcessVignette: [0.3, 1], postProcessLensDistortion: [0, 0.4] },
    lumiereTuning: { lightIntensity: [0.7, 1.4], audioResponse: [0.4, 1.4], fogDensity: [0.3, 1.2], darkField: [0.6, 0.95], moteAmount: [0.3, 1.2], bloom: [0.4, 1.2], textBloom: [0.3, 1], unlitOpacity: [0.18, 0.4], decay: [0.3, 1.2], echo: [0.2, 1], fogOctaves: [3, 5], themeColorMix: [0.1, 0.8] },
    dioramaTuning: { cameraSpeed: [0.65, 1.2], motionAmount: [0.5, 1.15], audioReactivity: [0.3, 1.2], particleDensity: [200, 700], particleScale: [0.75, 1.2], particleGlowIntensity: [0.3, 0.85], backgroundParticleCircumference: [16, 36], backgroundParticleRadial: [1, 3], glowIntensity: [0.4, 1.2], soulIntensity: [0.3, 0.9], gradientIntensity: [0.4, 1.2] },
    monetTuning: { fontScale: [0.95, 1.25], portraitOffsetX: [-60, 0] },
    monetBackgroundTuning: { backgroundBlurPx: [0, 12], backgroundOverlayOpacity: [0.45, 0.85], backgroundGrayscale: [0, 0.7], backgroundSaturation: [0.6, 1.4], backgroundWash: [0.15, 0.6], backgroundHalfPaneOffsetX: [-15, 15], backgroundDriftStrength: [0.15, 0.65] },
    nomandBackgroundTuning: { size: [1, 8], colorSteps: [2, 6], flutedGlassSize: [0.2, 0.7], flutedGlassDistortion: [0.1, 0.5], flutedGlassBlur: [0.1, 0.5], paperTextureContrast: [0.15, 0.6], paperTextureRoughness: [0.1, 0.6], paperTextureFiber: [0.1, 0.6], halftoneDotsSize: [0.2, 0.7], halftoneDotsRadius: [0.2, 0.65], halftoneDotsContrast: [0.1, 0.6], lensDistortionSpread: [0.15, 0.65], lensDistortionBulge: [0.1, 0.5], lensDistortionDispersion: [0, 0.3], overlayOpacity: [0.25, 0.7] },
    latentBackgroundTuning: { ditheringSpeed: [0.3, 1.1], ditheringAudioSpeed: [0.3, 1.2], ditheringSize: [1, 5], ditheringOpacity: [0.25, 0.65], meshSpeed: [0.3, 1.1], meshAudioSpeed: [0.3, 1.2], meshDistortion: [0.3, 1.2], meshSwirl: [0.15, 0.65], overlayOpacity: [0.25, 0.7] },
};

export const chooseVisualStyleValue = <T>(values: readonly T[], random: () => number): T => {
    const draw = random();
    const normalized = Number.isFinite(draw) ? Math.min(1 - Number.EPSILON, Math.max(0, draw)) : 0;
    return values[Math.floor(normalized * values.length)];
};

export const randomVisualStyleNumber = (min: number, max: number, random: () => number): number => {
    const draw = random();
    const normalized = Number.isFinite(draw) ? Math.min(1, Math.max(0, draw)) : 0;
    return Math.round((min + normalized * (max - min)) * 100) / 100;
};

const record = (value: object): Record<string, unknown> => value as Record<string, unknown>;

// Asset source choices are replaced by the service after it checks which local resources exist.
export const randomizeVisualStyleTunings = (current: RandomVisualStyleTunings, scope: RandomVisualStyleScope, random: () => number): RandomVisualStyleTunings => {
    const randomized = Object.fromEntries(Object.entries(TUNING_DEFAULTS).map(([tuningKey, defaults]) => {
        if (scope === 'lyrics' && tuningKey.endsWith('BackgroundTuning')) return [tuningKey, current[tuningKey as VisualStyleTuningKey]];
        const ranges = RANGES[tuningKey as VisualStyleTuningKey] ?? {};
        const randomFields = (template: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(template).map(([key, value]) => {
            if (ENUMS[key]) return [key, chooseVisualStyleValue(ENUMS[key], random)];
            if (typeof value === 'boolean') return [key, random() < 0.5];
            if (typeof value === 'number') {
                const range = ranges[key];
                const next = range ? randomVisualStyleNumber(...range, random) : value;
                return [key, ['particleDensity', 'backgroundParticleCircumference', 'backgroundParticleRadial', 'fogOctaves', 'colorSteps'].includes(key) ? Math.round(next) : next];
            }
            if (value !== null && typeof value === 'object' && !Array.isArray(value)) return [key, randomFields(record(value))];
            return [key, value];
        }));
        const next = randomFields(record(defaults));
        if (tuningKey === 'temperaTuning') next.layerImages = current.temperaTuning.layerImages.map(image => ({
            ...image, align: chooseVisualStyleValue(['left', 'center', 'right', 'free'] as const, random),
            verticalAlign: chooseVisualStyleValue(['top', 'center', 'bottom', 'free'] as const, random),
            scale: randomVisualStyleNumber(0.4, 1, random), opacity: randomVisualStyleNumber(0.4, 0.9, random),
        }));
        if (tuningKey === 'monetBackgroundTuning') next.backgroundWashCustomColor = chooseVisualStyleValue(['#8fb7ff', '#d5a0c9', '#90b9a7', '#c5aa7b', '#a5a7d8'], random);
        return [tuningKey, next];
    }));
    return randomized as unknown as RandomVisualStyleTunings;
};
