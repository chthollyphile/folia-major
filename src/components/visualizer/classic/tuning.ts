import { DEFAULT_CLASSIC_TUNING, type ClassicTuning } from '../../../types';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/classic/tuning.ts
// Classic's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'classicTuning', 'handleSetClassicTuning', 'handleResetClassicTuning', ClassicTuning> {}
}

/** The float multiplier and the word spacing both run from 0 to 2. */
const zeroToTwo = (value: number, fallback: number) => (Number.isFinite(value) ? Math.min(2, Math.max(0, value)) : fallback);

const DEFAULT_WORD_SPACING = DEFAULT_CLASSIC_TUNING.wordSpacing ?? 0.7;

export default defineVisualizerTuning<ClassicTuning>({
    mode: 'classic',
    defaults: DEFAULT_CLASSIC_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        enableWordRotation: MOD_SWITCH,
        useLegacyLayout: MOD_SWITCH,
        breathingFloatMultiplier: modNumber(0, 2),
        wordSpacing: modNumber(0, 2),
    },
    settingsKey: 'classicTuning',
    settingsSetterKey: 'handleSetClassicTuning',
    settingsResetterKey: 'handleResetClassicTuning',
    storage: {
        key: 'classic_tuning',
        read: (stored: Partial<ClassicTuning>) => ({
            enableWordRotation: stored.enableWordRotation ?? DEFAULT_CLASSIC_TUNING.enableWordRotation,
            breathingFloatMultiplier: zeroToTwo(
                stored.breathingFloatMultiplier ?? DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
                DEFAULT_CLASSIC_TUNING.breathingFloatMultiplier,
            ),
            useLegacyLayout: stored.useLegacyLayout ?? DEFAULT_CLASSIC_TUNING.useLegacyLayout,
            wordSpacing: zeroToTwo(stored.wordSpacing ?? DEFAULT_WORD_SPACING, DEFAULT_WORD_SPACING),
        }),
        merge: (held, patch) => ({
            enableWordRotation: patch.enableWordRotation ?? held.enableWordRotation,
            breathingFloatMultiplier: zeroToTwo(
                patch.breathingFloatMultiplier ?? held.breathingFloatMultiplier,
                held.breathingFloatMultiplier,
            ),
            useLegacyLayout: patch.useLegacyLayout ?? held.useLegacyLayout,
            wordSpacing: zeroToTwo(
                patch.wordSpacing ?? held.wordSpacing ?? DEFAULT_WORD_SPACING,
                held.wordSpacing ?? DEFAULT_WORD_SPACING,
            ),
        }),
        resetNotice: 'notifications.classicReset',
    },
    apply: (props, tuning) => ({ ...props, classicTuning: tuning }),
});
