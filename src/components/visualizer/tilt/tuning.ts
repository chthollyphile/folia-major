import { DEFAULT_TILT_TUNING, type TiltTuning } from '../../../types';
import { defineVisualizerTuning, modNumber, modChoice, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/tilt/tuning.ts
// Tilt's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'tiltTuning', 'handleSetTiltTuning', 'handleResetTiltTuning', TiltTuning> {}
}

/** The tuning `values` ask for, with `base` where they say nothing: both probabilities between 0 and 1. */
const resolve = (values: Partial<TiltTuning>, base: TiltTuning): TiltTuning => ({
    splitProbability: Math.min(1, Math.max(0, values.splitProbability ?? base.splitProbability)),
    tiltStyleProbability: Math.min(1, Math.max(0, values.tiltStyleProbability ?? base.tiltStyleProbability)),
    colorScheme: values.colorScheme ?? base.colorScheme,
});

export default defineVisualizerTuning<TiltTuning>({
    mode: 'tilt',
    defaults: DEFAULT_TILT_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        splitProbability: modNumber(0, 1),
        tiltStyleProbability: modNumber(0, 1),
        colorScheme: modChoice(['default', 'swap', 'accentAll', 'primaryAll']),
    },
    settingsKey: 'tiltTuning',
    settingsSetterKey: 'handleSetTiltTuning',
    settingsResetterKey: 'handleResetTiltTuning',
    storage: {
        key: 'tilt_tuning',
        read: (stored: Partial<TiltTuning>) => resolve(stored, DEFAULT_TILT_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.tiltReset',
    },
    apply: (props, tuning) => ({ ...props, tiltTuning: tuning }),
});
