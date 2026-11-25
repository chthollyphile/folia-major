import { describe, expect, it } from 'vitest';
import {
    ASCII_ANGLE_BINS,
    ASCII_CELL_H,
    ASCII_CELL_W,
    ASCII_GLYPH_COUNT,
    ASCII_RAMP_COUNT,
    buildAsciiGlyphRows,
    getAsciiGlyphAtlas,
} from '../../../src/components/visualizer/backgrounds/nomand/ascii/asciiGlyphAtlas';
import { deriveAsciiImageMaps } from '../../../src/components/visualizer/backgrounds/nomand/ascii/asciiImageMaps';
import { resolveStoredNomandBackgroundTuning } from '../../../src/components/visualizer/backgrounds/nomand/tuning';
import { DEFAULT_NOMAND_BACKGROUND_TUNING } from '../../../src/types';

// test/unit/visualizer/nomandAscii.test.ts
// Covers the Nomand ASCII effect's pure parts: the glyph strip, the direction maps and the stored tuning.

const lit = (rows: string[]) => rows.join('').split('#').length - 1;

describe('Nomand ASCII glyph atlas', () => {
    it('has the ramp and 8 angles × 4 weights, inside the 4×6 box', () => {
        const glyphs = buildAsciiGlyphRows();
        expect(glyphs).toHaveLength(ASCII_GLYPH_COUNT);
        for (const rows of glyphs.slice(ASCII_RAMP_COUNT)) {
            expect(rows).toHaveLength(ASCII_CELL_H);
            // Row 0 is the bottom (rows are stored bottom-up): it and the last column stay blank.
            expect(rows[0]).toBe('.'.repeat(ASCII_CELL_W));
            for (const row of rows) expect(row[ASCII_CELL_W - 1]).toBe('.');
        }
    });

    it('lights every weight about the same at every angle', () => {
        const glyphs = buildAsciiGlyphRows().slice(ASCII_RAMP_COUNT);
        for (let weight = 0; weight < 4; weight++) {
            const counts = glyphs.slice(weight * ASCII_ANGLE_BINS, (weight + 1) * ASCII_ANGLE_BINS).map(lit);
            // Horizontal strokes cannot reach the heavy targets in a 4 px wide box; the colour solve evens those out.
            expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(6);
        }
    });

    it('packs the strip with a cover fraction per glyph', () => {
        const atlas = getAsciiGlyphAtlas();
        expect(atlas.width).toBe(ASCII_CELL_W * ASCII_GLYPH_COUNT);
        expect(atlas.data).toHaveLength(atlas.width * ASCII_CELL_H);
        expect(atlas.covers).toHaveLength(ASCII_GLYPH_COUNT);
        expect(atlas.covers[0]).toBe(0);
        expect(Math.max(...atlas.covers)).toBeLessThan(1);
    });
});

describe('Nomand ASCII image maps', () => {
    it('reads vertical stripes as texture running vertically', () => {
        const w = 64;
        const h = 64;
        const pixels = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const v = 128 + 120 * Math.sin(x * 0.8);
                pixels.set([v, v, v, 255], (y * w + x) * 4);
            }
        }
        const maps = deriveAsciiImageMaps(pixels, w, h);
        const i = (32 * w + 32) * 4;
        // Doubled angle of a vertical line is π: (-1, 0), stored as 0.5 + 0.5 * v.
        expect(maps.data[i + 2]).toBeLessThan(20);
        expect(Math.abs(maps.data[i + 3] - 127)).toBeLessThan(12);
        expect(Math.abs(Math.cos(maps.dominant))).toBeLessThan(0.2);
    });
});

describe('Nomand ASCII tuning', () => {
    it('keeps the ascii effect and its fields from storage', () => {
        const tuning = resolveStoredNomandBackgroundTuning({
            effect: 'ascii',
            asciiScale: 2.4,
            asciiMotion: 9,
            asciiOriginalColors: true,
            asciiInverted: true,
        });
        expect(tuning.effect).toBe('ascii');
        expect(tuning.asciiScale).toBe(2.5);
        expect(tuning.asciiMotion).toBe(1.5);
        expect(tuning.asciiOriginalColors).toBe(true);
        expect(tuning.asciiInverted).toBe(true);
    });

    it('falls back to the defaults for missing or broken values', () => {
        const tuning = resolveStoredNomandBackgroundTuning({ asciiScale: Number.NaN, asciiOriginalColors: 'yes' as unknown as boolean });
        expect(tuning.asciiScale).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.asciiScale);
        expect(tuning.asciiMotion).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.asciiMotion);
        expect(tuning.asciiOriginalColors).toBe(DEFAULT_NOMAND_BACKGROUND_TUNING.asciiOriginalColors);
    });
});
