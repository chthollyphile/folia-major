// Copyright (c) 2026 chthollyphile
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, type StoredTuningFields } from '../tuningDefinition';
import { normalizeHanabiTuning } from './hanabiTuning';
import { DEFAULT_HANABI_TUNING, type HanabiTuning } from './types';

// src/components/visualizer/hanabi/tuning.ts
// 花火's tuning: its defaults, the settings store fields it lives in, and where it is stored. The
// renderer reads it from the tuning bundle with read() (entry.tsx), so there is no named prop.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'hanabiTuning', 'handleSetHanabiTuning', 'handleResetHanabiTuning', HanabiTuning> {}
}

export default defineVisualizerTuning<HanabiTuning>({
    mode: 'hanabi',
    defaults: DEFAULT_HANABI_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        colorMode: modChoice(['theme', 'vivid', 'mixed']),
        sparkAmount: modNumber(0, 2),
        ornamentAmount: modNumber(0, 2),
        textMotion: modNumber(0, 2),
        blockOpacity: modNumber(0, 1),
        riseSpeed: modNumber(0, 2),
        spin: modNumber(0, 2),
        ambient: modNumber(0, 2),
        glow: modNumber(0, 2),
        bloom: modNumber(0, 2),
        chorusBloom: modNumber(0, 2),
        launches: MOD_SWITCH,
        overlayFrame: MOD_SWITCH,
        textOnly: MOD_SWITCH,
        sky: modNumber(0, 1),
        collage: modNumber(0, 2),
    },
    settingsKey: 'hanabiTuning',
    settingsSetterKey: 'handleSetHanabiTuning',
    settingsResetterKey: 'handleResetHanabiTuning',
    storage: {
        key: 'hanabi_tuning',
        read: normalizeHanabiTuning,
        // Merge then normalize: the same clamp runs for slider drags, imports, sync and Folium.
        merge: (held, patch) => normalizeHanabiTuning({ ...held, ...patch }),
        resetNotice: 'notifications.hanabiReset',
    },
});
