// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { readStoredLyricRenderQuality } from '@/stores/visualizerSettingsPersistence';
import {
    DEFAULT_LYRIC_RENDER_QUALITY,
    LYRIC_RENDER_QUALITY_STORAGE_KEY,
    normalizeLyricRenderOverride,
    normalizeLyricRenderQuality,
    resolveLyricAntialias,
    resolveLyricPixelRatio,
    resolveLyricRenderQuality,
} from '@/utils/lyricRenderQuality';

// test/unit/visualizer/lyricRenderQuality.test.ts
// 歌词画布的分辨率与抗锯齿（#929）：全局挡位与样式覆盖的读取、合并，渲染倍率的封顶，抗锯齿的「自动」。

describe('lyric render quality', () => {
    afterEach(() => localStorage.removeItem(LYRIC_RENDER_QUALITY_STORAGE_KEY));

    it('reads the stored global setting, falling back field by field', () => {
        expect(readStoredLyricRenderQuality()).toEqual(DEFAULT_LYRIC_RENDER_QUALITY);
        localStorage.setItem(LYRIC_RENDER_QUALITY_STORAGE_KEY, JSON.stringify({ scale: 1.5, antialias: 'off' }));
        expect(readStoredLyricRenderQuality()).toEqual({ scale: 1.5, antialias: 'off' });
        localStorage.setItem(LYRIC_RENDER_QUALITY_STORAGE_KEY, JSON.stringify({ scale: 3, antialias: 'on' }));
        expect(readStoredLyricRenderQuality()).toEqual({ scale: 1, antialias: 'on' });
        localStorage.setItem(LYRIC_RENDER_QUALITY_STORAGE_KEY, '{not json');
        expect(readStoredLyricRenderQuality()).toEqual(DEFAULT_LYRIC_RENDER_QUALITY);
        expect(normalizeLyricRenderQuality(null)).toEqual(DEFAULT_LYRIC_RENDER_QUALITY);
    });

    it('reads a style override, following the global setting where it says nothing', () => {
        expect(normalizeLyricRenderOverride(undefined)).toEqual({ scale: 'global', antialias: 'global' });
        expect(normalizeLyricRenderOverride({ scale: 0.75, antialias: 'off' })).toEqual({ scale: 0.75, antialias: 'off' });
        // 全局挡位才有「自动」，样式覆盖里不认。
        expect(normalizeLyricRenderOverride({ scale: '2', antialias: 'auto' })).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('lets an override win field by field', () => {
        const global = { scale: 2, antialias: 'auto' } as const;
        expect(resolveLyricRenderQuality(global, null)).toEqual(global);
        expect(resolveLyricRenderQuality(global, { scale: 0.5, antialias: 'global' })).toEqual({ scale: 0.5, antialias: 'auto' });
        expect(resolveLyricRenderQuality(global, { scale: 'global', antialias: 'on' })).toEqual({ scale: 2, antialias: 'on' });
    });

    it('multiplies the style base, capping supersampling at 3 but never going below the base', () => {
        expect(resolveLyricPixelRatio(1, 1)).toBe(1);
        expect(resolveLyricPixelRatio(2, 0.5)).toBe(1);
        expect(resolveLyricPixelRatio(1, 2)).toBe(2);
        expect(resolveLyricPixelRatio(2, 1.5)).toBe(3);
        expect(resolveLyricPixelRatio(2, 2)).toBe(3);
        // 默认密度本来就过了上限：不再加，但也不压下来。
        expect(resolveLyricPixelRatio(3.5, 2)).toBe(3.5);
        expect(resolveLyricPixelRatio(Number.NaN, 1)).toBe(1);
    });

    it('keeps the style default when anti-aliasing is auto', () => {
        expect(resolveLyricAntialias('auto', true)).toBe(true);
        expect(resolveLyricAntialias('auto', false)).toBe(false);
        expect(resolveLyricAntialias('on', false)).toBe(true);
        expect(resolveLyricAntialias('off', true)).toBe(false);
    });
});
