import { DEFAULT_LATENT_BACKGROUND_TUNING, type LatentBackgroundColorSource, type LatentBackgroundDisplayMode, type LatentBackgroundTuning } from '../../../../types';
import { defineBackgroundTuning, type StoredTuningFields } from '../../tuningDefinition';

// src/components/visualizer/backgrounds/latent/tuning.ts
// The latent background's tuning: its defaults, the settings store fields it lives in, where it
// is stored and how a stored value and a change are read.

declare module '../definition' {
    interface VisualizerBackgroundConfig {
        latent?: BackgroundTuningSlot<LatentBackgroundTuning>;
    }
    interface VisualizerBackgroundActions {
        latent?: BackgroundTuningActionSlot<LatentBackgroundTuning>;
    }
}

declare module '../../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'latentBackgroundTuning', 'handleSetLatentBackgroundTuning', 'handleResetLatentBackgroundTuning', LatentBackgroundTuning> {}
}

const resolveLatentDisplayMode = (value: unknown): LatentBackgroundDisplayMode => (
    value === 'dithering' || value === 'mesh' || value === 'both'
        ? value
        : DEFAULT_LATENT_BACKGROUND_TUNING.displayMode
);

const resolveLatentColorSource = (value: unknown): LatentBackgroundColorSource => (
    value === 'cover-only' ? 'cover-only' : DEFAULT_LATENT_BACKGROUND_TUNING.colorSource
);

const clampLatentNumber = (value: unknown, fallback: number, min: number, max: number) => (
    Math.min(max, Math.max(min, typeof value === 'number' && Number.isFinite(value) ? value : fallback))
);

export const resolveStoredLatentBackgroundTuning = (
    parsed: Partial<LatentBackgroundTuning>,
): LatentBackgroundTuning => ({
    displayMode: resolveLatentDisplayMode(parsed.displayMode),
    colorSource: resolveLatentColorSource(parsed.colorSource),
    dynamicOnlyInPlayer: typeof parsed.dynamicOnlyInPlayer === 'boolean'
        ? parsed.dynamicOnlyInPlayer
        : DEFAULT_LATENT_BACKGROUND_TUNING.dynamicOnlyInPlayer,
    enhancedBeatResponse: typeof parsed.enhancedBeatResponse === 'boolean'
        ? parsed.enhancedBeatResponse
        : DEFAULT_LATENT_BACKGROUND_TUNING.enhancedBeatResponse,
    ditheringSpeed: clampLatentNumber(parsed.ditheringSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSpeed, 0, 2),
    ditheringAudioSpeed: clampLatentNumber(parsed.ditheringAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringAudioSpeed, 0, 2),
    ditheringSize: clampLatentNumber(parsed.ditheringSize, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringSize, 0.5, 8),
    ditheringOpacity: clampLatentNumber(parsed.ditheringOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.ditheringOpacity, 0, 1),
    meshSpeed: clampLatentNumber(parsed.meshSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshSpeed, 0, 2),
    meshAudioSpeed: clampLatentNumber(parsed.meshAudioSpeed, DEFAULT_LATENT_BACKGROUND_TUNING.meshAudioSpeed, 0, 2),
    meshDistortion: clampLatentNumber(parsed.meshDistortion, DEFAULT_LATENT_BACKGROUND_TUNING.meshDistortion, 0, 2),
    meshSwirl: clampLatentNumber(parsed.meshSwirl, DEFAULT_LATENT_BACKGROUND_TUNING.meshSwirl, 0, 1),
    overlayEnabled: typeof parsed.overlayEnabled === 'boolean'
        ? parsed.overlayEnabled
        : DEFAULT_LATENT_BACKGROUND_TUNING.overlayEnabled,
    overlayOpacity: clampLatentNumber(parsed.overlayOpacity, DEFAULT_LATENT_BACKGROUND_TUNING.overlayOpacity, 0, 1),
});

export default defineBackgroundTuning<LatentBackgroundTuning>({
    mode: 'latent',
    defaults: DEFAULT_LATENT_BACKGROUND_TUNING,
    settingsKey: 'latentBackgroundTuning',
    settingsSetterKey: 'handleSetLatentBackgroundTuning',
    settingsResetterKey: 'handleResetLatentBackgroundTuning',
    storage: {
        key: 'latent_background_tuning',
        read: resolveStoredLatentBackgroundTuning,
        merge: (held, patch) => resolveStoredLatentBackgroundTuning({ ...held, ...patch }),
        resetNotice: 'notifications.latentBgReset',
    },
});
