import type { MachiAntialias, MachiDetailLevel, MachiQuality, MachiRenderScale } from '../types';

// src/components/visualizer/machi/engine/quality.ts
// 画质设置 → 实际用的渲染参数（纯函数，运行时与单测共用）。
// 自动降级：帧时长期偏高时，运行时把“降了几格”加一，这里在用户那套设置上按固定顺序一格格往下压（景深离焦层 → 倒影 →
// 阴影 → 辉光 → 超采样退成 SMAA → 分辨率 → 抗锯齿，一轮压完再来一轮），已经压不动的跳过；所以只会比用户选的低，不会高。
// 超采样最贵，先于分辨率退掉：不然分辨率先降一格、再退超采样，像素比会一下子掉一半。
// 抗锯齿：SMAA 是几何边缘的 MSAA 加最后一道 SMAA（墨线与雨丝是后期描的，MSAA 管不到）；FXAA 只有最后一道；
// 超采样按 2 倍分辨率画（总像素比封顶 3），浏览器缩回屏幕尺寸时自然平均，墨线按屏幕像素取样，不变细。
// 预览（样式小图）：分辨率固定 1，不做超采样和 MSAA，阴影最多 1024，不开辉光，不自动降级。

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
    /** 实际压下去了几格（已经压到底时比运行时要的少）。 */
    degrade: number;
}

export interface MachiRenderQualityOptions {
    degrade: number;
    devicePixelRatio: number;
    previewMode: boolean;
}

const SHADOW_MAP_SIZES: Record<MachiDetailLevel, number> = { off: 0, low: 1024, high: 2048 };
const REFLECTION_SCALES: Record<MachiDetailLevel, number> = { off: 0, low: 0.3, high: 0.5 };
/** 高 DPI 屏上分辨率最多按 2 倍 CSS 像素算；超采样后总像素比最多 3。 */
const MAX_DEVICE_RATIO = 2;
const MAX_SUPERSAMPLED_RATIO = 3;
const SUPERSAMPLE = 2;
const PREVIEW_PIXEL_RATIO = 1;
const SMAA_SAMPLES = 4;

const LEVEL_DOWN: Record<MachiDetailLevel, MachiDetailLevel> = { high: 'low', low: 'off', off: 'off' };
const ANTIALIAS_DOWN: Record<MachiAntialias, MachiAntialias> = { ssaa: 'smaa', smaa: 'fxaa', fxaa: 'off', off: 'off' };
const SCALE_DOWN: Record<MachiRenderScale, MachiRenderScale> = { 1: 0.75, 0.75: 0.5, 0.5: 0.5 };

interface Settled {
    quality: Omit<MachiQuality, 'adaptive'>;
    dof: boolean;
}

/** 降级的一格：把一项往下压一档；已经最低时返回 null（这格跳过）。 */
const DEGRADE_STEPS: ((settled: Settled) => Settled | null)[] = [
    s => (s.dof ? { ...s, dof: false } : null),
    s => (s.quality.reflections !== 'off' ? { ...s, quality: { ...s.quality, reflections: LEVEL_DOWN[s.quality.reflections] } } : null),
    s => (s.quality.shadows !== 'off' ? { ...s, quality: { ...s.quality, shadows: LEVEL_DOWN[s.quality.shadows] } } : null),
    s => (s.quality.glow ? { ...s, quality: { ...s.quality, glow: false } } : null),
    s => (s.quality.antialias === 'ssaa' ? { ...s, quality: { ...s.quality, antialias: 'smaa' } } : null),
    s => (s.quality.renderScale !== 0.5 ? { ...s, quality: { ...s.quality, renderScale: SCALE_DOWN[s.quality.renderScale] } } : null),
    s => (s.quality.antialias !== 'off' ? { ...s, quality: { ...s.quality, antialias: ANTIALIAS_DOWN[s.quality.antialias] } } : null),
];

export const resolveMachiRenderQuality = (quality: MachiQuality, options: MachiRenderQualityOptions): MachiRenderQuality => {
    const { adaptive, ...chosen } = quality;
    let settled: Settled = { quality: chosen, dof: true };
    const wanted = adaptive && !options.previewMode ? Math.max(0, Math.floor(options.degrade)) : 0;
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
    let { antialias, shadows, glow } = settled.quality;
    if (options.previewMode) {
        if (antialias === 'ssaa') antialias = 'smaa';
        if (shadows === 'high') shadows = 'low';
        glow = false;
    }
    const device = Math.min(Math.max(1, options.devicePixelRatio || 1), MAX_DEVICE_RATIO);
    const base = options.previewMode ? PREVIEW_PIXEL_RATIO : device * settled.quality.renderScale;
    const pixelRatio = antialias === 'ssaa' ? Math.max(base, Math.min(base * SUPERSAMPLE, MAX_SUPERSAMPLED_RATIO)) : base;
    return {
        pixelRatio,
        samples: antialias === 'smaa' && !options.previewMode ? SMAA_SAMPLES : 0,
        postAA: antialias === 'fxaa' ? 'fxaa' : antialias === 'smaa' ? 'smaa' : 'none',
        inkScale: pixelRatio / base,
        shadowMapSize: SHADOW_MAP_SIZES[shadows],
        reflectionScale: REFLECTION_SCALES[settled.quality.reflections],
        bloom: glow,
        streaks: glow,
        dof: settled.dof,
        antialias,
        degrade,
    };
};
