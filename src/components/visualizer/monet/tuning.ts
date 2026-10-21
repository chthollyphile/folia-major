import { DEFAULT_MONET_TUNING, type MonetPortraitSource, type MonetTuning } from '../../../types';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';
import { monetPortraitActions, type MonetPortraitActions } from './portraitUpload';

// src/components/visualizer/monet/tuning.ts
// Monet's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, its actions for the listener's own portrait, and the
// renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends
        StoredTuningFields<'monetTuning', 'handleSetMonetTuning', 'handleResetMonetTuning', MonetTuning>,
        MonetPortraitActions {}
}

const fontScale = (value: number, fallback: number) => {
    if (!Number.isFinite(value)) {
        return fallback;
    }

    return Math.min(1.5, Math.max(0.7, value));
};

const portraitSource = (value: MonetPortraitSource | undefined): MonetPortraitSource => (
    value === 'custom' ? 'custom' : DEFAULT_MONET_TUNING.portraitSource
);

/**
 * A stored tuning, or a part of one, as a whole valid tuning. What is stored under this key may
 * still hold the monet background's settings from before that background had a key of its own:
 * they are passed over here.
 */
export const resolveStoredMonetTuning = (parsed: Partial<MonetTuning> & Record<string, unknown>): MonetTuning => ({
    keywordColoringEnabled: parsed.keywordColoringEnabled ?? DEFAULT_MONET_TUNING.keywordColoringEnabled,
    showDescription: parsed.showDescription ?? DEFAULT_MONET_TUNING.showDescription,
    showAudioVisualization: parsed.showAudioVisualization ?? DEFAULT_MONET_TUNING.showAudioVisualization,
    audioStyle: parsed.audioStyle === 'line' ? 'line' : DEFAULT_MONET_TUNING.audioStyle,
    audioPlacement: parsed.audioPlacement === 'lyrics' ? 'lyrics' : 'bottom',
    audioGain: typeof parsed.audioGain === 'number' && Number.isFinite(parsed.audioGain)
        ? Math.min(2, Math.max(0.5, parsed.audioGain))
        : 1,
    fontScale: fontScale(
        parsed.fontScale ?? DEFAULT_MONET_TUNING.fontScale,
        DEFAULT_MONET_TUNING.fontScale,
    ),
    portraitSource: portraitSource(parsed.portraitSource),
    portraitOffsetX: typeof parsed.portraitOffsetX === 'number'
        ? Math.min(0, Math.max(-150, parsed.portraitOffsetX))
        : (DEFAULT_MONET_TUNING.portraitOffsetX ?? 0),
    portraitStyle: parsed.portraitStyle === 'rectangular' ? 'rectangular' : DEFAULT_MONET_TUNING.portraitStyle,
    showPortraitDragHanger: parsed.showPortraitDragHanger ?? DEFAULT_MONET_TUNING.showPortraitDragHanger,
});

export default defineVisualizerTuning<MonetTuning>({
    mode: 'monet',
    defaults: DEFAULT_MONET_TUNING,
    settingsKey: 'monetTuning',
    settingsSetterKey: 'handleSetMonetTuning',
    settingsResetterKey: 'handleResetMonetTuning',
    storage: {
        key: 'monet_tuning',
        read: resolveStoredMonetTuning,
        merge: (held, patch) => resolveStoredMonetTuning({ ...held, ...patch }),
        resetNotice: 'notifications.monetReset',
        actions: monetPortraitActions,
    },
    // The portrait is dragged on the stage itself: the renderer reports the new offset through onMonetTuningChange.
    apply: (props, tuning) => ({ ...props, monetTuning: tuning, onMonetTuningChange: props.onMonetTuningChange ?? props.onVisualizerTuningChange }),
});
