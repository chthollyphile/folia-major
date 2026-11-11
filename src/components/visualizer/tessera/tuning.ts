import { defineVisualizerTuning, modChoice, type StoredTuningFields } from '../tuningDefinition';
import { DEFAULT_TESSERA_TUNING, normalizeTesseraTuning, TESSERA_BACKGROUNDS, type TesseraTuning } from './types';

// src/components/visualizer/tessera/tuning.ts
// 方块字的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- 接口合并只能这样把字段加进 VisualizerTuningSettings，别的样式的 tuning.ts 同样写法。
    interface VisualizerTuningSettings extends StoredTuningFields<'tesseraTuning', 'handleSetTesseraTuning', 'handleResetTesseraTuning', TesseraTuning> {}
}

export default defineVisualizerTuning<TesseraTuning>({
    mode: 'tessera',
    defaults: DEFAULT_TESSERA_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls.
    modKeys: {
        background: modChoice(TESSERA_BACKGROUNDS),
    },
    settingsKey: 'tesseraTuning',
    settingsSetterKey: 'handleSetTesseraTuning',
    settingsResetterKey: 'handleResetTesseraTuning',
    storage: {
        key: 'tessera_tuning',
        read: stored => normalizeTesseraTuning(stored),
        // 先合并再归一化：设置面板、导入、同步、Folium 走同一套校验。
        merge: (held, patch) => normalizeTesseraTuning({ ...held, ...patch }, held),
        resetNotice: 'notifications.tesseraReset',
    },
});
