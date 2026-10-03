import { describe, expect, it } from 'vitest';
import { DEFAULT_TIDE_BACKGROUND_TUNING, type Theme, type TideBackgroundTuning } from '@/types';
import { resolveStoredTideBackgroundTuning, resolveTideColorMode } from '@/stores/visualizerSettingsPersistence';
import { resolveTideStageColors } from '@/components/visualizer/backgrounds/tide/tidePalette';
import { compressConfig, decompressConfig } from '@/utils/appearanceCodec';

// test/unit/visualizer/tideSettings.test.ts
// The tide panel exposes a lot of knobs now, and every one of them is stored, imported and exported.
// These tests pin the three places where a bad value could reach the shader: the persistence clamps,
// the custom colour palette and the appearance codec round trip.

const NIGHT_THEME = {
    name: 'Night',
    backgroundColor: '#05060d',
    primaryColor: '#ffd166',
    accentColor: '#ff7ab6',
    secondaryColor: '#8b8b9a',
    fontStyle: 'sans',
    animationIntensity: 'normal',
    wordColors: [],
    lyricsIcons: [],
    description: '',
} as unknown as Theme;

const customColors = {
    colorMode: 'custom' as const,
    waterColor: '#123456',
    glintColor: '#00ff00',
    backgroundColor: '#000010',
};

describe('tide tuning persistence', () => {
    it('clamps every numeric field into the range the panel offers', () => {
        const resolved = resolveStoredTideBackgroundTuning({
            intensity: 9,
            flow: -2,
            dissipation: 4,
            spread: 99,
            sampleSeconds: -1,
            maxAnchors: 4.6,
            smoothing: 5,
            waveScale: 100,
            waveSpeed: -3,
            chop: 9,
            glintStrength: 9,
            fog: -1,
            perspective: 3,
        });

        expect(resolved.intensity).toBe(3);
        expect(resolved.flow).toBe(0);
        expect(resolved.dissipation).toBe(1);
        expect(resolved.spread).toBe(3);
        expect(resolved.sampleSeconds).toBe(0.06);
        expect(resolved.maxAnchors).toBe(5);
        expect(resolved.smoothing).toBe(0.92);
        expect(resolved.waveScale).toBe(2.5);
        expect(resolved.waveSpeed).toBe(0);
        expect(resolved.chop).toBe(1.5);
        expect(resolved.glintStrength).toBe(2.5);
        expect(resolved.fog).toBe(0);
        expect(resolved.perspective).toBe(1);
    });

    it('falls back to the defaults for junk values', () => {
        const resolved = resolveStoredTideBackgroundTuning({
            intensity: Number.NaN,
            sampleSeconds: Number.NaN,
            smoothing: Number.NaN,
        });

        expect(resolved.intensity).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.intensity);
        expect(resolved.sampleSeconds).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.sampleSeconds);
        expect(resolved.smoothing).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.smoothing);
        expect(resolveStoredTideBackgroundTuning({})).toEqual(DEFAULT_TIDE_BACKGROUND_TUNING);
    });

    it('keeps the colour mode and normalizes the hex strings', () => {
        const resolved = resolveStoredTideBackgroundTuning({
            colorMode: 'custom',
            waterColor: '#AABBCC',
            glintColor: 'not-a-colour',
            backgroundColor: '#abc',
        });

        expect(resolved.colorMode).toBe('custom');
        expect(resolved.waterColor).toBe('#aabbcc');
        expect(resolved.glintColor).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.glintColor);
        expect(resolved.backgroundColor).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.backgroundColor);
        expect(resolveTideColorMode('nonsense' as never)).toBe('theme');
    });
});

describe('tide colour settings', () => {
    it('uses the custom hex colours when the custom source is selected', () => {
        const colors = resolveTideStageColors(NIGHT_THEME, false, customColors);
        expect(colors.surface[0]).toBeCloseTo(0x12 / 255, 6);
        expect(colors.surface[2]).toBeCloseTo(0x56 / 255, 6);
        expect(colors.glint).toEqual([0, 1, 0]);
        expect(colors.background[2]).toBeCloseTo(0x10 / 255, 6);
        // 光晕是水色和浪尖色按 0.35 混合出来的，所以红蓝被拉低、绿色被拉高。
        expect(colors.glow[0]).toBeCloseTo(colors.surface[0] * 0.65, 6);
        expect(colors.glow[1]).toBeCloseTo(colors.surface[1] * 0.65 + 0.35, 6);
        expect(colors.glow[2]).toBeCloseTo(colors.surface[2] * 0.65, 6);
    });

    it('leaves the theme palette untouched when the theme source is selected', () => {
        const themed = resolveTideStageColors(NIGHT_THEME, false);
        expect(resolveTideStageColors(NIGHT_THEME, false, { ...customColors, colorMode: 'theme' })).toEqual(themed);
    });
});

describe('tide appearance codec', () => {
    it('round trips every tuning field through export and import', () => {
        const tuning: TideBackgroundTuning = {
            ...DEFAULT_TIDE_BACKGROUND_TUNING,
            sampleSeconds: 0.3,
            maxAnchors: 2,
            smoothing: 0.8,
            waveScale: 1.7,
            waveSpeed: 0.4,
            chop: 0.9,
            glintStrength: 1.4,
            fog: 0.2,
            perspective: 0.9,
            colorMode: 'custom',
            waterColor: '#112233',
            glintColor: '#445566',
            backgroundColor: '#778899',
        };

        const restored = decompressConfig(compressConfig({ tideBackgroundTuning: tuning })).tideBackgroundTuning;
        expect(restored).toMatchObject({
            sampleSeconds: 0.3,
            maxAnchors: 2,
            smoothing: 0.8,
            waveScale: 1.7,
            waveSpeed: 0.4,
            chop: 0.9,
            glintStrength: 1.4,
            fog: 0.2,
            perspective: 0.9,
            colorMode: 'custom',
            waterColor: '#112233',
            glintColor: '#445566',
            backgroundColor: '#778899',
        });
    });

    it('fills the defaults for an export written before these knobs existed', () => {
        // 老版本导出的短码里只有最初的六个字段。
        const minified = { tbt: { tbi: 0.9, tbf: 0.5, tbd: 0.45, tbs: 1.1, tfl: true, tar: false } };
        const shortcode = `folia-theme://${Buffer.from(JSON.stringify(minified), 'utf8').toString('base64')}`;
        const restored = decompressConfig(shortcode).tideBackgroundTuning;

        expect(restored.sampleSeconds).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.sampleSeconds);
        expect(restored.smoothing).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.smoothing);
        expect(restored.colorMode).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.colorMode);
        expect(restored.waterColor).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.waterColor);
    });
});

describe('tide camera follow', () => {
    it('clamps the camera strength and keeps the switch a boolean', () => {
        expect(resolveStoredTideBackgroundTuning({ cameraStrength: 9 }).cameraStrength).toBe(1);
        expect(resolveStoredTideBackgroundTuning({ cameraStrength: -3 }).cameraStrength).toBe(0);
        expect(resolveStoredTideBackgroundTuning({ cameraFollow: false }).cameraFollow).toBe(false);
        expect(resolveStoredTideBackgroundTuning({}).cameraFollow).toBe(DEFAULT_TIDE_BACKGROUND_TUNING.cameraFollow);
    });

    it('round trips the camera fields through the export codec', () => {
        const tuning: TideBackgroundTuning = {
            ...DEFAULT_TIDE_BACKGROUND_TUNING,
            cameraFollow: false,
            cameraStrength: 0.8,
        };
        const restored = decompressConfig(compressConfig({ tideBackgroundTuning: tuning })).tideBackgroundTuning;

        expect(restored?.cameraFollow).toBe(false);
        expect(restored?.cameraStrength).toBe(0.8);
    });
});
