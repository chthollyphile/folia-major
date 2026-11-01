import { describe, expect, it } from 'vitest';
import { resolveMachiRenderQuality } from '@/components/visualizer/machi/engine/quality';
import { DEFAULT_MACHI_QUALITY, MACHI_QUALITY_PRESETS, type MachiQuality } from '@/components/visualizer/machi/types';
import type { LyricRenderQuality } from '@/types';
import { DEFAULT_LYRIC_RENDER_QUALITY } from '@/utils/lyricRenderQuality';

// test/unit/visualizer/machi/machiQuality.test.ts
// 町景的画质 → 渲染参数：各档、各种抗锯齿算出来的东西；超采样的像素比与封顶；分辨率、抗锯齿跟随全局挡位；自动降级只会比
// 用户选的低、按顺序一格格压（省得多的先退，阴影最后）、压到底就停；关了自动降级不压；预览（样式小图）的限制。

const at = (quality: MachiQuality, degrade = 0, devicePixelRatio = 1, previewMode = false, global: LyricRenderQuality = DEFAULT_LYRIC_RENDER_QUALITY) => (
    resolveMachiRenderQuality(quality, { degrade, devicePixelRatio, previewMode, global })
);

describe('resolveMachiRenderQuality', () => {
    it('turns the presets into render parameters', () => {
        // 高档跟随全局：全局挡位默认时是 1 倍 + SMAA（MSAA×4 加 SMAA），和原来的高档一样。
        expect(at(DEFAULT_MACHI_QUALITY)).toEqual({
            pixelRatio: 1, samples: 4, postAA: 'smaa', inkScale: 1, shadowMapSize: 2048, reflectionScale: 0.5,
            bloom: true, streaks: true, dof: true, antialias: 'smaa', renderScale: 1, degrade: 0,
        });
        expect(at({ ...MACHI_QUALITY_PRESETS.balanced, adaptive: true })).toMatchObject({ samples: 0, postAA: 'fxaa', shadowMapSize: 1024, reflectionScale: 0.3, bloom: true });
        expect(at({ ...MACHI_QUALITY_PRESETS.low, adaptive: true })).toMatchObject({ pixelRatio: 0.75, samples: 0, postAA: 'none', shadowMapSize: 0, reflectionScale: 0, bloom: false, streaks: false });
    });

    it('anti-aliases each way', () => {
        const with_ = (antialias: MachiQuality['antialias']) => at({ ...DEFAULT_MACHI_QUALITY, antialias });
        expect(with_('off')).toMatchObject({ samples: 0, postAA: 'none', inkScale: 1, pixelRatio: 1 });
        expect(with_('fxaa')).toMatchObject({ samples: 0, postAA: 'fxaa', inkScale: 1, pixelRatio: 1 });
        expect(with_('smaa')).toMatchObject({ samples: 4, postAA: 'smaa', inkScale: 1, pixelRatio: 1 });
        expect(with_('ssaa')).toMatchObject({ samples: 0, postAA: 'none', inkScale: 2, pixelRatio: 2 });
    });

    it('supersamples twice the pixels up to a total ratio of 3, and samples ink per screen pixel', () => {
        const ssaa = { ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' as const };
        expect(at(ssaa, 0, 1)).toMatchObject({ pixelRatio: 2, inkScale: 2 });
        expect(at(ssaa, 0, 1.25)).toMatchObject({ pixelRatio: 2.5, inkScale: 2 });
        expect(at(ssaa, 0, 2)).toMatchObject({ pixelRatio: 3, inkScale: 1.5 });
        // 高 DPI 屏最多按 2 倍算。
        expect(at(ssaa, 0, 3)).toMatchObject({ pixelRatio: 3, inkScale: 1.5 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 3)).toMatchObject({ pixelRatio: 2 });
        expect(at({ ...ssaa, renderScale: 0.5 }, 0, 1)).toMatchObject({ pixelRatio: 1, inkScale: 2 });
    });

    it('scales the resolution by the share of screen pixels', () => {
        expect(at({ ...DEFAULT_MACHI_QUALITY, renderScale: 0.75 }, 0, 2).pixelRatio).toBe(1.5);
        expect(at({ ...DEFAULT_MACHI_QUALITY, renderScale: 0.5 }, 0, 1).pixelRatio).toBe(0.5);
    });

    it('follows the global lyric canvas setting where it is told to', () => {
        // 全局倍数大于 1：按超采样画，封顶 3，墨线按屏幕像素取样。
        expect(at(DEFAULT_MACHI_QUALITY, 0, 1, false, { scale: 2, antialias: 'auto' })).toMatchObject({ pixelRatio: 2, inkScale: 2, samples: 4, renderScale: 2 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 2, false, { scale: 2, antialias: 'auto' })).toMatchObject({ pixelRatio: 3, inkScale: 1.5 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 1, false, { scale: 0.5, antialias: 'on' })).toMatchObject({ pixelRatio: 0.5, antialias: 'smaa' });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 1, false, { scale: 1, antialias: 'off' })).toMatchObject({ samples: 0, postAA: 'none', antialias: 'off' });
        // 选了具体值的不跟。
        expect(at({ ...DEFAULT_MACHI_QUALITY, renderScale: 0.75, antialias: 'fxaa' }, 0, 1, false, { scale: 2, antialias: 'off' })).toMatchObject({ pixelRatio: 0.75, postAA: 'fxaa' });
    });

    it('degrades one notch at a time in order, cheapest savings last, never above the chosen settings', () => {
        const steps = Array.from({ length: 14 }, (_, degrade) => at(DEFAULT_MACHI_QUALITY, degrade));
        const picked = steps.map(step => [step.dof, step.samples, step.reflectionScale, step.bloom, step.pixelRatio, step.antialias, step.shadowMapSize, step.degrade]);
        expect(picked.slice(0, 8)).toEqual([
            [true, 4, 0.5, true, 1, 'smaa', 2048, 0],
            [false, 4, 0.5, true, 1, 'smaa', 2048, 1],
            // 没有超采样可退：下一格是几何边缘的 MSAA（后期 SMAA 留着）。
            [false, 0, 0.5, true, 1, 'smaa', 2048, 2],
            [false, 0, 0.3, true, 1, 'smaa', 2048, 3],
            [false, 0, 0.3, false, 1, 'smaa', 2048, 4],
            [false, 0, 0.3, false, 0.75, 'smaa', 2048, 5],
            [false, 0, 0.3, false, 0.75, 'fxaa', 2048, 6],
            // 阴影最后。
            [false, 0, 0.3, false, 0.75, 'fxaa', 1024, 7],
        ]);
        // 第二圈：倒影关掉，分辨率到一半，抗锯齿关掉，阴影关掉；之后压不动了。
        expect(steps[11]).toMatchObject({ reflectionScale: 0, shadowMapSize: 0, pixelRatio: 0.5, antialias: 'off', degrade: 11 });
        expect(steps[13]).toEqual(steps[11]);
        // 每一格都不比前一格高。
        steps.slice(1).forEach((step, index) => {
            const before = steps[index]!;
            expect(step.pixelRatio).toBeLessThanOrEqual(before.pixelRatio);
            expect(step.samples).toBeLessThanOrEqual(before.samples);
            expect(step.reflectionScale).toBeLessThanOrEqual(before.reflectionScale);
            expect(step.shadowMapSize).toBeLessThanOrEqual(before.shadowMapSize);
            expect(Number(step.bloom)).toBeLessThanOrEqual(Number(before.bloom));
        });
    });

    it('drops supersampling right after the depth-of-field layer', () => {
        const ssaa = { ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' as const };
        const ratios = Array.from({ length: 8 }, (_, degrade) => [at(ssaa, degrade).pixelRatio, at(ssaa, degrade).antialias, at(ssaa, degrade).samples]);
        expect(ratios).toEqual([
            [2, 'ssaa', 0], [2, 'ssaa', 0], [1, 'smaa', 4], [1, 'smaa', 0], [1, 'smaa', 0], [1, 'smaa', 0], [0.75, 'smaa', 0], [0.75, 'fxaa', 0],
        ]);
        // 全局倍数的超采样也是一格退回 1 倍。
        const global = { scale: 2, antialias: 'auto' } as const;
        expect([0, 1, 2].map(degrade => at(DEFAULT_MACHI_QUALITY, degrade, 1, false, global).pixelRatio)).toEqual([2, 2, 1]);
    });

    it('skips notches that are already at the bottom', () => {
        const low = { ...MACHI_QUALITY_PRESETS.low, adaptive: true };
        // 低档只剩景深离焦层、分辨率（0.75 → 0.5）可以压。
        expect(at(low, 1)).toMatchObject({ dof: false, pixelRatio: 0.75, degrade: 1 });
        expect(at(low, 2)).toMatchObject({ dof: false, pixelRatio: 0.5, degrade: 2 });
        expect(at(low, 5)).toMatchObject({ degrade: 2 });
    });

    it('ignores the degrade count when auto-degrade is off', () => {
        const fixed = { ...DEFAULT_MACHI_QUALITY, adaptive: false };
        expect(at(fixed, 6)).toEqual(at(fixed, 0));
        expect(at(fixed, 6).degrade).toBe(0);
    });

    it('keeps previews small and cheap, whatever the global setting says', () => {
        const preview = at({ ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' }, 4, 2, true);
        expect(preview).toMatchObject({ pixelRatio: 1, samples: 0, postAA: 'smaa', inkScale: 1, shadowMapSize: 1024, bloom: false, streaks: false, dof: true, degrade: 0 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 2, true)).toMatchObject({ pixelRatio: 1, samples: 0, postAA: 'smaa' });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 2, true, { scale: 2, antialias: 'on' })).toMatchObject({ pixelRatio: 1, inkScale: 1 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 1, true, { scale: 1, antialias: 'off' })).toMatchObject({ postAA: 'smaa', antialias: 'smaa' });
    });
});
