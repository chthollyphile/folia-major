import type { LyricAntialias, LyricRenderOverride, LyricRenderQuality, LyricRenderScale } from '../types';

// src/utils/lyricRenderQuality.ts
// 歌词画布的分辨率与抗锯齿（#929）：「性能与动效」里一个全局挡位，用 canvas / WebGL 画的歌词样式各自有一份覆盖，
// 默认「跟随全局」。这里是纯函数：校验存着的值、合出一个样式实际用的那一组、按样式自己的默认像素密度算出渲染倍率。
// 全局挡位存在 useVisualizerSettingsStore，样式的覆盖存在样式自己的 tuning 里，模组经 folium.visualizer 读写全局挡位。

export const LYRIC_RENDER_QUALITY_STORAGE_KEY = 'lyric_render_quality';

export const LYRIC_RENDER_SCALES = [0.5, 0.75, 1, 1.5, 2] as const satisfies readonly LyricRenderScale[];
export const LYRIC_ANTIALIAS_MODES = ['auto', 'on', 'off'] as const satisfies readonly LyricAntialias[];
/** 样式覆盖里抗锯齿的取值（「自动」只在全局挡位里有：就是跟着样式自己的默认）。 */
export const LYRIC_ANTIALIAS_OVERRIDES = ['global', 'on', 'off'] as const satisfies readonly LyricRenderOverride['antialias'][];

/** 默认就是各样式原来的样子：分辨率不加不减，抗锯齿按样式自己的默认。 */
export const DEFAULT_LYRIC_RENDER_QUALITY: LyricRenderQuality = { scale: 1, antialias: 'auto' };
export const DEFAULT_LYRIC_RENDER_OVERRIDE: LyricRenderOverride = { scale: 'global', antialias: 'global' };

/** 超采样后的渲染倍率最多到这么大（2 倍屏上再超采样 2 倍会是 4，显存和填充率都吃不消）。 */
export const MAX_LYRIC_PIXEL_RATIO = 3;

export const isLyricRenderScale = (value: unknown): value is LyricRenderScale => (LYRIC_RENDER_SCALES as readonly unknown[]).includes(value);

/** 存着的（或模组给的）全局挡位读成合法值，缺的、不认识的取默认。 */
export const normalizeLyricRenderQuality = (raw: unknown): LyricRenderQuality => {
    const input = raw && typeof raw === 'object' ? raw as Partial<Record<keyof LyricRenderQuality, unknown>> : {};
    return {
        scale: isLyricRenderScale(input.scale) ? input.scale : DEFAULT_LYRIC_RENDER_QUALITY.scale,
        antialias: (LYRIC_ANTIALIAS_MODES as readonly unknown[]).includes(input.antialias) ? input.antialias as LyricAntialias : DEFAULT_LYRIC_RENDER_QUALITY.antialias,
    };
};

/** 样式 tuning 里存着的覆盖读成合法值；没有这一项（旧的存档）就是全跟随全局。 */
export const normalizeLyricRenderOverride = (raw: unknown): LyricRenderOverride => {
    const input = raw && typeof raw === 'object' ? raw as Partial<Record<keyof LyricRenderOverride, unknown>> : {};
    return {
        scale: isLyricRenderScale(input.scale) ? input.scale : 'global',
        antialias: input.antialias === 'on' || input.antialias === 'off' ? input.antialias : 'global',
    };
};

/** 一个样式实际用的分辨率倍数与抗锯齿：覆盖里写了具体值就用它，否则用全局挡位。 */
export const resolveLyricRenderQuality = (global: LyricRenderQuality, override?: LyricRenderOverride | null): LyricRenderQuality => ({
    scale: override && override.scale !== 'global' ? override.scale : global.scale,
    antialias: override && override.antialias !== 'global' ? override.antialias : global.antialias,
});

/**
 * 渲染倍率：样式自己的默认像素密度（base，各样式原来怎么算还怎么算）乘上分辨率倍数，最多 MAX_LYRIC_PIXEL_RATIO；
 * 默认密度本来就超过上限时不再往上加，但缩小照样生效。
 */
export const resolveLyricPixelRatio = (base: number, scale: LyricRenderScale, max = MAX_LYRIC_PIXEL_RATIO) => {
    const safeBase = Number.isFinite(base) && base > 0 ? base : 1;
    const ratio = safeBase * scale;
    return scale > 1 ? Math.max(safeBase, Math.min(ratio, max)) : ratio;
};

/** 抗锯齿开不开：auto 用样式自己的默认。 */
export const resolveLyricAntialias = (antialias: LyricAntialias, styleDefault: boolean) => (
    antialias === 'auto' ? styleDefault : antialias === 'on'
);

/** 面板和命令面板里显示的分辨率倍数（“1.5×”）。 */
export const formatLyricRenderScale = (scale: LyricRenderScale) => `${scale}×`;
