// src/stores/useLiquidGlassTuningStore.ts
// 播放页悬浮胶囊液态玻璃的实验室调参。与胶囊同在主窗口，纯 zustand +
// localStorage 即可（不需要上一期遥控窗口那套 save-settings/IPC 跨窗口链路）。
// 参数直接透传给 LiquidGlassFilter 的滤镜链（位移 → blur → 饱和度）。

import { create } from 'zustand';

export const LIQUID_GLASS_TUNING_STORAGE_KEY = 'liquid_glass_tuning';

/** 边缘位移（px）——折射强度 */
export const LIQUID_GLASS_REFRACTION_RANGE = { min: 0, max: 50, step: 1, default: 20 } as const;
/** 背景模糊半径（px）*/
export const LIQUID_GLASS_BLUR_RANGE = { min: 0, max: 5, step: 0.1, default: 1 } as const;
/** 饱和度增益 */
export const LIQUID_GLASS_SATURATION_RANGE = { min: 1, max: 2, step: 0.05, default: 1.6 } as const;
/** 边缘高光/描边强度（rim 光总强度，0 = 关闭；方向高光与贴边描边按比例派生）。
 *  上限刻意压低：描边是贴边 1-2px 的细线，强度一大锯齿感立刻显形。 */
export const LIQUID_GLASS_RIM_RANGE = { min: 0, max: 0.05, step: 0.01, default: 0.01 } as const;
/** 边缘色散强度：RGB 通道位移差围绕 G 通道的展开倍率，1 = 默认 ±25% 分离，
 *  0 = 与不开色散等价（滤镜链仍按开关决定是否展开三路位移）。 */
export const LIQUID_GLASS_DISPERSION_STRENGTH_RANGE = { min: 0, max: 2, step: 0.05, default: 0.5 } as const;
/** 底色 alpha（深/浅主题各表面再乘预设倍率） */
export const LIQUID_GLASS_TINT_RANGE = { min: 0, max: 1, step: 0.05 } as const;
/** 暗色主题下的玻璃黑底透明度默认值（展开态基准；收起/悬停按比例派生） */
export const LIQUID_GLASS_DARK_TINT_DEFAULT = 0.15 as const;
/** 亮色主题下的玻璃白底透明度默认值（所有玻璃表面统一基准） */
export const LIQUID_GLASS_LIGHT_TINT_DEFAULT = 0.6 as const;

export type LiquidGlassTuning = {
    edgeDisplacement: number;
    blur: number;
    saturation: number;
    /** 边缘高光/描边强度：驱动 rim 方向光与贴边描边，0 = 无高光 */
    rimIntensity: number;
    darkTint: number;
    lightTint: number;
    /** 边缘色散：RGB 三通道按不同强度分开折射再合并，模拟玻璃色差 */
    dispersion: boolean;
    /** 边缘色散强度：通道位移差的展开倍率，默认 0.5（±12.5% 分离） */
    dispersionStrength: number;
    /** 液态玻璃总开关：关闭后所有表面回退为普通背景模糊（backdrop-blur-* 类） */
    enabled: boolean;
};

export const DEFAULT_LIQUID_GLASS_TUNING: LiquidGlassTuning = {
    edgeDisplacement: LIQUID_GLASS_REFRACTION_RANGE.default,
    blur: LIQUID_GLASS_BLUR_RANGE.default,
    saturation: LIQUID_GLASS_SATURATION_RANGE.default,
    rimIntensity: LIQUID_GLASS_RIM_RANGE.default,
    darkTint: LIQUID_GLASS_DARK_TINT_DEFAULT,
    lightTint: LIQUID_GLASS_LIGHT_TINT_DEFAULT,
    // 色散默认关闭：位移段 ×3 的成本偏高风险收益不高，需要彩色玻璃边缘的用户再手动开
    dispersion: false,
    dispersionStrength: LIQUID_GLASS_DISPERSION_STRENGTH_RANGE.default,
    enabled: true,
};

// 0 是合法值（模糊/折射都可以为 0），不能用 `|| default` 兜底，否则合法零值被吞
const sanitizeNumber = (value: unknown, fallback: number, range: { min: number; max: number }) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(range.max, Math.max(range.min, n)) : fallback;
};

const sanitizeTuning = (value: Partial<LiquidGlassTuning> | null | undefined): LiquidGlassTuning => ({
    edgeDisplacement: sanitizeNumber(value?.edgeDisplacement, DEFAULT_LIQUID_GLASS_TUNING.edgeDisplacement, LIQUID_GLASS_REFRACTION_RANGE),
    blur: sanitizeNumber(value?.blur, DEFAULT_LIQUID_GLASS_TUNING.blur, LIQUID_GLASS_BLUR_RANGE),
    saturation: sanitizeNumber(value?.saturation, DEFAULT_LIQUID_GLASS_TUNING.saturation, LIQUID_GLASS_SATURATION_RANGE),
    rimIntensity: sanitizeNumber(value?.rimIntensity, DEFAULT_LIQUID_GLASS_TUNING.rimIntensity, LIQUID_GLASS_RIM_RANGE),
    darkTint: sanitizeNumber(value?.darkTint, DEFAULT_LIQUID_GLASS_TUNING.darkTint, LIQUID_GLASS_TINT_RANGE),
    lightTint: sanitizeNumber(value?.lightTint, DEFAULT_LIQUID_GLASS_TUNING.lightTint, LIQUID_GLASS_TINT_RANGE),
    // 色散默认关闭：只认显式 true，非法值/缺省保持关闭（曾主动开启的用户
    // 持久化里有显式 true，不受影响）
    dispersion: value?.dispersion === true,
    dispersionStrength: sanitizeNumber(value?.dispersionStrength, DEFAULT_LIQUID_GLASS_TUNING.dispersionStrength, LIQUID_GLASS_DISPERSION_STRENGTH_RANGE),
    // 总开关相反：只认显式 false，旧配置/非法值保持开启
    enabled: value?.enabled !== false,
});

const readStoredTuning = (): LiquidGlassTuning => {
    if (typeof window === 'undefined') return { ...DEFAULT_LIQUID_GLASS_TUNING };
    try {
        const raw = window.localStorage.getItem(LIQUID_GLASS_TUNING_STORAGE_KEY);
        if (!raw) return { ...DEFAULT_LIQUID_GLASS_TUNING };
        return sanitizeTuning(JSON.parse(raw) as Partial<LiquidGlassTuning>);
    } catch {
        return { ...DEFAULT_LIQUID_GLASS_TUNING };
    }
};

// 拖滑杆以每次 input 事件的频率触发持久化，localStorage 同步写在低端机上会卡 UI；
// 防抖合并成最后一次写入（200ms 窗口内的连续调整只落盘一次）。
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistTuning = (tuning: LiquidGlassTuning) => {
    if (typeof window === 'undefined') return;
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
        persistTimer = null;
        try {
            window.localStorage.setItem(LIQUID_GLASS_TUNING_STORAGE_KEY, JSON.stringify(tuning));
        } catch {
            // localStorage 不可用时只保留内存态
        }
    }, 200);
};

/** 玻璃底色统一定义：亮/暗主题各一套 alpha，全部由实验室参数驱动。
 *  alphaMultiplier 供状态派生（如胶囊收起态约 2/3、悬停态略升）。 */
export const buildGlassTintStyle = (
    tuning: LiquidGlassTuning,
    isDaylight: boolean,
    alphaMultiplier = 1,
): { backgroundColor: string } => ({
    backgroundColor: isDaylight
        ? `rgba(255, 255, 255, ${(tuning.lightTint * alphaMultiplier).toFixed(3)})`
        : `rgba(0, 0, 0, ${(tuning.darkTint * alphaMultiplier).toFixed(3)})`,
});

/** 表面 tint 倍率预设：dark/light 分别乘在对应主题的基础 alpha 上。
 *  组件功能不同，可读所需的明暗不同——大面积文字的面板要更实的底，
 *  小圆钮和短文案可以更透。统一在这张表里调，组件只查表不写死数字。
 *  由 class 底色迁移过来的表面，初值按旧 alpha 反推（darkTint 0.15 / lightTint 0.6
 *  基准），保证接入后观感不变，后续再按手感调。 */
export type LiquidGlassTintPreset = { dark: number; light: number };

export const LIQUID_GLASS_SURFACE_TINT_PRESETS = {
    /** 播放胶囊（展开态基准；收起/悬停的动态倍率由组件再乘） */
    playerPill: { dark: 1, light: 1 },
    /** 播放胶囊内的播放/暂停按钮：反色子芯片——暗色主题白底、亮色主题黑底，
     *  alpha 取反色侧主题的 tint 参数乘这里的反色侧倍率；
     *  图标用 --bg-color。不叠玻璃滤镜，透出胶囊的玻璃内容。 */
    playerPlayButton: { dark: 1, light: 1.15 },
    /** 歌词时间线弹层：大面积歌词文本；较胶囊少量加深 */
    lyricsTimeline: { dark: 1.3, light: 1.15 },
    /** 右下角控制面板：大面积内容；较胶囊少量加深 */
    cornerPanel: { dark: 1.3, light: 1.15 },
    /** 播放页左上角返回按钮 */
    playerBackButton: { dark: 1, light: 1 },
    /** 右下面板开合按钮（兼 osu! 拖拽钮）；与播放胶囊 tint 对齐 */
    panelToggleButton: { dark: 1, light: 1 },
    /** now playing 提示卡；用户定档 tint ×1（原迁移值 dark 2.33 / light 0.58） */
    nowPlayingToast: { dark: 1, light: 1 },
    /** 首页右下角平台切换/返回播放器胶囊（浮在 visualizer 上，含头像与图标）；与播放胶囊 tint 对齐 */
    homePlayerEntryPill: { dark: 1, light: 1 },
    /** 全局命令面板主面板（身后有遮罩压暗，但面板文字密集，底色偏实） */
    commandPalette: { dark: 1.5, light: 1.25 },
    /** 首页顶部搜索框：迁移自旧 class 底色（dark 白霜 /5、light 黑霜 /5，极透）。
     *  旧底色极性与玻璃家族约定相反，接入时按同一透明度换到约定极性
     *  （dark 黑霜 / light 白霜），5% alpha 下极性差异不可感知。 */
    homeSearchInput: { dark: 0.33, light: 0.08 },
    /** 首页 3D 歌单滑轨顶部的「全部」按钮（打开 GridMap 2D 视图）；用户定档 tint ×1 */
    homeGridMapButton: { dark: 1, light: 1 },
    /** GridMap 2D 视图顶部的标题框：迁移自旧 inline 底色
     *  color-mix(var(--bg-color) 20%)（dark ≈ 黑 20%、light ≈ 白 20%），观感不变换算。 */
    gridMapTitle: { dark: 1.33, light: 0.33 },
    /** 歌单详情页（GridView）顶部的标题框：旧底色与 GridMap 标题框同款
     *  （color-mix(var(--bg-color) 20%)），倍率对齐；同样不带磨砂（见组件注释）。 */
    gridViewTitle: { dark: 1.33, light: 0.33 },
    /** 右下角面板封面的四个浮动按钮：白字图标压封面，tint 刻意恒取暗色侧
     *  （darkTint × dark 倍率，不随主题翻成白霜），light 列仅供查表不生效。
     *  dark 由旧 class 底色 bg-black/25 反推（0.25/0.15），hover 加深 ×1.6
     *  （旧 hover:bg-black/40 换算）由组件再乘。 */
    panelCoverButton: { dark: 1.67, light: 0.42 },
} as const satisfies Record<string, LiquidGlassTintPreset>;

export type LiquidGlassSurfaceId = keyof typeof LIQUID_GLASS_SURFACE_TINT_PRESETS;

/** 表面级色散覆盖：值为 false 的表面即使全局开启色散也不使用边缘色散。
 *  与 tint 预设表同址维护。色散把位移段成本约 ×3，大面积表面（如歌词时间线弹层）
 *  容易因此拖出性能问题，优先单独禁用。 */
export const LIQUID_GLASS_SURFACE_DISPERSION_OVERRIDE: Partial<Record<LiquidGlassSurfaceId, boolean>> = {
    lyricsTimeline: false,
    panelToggleButton: false,
};

/** 查表面最终生效的色散开关：覆盖表有值优先，否则跟随全局。 */
export const resolveSurfaceDispersion = (
    surface: LiquidGlassSurfaceId,
    globalDispersion: boolean,
): boolean => LIQUID_GLASS_SURFACE_DISPERSION_OVERRIDE[surface] ?? globalDispersion;

/** 查表取某表面在当前主题下的 tint 倍率；stateMultiplier 供组件自身状态再乘
 *  （如胶囊的收起/悬停、toast 的悬停加深）。 */
export const resolveLiquidGlassTintMultiplier = (
    surface: LiquidGlassSurfaceId,
    isDaylight: boolean,
    stateMultiplier = 1,
): number => {
    const preset = LIQUID_GLASS_SURFACE_TINT_PRESETS[surface];
    return (isDaylight ? preset.light : preset.dark) * stateMultiplier;
};

export type LiquidGlassTuningState = {
    liquidGlassTuning: LiquidGlassTuning;
    handleSetLiquidGlassTuning: (patch: Partial<LiquidGlassTuning>) => void;
    handleResetLiquidGlassTuning: () => void;
};

export const useLiquidGlassTuningStore = create<LiquidGlassTuningState>((set, get) => ({
    liquidGlassTuning: readStoredTuning(),
    handleSetLiquidGlassTuning: (patch) => {
        const current = get().liquidGlassTuning;
        const next = sanitizeTuning({ ...current, ...patch });
        persistTuning(next);
        set({ liquidGlassTuning: next });
    },
    handleResetLiquidGlassTuning: () => {
        persistTuning({ ...DEFAULT_LIQUID_GLASS_TUNING });
        set({ liquidGlassTuning: { ...DEFAULT_LIQUID_GLASS_TUNING } });
    },
}));
