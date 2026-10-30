import { defineVisualizerTuning, type StoredTuningFields } from '../tuningDefinition';
import { normalizeMachiTuning } from './machiTuning';
import { DEFAULT_MACHI_TUNING, type MachiTuning } from './types';

// src/components/visualizer/machi/tuning.ts
// 町景的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'machiTuning', 'handleSetMachiTuning', 'handleResetMachiTuning', MachiTuning> {}
}

export default defineVisualizerTuning<MachiTuning>({
    mode: 'machi',
    defaults: DEFAULT_MACHI_TUNING,
    settingsKey: 'machiTuning',
    settingsSetterKey: 'handleSetMachiTuning',
    settingsResetterKey: 'handleResetMachiTuning',
    storage: {
        key: 'machi_tuning',
        read: normalizeMachiTuning,
        // 先合并再归一化：设置面板、导入、同步、Folium 走同一套校验。
        merge: (held, patch) => normalizeMachiTuning({ ...held, ...patch }),
        resetNotice: 'notifications.machiReset',
    },
});
