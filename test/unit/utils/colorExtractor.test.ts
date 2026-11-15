import { describe, expect, it } from 'vitest';
import { extractThemeColorsFromPixels } from '../../../src/utils/colorExtractor';
import { hexToOklch, getHueDistance } from '../../../src/utils/themeColorMath';

// test/unit/utils/colorExtractor.test.ts

type Pixel = [number, number, number, number?];

const image = (...regions: Array<[Pixel, number]>) => new Uint8ClampedArray(
    regions.flatMap(([[r, g, b, a = 255], count]) => Array.from({ length: count }, () => [r, g, b, a]).flat()),
);

const oklchHue = (color: string) => hexToOklch(color)!.h;

describe('extractThemeColorsFromPixels', () => {
    it('leads with a large calm colour, not a tiny saturated sticker', () => {
        const colors = extractThemeColorsFromPixels(image(
            [[62, 92, 140], 1700], // muted blue sky, most of the cover
            [[236, 232, 224], 780], // paper-white border
            [[255, 0, 40], 20], // a small red logo
        ), 5);

        expect(getHueDistance(oklchHue(colors[0]), oklchHue('#3e5c8c'))).toBeLessThan(10);
        expect(colors.indexOf(colors.find(color => getHueDistance(oklchHue(color), oklchHue('#ff0028')) < 10) ?? '')).not.toBe(0);
    });

    it('returns the cover\'s second colour as a separate pick instead of shades of the first', () => {
        const colors = extractThemeColorsFromPixels(image(
            [[24, 120, 128], 1300],
            [[30, 132, 140], 200],
            [[226, 120, 52], 1000],
        ), 5);

        const hues = colors.slice(0, 2).map(oklchHue);
        expect(getHueDistance(hues[0], hues[1])).toBeGreaterThan(90);
    });

    it('still yields the greys of an all-grey cover', () => {
        const colors = extractThemeColorsFromPixels(image(
            [[40, 40, 42], 1800],
            [[180, 180, 178], 700],
        ), 5);

        expect(colors).toHaveLength(2);
        expect(colors.every(color => hexToOklch(color)!.C < 0.02)).toBe(true);
    });

    it('ignores transparent pixels and handles empty input', () => {
        expect(extractThemeColorsFromPixels(image([[255, 0, 0, 10], 50], [[20, 40, 60], 10]), 3)).toHaveLength(1);
        expect(extractThemeColorsFromPixels(new Uint8ClampedArray(), 3)).toEqual([]);
        expect(extractThemeColorsFromPixels(image([[20, 40, 60], 10]), 0)).toEqual([]);
    });
});
