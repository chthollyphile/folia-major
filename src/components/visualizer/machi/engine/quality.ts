import type { LyricRenderQuality, LyricRenderScale } from '../../../../types';
import { DEFAULT_LYRIC_RENDER_QUALITY, MAX_LYRIC_PIXEL_RATIO } from '../../../../utils/lyricRenderQuality';
import type { MachiAntialias, MachiDetailLevel, MachiQuality } from '../types';

// src/components/visualizer/machi/engine/quality.ts
// 画质设置 → 实际用的渲染参数（纯函数，运行时与单测共用）。
// 分辨率、抗锯齿可以「跟随全局」（「性能与动效」里歌词画布的挡位）：全局倍数照用（大于 1 就是超采样），全局抗锯齿开是 SMAA、关是关。
// 自动降级：帧时长期偏高时，运行时把“降了几格”加一，这里在用户那套设置上按固定顺序一格格往下压（景深离焦层 → 超采样 →
// 几何边缘的 MSAA → 倒影 → 辉光 → 分辨率 → 后期抗锯齿 → 阴影，一轮压完再来一轮），已经压不动的跳过；所以只会比用户选的低，不会高。
// 省得多的先退：超采样和 MSAA 吃的是整帧的填充率和带宽；阴影图是静态的（只在光变了时重画），平时几乎不花什么，关掉反而要重编
// 全部材质的着色器，放到最后。
// 抗锯齿：SMAA 是几何边缘的 MSAA 加最后一道 SMAA（墨线与雨丝是后期描的，MSAA 管不到）；FXAA 只有最后一道；
// 超采样按 2 倍分辨率画（总像素比封顶 3），浏览器缩回屏幕尺寸时自然平均，墨线按屏幕像素取样，不变细。
// 预览（样式小图）：分辨率固定 1，不做超采样和 MSAA，阴影最多 1024，不开辉光，不自动降级，也不跟全局挡位。

export type MachiPostAntialias = 'none' | 'fxaa' | 'smaa';

export interface MachiRenderQuality {
    pixelRatio: number;
    /** 场景目标的 MSAA 采样数。 */
    samples: number;
    postAA: MachiPostAntialias;
    /** 墨线取样的步长（内部像素）：超采样时按屏幕像素取，线才不变细。 */
    inkScale: number;
    /** 0 是不投阴影。 */
    shadowMapSize: number;
    /** 0 是不画倒影。 */
    reflectionScale: number;
    bloom: boolean;
    streaks: boolean;
    /** 景深的离焦层（tuning 的景深强度另算）。 */
    dof: boolean;
    /** 降级之后实际用的抗锯齿方式。 */
    antialias: MachiAntialias;
    /** 降级之后实际用的分辨率倍数。 */
    renderScale: LyricRenderScale;
    /** 实际压下去了几格（已经压到底时比运行时要的少）。 */
    degrade: number;
}

export interface MachiRenderQualityOptions {
    degrade: number;
    devicePixelRatio: number;
    previewMode: boolean;
    /** 歌词画布的全局挡位：分辨率、抗锯齿选了「跟随全局」时用它。 */
    global: LyricRenderQuality;
}

const SHADOW_MAP_SIZES: Record<MachiDetailLevel, number> = { off: 0, low: 1024, high: 2048 };
const REFLECTION_SCALES: Record<MachiDetailLevel, number> = { off: 0, low: 0.3, high: 0.5 };
/** 高 DPI 屏上分辨率最多按 2 倍 CSS 像素算；超采样后总像素比最多 3。 */
const MAX_DEVICE_RATIO = 2;
const MAX_SUPERSAMPLED_RATIO = MAX_LYRIC_PIXEL_RATIO;
const SUPERSAMPLE = 2;
const PREVIEW_PIXEL_RATIO = 1;
const SMAA_SAMPLES = 4;

const LEVEL_DOWN: Record<MachiDetailLevel, MachiDetailLevel> = { high: 'low', low: 'off', off: 'off' };
const POST_AA_DOWN: Partial<Record<MachiAntialias, MachiAntialias>> = { smaa: 'fxaa', fxaa: 'off' };
/** 不超采样的分辨率往下退一格（到 0.5 为止）；超采样的倍数（大于 1）一格就退回 1，和「超采样」抗锯齿一样。 */
const SCALE_DOWN: Partial<Record<LyricRenderScale, LyricRenderScale>> = { 1: 0.75, 0.75: 0.5 };

/** 跟随全局展开以后的一套具体设置。 */
interface Settled {
    renderScale: LyricRenderScale;
    antialias: MachiAntialias;
    /** SMAA 那档里几何边缘的 MSAA（降级时先退它，留着后期那道 SMAA）。 */
    msaa: boolean;
    shadows: MachiDetailLevel;
    reflections: MachiDetailLevel;
    glow: boolean;
    dof: boolean;
}

/** 降级的一格：把一项往下压一档；已经最低时返回 null（这格跳过）。 */
const DEGRADE_STEPS: ((settled: Settled) => Settled | null)[] = [
    s => (s.dof ? { ...s, dof: false } : null),
    s => {
        if (s.antialias === 'ssaa') return { ...s, antialias: 'smaa', msaa: true };
        return s.renderScale > 1 ? { ...s, renderScale: 1 } : null;
    },
    s => (s.antialias === 'smaa' && s.msaa ? { ...s, msaa: false } : null),
    s => (s.reflections !== 'off' ? { ...s, reflections: LEVEL_DOWN[s.reflections] } : null),
    s => (s.glow ? { ...s, glow: false } : null),
    s => {
        const lower = SCALE_DOWN[s.renderScale];
        return lower ? { ...s, renderScale: lower } : null;
    },
    s => {
        const lower = POST_AA_DOWN[s.antialias];
        return lower ? { ...s, antialias: lower } : null;
    },
    s => (s.shadows !== 'off' ? { ...s, shadows: LEVEL_DOWN[s.shadows] } : null),
];

/** 把「跟随全局」换成全局挡位里的具体值。 */
const settle = (quality: MachiQuality, global: LyricRenderQuality): Settled => ({
    renderScale: quality.renderScale === 'global' ? global.scale : quality.renderScale,
    antialias: quality.antialias === 'global' ? (global.antialias === 'off' ? 'off' : 'smaa') : quality.antialias,
    msaa: true,
    shadows: quality.shadows,
    reflections: quality.reflections,
    glow: quality.glow,
    dof: true,
});

export const resolveMachiRenderQuality = (quality: MachiQuality, options: MachiRenderQualityOptions): MachiRenderQuality => {
    // 预览不跟全局挡位：跟随全局的两项按全局的默认值（1 倍、SMAA）算，和别的样式的预览一样保持原样。
    let settled = settle(quality, options.previewMode ? DEFAULT_LYRIC_RENDER_QUALITY : options.global);
    const wanted = quality.adaptive && !options.previewMode ? Math.max(0, Math.floor(options.degrade)) : 0;
    let degrade = 0;
    // 按顺序转圈，压不动的格跳过；整整一圈都压不动就到底了。
    for (let index = 0, idle = 0; degrade < wanted && idle < DEGRADE_STEPS.length; index += 1) {
        const next = DEGRADE_STEPS[index % DEGRADE_STEPS.length]!(settled);
        if (next) {
            settled = next;
            degrade += 1;
            idle = 0;
        } else {
            idle += 1;
        }
    }
    let { antialias, shadows, glow, renderScale } = settled;
    if (options.previewMode) {
        if (antialias === 'ssaa') antialias = 'smaa';
        if (shadows === 'high') shadows = 'low';
        glow = false;
        renderScale = 1;
    }
    const device = Math.min(Math.max(1, options.devicePixelRatio || 1), MAX_DEVICE_RATIO);
    // 不超采样时的内部像素比（墨线的取样步长按它算）；倍数大于 1 是超采样，和「超采样」抗锯齿一样处理。
    const base = options.previewMode ? PREVIEW_PIXEL_RATIO : device * Math.min(1, renderScale);
    const scaled = renderScale > 1 ? Math.max(base, Math.min(base * renderScale, MAX_SUPERSAMPLED_RATIO)) : base;
    const pixelRatio = antialias === 'ssaa' ? Math.max(scaled, Math.min(scaled * SUPERSAMPLE, MAX_SUPERSAMPLED_RATIO)) : scaled;
    return {
        pixelRatio,
        samples: antialias === 'smaa' && settled.msaa && !options.previewMode ? SMAA_SAMPLES : 0,
        postAA: antialias === 'fxaa' ? 'fxaa' : antialias === 'smaa' ? 'smaa' : 'none',
        inkScale: pixelRatio / base,
        shadowMapSize: SHADOW_MAP_SIZES[shadows],
        reflectionScale: REFLECTION_SCALES[settled.reflections],
        bloom: glow,
        streaks: glow,
        dof: settled.dof,
        antialias,
        renderScale,
        degrade,
    };
};
