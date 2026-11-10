// Copyright (c) 2026 chthollyphile
import { normalizeLyricRenderOverride } from '../../../utils/lyricRenderQuality';
import { snapResolutionToTexturePool } from '../pixi/pixiTextureBudget';
import { numberWithin } from '../tuningDefinition';
import { DEFAULT_HANABI_TUNING, type HanabiRenderQuality, type HanabiTuning } from './types';

// src/components/visualizer/hanabi/hanabiTuning.ts
// 花火 tuning 的归一化与运行时分类：存档、导入、同步、滑块拖动都经 normalizeHanabiTuning 补齐字段、钳住范围；
// 运行时按 HANABI_LIVE_KEYS 区分「每帧现读、改了立刻生效」与「烘焙进场景、改了要重建」的字段。
// 画质档的数值也在这里（纯函数，运行时与单测共用）。

/** 屏幕密度最多按 2 倍算：烟花是成千上万的小精灵，3 倍屏上满分辨率只换来更贵的填充。 */
const MAX_BASE_RESOLUTION = 2;

/** 花火自己的像素密度（分辨率倍数为 1 时就是它，和没有这个设置时一样）；字形图集按渲染倍率除以它算出超采样倍数。 */
export const resolveHanabiBaseResolution = (devicePixelRatio: number) => Math.min(MAX_BASE_RESOLUTION, Math.max(1, devicePixelRatio || 1));

const COLOR_MODES: HanabiTuning['colorMode'][] = ['theme', 'vivid', 'mixed'];
const RENDER_QUALITIES: HanabiRenderQuality[] = ['full', 'balanced', 'low'];

/** 任何存下来的值 → 完整、合法的 tuning（缺字段走默认，越界钳住）。 */
export const normalizeHanabiTuning = (raw: unknown): HanabiTuning => {
    const input = { ...DEFAULT_HANABI_TUNING, ...(raw && typeof raw === 'object' ? raw as Partial<HanabiTuning> : {}) };
    const d = DEFAULT_HANABI_TUNING;
    return {
        render: normalizeLyricRenderOverride(input.render),
        colorMode: COLOR_MODES.includes(input.colorMode) ? input.colorMode : d.colorMode,
        sparkAmount: numberWithin(input.sparkAmount, d.sparkAmount, 0, 2),
        ornamentAmount: numberWithin(input.ornamentAmount, d.ornamentAmount, 0, 2),
        textMotion: numberWithin(input.textMotion, d.textMotion, 0, 2),
        blockOpacity: numberWithin(input.blockOpacity, d.blockOpacity, 0, 1),
        riseSpeed: numberWithin(input.riseSpeed, d.riseSpeed, 0, 2),
        spin: numberWithin(input.spin, d.spin, 0, 2),
        ambient: numberWithin(input.ambient, d.ambient, 0, 2),
        glow: numberWithin(input.glow, d.glow, 0, 2),
        bloom: numberWithin(input.bloom, d.bloom, 0, 2),
        chorusBloom: numberWithin(input.chorusBloom, d.chorusBloom, 0, 2),
        launches: input.launches !== false,
        overlayFrame: input.overlayFrame !== false,
        textOnly: input.textOnly === true,
        sky: numberWithin(input.sky, d.sky, 0, 1),
        collage: numberWithin(input.collage, d.collage, 0, 2),
        renderQuality: RENDER_QUALITIES.includes(input.renderQuality) ? input.renderQuality : d.renderQuality,
    };
};

/**
 * 每帧现读、改了不用重建场景的字段（夜空、全屏辉光）；画框另由 HANABI_OVERLAY_KEYS 决定是否重画。
 * render（分辨率 / 抗锯齿）不经 setTuning：外壳把合出来的倍数和抗锯齿另外推给运行时，而且每次归一化都是新对象，按引用比会次次重建。
 */
const HANABI_LIVE_KEYS: ReadonlyArray<keyof HanabiTuning> = ['render', 'sky', 'overlayFrame', 'bloom', 'chorusBloom'];
/** 改了要重画画框的字段。 */
export const HANABI_OVERLAY_KEYS: ReadonlyArray<keyof HanabiTuning> = ['overlayFrame', 'colorMode', 'textOnly'];

/** 两份 tuning 之间有没有烘焙进场景的字段变了（变了就防抖重建场景与片尾卡）。 */
export const requiresHanabiSceneRebuild = (previous: HanabiTuning, next: HanabiTuning) => (
    (Object.keys(next) as Array<keyof HanabiTuning>).some(key => !HANABI_LIVE_KEYS.includes(key) && previous[key] !== next[key])
);

export const changedHanabiKeys = (previous: HanabiTuning, next: HanabiTuning, keys: ReadonlyArray<keyof HanabiTuning>) => (
    keys.some(key => previous[key] !== next[key])
);

// ─── 画质档 ────────────────────────────────────────────────────────────
// 只动开销最大、又最不怕软的那一块：每个镜头烟花层上的辉光（离屏画一遍烟花，再走一条整条降采样链）。
// 烟花本来就是柔光，降分辨率几乎看不出来；字、色块、拼贴和全屏辉光仍按满分辨率合成，歌词保持清晰。

export interface HanabiQualityProfile {
    /** 烟花辉光相对渲染分辨率的倍率（按轴）；像素数是它的平方。 */
    glowScale: number;
    /** 环境粒子（星点、火星、远方小烟花）数量倍率（乘在用户设置上）。 */
    ambientScale: number;
}

/**
 * - full：与屏幕同分辨率（默认，画面与没有画质档时完全一样）。
 * - balanced：烟花辉光每轴 0.7（像素约 49%），辉光少降一级，宽度不变。
 * - low（省电）：烟花辉光每轴 0.5（像素 25%），环境粒子 ×0.6。
 */
export const HANABI_QUALITY_PROFILES: Record<HanabiRenderQuality, HanabiQualityProfile> = {
    full: { glowScale: 1, ambientScale: 1 },
    balanced: { glowScale: 0.7, ambientScale: 1 },
    low: { glowScale: 0.5, ambientScale: 0.6 },
};

/** 烟花辉光的 filter 分辨率：满画质时就是渲染分辨率；降档时乘倍率，再按 Pixi 纹理池的 2 的幂分桶往下吸附。 */
export const resolveHanabiGlowResolution = (width: number, height: number, renderResolution: number, quality: HanabiRenderQuality) => {
    const { glowScale } = HANABI_QUALITY_PROFILES[quality] ?? HANABI_QUALITY_PROFILES.full;
    if (glowScale >= 1) return renderResolution;
    return snapResolutionToTexturePool(width, height, renderResolution * glowScale);
};

/** 输入已经降了 2^k 倍，bloom 就少降 k 级：最小一级的纹素（决定辉光多宽）才和满画质一样大。 */
export const resolveHanabiGlowLevelDrop = (renderResolution: number, glowResolution: number) => (
    glowResolution > 0 && glowResolution < renderResolution
        ? Math.max(0, Math.round(Math.log2(renderResolution / glowResolution)))
        : 0
);

/** 烟花辉光 filter 的画质参数（mg/glow.ts 的 HanabiGlowQuality）：满画质时 resolution 为 null，跟渲染分辨率。 */
export const resolveHanabiGlowQuality = (width: number, height: number, renderResolution: number, quality: HanabiRenderQuality) => {
    const resolution = resolveHanabiGlowResolution(width, height, renderResolution, quality);
    return {
        resolution: resolution < renderResolution ? resolution : null,
        levelDrop: resolveHanabiGlowLevelDrop(renderResolution, resolution),
    };
};
