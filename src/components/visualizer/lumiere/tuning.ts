// Copyright (c) 2026 chthollyphile
import { DEFAULT_LUMIERE_TUNING, type LumiereTuning } from '../../../types';
import { normalizeLumiereTuning } from '../../../utils/lumiereTuning';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/lumiere/tuning.ts
// 绘光's tuning: its defaults, the settings store fields it lives in, where it is stored and how
// a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'lumiereTuning', 'handleSetLumiereTuning', 'handleResetLumiereTuning', LumiereTuning> {}
}

export default defineVisualizerTuning<LumiereTuning>({
    mode: 'lumiere',
    defaults: DEFAULT_LUMIERE_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        lightIntensity: modNumber(0.3, 2),
        audioResponse: modNumber(0, 2),
        fogDensity: modNumber(0, 2),
        darkField: modNumber(0, 1),
        moteAmount: modNumber(0, 2),
        bloom: modNumber(0, 2),
        textBloom: modNumber(0, 2),
        unlitOpacity: modNumber(0.05, 0.6),
        windowNeighbors: modNumber(1, 2, 1),
        decay: modNumber(0, 2),
        echo: modNumber(0, 2),
        lineArt: MOD_SWITCH,
        frontBokeh: MOD_SWITCH,
        trails: MOD_SWITCH,
        hideTrails: MOD_SWITCH,
        seamlessTransitions: MOD_SWITCH,
        overlayFrame: MOD_SWITCH,
        textOnly: MOD_SWITCH,
        keywordColors: MOD_SWITCH,
        themeIcons: MOD_SWITCH,
        themeColorMix: modNumber(0, 1),
    },
    settingsKey: 'lumiereTuning',
    settingsSetterKey: 'handleSetLumiereTuning',
    settingsResetterKey: 'handleResetLumiereTuning',
    storage: {
        key: 'lumiere_tuning',
        read: normalizeLumiereTuning,
        // Merge then normalize: the same clamp runs for slider drags, imports, sync and Folium.
        merge: (held, patch) => normalizeLumiereTuning({ ...held, ...patch }),
        resetNotice: 'notifications.lumiereReset',
    },
    apply: (props, tuning) => ({ ...props, lumiereTuning: tuning }),
});
