import type { LyricRenderOverride, LyricRenderScale } from '../../../types';
import { LYRIC_RENDER_SCALES, normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { defineVisualizerTuning, modNumber, MOD_SWITCH, modChoice, numberWithin, type StoredTuningFields } from '../tuningDefinition';
import {
    DEFAULT_NEBBIA_TUNING,
    NEBBIA_APPEAR_STYLES,
    NEBBIA_BEHIND,
    NEBBIA_FADE_STYLES,
    NEBBIA_LAYOUTS,
    NEBBIA_GLASS,
    NEBBIA_GLASS_FOR,
    NEBBIA_LIMITS,
    NEBBIA_RAIN,
    NEBBIA_SCENERY,
    type NebbiaNumberKey,
    type NebbiaTuning,
} from './types';

// src/components/visualizer/nebbia/tuning.ts
// 雾笺的 tuning：默认值、在设置 store 里的字段、存在哪。渲染器经 read() 从 tuning 包里取（entry.tsx），没有具名 prop。

declare module '../tuningDefinition' {
    interface VisualizerTuningSettings extends StoredTuningFields<'nebbiaTuning', 'handleSetNebbiaTuning', 'handleResetNebbiaTuning', NebbiaTuning> {}
}

/** 一组开关：只留认得的、按固定顺序排，一个都没有就用默认。 */
const subsetOf = <T extends string>(choices: readonly T[], value: unknown, fallback: T[]): T[] => {
    const picked = Array.isArray(value) ? choices.filter(c => value.includes(c)) : [];
    return picked.length ? picked : [...fallback];
};

/** 早期存的单选（appearMode / fadeMode）换成开关。 */
const LEGACY_APPEAR: Record<string, NebbiaTuning['appear']> = { auto: ['write', 'fade'], write: ['write'], fade: ['fade'] };
const LEGACY_FADE: Record<string, NebbiaTuning['fade']> = { fog: ['fog'], fingers: ['fingers'], mix: ['fog', 'fingers'] };

/**
 * 分辨率与抗锯齿（#929）。以前雾笺自己有一个分辨率滑块（`resolution`，0.5–2 倍，1 是原样），现在换成了共用的
 * 「跟随全局 / 指定倍数」：存档里有 `render` 就只看它；只有旧的 `resolution`、又不是 1 时，换成最接近的倍数
 * （两边一样近取大的那个，老用户调高是想要更清楚），这样调过的值保留下来；是 1 或没有就跟随全局。
 */
const readRender = (render: unknown, legacyResolution: unknown): LyricRenderOverride => {
    if (render !== undefined) return normalizeLyricRenderOverride(render);
    const override = normalizeLyricRenderOverride(null);
    if (legacyResolution === undefined) return override;
    const resolution = numberWithin(legacyResolution, 1, 0.5, 2);
    if (resolution === 1) return override;
    const scale = LYRIC_RENDER_SCALES.reduce<LyricRenderScale>(
        (best, next) => (Math.abs(next - resolution) <= Math.abs(best - resolution) ? next : best),
        LYRIC_RENDER_SCALES[0],
    );
    return { ...override, scale };
};

/** 存着的值、导入或同步来的值，读成一份完整合法的 tuning：缺的、类型不对的用默认，数值夹进范围。 */
export const normalizeNebbiaTuning = (stored: unknown): NebbiaTuning => {
    const values = (stored && typeof stored === 'object' ? stored : {}) as Partial<Record<keyof NebbiaTuning | 'appearMode' | 'fadeMode' | 'resolution', unknown>>;
    const base = DEFAULT_NEBBIA_TUNING;
    const numbers = Object.fromEntries((Object.keys(NEBBIA_LIMITS) as NebbiaNumberKey[]).map(key => [
        key,
        numberWithin(values[key], base[key], NEBBIA_LIMITS[key].min, NEBBIA_LIMITS[key].max),
    ])) as Pick<NebbiaTuning, NebbiaNumberKey>;
    const appear = values.appear ?? LEGACY_APPEAR[String(values.appearMode)];
    const fade = values.fade ?? LEGACY_FADE[String(values.fadeMode)];
    const behind = NEBBIA_BEHIND.find(b => b === values.behind) ?? base.behind;
    return {
        render: readRender(values.render, values.resolution),
        appear: subsetOf(NEBBIA_APPEAR_STYLES, appear, base.appear),
        fade: subsetOf(NEBBIA_FADE_STYLES, fade, base.fade),
        layouts: subsetOf(NEBBIA_LAYOUTS, values.layouts, base.layouts),
        behind,
        // 没存过玻璃（旧的 tuning）时按窗外的默认搭配
        glass: NEBBIA_GLASS.find(g => g === values.glass) ?? NEBBIA_GLASS_FOR[behind] ?? base.glass,
        // 窗外可以全关：只有没存过（旧的 tuning）才用默认
        scenery: Array.isArray(values.scenery) ? NEBBIA_SCENERY.filter(c => (values.scenery as unknown[]).includes(c)) : [...base.scenery],
        rain: NEBBIA_RAIN.find(r => r === values.rain) ?? base.rain,
        credits: typeof values.credits === 'boolean' ? values.credits : base.credits,
        ...numbers,
    };
};

export default defineVisualizerTuning<NebbiaTuning>({
    mode: 'nebbia',
    defaults: DEFAULT_NEBBIA_TUNING,
    // What mods may read and write (folium.visualizer.setTuning): the panel's own controls, without what the picture costs.
    modKeys: {
        behind: modChoice(NEBBIA_BEHIND),
        glass: modChoice(NEBBIA_GLASS),
        rain: modChoice(NEBBIA_RAIN),
        credits: MOD_SWITCH,
        ...Object.fromEntries(Object.entries(NEBBIA_LIMITS).map(([key, { min, max }]) => [key, modNumber(min, max)])),
        // A count of jellyfish: whole ones, as the panel's slider steps.
        jellies: modNumber(NEBBIA_LIMITS.jellies.min, NEBBIA_LIMITS.jellies.max, 1),
    },
    settingsKey: 'nebbiaTuning',
    settingsSetterKey: 'handleSetNebbiaTuning',
    settingsResetterKey: 'handleResetNebbiaTuning',
    storage: {
        key: 'nebbia_tuning',
        read: normalizeNebbiaTuning,
        // 先合并再归一化：设置面板、导入、同步走同一套校验。
        // 导入或同步来的旧配置只有 resolution、没有 render：先迁成 render，不然 held 里已有的 render 会把它盖掉。
        merge: (held, patch) => {
            const legacyResolution = (patch as { resolution?: unknown }).resolution;
            const migrated = patch.render === undefined && legacyResolution !== undefined
                ? { ...patch, render: readRender(undefined, legacyResolution) }
                : patch;
            return normalizeNebbiaTuning({ ...held, ...migrated });
        },
        resetNotice: 'notifications.nebbiaReset',
    },
});
