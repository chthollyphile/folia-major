import { DEFAULT_MONET_BACKGROUND_TUNING, type MonetBackgroundLayout, type MonetBackgroundSource, type MonetBackgroundTuning, type MonetBackgroundWashColorMode } from '../../../../types';
import { defineBackgroundTuning, type StoredTuningFields } from '../../tuningDefinition';
import { monetBackgroundImageActions, type MonetBackgroundImageActions } from './imageUpload';

// src/components/visualizer/backgrounds/monet/tuning.ts
// The monet background's tuning: its defaults, the settings store fields it lives in, where it is
// stored and how a stored value and a change are read, and its actions for the listener's own picture.

declare module '../definition' {
    interface VisualizerBackgroundConfig {
        monet?: BackgroundTuningSlot<MonetBackgroundTuning>;
    }
    interface VisualizerBackgroundActions {
        monet?: BackgroundTuningActionSlot<MonetBackgroundTuning>;
    }
}

declare module '../../tuningDefinition' {
    interface VisualizerTuningSettings extends
        StoredTuningFields<'monetBackgroundTuning', 'handleSetMonetBackgroundTuning', 'handleResetMonetBackgroundTuning', MonetBackgroundTuning>,
        MonetBackgroundImageActions {}
}

const backgroundSource = (value: MonetBackgroundSource | undefined): MonetBackgroundSource => (
    value === 'uploaded-global' ? 'uploaded-global' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundSource
);

const backgroundLayout = (value: MonetBackgroundLayout | undefined): MonetBackgroundLayout => (
    value === 'full-overlay' || value === 'half-pane-gradient'
        ? value
        : DEFAULT_MONET_BACKGROUND_TUNING.backgroundLayout
);

const washColorMode = (value: MonetBackgroundWashColorMode | undefined): MonetBackgroundWashColorMode => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashColorMode
);

/** A finite number kept between `min` and `max`; anything else is the fallback. */
const inRange = (min: number, max: number) => (value: number, fallback: number) => (
    Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
);

const blurPx = inRange(0, 60);
const unitInterval = inRange(0, 1);
const saturation = inRange(0, 2);
const offsetX = inRange(-40, 40);

const hexColor = (value: unknown, fallback: string) => {
    if (typeof value !== 'string') {
        return fallback;
    }

    const trimmed = value.trim();
    const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
    if (!/^[0-9a-fA-F]{6}$/.test(withoutHash)) {
        return fallback;
    }

    return `#${withoutHash.toLowerCase()}`;
};

// Fields of earlier versions that a stored tuning may still carry; they are passed over.
export type StoredMonetBackgroundTuningInput = Partial<MonetBackgroundTuning> & {
    backgroundCropMode?: unknown;
    coverPaneRatio?: unknown;
    lyricsFocusScale?: unknown;
};

/** A stored tuning, or a part of one, as a whole valid tuning. */
export const resolveStoredMonetBackgroundTuning = (parsed: StoredMonetBackgroundTuningInput): MonetBackgroundTuning => ({
    backgroundSource: backgroundSource(parsed.backgroundSource),
    backgroundLayout: backgroundLayout(parsed.backgroundLayout),
    backgroundBlurPx: blurPx(
        parsed.backgroundBlurPx ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundBlurPx,
    ),
    backgroundOverlayOpacity: unitInterval(
        parsed.backgroundOverlayOpacity ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundOverlayOpacity,
    ),
    backgroundGrayscale: unitInterval(
        parsed.backgroundGrayscale ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundGrayscale,
    ),
    backgroundSaturation: saturation(
        parsed.backgroundSaturation ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundSaturation,
    ),
    backgroundWash: unitInterval(
        parsed.backgroundWash ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWash,
    ),
    backgroundHalfPaneOffsetX: offsetX(
        parsed.backgroundHalfPaneOffsetX ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundHalfPaneOffsetX,
    ),
    backgroundWashColorMode: washColorMode(parsed.backgroundWashColorMode),
    backgroundWashCustomColor: hexColor(
        parsed.backgroundWashCustomColor,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundWashCustomColor,
    ),
    backgroundDriftEnabled: parsed.backgroundDriftEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftEnabled,
    backgroundDriftStrength: unitInterval(
        parsed.backgroundDriftStrength ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
        DEFAULT_MONET_BACKGROUND_TUNING.backgroundDriftStrength,
    ),
    backgroundStreaksEnabled: parsed.backgroundStreaksEnabled ?? DEFAULT_MONET_BACKGROUND_TUNING.backgroundStreaksEnabled,
});

export default defineBackgroundTuning<MonetBackgroundTuning>({
    mode: 'monet',
    defaults: DEFAULT_MONET_BACKGROUND_TUNING,
    settingsKey: 'monetBackgroundTuning',
    settingsSetterKey: 'handleSetMonetBackgroundTuning',
    settingsResetterKey: 'handleResetMonetBackgroundTuning',
    storage: {
        key: 'monet_background_tuning',
        // Before this background had a key of its own, its settings lay in the monet style's.
        olderKeys: ['monet_tuning'],
        read: resolveStoredMonetBackgroundTuning,
        merge: (held, patch) => resolveStoredMonetBackgroundTuning({ ...held, ...patch }),
        resetNotice: 'notifications.monetBgReset',
        actions: monetBackgroundImageActions,
    },
});
