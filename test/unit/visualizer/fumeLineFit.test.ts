import { beforeAll, describe, expect, it } from 'vitest';
import type { FumeLineMeasures } from '../../../src/components/visualizer/fume/fumeTextMeasure';

// test/unit/visualizer/fumeLineFit.test.ts
// fume picks each block's font size with a short binary search over font sizes, dozens of times per
// layout. It now measures a text at a size once per layout and answers most tries from the sizes
// measured before (a text that fits at a size fits at every smaller one). Lock that the answers are
// the ones measuring every try gives, also for a font like the CJK fonts with small-size bitmaps
// drawn bold: below 24 px narrower just past every other half pixel and at whole pixels.

/** Advance of one character at `size`: in proportion, with a bitmap font's jumps below 24 px. */
const advance = (char: string, size: number) => {
    const em = /[぀-ヿ一-鿿가-힯]/.test(char) ? 1 : char === ' ' ? 0.28 : 0.5 + (char.charCodeAt(0) % 7) * 0.04;
    const proportional = Math.round(em * size * 64) / 64;
    if (size >= 24) return proportional;
    const wholePixel = Math.abs(size - Math.round(size)) < 0.005;
    return proportional + (Math.round(size) % 2 === 1 ? 0.3 * em : 0) - (wholePixel ? 0.25 * em : 0);
};

class FakeContext {
    font = '10px sans-serif';
    measureText(text: string) {
        const size = Number(/([0-9.]+)px/.exec(this.font)?.[1] ?? 10);
        return { width: Array.from(text).reduce((sum, char) => sum + advance(char, size), 0) };
    }
}

let fume: typeof import('../../../src/components/visualizer/fume/fumeTextMeasure');
let pretext: typeof import('@chenglou/pretext');

beforeAll(async () => {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = class {
        getContext() {
            return new FakeContext();
        }
    };
    fume = await import('../../../src/components/visualizer/fume/fumeTextMeasure');
    pretext = await import('@chenglou/pretext');
});

const FONT_FAMILY = 'Test Sans';
const THEME = { fontWeight: undefined };
const TEXTS = [
    '清晨的站台没有人说话',
    'Paper boats in a puddle of light',
    '沿着海岸线一路向北 until the lighthouse blinks twice and the tide lets go of our names',
    'Oh',
    'Supercalifragilisticexpialidociouswithoutanyspaces',
    '数到三 就放手',
];

/** The search as it was: every try measured. */
const searchMeasuringEveryTry = (text: string, variant: 'body' | 'hero', width: number, lyricsFontScale: number, densityScale: number, heroScale: number) => {
    const sizeAt = (base: number) => base * lyricsFontScale * densityScale * (variant === 'hero' ? heroScale : 1);
    const linesAt = (fontPx: number) => {
        const prepared = pretext.prepareWithSegments(text, fume.buildFontSpec(fontPx, variant, FONT_FAMILY, THEME), { whiteSpace: 'pre-wrap' });
        return pretext.layoutWithLines(prepared, width, Math.round(fontPx * (variant === 'hero' ? 1.02 : 1.06))).lines.length;
    };
    let low = variant === 'hero' ? 18 : 10;
    let high = variant === 'hero' ? 58 : 30;
    let best: { fontPx: number; lineCount: number } | null = null;
    for (let iteration = 0; iteration < 8; iteration += 1) {
        const candidate = sizeAt((low + high) / 2);
        const lineCount = linesAt(candidate);
        if (lineCount <= 1) {
            best = { fontPx: candidate, lineCount };
            low = (low + high) / 2;
        } else {
            high = (low + high) / 2;
        }
    }
    if (best) return best;
    const fallback = sizeAt(variant === 'hero' ? 18 : 10);
    return { fontPx: fallback, lineCount: linesAt(fallback) };
};

describe('fume single-line font size', () => {
    it('answers every try as measuring it would, across widths and densities in one layout', () => {
        for (const lyricsFontScale of [1, 0.85, 1.3]) {
            // One layout: every text keeps what it measured for all the widths and densities that follow.
            const measures = new Map<string, FumeLineMeasures>();
            for (const width of [140, 236.5, 318, 487.25, 980, 2400]) {
                for (let step = 0; step < 8; step += 1) {
                    const densityScale = 0.82 + step * 0.075;
                    for (const text of TEXTS) {
                        for (const variant of ['body', 'hero'] as const) {
                            const memo = fume.lineMeasuresFor(measures, text, variant, FONT_FAMILY, THEME);
                            const got = fume.chooseSingleLineFontPx(memo, width, lyricsFontScale, densityScale, 1.12);
                            expect(got).toEqual(searchMeasuringEveryTry(text, variant, width, lyricsFontScale, densityScale, 1.12));
                        }
                    }
                }
            }
        }
    });

    it('answers random layouts as measuring would, sizes near a half or whole pixel included', () => {
        // The grid above lands near a pixel edge only by chance; random widths and scales land there often.
        let seed = 12345;
        const random = () => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed / 2147483648;
        };
        for (let layout = 0; layout < 12; layout += 1) {
            const measures = new Map<string, FumeLineMeasures>();
            const lyricsFontScale = 0.6 + random();
            const heroScale = 0.8 + random() * 0.8;
            for (let attempt = 0; attempt < 250; attempt += 1) {
                const width = random() < 0.5 ? Math.round(120 + random() * 1500) : 120 + random() * 1500;
                const densityScale = 0.82 + Math.floor(random() * 8) * 0.075;
                const text = TEXTS[Math.floor(random() * TEXTS.length)];
                const variant = random() < 0.3 ? 'hero' : 'body';
                const got = fume.chooseSingleLineFontPx(fume.lineMeasuresFor(measures, text, variant, FONT_FAMILY, THEME), width, lyricsFontScale, densityScale, heroScale);
                expect(got).toEqual(searchMeasuringEveryTry(text, variant, width, lyricsFontScale, densityScale, heroScale));
            }
        }
    });

    it('measures a text at far fewer sizes than it tries', () => {
        const measures = new Map<string, FumeLineMeasures>();
        let tries = 0;
        for (const width of [600, 750, 900]) {
            for (let step = 0; step < 8; step += 1) {
                fume.chooseSingleLineFontPx(fume.lineMeasuresFor(measures, TEXTS[1], 'body', FONT_FAMILY, THEME), width, 1, 0.82 + step * 0.075, 1);
                tries += 8;
            }
        }
        const measured = measures.get(`body:${TEXTS[1]}`)!.preparedByFontPx.size;
        expect(measured).toBeLessThan(tries / 4);
    });
});
