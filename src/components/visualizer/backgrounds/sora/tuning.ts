import { DEFAULT_SORA_BACKGROUND_TUNING, type SoraBackgroundTuning } from '../../../../types';
import { defineBackgroundTuning, type StoredTuningFields } from '../../tuningDefinition';

// src/components/visualizer/backgrounds/sora/tuning.ts
// The sora background's tuning: its defaults, the settings store fields it lives in, where it is
// stored and how a stored value and a change are read.

declare module '../definition' {
    interface VisualizerBackgroundConfig {
        sora?: BackgroundTuningSlot<SoraBackgroundTuning>;
    }
    interface VisualizerBackgroundActions {
        sora?: BackgroundTuningActionSlot<SoraBackgroundTuning>;
    }
}

declare module '../../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'soraBackgroundTuning', 'handleSetSoraBackgroundTuning', 'handleResetSoraBackgroundTuning', SoraBackgroundTuning> {}
}

const resolveStoredSoraBackgroundTuning = (
    parsed: Partial<SoraBackgroundTuning>,
): SoraBackgroundTuning => ({
    blank: typeof parsed.blank === 'boolean' ? parsed.blank : DEFAULT_SORA_BACKGROUND_TUNING.blank,
});

export default defineBackgroundTuning<SoraBackgroundTuning>({
    mode: 'sora',
    defaults: DEFAULT_SORA_BACKGROUND_TUNING,
    settingsKey: 'soraBackgroundTuning',
    settingsSetterKey: 'handleSetSoraBackgroundTuning',
    settingsResetterKey: 'handleResetSoraBackgroundTuning',
    storage: {
        key: 'sora_background_tuning',
        read: resolveStoredSoraBackgroundTuning,
        merge: (held, patch) => resolveStoredSoraBackgroundTuning({ ...held, ...patch }),
    },
});
