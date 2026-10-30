import { describe, expect, it } from 'vitest';
import { resolveMachiRenderQuality } from '@/components/visualizer/machi/engine/quality';
import { DEFAULT_MACHI_QUALITY, MACHI_QUALITY_PRESETS, type MachiQuality } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/machiQuality.test.ts
// 町景的画质 → 渲染参数：各档、各种抗锯齿算出来的东西；超采样的像素比与封顶；自动降级只会比用户选的低、按顺序一格格压、
// 压到底就停；关了自动降级不压；预览（样式小图）的限制。

const at = (quality: MachiQuality, degrade = 0, devicePixelRatio = 1, previewMode = false) => resolveMachiRenderQuality(quality, { degrade, devicePixelRatio, previewMode });

describe('resolveMachiRenderQuality', () => {
    it('turns the presets into render parameters', () => {
        expect(at(DEFAULT_MACHI_QUALITY)).toEqual({
            pixelRatio: 1, samples: 4, postAA: 'smaa', inkScale: 1, shadowMapSize: 2048, reflectionScale: 0.5,
            bloom: true, streaks: true, dof: true, antialias: 'smaa', degrade: 0,
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

    it('degrades one notch at a time in order, never above the chosen settings', () => {
        const steps = Array.from({ length: 14 }, (_, degrade) => at(DEFAULT_MACHI_QUALITY, degrade));
        const picked = steps.map(step => [step.dof, step.reflectionScale, step.shadowMapSize, step.bloom, step.pixelRatio, step.antialias, step.degrade]);
        expect(picked.slice(0, 7)).toEqual([
            [true, 0.5, 2048, true, 1, 'smaa', 0],
            [false, 0.5, 2048, true, 1, 'smaa', 1],
            [false, 0.3, 2048, true, 1, 'smaa', 2],
            [false, 0.3, 1024, true, 1, 'smaa', 3],
            [false, 0.3, 1024, false, 1, 'smaa', 4],
            [false, 0.3, 1024, false, 0.75, 'smaa', 5],
            [false, 0.3, 1024, false, 0.75, 'fxaa', 6],
        ]);
        // 第二圈：倒影、阴影关掉，分辨率到一半，抗锯齿关掉；之后压不动了。
        expect(steps[10]).toMatchObject({ reflectionScale: 0, shadowMapSize: 0, pixelRatio: 0.5, antialias: 'off', degrade: 10 });
        expect(steps[13]).toEqual(steps[10]);
        // 每一格都不比前一格高。
        steps.slice(1).forEach((step, index) => {
            const before = steps[index]!;
            expect(step.pixelRatio).toBeLessThanOrEqual(before.pixelRatio);
            expect(step.reflectionScale).toBeLessThanOrEqual(before.reflectionScale);
            expect(step.shadowMapSize).toBeLessThanOrEqual(before.shadowMapSize);
            expect(Number(step.bloom)).toBeLessThanOrEqual(Number(before.bloom));
        });
    });

    it('drops supersampling before it lowers the resolution', () => {
        const ssaa = { ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' as const };
        const ratios = Array.from({ length: 8 }, (_, degrade) => [at(ssaa, degrade).pixelRatio, at(ssaa, degrade).antialias]);
        expect(ratios).toEqual([[2, 'ssaa'], [2, 'ssaa'], [2, 'ssaa'], [2, 'ssaa'], [2, 'ssaa'], [1, 'smaa'], [0.75, 'smaa'], [0.75, 'fxaa']]);
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

    it('keeps previews small and cheap', () => {
        const preview = at({ ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' }, 4, 2, true);
        expect(preview).toMatchObject({ pixelRatio: 1, samples: 0, postAA: 'smaa', inkScale: 1, shadowMapSize: 1024, bloom: false, streaks: false, dof: true, degrade: 0 });
        expect(at(DEFAULT_MACHI_QUALITY, 0, 2, true)).toMatchObject({ pixelRatio: 1, samples: 0, postAA: 'smaa' });
    });
});
