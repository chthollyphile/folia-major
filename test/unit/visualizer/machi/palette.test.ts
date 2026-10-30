import { describe, expect, it } from 'vitest';
import { flattenMachiPalette } from '@/components/visualizer/machi/engine/materials';
import { resolveMachiPalette, MACHI_BOARD_MIN_CONTRAST } from '@/components/visualizer/machi/engine/palette';
import { KONBINI_SCENE } from '@/components/visualizer/machi/scenes/konbini/konbiniScene';
import { DAYLIGHT_THEME, DEFAULT_THEME } from '@/services/baseThemes';
import { getContrastRatio, hexToHsl } from '@/utils/themeColorMath';
import type { Theme } from '@/types';

// test/unit/visualizer/machi/palette.test.ts
// 町景调色板：主题色只在限定范围里推场景（品牌三色、屏幕字、天空色相），偏灰主题回退经典配色，亮色主题换白底屏幕；
// 场景自己的颜色（便利店的墙、自行车……）放进 art，摊平后与共用的颜色一起插值。

const COLORFUL: Theme = {
    ...DEFAULT_THEME,
    backgroundColor: '#1a0f2e',
    accentColor: '#ff6b9a',
    primaryColor: '#f4f4f5',
    secondaryColor: '#7ad1ff',
    wordColors: [{ word: 'tide', color: '#5ad1ff' }],
};

describe('resolveMachiPalette', () => {
    it('is deterministic for the same theme and seed', () => {
        expect(resolveMachiPalette(COLORFUL, 'song-a')).toEqual(resolveMachiPalette(COLORFUL, 'song-a'));
    });

    it('keeps the lit board text readable on every kind of theme', () => {
        [DEFAULT_THEME, DAYLIGHT_THEME, COLORFUL].forEach(theme => {
            const palette = resolveMachiPalette(theme, 'seed');
            expect(getContrastRatio(palette.boardLit, palette.boardBase)).toBeGreaterThanOrEqual(MACHI_BOARD_MIN_CONTRAST - 0.01);
        });
    });

    it('uses the theme accent for the first brand stripe and a different hue for the third', () => {
        const palette = resolveMachiPalette(COLORFUL, 'seed');
        const first = hexToHsl(palette.brand[0])!;
        const third = hexToHsl(palette.brand[2])!;
        expect(Math.abs(first.h - hexToHsl('#ff6b9a')!.h)).toBeLessThan(2);
        expect(first.s).toBeGreaterThanOrEqual(0.58);
        const distance = Math.min(Math.abs(first.h - third.h), 360 - Math.abs(first.h - third.h));
        expect(distance).toBeGreaterThanOrEqual(40);
    });

    it('falls back to a seeded classic chain colourway when the theme is grey', () => {
        const grey = resolveMachiPalette(DEFAULT_THEME, 'grey-song');
        expect(hexToHsl(grey.brand[0])!.s).toBeGreaterThan(0.4);
        const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(seed => resolveMachiPalette(DEFAULT_THEME, seed).brand[0]));
        expect(seen.size).toBeGreaterThan(1);
    });

    it('turns the board into a white lightbox on light themes and keeps the night sky dark', () => {
        const light = resolveMachiPalette(DAYLIGHT_THEME, 'seed');
        const dark = resolveMachiPalette(DEFAULT_THEME, 'seed');
        expect(light.boardIsLight).toBe(true);
        expect(dark.boardIsLight).toBe(false);
        expect(hexToHsl(light.boardBase)!.l).toBeGreaterThan(0.85);
        [light, dark].forEach(palette => {
            expect(hexToHsl(palette.skyTop)!.l).toBeLessThan(0.2);
            expect(hexToHsl(palette.skyBottom)!.l).toBeLessThan(0.25);
        });
    });

    it('only nudges the sky hue towards a coloured background', () => {
        const tinted = resolveMachiPalette({ ...COLORFUL, backgroundColor: '#3a0a12' }, 'seed');
        const plain = resolveMachiPalette({ ...COLORFUL, backgroundColor: '#101010' }, 'seed');
        expect(tinted.skyBottom).not.toBe(plain.skyBottom);
        expect(Math.abs(hexToHsl(tinted.skyBottom)!.l - hexToHsl(plain.skyBottom)!.l)).toBeLessThan(0.02);
    });

    it('keeps the interior light warm and bright whatever the accent', () => {
        const palette = resolveMachiPalette({ ...COLORFUL, accentColor: '#2050ff' }, 'seed');
        const interior = hexToHsl(palette.interiorLight)!;
        expect(interior.l).toBeGreaterThanOrEqual(0.72);
    });
});

describe('scene art', () => {
    it('adds the scene colours and flattens them with the shared ones', () => {
        const plain = resolveMachiPalette(COLORFUL, 'seed');
        expect(plain.art).toEqual({});
        const konbini = resolveMachiPalette(COLORFUL, 'seed', KONBINI_SCENE.resolveArt);
        expect(konbini.art.wall).toMatch(/^#[0-9a-f]{6}$/);
        expect(konbini.art.bike).toBe(resolveMachiPalette(COLORFUL, 'seed', KONBINI_SCENE.resolveArt).art.bike);
        const flat = flattenMachiPalette(konbini);
        expect(flat.wall).toBe(konbini.art.wall);
        expect(flat.brand0).toBe(konbini.brand[0]);
        expect(flat.product7).toBe(konbini.products[7]);
        expect(flat.asphalt).toBe(konbini.asphalt);
    });
});
