import { defineVisualizerTuning, numberWithin, type StoredTuningFields } from '../tuningDefinition';
import { DEFAULT_MOTES_TUNING, MOTES_TUNING_LIMITS, type MotesTuning } from './types';

// Motes owns its persisted settings; import, sync and previews use the shared tuning bundle.
declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'motesTuning', 'handleSetMotesTuning', 'handleResetMotesTuning', MotesTuning> {}
}

/** Normalize persisted or imported values before they reach particle layout or animation. */
export const normalizeMotesTuning = (stored: unknown): MotesTuning => {
    const values = stored !== null && typeof stored === 'object'
        ? stored as Partial<MotesTuning>
        : {};
    return {
        density: numberWithin(values.density, DEFAULT_MOTES_TUNING.density, MOTES_TUNING_LIMITS.density.min, MOTES_TUNING_LIMITS.density.max),
        scatter: numberWithin(values.scatter, DEFAULT_MOTES_TUNING.scatter, MOTES_TUNING_LIMITS.scatter.min, MOTES_TUNING_LIMITS.scatter.max),
        transition: numberWithin(values.transition, DEFAULT_MOTES_TUNING.transition, MOTES_TUNING_LIMITS.transition.min, MOTES_TUNING_LIMITS.transition.max),
        depth: numberWithin(values.depth, DEFAULT_MOTES_TUNING.depth, MOTES_TUNING_LIMITS.depth.min, MOTES_TUNING_LIMITS.depth.max),
        drift: numberWithin(values.drift, DEFAULT_MOTES_TUNING.drift, MOTES_TUNING_LIMITS.drift.min, MOTES_TUNING_LIMITS.drift.max),
        audioResponse: numberWithin(values.audioResponse, DEFAULT_MOTES_TUNING.audioResponse, MOTES_TUNING_LIMITS.audioResponse.min, MOTES_TUNING_LIMITS.audioResponse.max),
    };
};

export default defineVisualizerTuning<MotesTuning>({
    mode: 'motes',
    defaults: DEFAULT_MOTES_TUNING,
    settingsKey: 'motesTuning',
    settingsSetterKey: 'handleSetMotesTuning',
    settingsResetterKey: 'handleResetMotesTuning',
    storage: {
        key: 'motes_tuning',
        read: normalizeMotesTuning,
        merge: (held, patch) => normalizeMotesTuning({ ...held, ...patch }),
        resetNotice: 'notifications.motesReset',
    },
});
