import { describe, expect, it } from 'vitest';
import { normalizeMachiTuning, resolveMachiQualityPreset, resolveMachiSceneId } from '@/components/visualizer/machi/machiTuning';
import { DEFAULT_MACHI_QUALITY, DEFAULT_MACHI_TUNING, DEFAULT_MACHI_VIEW, DEFAULT_MACHI_VIEWS, MACHI_QUALITY_PRESET_IDS, MACHI_QUALITY_PRESETS, MACHI_SCENE_IDS } from '@/components/visualizer/machi/types';

// test/unit/visualizer/machi/machiTuning.test.ts
// 町景的设置：存下来的值认不得就回默认、数值夹进范围；自定义视角每个场景一份（以前共用的一份拿来给每个场景）；
// 画质每项认不得的回默认，预设由细项推出来；
// “自动”场景按 seed 选，同一首歌总是同一个。

describe('normalizeMachiTuning', () => {
    it('fills missing fields and drops unknown values', () => {
        expect(normalizeMachiTuning(undefined)).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ weather: 'snow' })).toEqual({ ...DEFAULT_MACHI_TUNING, weather: 'snow' });
        expect(normalizeMachiTuning({ scene: 'beach', timeOfDay: 7, weather: 'hail' })).toEqual(DEFAULT_MACHI_TUNING);
        expect(normalizeMachiTuning({ scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' })).toEqual({ ...DEFAULT_MACHI_TUNING, scene: 'konbini', timeOfDay: 'dusk', weather: 'fog' });
    });

    it('keeps a custom view for each scene inside the camera limits', () => {
        const tuning = normalizeMachiTuning({ camera: 'custom', views: { station: { azimuth: 120, elevation: -40, zoom: 9, panX: 2.5, panZ: 'far' }, kowloon: 'wide', beach: {} } });
        expect(tuning.camera).toBe('custom');
        expect(tuning.views).toEqual({
            konbini: DEFAULT_MACHI_VIEW,
            station: { azimuth: 75, elevation: -12, zoom: 2.8, panX: 2.5, panZ: 0 },
            kowloon: DEFAULT_MACHI_VIEW,
        });
        expect(normalizeMachiTuning({ camera: 'orbit', views: null })).toMatchObject({ camera: 'default', views: DEFAULT_MACHI_VIEWS });
    });

    it('gives the old shared view to every scene', () => {
        const view = { azimuth: -20, elevation: 6, zoom: 1.6, panX: 1.5, panZ: -0.5 };
        const tuning = normalizeMachiTuning({ camera: 'custom', view });
        expect(tuning.views).toEqual({ konbini: view, station: view, kowloon: view });
        expect(tuning).not.toHaveProperty('view');
        // 已经有各场景的视角时不再看旧的那份。
        expect(normalizeMachiTuning({ view, views: { konbini: view } }).views).toEqual({ konbini: view, station: DEFAULT_MACHI_VIEW, kowloon: DEFAULT_MACHI_VIEW });
    });

    it('keeps the camera drift switch and its speed inside the range', () => {
        expect(normalizeMachiTuning({ motion: true }).motion).toBe(true);
        expect(normalizeMachiTuning({ motion: 'yes' }).motion).toBe(false);
        expect(normalizeMachiTuning({ motionSpeed: 2 }).motionSpeed).toBe(2);
        expect(normalizeMachiTuning({ motionSpeed: 9 }).motionSpeed).toBe(3);
        expect(normalizeMachiTuning({ motionSpeed: 'fast' }).motionSpeed).toBe(1);
    });

    it('clamps the depth of field and falls back to centre focus', () => {
        const tuning = normalizeMachiTuning({ aperture: 0.5, dof: 5, dofRange: 0, tiltShift: -1, focus: 'eyes', focusOffset: -30 });
        expect(tuning).toMatchObject({ aperture: 1.4, dof: 2, dofRange: 0.3, tiltShift: 0, focus: 'center', focusOffset: -10 });
        expect(normalizeMachiTuning({ aperture: 2.8 }).aperture).toBe(2.8);
        expect(normalizeMachiTuning({ aperture: null }).aperture).toBe(8);
        expect(normalizeMachiTuning({ dof: 0, focus: 'lyrics' })).toMatchObject({ dof: 0, focus: 'lyrics' });
    });

    it('keeps known quality values field by field and fills the rest', () => {
        expect(normalizeMachiTuning({}).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: null }).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: { antialias: 'ssaa', glow: false } }).quality).toEqual({ ...DEFAULT_MACHI_QUALITY, antialias: 'ssaa', glow: false });
        expect(normalizeMachiTuning({ quality: { renderScale: 3, antialias: 'taa', shadows: 'ultra', reflections: 1, glow: 'yes', adaptive: 0 } }).quality).toEqual(DEFAULT_MACHI_QUALITY);
        expect(normalizeMachiTuning({ quality: { renderScale: 0.5, shadows: 'off', reflections: 'low', adaptive: false } }).quality)
            .toEqual({ ...DEFAULT_MACHI_QUALITY, renderScale: 0.5, shadows: 'off', reflections: 'low', adaptive: false });
    });
});

describe('resolveMachiQualityPreset', () => {
    it('names the preset a quality matches, whatever the auto-degrade switch says', () => {
        MACHI_QUALITY_PRESET_IDS.forEach(id => {
            expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS[id], adaptive: true })).toBe(id);
            expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS[id], adaptive: false })).toBe(id);
        });
        expect(resolveMachiQualityPreset(DEFAULT_MACHI_QUALITY)).toBe('high');
    });

    it('calls any other combination custom', () => {
        expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS.high, antialias: 'ssaa', adaptive: true })).toBe('custom');
        expect(resolveMachiQualityPreset({ ...MACHI_QUALITY_PRESETS.low, glow: true, adaptive: true })).toBe('custom');
    });
});

describe('resolveMachiSceneId', () => {
    it('uses the chosen scene', () => {
        expect(resolveMachiSceneId({ scene: 'konbini' }, 'any')).toBe('konbini');
    });

    it('picks a stable scene per song when automatic', () => {
        ['a', 'b', 'song-42', 7].forEach(seed => {
            const scene = resolveMachiSceneId({ scene: 'auto' }, seed);
            expect(MACHI_SCENE_IDS).toContain(scene);
            expect(resolveMachiSceneId({ scene: 'auto' }, seed)).toBe(scene);
        });
    });
});
