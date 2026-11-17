import { describe, expect, it } from 'vitest';
import {
    adjustLightnessForContrast,
    adjustOklchLightnessForContrast,
    getContrastRatio,
    getHueDistance,
    hexToHsl,
    hexToOklch,
    hslToHex,
    mixHexColors,
    oklchToHex,
} from '@/utils/themeColorMath';
import { fitOklchToSrgb, oklabToSrgb, srgbToOklab } from '@/utils/oklab';

// test/unit/utils/themeColorMath.test.ts

describe('oklab', () => {
    it('round-trips sRGB through OKLab within rounding', () => {
        for (const [r, g, b] of [[0, 0, 0], [255, 255, 255], [249, 115, 22], [34, 197, 94], [79, 124, 255], [128, 128, 128]]) {
            const back = oklabToSrgb(srgbToOklab({ r, g, b }));
            expect(Math.abs(back.r - r)).toBeLessThan(0.5);
            expect(Math.abs(back.g - g)).toBeLessThan(0.5);
            expect(Math.abs(back.b - b)).toBeLessThan(0.5);
        }
        // White is L 1 with no chroma; black is L 0.
        expect(srgbToOklab({ r: 255, g: 255, b: 255 }).L).toBeCloseTo(1, 3);
        expect(Math.hypot(srgbToOklab({ r: 255, g: 255, b: 255 }).a, srgbToOklab({ r: 255, g: 255, b: 255 }).b)).toBeLessThan(1e-3);
    });

    it('fits an out-of-gamut colour by lowering chroma only', () => {
        const fitted = fitOklchToSrgb({ L: 0.55, C: 0.4, h: 110 });
        expect(fitted.L).toBe(0.55);
        expect(fitted.h).toBe(110);
        expect(fitted.C).toBeLessThan(0.4);
        expect(fitted.C).toBeGreaterThan(0.05);

        // The hex it lands on keeps the hue it was asked for.
        const hue = hexToOklch(oklchToHex({ L: 0.55, C: 0.4, h: 110 }))!.h;
        expect(getHueDistance(hue, 110)).toBeLessThan(3);
    });

    it('solves OKLCH lightness past a contrast floor while keeping the hue', () => {
        for (const background of ['#f2f1ed', '#232014']) {
            for (const h of [30, 100, 150, 250]) {
                const color = adjustOklchLightnessForContrast({ L: background === '#f2f1ed' ? 0.8 : 0.3, C: 0.1, h }, background, 3.2);
                expect(getContrastRatio(color, background)).toBeGreaterThanOrEqual(3.2);
                expect(getHueDistance(hexToOklch(color)!.h, h)).toBeLessThan(6);
            }
        }
    });
});

describe('themeColorMath', () => {
    it('round-trips hex through HSL', () => {
        for (const color of ['#f97316', '#22c55e', '#4f7cff', '#09090b', '#f4f4f5']) {
            const hsl = hexToHsl(color);
            expect(hsl).not.toBeNull();
            expect(hslToHex(hsl!)).toBe(color);
        }
    });

    it('parses rgb() input and normalizes short hex', () => {
        expect(hexToHsl('rgb(255, 0, 0)')!.h).toBeCloseTo(0, 5);
        expect(hslToHex(hexToHsl('#f00')!)).toBe('#ff0000');
        expect(hexToHsl('not-a-color')).toBeNull();
    });

    it('mixes colors in hex space', () => {
        expect(mixHexColors('#000000', '#ffffff', 0.5)).toBe('#808080');
        expect(mixHexColors('#000000', '#ffffff', 0)).toBe('#000000');
        expect(mixHexColors('#000000', '#ffffff', 1)).toBe('#ffffff');
    });

    it('measures hue distance on the shorter arc', () => {
        expect(getHueDistance(350, 10)).toBe(20);
        expect(getHueDistance(10, 350)).toBe(20);
        expect(getHueDistance(0, 180)).toBe(180);
    });

    it('lifts a low-contrast color over the floor on a dark background', () => {
        const background = '#101418';
        const adjusted = adjustLightnessForContrast('#1b2733', background, 4.5);

        expect(getContrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5);
        // The hue survives the lightness walk.
        expect(getHueDistance(hexToHsl(adjusted)!.h, hexToHsl('#1b2733')!.h)).toBeLessThan(6);
    });

    it('darkens a low-contrast color on a light background', () => {
        const background = '#f5f1ea';
        const adjusted = adjustLightnessForContrast('#e8d9bf', background, 4.5);

        expect(getContrastRatio(adjusted, background)).toBeGreaterThanOrEqual(4.5);
        expect(hexToHsl(adjusted)!.l).toBeLessThan(hexToHsl('#e8d9bf')!.l);
    });

    it('returns the best candidate when the floor is unreachable', () => {
        const adjusted = adjustLightnessForContrast('#ffffff', '#ffffff', 21);

        expect(getContrastRatio(adjusted, '#ffffff')).toBeGreaterThan(1);
    });
});
