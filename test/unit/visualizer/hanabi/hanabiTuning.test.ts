// Copyright (c) 2026 chthollyphile
import { describe, expect, it } from 'vitest';
import {
    HANABI_QUALITY_PROFILES,
    normalizeHanabiTuning,
    requiresHanabiSceneRebuild,
    resolveHanabiGlowQuality,
} from '@/components/visualizer/hanabi/hanabiTuning';
import { DEFAULT_HANABI_TUNING } from '@/components/visualizer/hanabi/types';

// test/unit/visualizer/hanabi/hanabiTuning.test.ts
// 花火 tuning 的归一化：补齐缺的字段、钳住范围、拒绝不认识的配色；以及哪些字段改了要重建场景。

describe('花火 tuning 的归一化', () => {
    it('不是对象时整份用默认值', () => {
        for (const raw of [undefined, null, 5, 'text', true]) expect(normalizeHanabiTuning(raw)).toEqual(DEFAULT_HANABI_TUNING);
        expect(normalizeHanabiTuning({})).toEqual(DEFAULT_HANABI_TUNING);
    });

    it('缺的字段补默认值，给了的留着', () => {
        const tuning = normalizeHanabiTuning({ sparkAmount: 1.5, launches: false });
        expect(tuning).toEqual({ ...DEFAULT_HANABI_TUNING, sparkAmount: 1.5, launches: false });
        expect(Object.keys(tuning).sort()).toEqual(Object.keys(DEFAULT_HANABI_TUNING).sort());
    });

    it('数值钳在范围里，不是数的退回默认值', () => {
        const high = normalizeHanabiTuning({
            sparkAmount: 9, ornamentAmount: 9, textMotion: 9, blockOpacity: 9, riseSpeed: 9, ambient: 9, glow: 9, sky: 9, collage: 9,
        });
        expect(high).toMatchObject({
            sparkAmount: 2, ornamentAmount: 2, textMotion: 2, blockOpacity: 1, riseSpeed: 2, ambient: 2, glow: 2, sky: 1, collage: 2,
        });
        const low = normalizeHanabiTuning({
            sparkAmount: -1, ornamentAmount: -1, textMotion: -1, blockOpacity: -1, riseSpeed: -1, ambient: -1, glow: -1, sky: -1, collage: -1,
        });
        expect(low).toMatchObject({
            sparkAmount: 0, ornamentAmount: 0, textMotion: 0, blockOpacity: 0, riseSpeed: 0, ambient: 0, glow: 0, sky: 0, collage: 0,
        });
        const wrong = normalizeHanabiTuning({ sparkAmount: '1.5', sky: null, glow: Number.NaN });
        expect(wrong).toMatchObject({ sparkAmount: DEFAULT_HANABI_TUNING.sparkAmount, sky: DEFAULT_HANABI_TUNING.sky, glow: DEFAULT_HANABI_TUNING.glow });
    });

    it('配色只认 theme / vivid / mixed', () => {
        for (const colorMode of ['theme', 'vivid', 'mixed'] as const) expect(normalizeHanabiTuning({ colorMode }).colorMode).toBe(colorMode);
        for (const colorMode of ['neon', '', 3, null]) expect(normalizeHanabiTuning({ colorMode }).colorMode).toBe(DEFAULT_HANABI_TUNING.colorMode);
    });

    it('开关：launches / overlayFrame 只有 false 才关，textOnly 只有 true 才开', () => {
        expect(normalizeHanabiTuning({ launches: 0, overlayFrame: 'no', textOnly: 'yes' })).toMatchObject({ launches: true, overlayFrame: true, textOnly: false });
        expect(normalizeHanabiTuning({ launches: false, overlayFrame: false, textOnly: true })).toMatchObject({ launches: false, overlayFrame: false, textOnly: true });
    });

    it('分辨率与抗锯齿（#929）：旧存档没有 render 就全跟随全局；合法值原样读回，非法值逐项回退', () => {
        const { render: _omitted, ...legacy } = { ...DEFAULT_HANABI_TUNING, sparkAmount: 1.5 };
        expect(normalizeHanabiTuning(legacy).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(normalizeHanabiTuning({ render: { scale: 1.5, antialias: 'on' } }).render).toEqual({ scale: 1.5, antialias: 'on' });
        expect(normalizeHanabiTuning({ render: { scale: 0.75, antialias: 'off' } }).render).toEqual({ scale: 0.75, antialias: 'off' });
        expect(normalizeHanabiTuning({ render: { scale: 4, antialias: 'auto' } }).render).toEqual({ scale: 'global', antialias: 'global' });
        expect(normalizeHanabiTuning({ render: { scale: 2, antialias: 1 } }).render).toEqual({ scale: 2, antialias: 'global' });
        expect(normalizeHanabiTuning({ render: null }).render).toEqual({ scale: 'global', antialias: 'global' });
    });

    it('归一化是幂等的', () => {
        const once = normalizeHanabiTuning({ sparkAmount: 9, colorMode: 'neon', sky: 0.3 });
        expect(normalizeHanabiTuning(once)).toEqual(once);
    });
});

describe('花火 tuning 改了要不要重建场景', () => {
    it('夜空与画框每帧现读，不重建；其余字段改了要重建', () => {
        const base = DEFAULT_HANABI_TUNING;
        expect(requiresHanabiSceneRebuild(base, { ...base })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, sky: 0.2 })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, overlayFrame: !base.overlayFrame })).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, sparkAmount: 1.7 })).toBe(true);
        expect(requiresHanabiSceneRebuild(base, { ...base, colorMode: 'theme' })).toBe(true);
    });

    it('render 不经场景重建：每次归一化都是新对象，夜空等现读字段改了也不能因它重建', () => {
        const base = normalizeHanabiTuning({});
        expect(requiresHanabiSceneRebuild(base, normalizeHanabiTuning({ ...base, sky: 0.3 }))).toBe(false);
        expect(requiresHanabiSceneRebuild(base, { ...base, render: { scale: 2, antialias: 'on' } })).toBe(false);
    });
});

describe('花火的画质档', () => {
    it('默认全分辨率；不认识的档退回默认，改了要重建场景', () => {
        expect(DEFAULT_HANABI_TUNING.renderQuality).toBe('full');
        expect(normalizeHanabiTuning({ renderQuality: 'ultra' }).renderQuality).toBe('full');
        expect(normalizeHanabiTuning({ renderQuality: 'low' }).renderQuality).toBe('low');
        expect(requiresHanabiSceneRebuild(DEFAULT_HANABI_TUNING, { ...DEFAULT_HANABI_TUNING, renderQuality: 'balanced' })).toBe(true);
    });

    it('全分辨率时烟花辉光跟渲染分辨率走，画面与没有画质档时一样', () => {
        expect(resolveHanabiGlowQuality(1920, 1080, 2, 'full')).toEqual({ resolution: null, levelDrop: 0 });
        expect(resolveHanabiGlowQuality(1280, 720, 1, 'full')).toEqual({ resolution: null, levelDrop: 0 });
    });

    it('降档时烟花辉光分辨率降下来，少降的级数让辉光宽度不变', () => {
        for (const [width, height, resolution] of [[1920, 1080, 2], [1280, 720, 1], [2560, 1440, 1.5]] as const) {
            const balanced = resolveHanabiGlowQuality(width, height, resolution, 'balanced');
            const low = resolveHanabiGlowQuality(width, height, resolution, 'low');
            expect(balanced.resolution).not.toBeNull();
            expect(balanced.resolution!).toBeLessThanOrEqual(resolution * HANABI_QUALITY_PROFILES.balanced.glowScale + 1e-9);
            expect(low.resolution!).toBeLessThanOrEqual(resolution * HANABI_QUALITY_PROFILES.low.glowScale + 1e-9);
            expect(low.resolution!).toBeLessThanOrEqual(balanced.resolution!);
            // 少降的级数 = 分辨率降的倍数取 log2 就近：省电降到一半，正好少一级。
            expect(low.levelDrop).toBe(Math.round(Math.log2(resolution / low.resolution!)));
            expect(low.levelDrop).toBeGreaterThanOrEqual(1);
        }
        expect(HANABI_QUALITY_PROFILES.low.ambientScale).toBeLessThan(1);
        expect(HANABI_QUALITY_PROFILES.full.ambientScale).toBe(1);
    });
});
