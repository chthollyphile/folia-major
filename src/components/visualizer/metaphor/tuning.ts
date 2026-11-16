import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, numberWithin } from '../tuningDefinition';
import { DEFAULT_METAPHOR_TUNING, METAPHOR_BOOLEAN_KEYS, METAPHOR_LIMITS, type MetaphorBooleanKey, type MetaphorNumberKey, type MetaphorTuning } from './types';

// src/components/visualizer/metaphor/tuning.ts
// 隐喻的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings {
        metaphorTuning: MetaphorTuning;
        handleSetMetaphorTuning: (patch: Partial<MetaphorTuning>) => void;
        handleResetMetaphorTuning: () => void;
    }
}

/** 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。 */
export const normalizeMetaphorTuning = (stored: unknown): MetaphorTuning => {
    const values = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof MetaphorTuning, unknown>>;
    const base = DEFAULT_METAPHOR_TUNING;
    const numbers = Object.fromEntries((Object.keys(METAPHOR_LIMITS) as MetaphorNumberKey[]).map(key => [
        key,
        numberWithin(values[key], base[key], METAPHOR_LIMITS[key].min, METAPHOR_LIMITS[key].max),
    ])) as Pick<MetaphorTuning, MetaphorNumberKey>;
    const switches = Object.fromEntries(METAPHOR_BOOLEAN_KEYS.map(key => [
        key,
        typeof values[key] === 'boolean' ? values[key] : base[key],
    ])) as Pick<MetaphorTuning, MetaphorBooleanKey>;
    return { render: normalizeLyricRenderOverride(values.render), ...numbers, ...switches };
};

export default defineVisualizerTuning<MetaphorTuning>({
    mode: 'metaphor',
    defaults: DEFAULT_METAPHOR_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        ...Object.fromEntries(Object.entries(METAPHOR_LIMITS).map(([key, { min, max }]) => [key, modNumber(min, max)])),
        negative: MOD_SWITCH,
        flip: MOD_SWITCH,
        keywordColors: MOD_SWITCH,
        transitions: MOD_SWITCH,
    },
    settingsKey: 'metaphorTuning',
    settingsSetterKey: 'handleSetMetaphorTuning',
    settingsResetterKey: 'handleResetMetaphorTuning',
    storage: {
        key: 'metaphor_tuning',
        read: normalizeMetaphorTuning,
        // 先合并再归一化：设置面板、导入、同步、Folium 走同一套校验。
        merge: (held, patch) => normalizeMetaphorTuning({ ...held, ...patch }),
        resetNotice: 'notifications.metaphorReset',
    },
});
