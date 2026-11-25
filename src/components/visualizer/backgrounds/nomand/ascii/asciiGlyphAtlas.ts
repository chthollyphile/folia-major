// src/components/visualizer/backgrounds/nomand/ascii/asciiGlyphAtlas.ts
// The glyphs of the Nomand ASCII effect, after living-ascii (MIT, Copyright (c) 2026 Yusen,
// https://github.com/yusen-dev/living-ascii): a 5×7 bitmap ramp for cells without a clear
// direction, and stroke glyphs in 8 angles × 4 weights for cells with one. Each weight lights
// about the same number of pixels at every angle, so a horizontal cell does not read darker
// than a diagonal one. The strokes stay inside a 4×6 box (the last column and the top row stay
// blank, as letter spacing), so neighbouring glyphs never join into long lines.

export const ASCII_CELL_W = 5;
export const ASCII_CELL_H = 7;
/** Stroke angles over half a turn. */
export const ASCII_ANGLE_BINS = 8;

/** Darkest → brightest. */
const RAMP = ' .:-+=o*#@';

/** Hand-drawn so they stay crisp at this size, where a browser font would blur. Rows are top-down. */
const RAMP_GLYPHS: Record<string, string[]> = {
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
    '.': ['.....', '.....', '.....', '.....', '.....', '..#..', '.....'],
    ':': ['.....', '.....', '..#..', '.....', '.....', '..#..', '.....'],
    '-': ['.....', '.....', '.....', '.###.', '.....', '.....', '.....'],
    '+': ['.....', '.....', '..#..', '.###.', '..#..', '.....', '.....'],
    '=': ['.....', '.....', '.###.', '.....', '.###.', '.....', '.....'],
    'o': ['.....', '.....', '..##.', '.#..#', '.#..#', '..##.', '.....'],
    '*': ['.....', '..#..', '#.#.#', '.###.', '#.#.#', '..#..', '.....'],
    '#': ['.....', '.#.#.', '#####', '.#.#.', '#####', '.#.#.', '.....'],
    '@': ['..##.', '.#..#', '.#.##', '.#.##', '.#...', '..###', '.....'],
};

/** [half length, lit pixels out of the 4×6 box], light → heavy. */
const STROKE_WEIGHTS: ReadonlyArray<readonly [number, number]> = [[1.6, 3], [3.6, 6], [3.6, 10], [3.6, 14]];

export const ASCII_RAMP_COUNT = RAMP.length;
export const ASCII_GLYPH_COUNT = RAMP.length + ASCII_ANGLE_BINS * STROKE_WEIGHTS.length;

export interface AsciiGlyphAtlas {
    /** One strip of glyphs, ASCII_CELL_W wide each, rows bottom-up; 255 where lit. */
    data: Uint8Array;
    width: number;
    height: number;
    /** Fraction of the cell each glyph lights, for the colour solve. */
    covers: Float32Array;
}

const litCount = (rows: string[]) => rows.join('').split('#').length - 1;

/** A stroke through the box at `theta` (y up), rasterised with 4×4 supersampling; rows bottom-up. */
const strokeGlyph = (theta: number, halfLen: number, halfThick: number) => {
    const rows: string[] = [];
    const dx = Math.cos(theta);
    const dy = Math.sin(theta);
    // Centred on a pixel (col 1, row 3), so a one-pixel line stays one pixel wide.
    const cx = 1.5;
    const cy = 3.5;
    for (let y = 0; y < ASCII_CELL_H; y++) {
        let row = '';
        for (let x = 0; x < ASCII_CELL_W; x++) {
            let hit = 0;
            if (x !== ASCII_CELL_W - 1 && y !== 0) {
                for (let sy = 0; sy < 4; sy++) {
                    for (let sx = 0; sx < 4; sx++) {
                        const px = x + (sx + 0.5) / 4 - cx;
                        const py = y + (sy + 0.5) / 4 - cy;
                        const along = px * dx + py * dy;
                        const across = Math.abs(-px * dy + py * dx);
                        if (across <= halfThick && Math.abs(along) <= halfLen) hit++;
                    }
                }
            }
            row += hit >= 5 ? '#' : '.';
        }
        rows.push(row);
    }
    return rows;
};

/**
 * Searches length and thickness for the stroke that lights closest to `target` pixels while still
 * reading as a line (never thicker than half its length). Angles that cannot reach the target
 * (horizontal: the box is 4 px wide) are evened out by the per-cell colour solve.
 */
const fitStroke = (theta: number, halfLen: number, target: number) => {
    let best: string[] = [];
    let bestCost = Infinity;
    for (let hl = 0.8; hl <= 4.6; hl += 0.1) {
        for (let ht = 0.2; ht <= hl * 0.5; ht += 0.05) {
            const glyph = strokeGlyph(theta, hl, ht);
            const cost = Math.abs(litCount(glyph) - target) * 10 + Math.abs(hl - halfLen) + ht * 0.1;
            if (cost < bestCost) {
                best = glyph;
                bestCost = cost;
            }
        }
    }
    return best;
};

/** Rows of every glyph, bottom-up: the ramp first, then the strokes weight by weight, bin by bin. */
export const buildAsciiGlyphRows = (): string[][] => {
    const glyphs: string[][] = [];
    for (const ch of RAMP) glyphs.push(RAMP_GLYPHS[ch].slice().reverse());
    for (const [halfLen, target] of STROKE_WEIGHTS) {
        for (let bin = 0; bin < ASCII_ANGLE_BINS; bin++) {
            glyphs.push(fitStroke((bin / ASCII_ANGLE_BINS) * Math.PI, halfLen, target));
        }
    }
    return glyphs;
};

let cachedAtlas: AsciiGlyphAtlas | null = null;

/** The glyph strip as single-channel bytes, built once (the stroke fit takes a few milliseconds). */
export const getAsciiGlyphAtlas = (): AsciiGlyphAtlas => {
    if (cachedAtlas) return cachedAtlas;
    const glyphs = buildAsciiGlyphRows();
    const width = ASCII_CELL_W * glyphs.length;
    const data = new Uint8Array(width * ASCII_CELL_H);
    glyphs.forEach((rows, gi) => {
        for (let y = 0; y < ASCII_CELL_H; y++) {
            for (let x = 0; x < ASCII_CELL_W; x++) {
                if (rows[y][x] === '#') data[y * width + gi * ASCII_CELL_W + x] = 255;
            }
        }
    });
    const covers = Float32Array.from(glyphs, rows => litCount(rows) / (ASCII_CELL_W * ASCII_CELL_H));
    cachedAtlas = { data, width, height: ASCII_CELL_H, covers };
    return cachedAtlas;
};
