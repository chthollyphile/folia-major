import { createContext, useContext } from 'react';
import { useVisualizerSettingsStore } from '../../../stores/useVisualizerSettingsStore';
import type { LyricRenderQuality } from '../../../types';

// src/components/visualizer/renderQuality/lyricRenderQualityPin.ts
// 把歌词画布的分辨率与抗锯齿钉在一组固定值上：视频导出（mods/export/modExportPage.tsx）用它按 1×、各样式默认的抗锯齿画，
// 不跟全局挡位和样式自己的覆盖（为流畅调低的设置不该让导出的视频发糊）。不在它里面时什么也不钉。

export const LyricRenderQualityPinContext = createContext<LyricRenderQuality | null>(null);

/** 钉住的那一组（导出时），没钉时是 null。 */
export const useLyricRenderQualityPin = (): LyricRenderQuality | null => useContext(LyricRenderQualityPinContext);

/**
 * 全局挡位从外面给（OBS 页面：本机的设置在 OBS 的浏览器里读不到，经外观配置码带过来）。
 * 和钉住不同，它只替换全局挡位，样式自己的覆盖照常生效。不在它里面时用「动画与性能」里的设置。
 */
export const LyricRenderQualityGlobalContext = createContext<LyricRenderQuality | null>(null);

/** 全局挡位：钉住时用钉住的值，外面给了就用给的，否则是「动画与性能」里的设置。 */
export const useGlobalLyricRenderQuality = (): LyricRenderQuality => {
    const pinned = useLyricRenderQualityPin();
    const provided = useContext(LyricRenderQualityGlobalContext);
    const global = useVisualizerSettingsStore(state => state.lyricRenderQuality);
    return pinned ?? provided ?? global;
};
