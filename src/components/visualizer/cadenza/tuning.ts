import { DEFAULT_CADENZA_TUNING, type CadenzaTuning } from '../../../types';
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';

// src/components/visualizer/cadenza/tuning.ts
// Cadenza's tuning: its defaults, the settings store fields it lives in, where it is stored and
// how a stored value and a change are read, and the renderer prop it is put on.

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'cadenzaTuning', 'handleSetCadenzaTuning', 'handleResetCadenzaTuning', CadenzaTuning> {}
}

export default defineVisualizerTuning<CadenzaTuning>({
    mode: 'cadenza',
    defaults: DEFAULT_CADENZA_TUNING,
    settingsKey: 'cadenzaTuning',
    settingsSetterKey: 'handleSetCadenzaTuning',
    settingsResetterKey: 'handleResetCadenzaTuning',
    storage: {
        key: 'cadenza_tuning',
        // The style was once spelled "cadenze".
        olderKeys: ['cadenze_tuning'],
        // The beam is gone from the style: whatever was stored or is asked for, it stays 0.
        // 分辨率覆盖（#929）：旧存档没有 render 就是全跟随全局，不认识的值回退。
        read: (stored: Partial<CadenzaTuning>) => ({ ...DEFAULT_CADENZA_TUNING, ...stored, beamIntensity: 0, render: normalizeLyricRenderOverride(stored.render) }),
        merge: (held, patch) => ({ ...held, ...patch, beamIntensity: 0, render: normalizeLyricRenderOverride(patch.render ?? held.render) }),
        resetNotice: 'notifications.cadenzaReset',
        // 面板上只有「渲染」一组：「默认」只把它还原，fontScale 这些面板上没有的（只能靠导入得到）留着。
        reset: (held, defaults) => ({ ...held, render: defaults.render }),
    },
    apply: (props, tuning) => ({ ...props, cadenzaTuning: tuning }),
});
