import { DEFAULT_NOMAND_BACKGROUND_TUNING, type NomandBackgroundDitheringType, type NomandBackgroundEffect, type NomandBackgroundSource, type NomandBackgroundTuning } from '../../../../types';
import { defineBackgroundTuning, type StoredTuningFields } from '../../tuningDefinition';

// src/components/visualizer/backgrounds/nomand/tuning.ts
// The nomand background's tuning: its defaults, the settings store fields it lives in, where it
// is stored and how a stored value and a change are read.

declare module '../definition' {
    interface VisualizerBackgroundConfig {
        nomand?: BackgroundTuningSlot<NomandBackgroundTuning>;
    }
    interface VisualizerBackgroundActions {
        nomand?: BackgroundTuningActionSlot<NomandBackgroundTuning>;
    }
}

declare module '../../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'nomandBackgroundTuning', 'handleSetNomandBackgroundTuning', 'handleResetNomandBackgroundTuning', NomandBackgroundTuning> {}
}

const resolveNomandBackgroundSource = (value: NomandBackgroundSource | undefined): NomandBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_NOMAND_BACKGROUND_TUNING.imageSource
);

const resolveNomandDitheringType = (
    value: unknown,
): NomandBackgroundDitheringType => (
    value === '2x2' || value === '4x4' || value === '8x8'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.ditheringType
);

const resolveNomandBackgroundEffect = (value: unknown): NomandBackgroundEffect => (
    value === 'fluted-glass'
        || value === 'paper-texture'
        || value === 'halftone-dots'
        || value === 'lens-distortion'
        || value === 'dithering'
        ? value
        : DEFAULT_NOMAND_BACKGROUND_TUNING.effect
);

const clampNomandEffectValue = (value: unknown, fallback: number, min = 0, max = 1) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

type StoredNomandBackgroundTuningInput = Omit<Partial<NomandBackgroundTuning>, 'ditheringType' | 'effect'> & {
    ditheringType?: unknown;
    effect?: unknown;
};

export const resolveStoredNomandBackgroundTuning = (
    parsed: StoredNomandBackgroundTuningInput,
): NomandBackgroundTuning => ({
    imageSource: resolveNomandBackgroundSource(parsed.imageSource),
    effect: resolveNomandBackgroundEffect(parsed.effect),
    ditheringType: resolveNomandDitheringType(parsed.ditheringType),
    size: Math.min(20, Math.max(0.5, Number.isFinite(parsed.size) ? parsed.size! : DEFAULT_NOMAND_BACKGROUND_TUNING.size)),
    colorSteps: Math.min(7, Math.max(1, Math.round(Number.isFinite(parsed.colorSteps) ? parsed.colorSteps! : DEFAULT_NOMAND_BACKGROUND_TUNING.colorSteps))),
    originalColors: parsed.originalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.originalColors,
    inverted: parsed.inverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.inverted,
    flutedGlassSize: clampNomandEffectValue(
        parsed.flutedGlassSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassSize,
        0.1,
    ),
    flutedGlassDistortion: clampNomandEffectValue(
        parsed.flutedGlassDistortion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassDistortion,
    ),
    flutedGlassBlur: clampNomandEffectValue(
        parsed.flutedGlassBlur,
        DEFAULT_NOMAND_BACKGROUND_TUNING.flutedGlassBlur,
    ),
    paperTextureContrast: clampNomandEffectValue(
        parsed.paperTextureContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureContrast,
    ),
    paperTextureRoughness: clampNomandEffectValue(
        parsed.paperTextureRoughness,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureRoughness,
    ),
    paperTextureFiber: clampNomandEffectValue(
        parsed.paperTextureFiber,
        DEFAULT_NOMAND_BACKGROUND_TUNING.paperTextureFiber,
    ),
    halftoneDotsSize: clampNomandEffectValue(
        parsed.halftoneDotsSize,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsSize,
        0.1,
    ),
    halftoneDotsRadius: clampNomandEffectValue(
        parsed.halftoneDotsRadius,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsRadius,
        0.1,
        2,
    ),
    halftoneDotsContrast: clampNomandEffectValue(
        parsed.halftoneDotsContrast,
        DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsContrast,
    ),
    halftoneDotsOriginalColors: parsed.halftoneDotsOriginalColors ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsOriginalColors,
    halftoneDotsInverted: parsed.halftoneDotsInverted ?? DEFAULT_NOMAND_BACKGROUND_TUNING.halftoneDotsInverted,
    lensDistortionSpread: clampNomandEffectValue(
        parsed.lensDistortionSpread,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionSpread,
    ),
    lensDistortionBulge: clampNomandEffectValue(
        parsed.lensDistortionBulge,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionBulge,
        -1,
        1,
    ),
    lensDistortionDispersion: clampNomandEffectValue(
        parsed.lensDistortionDispersion,
        DEFAULT_NOMAND_BACKGROUND_TUNING.lensDistortionDispersion,
    ),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: Math.min(1, Math.max(0,
        Number.isFinite(parsed.overlayOpacity)
            ? parsed.overlayOpacity!
            : DEFAULT_NOMAND_BACKGROUND_TUNING.overlayOpacity
    )),
});

export default defineBackgroundTuning<NomandBackgroundTuning>({
    mode: 'nomand',
    defaults: DEFAULT_NOMAND_BACKGROUND_TUNING,
    settingsKey: 'nomandBackgroundTuning',
    settingsSetterKey: 'handleSetNomandBackgroundTuning',
    settingsResetterKey: 'handleResetNomandBackgroundTuning',
    storage: {
        key: 'nomand_background_tuning',
        read: resolveStoredNomandBackgroundTuning,
        merge: (held, patch) => resolveStoredNomandBackgroundTuning({ ...held, ...patch }),
        resetNotice: 'notifications.nomandBgReset',
    },
});
