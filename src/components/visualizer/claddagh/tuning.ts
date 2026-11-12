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
// 圆环位置（#1124）：画面宽、高的百分比，留在画面里。
export const CLADDAGH_POSITION_LIMIT_PERCENT = 40;
const position = inRange(-CLADDAGH_POSITION_LIMIT_PERCENT, CLADDAGH_POSITION_LIMIT_PERCENT);
const translationScale = inRange(0.5, 2);

/** A stored tuning, or a part of one laid over `base`, as a whole valid tuning. */
const resolve = (values: Partial<CladdaghTuning>, base: CladdaghTuning): CladdaghTuning => ({
    focusScaleRatio: focusScaleRatio(values.focusScaleRatio ?? base.focusScaleRatio, base.focusScaleRatio),
    radiusScale: radiusScale(values.radiusScale ?? base.radiusScale, base.radiusScale),
    ellipseTiltDeg: ellipseTiltDeg(values.ellipseTiltDeg ?? base.ellipseTiltDeg, base.ellipseTiltDeg),
    showAxisLine: typeof values.showAxisLine === 'boolean' ? values.showAxisLine : base.showAxisLine,
    letterSpacingOffset: letterSpacingOffset(values.letterSpacingOffset ?? base.letterSpacingOffset, base.letterSpacingOffset),
    // 旧存档没有下面几项：圆环在正中，不显示翻译。
    positionX: position(values.positionX ?? base.positionX, base.positionX ?? 0),
    positionY: position(values.positionY ?? base.positionY, base.positionY ?? 0),
    showTranslation: typeof values.showTranslation === 'boolean' ? values.showTranslation : (base.showTranslation ?? false),
    translationScale: translationScale(values.translationScale ?? base.translationScale, base.translationScale ?? 1),
    translationLetterSpacingOffset: letterSpacingOffset(
        values.translationLetterSpacingOffset ?? base.translationLetterSpacingOffset,
        base.translationLetterSpacingOffset ?? 0,
    ),
});

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
        positionX: modNumber(-CLADDAGH_POSITION_LIMIT_PERCENT, CLADDAGH_POSITION_LIMIT_PERCENT),
        positionY: modNumber(-CLADDAGH_POSITION_LIMIT_PERCENT, CLADDAGH_POSITION_LIMIT_PERCENT),
        showTranslation: MOD_SWITCH,
        translationScale: modNumber(0.5, 2),
        translationLetterSpacingOffset: modNumber(-5, 20),
    },
    settingsKey: 'claddaghTuning',
    settingsSetterKey: 'handleSetCladdaghTuning',
    settingsResetterKey: 'handleResetCladdaghTuning',
    storage: {
        key: 'claddagh_tuning',
        read: (stored: Partial<CladdaghTuning>) => resolve(stored, DEFAULT_CLADDAGH_TUNING),
        merge: (held, patch) => resolve(patch, held),
        resetNotice: 'notifications.claddaghReset',
    },
    apply: (props, tuning) => ({ ...props, claddaghTuning: tuning }),
});
