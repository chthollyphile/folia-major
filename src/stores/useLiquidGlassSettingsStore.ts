import { create } from 'zustand';
import {
    LIQUID_GLASS_DEFAULTS,
    LIQUID_GLASS_EFFECT_KEYS,
    LIQUID_GLASS_STORAGE_KEYS,
    applyLiquidGlassParams,
    clampLiquidGlassParam,
    readStoredLiquidGlassEffects,
    readStoredLiquidGlassParams,
    setLiquidGlassJellyEnabled,
    setLiquidGlassLightEnabled,
    type LiquidGlassEffects,
    type LiquidGlassParams,
} from '../shinoinject/liquidglass';

// src/stores/useLiquidGlassSettingsStore.ts
// 流体玻璃的四个全局数值参数（折射强度 strength、模糊 blur、饱和度 sat、最大弯曲距离 bend，见 src/mods/liquidglass.ts）
// 与两个效果开关（光效 light、果冻 jelly）。默认值与读回都定义在 liquidglass.ts（它的 global 是运行时实际生效的那份），
// 这里只负责持久化、钳制后的 state 和 setter；setter 同步调 liquidglass 的入口让在场的玻璃 / 效果立刻重画或收摊。

const persistParam = (key: string, value: number) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, String(value));
    }
};

const persistFlag = (key: string, value: boolean) => {
    if (typeof window !== 'undefined') {
        localStorage.setItem(key, value ? '1' : '0');
    }
};

export type LiquidGlassSettingsState = LiquidGlassParams & LiquidGlassEffects & {
    handleSetLiquidGlassStrength: (value: number) => void;
    handleSetLiquidGlassBlur: (value: number) => void;
    handleSetLiquidGlassSat: (value: number) => void;
    handleSetLiquidGlassBend: (value: number) => void;
    handleSetLiquidGlassLight: (enabled: boolean) => void;
    handleSetLiquidGlassJelly: (enabled: boolean) => void;
    /** 整组写入：导入外观配置或套用预设时一次应用，落库与刷新各走一次（未给的字段保持现值）。 */
    handleSetLiquidGlassParams: (patch: Partial<LiquidGlassParams & LiquidGlassEffects>) => void;
    resetLiquidGlassParams: () => void;
};

export const useLiquidGlassSettingsStore = create<LiquidGlassSettingsState>((set, get) => {
    // 一次写入：钳制 → 落 localStorage → 更新 state → 重刷已挂玻璃 / 应用效果开关。
    const commit = (patch: Partial<LiquidGlassParams & LiquidGlassEffects>) => {
        const next: LiquidGlassParams = {
            strength: patch.strength !== undefined
                ? clampLiquidGlassParam('strength', patch.strength)
                : get().strength,
            blur: patch.blur !== undefined
                ? clampLiquidGlassParam('blur', patch.blur)
                : get().blur,
            sat: patch.sat !== undefined
                ? clampLiquidGlassParam('sat', patch.sat)
                : get().sat,
            bend: patch.bend !== undefined
                ? clampLiquidGlassParam('bend', patch.bend)
                : get().bend,
        };
        const light = patch.light !== undefined ? patch.light : get().light;
        const jelly = patch.jelly !== undefined ? patch.jelly : get().jelly;
        set({ ...next, light, jelly });
        persistParam(LIQUID_GLASS_STORAGE_KEYS.strength, next.strength);
        persistParam(LIQUID_GLASS_STORAGE_KEYS.blur, next.blur);
        persistParam(LIQUID_GLASS_STORAGE_KEYS.sat, next.sat);
        persistParam(LIQUID_GLASS_STORAGE_KEYS.bend, next.bend);
        persistFlag(LIQUID_GLASS_EFFECT_KEYS.light, light);
        persistFlag(LIQUID_GLASS_EFFECT_KEYS.jelly, jelly);
        applyLiquidGlassParams(next);
        setLiquidGlassLightEnabled(light);
        setLiquidGlassJellyEnabled(jelly);
    };

    return {
        ...readStoredLiquidGlassParams(),
        ...readStoredLiquidGlassEffects(),
        handleSetLiquidGlassStrength: (value) => commit({ strength: value }),
        handleSetLiquidGlassBlur: (value) => commit({ blur: value }),
        handleSetLiquidGlassSat: (value) => commit({ sat: value }),
        handleSetLiquidGlassBend: (value) => commit({ bend: value }),
        handleSetLiquidGlassLight: (enabled) => commit({ light: enabled }),
        handleSetLiquidGlassJelly: (enabled) => commit({ jelly: enabled }),
        handleSetLiquidGlassParams: (patch) => commit(patch),
        resetLiquidGlassParams: () => commit({ ...LIQUID_GLASS_DEFAULTS, light: true, jelly: true }),
    };
});
