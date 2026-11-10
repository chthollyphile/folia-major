import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LyricRenderQualityGlobalContext, LyricRenderQualityPinContext } from '@/components/visualizer/renderQuality/lyricRenderQualityPin';
import { useLyricRenderQuality } from '@/components/visualizer/renderQuality/useLyricRenderQuality';
import type { LyricRenderOverride } from '@/types';
import { DEFAULT_LYRIC_RENDER_QUALITY } from '@/utils/lyricRenderQuality';

// test/unit/visualizer/lyricRenderQualityPin.test.ts
// 视频导出钉住歌词画布的渲染质量：钉住时样式拿到的就是钉住的那组（1×、各样式默认的抗锯齿），全局挡位和样式覆盖都不算；
// 没钉时照常是全局叠覆盖。（服务端渲染里 store 读的是初始值，所以这里只拿覆盖来分辨钉没钉。）

const probe = (override: LyricRenderOverride, pinned: boolean) => {
    const Probe = () => JSON.stringify(useLyricRenderQuality(override));
    const element = createElement(Probe);
    const html = renderToString(pinned ? createElement(LyricRenderQualityPinContext.Provider, { value: DEFAULT_LYRIC_RENDER_QUALITY }, element) : element);
    return JSON.parse(html.replace(/&quot;/g, '"'));
};

describe('lyric render quality given from outside (the OBS page)', () => {
    // OBS 页面经配置码带来全局挡位：它替换全局挡位，样式自己的覆盖照常生效（和钉住不同）
    const probeGiven = (override: LyricRenderOverride | null) => {
        const Probe = () => JSON.stringify(useLyricRenderQuality(override));
        const html = renderToString(createElement(LyricRenderQualityGlobalContext.Provider, { value: { scale: 1.5, antialias: 'off' } }, createElement(Probe)));
        return JSON.parse(html.replace(/&quot;/g, '"'));
    };

    it('uses the given global, and the style override still wins', () => {
        expect(probeGiven(null)).toEqual({ scale: 1.5, antialias: 'off' });
        expect(probeGiven({ scale: 0.75, antialias: 'on' })).toEqual({ scale: 0.75, antialias: 'on' });
    });
});

describe('lyric render quality pin', () => {
    it('ignores the style override while pinned', () => {
        const override = { scale: 0.75, antialias: 'on' } as const;
        expect(probe(override, false)).toEqual({ scale: 0.75, antialias: 'on' });
        expect(probe(override, true)).toEqual(DEFAULT_LYRIC_RENDER_QUALITY);
        expect(probe({ scale: 2, antialias: 'off' }, true)).toEqual(DEFAULT_LYRIC_RENDER_QUALITY);
    });
});
