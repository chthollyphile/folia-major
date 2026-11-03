import { DEFAULT_CLADDAGH_TUNING, type CladdaghTuning } from '../../../types';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/claddagh/tuning.ts
// Claddagh's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'claddaghTuning', 'handleSetCladdaghTuning', 'handleResetCladdaghTuning', CladdaghTuning> {}
}

/** A number, or a text that reads as one, kept between `min` and `max`; anything else is the fallback. */
const inRange = (min: number, max: number) => (value: unknown, fallback: number): number => {
    const parsed = typeof value === 'number' ? value : parseFloat(value as string);
    return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
};

const focusScaleRatio = inRange(0.0, 1.5);
const radiusScale = inRange(0.5, 1.5);
const ellipseTiltDeg = inRange(0, 60);
const letterSpacingOffset = inRange(-5, 20);

export default defineVisualizerTuning<CladdaghTuning>({
    mode: 'claddagh',
    defaults: DEFAULT_CLADDAGH_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        focusScaleRatio: modNumber(0, 1.5),
        radiusScale: modNumber(0.5, 1.5),
        ellipseTiltDeg: modNumber(0, 60),
        showAxisLine: MOD_SWITCH,
        letterSpacingOffset: modNumber(-5, 20),
    },
    settingsKey: 'claddaghTuning',
    settingsSetterKey: 'handleSetCladdaghTuning',
    settingsResetterKey: 'handleResetCladdaghTuning',
    storage: {
        key: 'claddagh_tuning',
        read: (stored: Partial<CladdaghTuning>) => ({
            focusScaleRatio: focusScaleRatio(stored.focusScaleRatio, DEFAULT_CLADDAGH_TUNING.focusScaleRatio),
            radiusScale: radiusScale(stored.radiusScale, DEFAULT_CLADDAGH_TUNING.radiusScale),
            ellipseTiltDeg: ellipseTiltDeg(stored.ellipseTiltDeg, DEFAULT_CLADDAGH_TUNING.ellipseTiltDeg),
            showAxisLine: typeof stored.showAxisLine === 'boolean' ? stored.showAxisLine : DEFAULT_CLADDAGH_TUNING.showAxisLine,
            letterSpacingOffset: letterSpacingOffset(stored.letterSpacingOffset, DEFAULT_CLADDAGH_TUNING.letterSpacingOffset),
        }),
        merge: (held, patch) => ({
            focusScaleRatio: focusScaleRatio(patch.focusScaleRatio ?? held.focusScaleRatio, held.focusScaleRatio),
            radiusScale: radiusScale(patch.radiusScale ?? held.radiusScale, held.radiusScale),
            ellipseTiltDeg: ellipseTiltDeg(patch.ellipseTiltDeg ?? held.ellipseTiltDeg, held.ellipseTiltDeg),
            showAxisLine: patch.showAxisLine ?? held.showAxisLine,
            letterSpacingOffset: letterSpacingOffset(patch.letterSpacingOffset ?? held.letterSpacingOffset, held.letterSpacingOffset),
        }),
        resetNotice: 'notifications.claddaghReset',
    },
    apply: (props, tuning) => ({ ...props, claddaghTuning: tuning }),
});
