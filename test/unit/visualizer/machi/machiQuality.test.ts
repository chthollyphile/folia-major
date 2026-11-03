import { describe, expect, it } from 'vitest';
import { createMachiDegradeState, resolveMachiDegradeThreshold, resolveMachiRenderQuality, stepMachiDegrade } from '@/components/visualizer/machi/engine/quality';
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
            // 没有超采样可退：第一格是几何边缘的 MSAA（后期 SMAA 留着）。
            [true, 0, 0.5, true, 1, 'smaa', 2048, 1],
            [true, 0, 0.5, false, 1, 'smaa', 2048, 2],
            [true, 0, 0.3, false, 1, 'smaa', 2048, 3],
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

    it('drops supersampling first, then the geometry MSAA', () => {
        const ssaa = { ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa' as const };
        const ratios = Array.from({ length: 8 }, (_, degrade) => [at(ssaa, degrade).pixelRatio, at(ssaa, degrade).antialias, at(ssaa, degrade).samples]);
        expect(ratios).toEqual([
            [2, 'ssaa', 0], [1, 'smaa', 4], [1, 'smaa', 0], [1, 'smaa', 0], [1, 'smaa', 0], [1, 'smaa', 0], [0.75, 'smaa', 0], [0.75, 'fxaa', 0],
        ]);
        // 全局倍数的超采样也是一格退回 1 倍。
        const global = { scale: 2, antialias: 'auto' } as const;
        expect([0, 1, 2].map(degrade => at(DEFAULT_MACHI_QUALITY, degrade, 1, false, global).pixelRatio)).toEqual([2, 1, 1]);
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

    it('sets the degrade threshold from the display refresh, between 90 fps and the old 21 ms', () => {
        expect(resolveMachiDegradeThreshold(8.33)).toBeCloseTo(1000 / 90, 2);
        expect(resolveMachiDegradeThreshold(10)).toBeCloseTo(13.3, 2);
        expect(resolveMachiDegradeThreshold(16.67)).toBe(21);
        expect(resolveMachiDegradeThreshold(25)).toBe(21);
        expect(resolveMachiDegradeThreshold(0)).toBe(21);
    });

    it('asks no more than 90 fps of a 144 Hz or 240 Hz display', () => {
        expect(resolveMachiDegradeThreshold(1000 / 144)).toBeCloseTo(1000 / 90, 2);
        expect(resolveMachiDegradeThreshold(1000 / 240)).toBeCloseTo(1000 / 90, 2);
        // 240Hz 上稳定 120fps：不降。
        const step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 1000 / 240 : 1000 / 80)));
        expect(step).toMatchObject({ degrade: false, state: { slowChecks: 0 } });
    });

    it('degrades after two slow checks, keeping the fastest refresh seen so far', () => {
        const frames = (fast: number, slow: number, slowEvery: number) => Array.from({ length: 120 }, (_, i) => (i % slowEvery === 0 ? slow : fast));
        // 120Hz、每十帧掉一帧（约 109fps）：不降。
        let step = stepMachiDegrade(createMachiDegradeState(), frames(8.33, 16.67, 10));
        expect(step).toMatchObject({ degrade: false, state: { slowChecks: 0 } });
        expect(step.state.refresh).toBeCloseTo(8.33);
        // 之后每帧都赶不上（稳定 60fps，这一段较快的帧也是 16.67）：门槛仍按 120Hz 算，连着两次就降。
        const at60 = Array.from({ length: 120 }, () => 16.67);
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: false, state: { slowChecks: 1 } });
        expect(step.state.refresh).toBeCloseTo(8.33);
        expect(step.threshold).toBeCloseTo(1000 / 90, 2);
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: true, state: { slowChecks: 0 } });
        expect(step.state.refresh).toBeCloseTo(8.33);
        expect(step.state.degradedAverage).toBeCloseTo(16.67);
    });

    it('takes the display as slowed down when a step down did not speed the frames up', () => {
        // 120Hz 上学到 8.33，屏幕自己降到 60Hz（动态刷新率、低电量）：两次检查后降了一格。
        let step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, () => 8.33));
        const at60 = Array.from({ length: 120 }, () => 16.67);
        step = stepMachiDegrade(step.state, at60);
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: true });
        // 降了一格还是 16.67：卡住的是刷新，按 60Hz 重新认，门槛回到 21 毫秒，不再降。
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: false, threshold: 21, state: { slowChecks: 0, degradedAverage: 0 } });
        expect(step.state.displayFloor).toBeCloseTo(16.67);
        expect(step.state.refresh).toBeCloseTo(16.67);
        for (let check = 0; check < 6; check += 1) {
            step = stepMachiDegrade(step.state, at60);
            expect(step.degrade).toBe(false);
        }
    });

    it('keeps the learned refresh when a step down did speed the frames up, and compares only once', () => {
        let step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, () => 8.33));
        const at60 = Array.from({ length: 120 }, () => 16.67);
        step = stepMachiDegrade(step.state, at60);
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: true });
        // 降了一格到 80fps：确实变快了，仍按 8.33 判断（门槛约 11.1，80fps 仍算慢）。
        const at80 = Array.from({ length: 120 }, () => 12.5);
        step = stepMachiDegrade(step.state, at80);
        expect(step).toMatchObject({ degrade: false, state: { slowChecks: 1, degradedAverage: 0 } });
        expect(step.state.refresh).toBeCloseTo(8.33);
        expect(step.threshold).toBeCloseTo(1000 / 90, 2);
        // 下一次又慢回 60fps：不再拿降级那次的平均比，照旧按 8.33 判断，降。
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: true });
        expect(step.threshold).toBeCloseTo(1000 / 90, 2);
    });

    it('does not loosen the refresh when the GPU falls short on a 120 Hz display', () => {
        // 120Hz 上学到 8.33，之后 GPU 不够，帧对齐到刷新间隔的整数倍：16.67 和 25 交替（约 48fps），较快那一成是 16.67。
        let step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, () => 8.33));
        const uneven = Array.from({ length: 120 }, (_, i) => (i % 2 === 0 ? 16.67 : 25));
        step = stepMachiDegrade(step.state, uneven);
        step = stepMachiDegrade(step.state, uneven);
        expect(step).toMatchObject({ degrade: true });
        // 降的这一格省得很少，没变快：但间隔快慢混着，不是屏幕卡着刷新，不放宽，接着降。
        step = stepMachiDegrade(step.state, uneven);
        expect(step).toMatchObject({ degrade: false, state: { slowChecks: 1, displayFloor: 0 } });
        expect(step.state.refresh).toBeCloseTo(8.33);
        expect(step.threshold).toBeCloseTo(1000 / 90, 2);
        step = stepMachiDegrade(step.state, uneven);
        expect(step).toMatchObject({ degrade: true });
    });

    it('holds the slowed-down display refresh when a dynamic refresh rate briefly goes back up', () => {
        let step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, () => 8.33));
        const at60 = Array.from({ length: 120 }, () => 16.67);
        step = stepMachiDegrade(step.state, at60);
        step = stepMachiDegrade(step.state, at60);
        expect(step).toMatchObject({ degrade: true });
        step = stepMachiDegrade(step.state, at60);
        expect(step.state.displayFloor).toBeCloseTo(16.67);
        // 之后屏幕时不时升回 120Hz 一小会儿（一段里一成半的帧是 8.33）：较快的帧不把刷新拉回 8.33，不再白降。
        const burst = Array.from({ length: 120 }, (_, i) => (i < 18 ? 8.33 : 16.67));
        let degrades = 0;
        for (let round = 0; round < 6; round += 1) {
            for (const frames of [at60, at60, at60, burst]) {
                step = stepMachiDegrade(step.state, frames);
                if (step.degrade) degrades += 1;
            }
        }
        expect(degrades).toBe(0);
        expect(step.threshold).toBe(21);
    });

    it('keeps the 21 ms threshold at 60 Hz and before any frame', () => {
        const step = stepMachiDegrade(createMachiDegradeState(), Array.from({ length: 120 }, (_, i) => (i % 5 === 0 ? 33.3 : 16.67)));
        expect(step).toMatchObject({ degrade: false, threshold: 21 });
        expect(stepMachiDegrade(createMachiDegradeState(), [])).toMatchObject({ degrade: false, threshold: 21 });
    });
});
