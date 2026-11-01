import { useMemo } from 'react';
import type { LyricRenderOverride, LyricRenderQuality } from '../../../types';
import { resolveLyricRenderQuality } from '../../../utils/lyricRenderQuality';
import { useGlobalLyricRenderQuality, useLyricRenderQualityPin } from './lyricRenderQualityPin';

// src/components/visualizer/renderQuality/useLyricRenderQuality.ts
// 歌词样式的渲染器取自己实际用的分辨率倍数与抗锯齿：全局挡位（「性能与动效」）叠上样式 tuning 里的覆盖。
// 全局挡位改了、覆盖改了都会换一个新对象，渲染器据此调整像素密度或重建上下文。视频导出钉住了值（lyricRenderQualityPin.ts）时
// 只用钉住的，覆盖也不看。

/** 全局挡位叠上 override（样式 tuning 里的 render 一项；没有时全跟随全局）；导出时是钉住的那一组。 */
export const useLyricRenderQuality = (override?: LyricRenderOverride | null): LyricRenderQuality => {
    const pinned = useLyricRenderQualityPin();
    const global = useGlobalLyricRenderQuality();
    const scale = pinned ? undefined : override?.scale;
    const antialias = pinned ? undefined : override?.antialias;
    return useMemo(
        () => resolveLyricRenderQuality(global, scale && antialias ? { scale, antialias } : null),
        [global, scale, antialias],
    );
};
