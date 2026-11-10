// Copyright (c) 2026 chthollyphile
import type { LumiereRenderQuality, LumiereTuning, LyricRenderScale } from '../../../types';
import { resolveLyricPixelRatio } from '../../../utils/lyricRenderQuality';
import { snapResolutionToTexturePool } from '../pixi/pixiTextureBudget';
import type { LumiereProgramOptions } from './lumiereProgram';
import type { LumiereSceneTuning } from './types';

// src/components/visualizer/lumiere/lumiereRuntimeTuning.ts
// 用户 tuning（LumiereTuning）→ 场景 tuning（LumiereSceneTuning）的映射、画质档的数值，以及哪些改动要重建场景。
// 纯函数，不碰 Pixi，运行时与单测共用。
//
// 画质档只动开销最大的那一块：图形组（光场着色器 + 烟雾 fbm + 图形组 bloom 的整条降采样链）。
// 图形组本来就是整屏的柔光与烟雾，低频为主，降分辨率几乎看不出来；文字组、画框和片尾卡的字仍按满分辨率
// 光栅化与合成，所以歌词保持清晰。见 resolveLumiereGraphicsResolution。
//
// 分辨率倍数（#929，全局挡位 / 样式覆盖）先乘在渲染分辨率上（resolveLumiereScaledRenderResolution），
// 画质档再从乘过的渲染分辨率往下降图形组：两者相乘，互不覆盖。

export interface LumiereQualityProfile {
    /** 图形组相对渲染分辨率的倍率（按轴）；像素数是它的平方。 */
    graphicsScale: number;
    /** 烟雾噪声倍频数上限（用户设置更低时按用户的）。 */
    maxFogOctaves: number;
    /** 浮尘数量倍率（乘在用户设置上）。 */
    moteScale: number;
}

/**
 * 三档的数值：
 * - full：图形组与屏幕同分辨率，倍频按用户设置（2..6）。
 * - balanced：图形组每轴 0.7（像素约 49%），倍频 ≤ 4。bloom 按对数就近减一级（不减会宽 1.43 倍，
 *   减一级窄到 0.71 倍，后者更近），辉光略收、开销再降一截。
 * - low（省电）：图形组每轴 0.5（像素 25%），倍频 ≤ 3，浮尘 ×0.6。分辨率正好减半，bloom 少降一级，
 *   最小一级与 full 完全同尺寸，辉光宽度不变。
 */
export const LUMIERE_QUALITY_PROFILES: Record<LumiereRenderQuality, LumiereQualityProfile> = {
    full: { graphicsScale: 1, maxFogOctaves: 6, moteScale: 1 },
    balanced: { graphicsScale: 0.7, maxFogOctaves: 4, moteScale: 1 },
    low: { graphicsScale: 0.5, maxFogOctaves: 3, moteScale: 0.6 },
};

/** 渲染分辨率上限：再高的屏幕也按 2 倍画，4K / 高 DPI 下整屏光场的开销是按像素数涨的。 */
export const LUMIERE_MAX_RENDER_RESOLUTION = 2;

/** 画布（文字、画框）的渲染分辨率：devicePixelRatio 钳在 1..2。 */
export const resolveLumiereRenderResolution = (devicePixelRatio: number | undefined) => {
    const ratio = typeof devicePixelRatio === 'number' && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
    return Math.min(LUMIERE_MAX_RENDER_RESOLUTION, Math.max(1, ratio));
};

/**
 * 实际的渲染分辨率：上面的 base（dpr 钳在 1..2）乘上用户选的分辨率倍数（>1 时封顶 3，见 utils/lyricRenderQuality.ts）。
 * 倍数为 1 时与没有这个设置时完全一样。
 */
export const resolveLumiereScaledRenderResolution = (devicePixelRatio: number | undefined, scale: LyricRenderScale) => (
    resolveLyricPixelRatio(resolveLumiereRenderResolution(devicePixelRatio), scale)
);

/**
 * 图形组 filter 的分辨率：满画质时就是渲染分辨率；降档时乘上倍率，再按 Pixi 纹理池的 2 的幂分桶往下吸附
 * （pixiTextureBudget.ts：最多再让 25%，换一个小一号的桶）。吸附只对图形组做——它是柔光，软一点看不出来；
 * 文字不吸附，保证清晰。
 */
export const resolveLumiereGraphicsResolution = (
    width: number,
    height: number,
    renderResolution: number,
    quality: LumiereRenderQuality,
) => {
    const { graphicsScale } = LUMIERE_QUALITY_PROFILES[quality];
    if (graphicsScale >= 1) return renderResolution;
    return snapResolutionToTexturePool(width, height, renderResolution * graphicsScale);
};

/**
 * 图形组分辨率降了多少，bloom 就少降几级：bloom 每级是上一级的一半分辨率，输入已经降了 2^k 倍时去掉 k 级，
 * 最小一级的纹素（决定辉光有多宽）才和满画质一样大。
 */
export const resolveLumiereBloomLevelDrop = (renderResolution: number, graphicsResolution: number) => (
    graphicsResolution > 0 && graphicsResolution < renderResolution
        ? Math.max(0, Math.round(Math.log2(renderResolution / graphicsResolution)))
        : 0
);

export interface LumiereSceneTuningContext {
    /** false 时不画歌词：背景歌词碎片也关掉（它们是歌词的字），光照照常。 */
    showText: boolean;
}

/** 用户 tuning → 场景 tuning。画质档在这里折进倍频与浮尘；「仅显示歌词文字」即场景的 textOnly。 */
export const toLumiereSceneTuning = (
    tuning: LumiereTuning,
    context: LumiereSceneTuningContext,
): LumiereSceneTuning => {
    const profile = LUMIERE_QUALITY_PROFILES[tuning.renderQuality] ?? LUMIERE_QUALITY_PROFILES.full;
    return {
        lightIntensity: tuning.lightIntensity,
        audioResponse: tuning.audioResponse,
        fogDensity: tuning.fogDensity,
        darkField: tuning.darkField,
        moteAmount: tuning.moteAmount * profile.moteScale,
        bloom: tuning.bloom,
        textBloom: tuning.textBloom,
        unlitOpacity: tuning.unlitOpacity,
        windowNeighbors: tuning.windowNeighbors,
        decay: tuning.decay,
        echo: context.showText ? tuning.echo : 0,
        fogOctaves: Math.min(tuning.fogOctaves, profile.maxFogOctaves),
        lineArt: tuning.lineArt,
        frontBokeh: tuning.frontBokeh,
        trails: tuning.trails,
        hideTrails: tuning.hideTrails,
        overlayFrame: tuning.overlayFrame,
        textOnly: tuning.textOnly,
        keywordColors: tuning.keywordColors,
        themeIcons: tuning.themeIcons,
        themeColorMix: tuning.themeColorMix,
    };
};

/**
 * 每帧才读的字段：直接改运行时持有的那份 tuning 对象就生效，不必重建。
 * （光强、随音乐、烟雾浓度、未唱字透明度、倍频在 scene.update 里现读；暗场强度由运行时的暗场层每帧现读。）
 */
export const LUMIERE_LIVE_SCENE_KEYS = [
    'lightIntensity',
    'audioResponse',
    'fogDensity',
    'darkField',
    'unlitOpacity',
    'fogOctaves',
    'hideTrails',
] as const satisfies readonly (keyof LumiereSceneTuning)[];

/**
 * 改变编译结果的字段：既不是每帧现读，也不是场景重建——程序本身要重新编译（VisualizerLumiere 的 useMemo），
 * 新程序经 swapSong 的同曲替换路径交给运行时（commitSong 清掉场景缓存，下一帧按新程序建），不重建 WebGL 上下文。
 * 轨迹过渡把整首歌编成一个单元，所以它在这里，不在场景 tuning 里。
 */
export const LUMIERE_COMPILE_KEYS = ['seamlessTransitions'] as const satisfies readonly (keyof LumiereTuning)[];

/** 用户 tuning → 编译选项（只取 LUMIERE_COMPILE_KEYS 里的字段）。 */
export const resolveLumiereCompileOptions = (
    tuning: Pick<LumiereTuning, typeof LUMIERE_COMPILE_KEYS[number]>,
): Pick<LumiereProgramOptions, 'seamless'> => ({ seamless: tuning.seamlessTransitions });

/** 两个 bloom 倍率：强度直接写进现有 filter 的 options；只有跨过 0（要挂 / 摘 filter）时才重建。 */
const crossesZero = (previous: number, next: number) => (previous > 0) !== (next > 0);

/**
 * 场景构建时烘焙进去的字段变了，缓存的场景就得重建（运行时会防抖）。画框只在 overlay 里，不算。
 */
export const requiresLumiereSceneRebuild = (previous: LumiereSceneTuning, next: LumiereSceneTuning) => (
    previous.moteAmount !== next.moteAmount
    || previous.windowNeighbors !== next.windowNeighbors
    || previous.decay !== next.decay
    || previous.echo !== next.echo
    || previous.lineArt !== next.lineArt
    || previous.frontBokeh !== next.frontBokeh
    || previous.trails !== next.trails
    || previous.textOnly !== next.textOnly
    || previous.keywordColors !== next.keywordColors
    || previous.themeIcons !== next.themeIcons
    // 调色盘在建场景时算好（光色、字色、线稿与关键字的混色都从它来）。
    || previous.themeColorMix !== next.themeColorMix
    || crossesZero(previous.bloom, next.bloom)
    || crossesZero(previous.textBloom, next.textBloom)
);
