import { describe, expect, it } from 'vitest';
import { extractRepresentativeColorsFromPixels } from '../../../src/utils/colorPalette';

// test/unit/utils/colorPalette.test.ts

const pixels = (...colors: Array<[number, number, number, number?]>) => new Uint8ClampedArray(
    colors.flatMap(([r, g, b, a = 255]) => [r, g, b, a]),
);

describe('extractRepresentativeColorsFromPixels', () => {
    it('orders cover colors by represented pixel population instead of saturation', () => {
        const image = pixels(
            ...Array.from({ length: 12 }, () => [70, 72, 74] as [number, number, number]),
            ...Array.from({ length: 5 }, () => [180, 175, 168] as [number, number, number]),
            [255, 0, 180],
        );

        expect(extractRepresentativeColorsFromPixels(image, 3)).toEqual([
            '#46484a',
            '#b4afa8',
            '#ff00b4',
        ]);
    });

    it('keeps dark and low-saturation colors when they are representative', () => {
        const image = pixels(
            ...Array.from({ length: 8 }, () => [12, 16, 20] as [number, number, number]),
            ...Array.from({ length: 4 }, () => [98, 104, 110] as [number, number, number]),
        );

        expect(extractRepresentativeColorsFromPixels(image, 2)).toEqual(['#0c1014', '#62686e']);
    });

    it('ignores mostly transparent pixels and handles an empty palette', () => {
        const image = pixels([255, 0, 0, 10], [20, 40, 60], [0, 255, 0, 127]);

        expect(extractRepresentativeColorsFromPixels(image, 4)).toEqual(['#14283c']);
        expect(extractRepresentativeColorsFromPixels(image, 0)).toEqual([]);
        expect(extractRepresentativeColorsFromPixels(new Uint8ClampedArray(), 4)).toEqual([]);
    });
});
