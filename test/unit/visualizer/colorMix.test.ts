import { describe, expect, it } from 'vitest';
import { desaturateColor, parseColorChannels } from '@/components/visualizer/colorMix';

// test/unit/visualizer/colorMix.test.ts
// desaturateColor lets material-simulating visualizers accept a saturated theme without the
// material itself turning into coloured plastic.

describe('desaturateColor', () => {
    it('leaves the color untouched at amount 0', () => {
        expect(parseColorChannels(desaturateColor('#ff0044', 0))).toEqual({ r: 255, g: 0, b: 68 });
    });

    it('collapses to the color own luma at amount 1', () => {
        const channels = parseColorChannels(desaturateColor('#ff0044', 1))!;
        expect(channels.r).toBe(channels.g);
        expect(channels.g).toBe(channels.b);
        const luma = 255 * 0.2126 + 0 * 0.7152 + 68 * 0.0722;
        expect(channels.r).toBe(Math.round(luma));
    });

    it('preserves luma at every amount', () => {
        const lumaOf = (color: string) => {
            const channels = parseColorChannels(color)!;
            return channels.r * 0.2126 + channels.g * 0.7152 + channels.b * 0.0722;
        };
        const source = '#3f8ad0';
        [0.25, 0.5, 0.75].forEach((amount) => {
            expect(lumaOf(desaturateColor(source, amount))).toBeCloseTo(lumaOf(source), 0);
        });
    });

    it('clamps the amount and survives an unparseable color', () => {
        expect(desaturateColor('#3f8ad0', -4)).toBe(desaturateColor('#3f8ad0', 0));
        expect(desaturateColor('#3f8ad0', 9)).toBe(desaturateColor('#3f8ad0', 1));
        expect(desaturateColor('not-a-color', 0.5)).toBe('not-a-color');
    });
});
