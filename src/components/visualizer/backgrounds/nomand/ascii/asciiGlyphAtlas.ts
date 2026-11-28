// src/components/visualizer/backgrounds/nomand/ascii/asciiGlyphAtlas.ts
// The glyphs of the Nomand ASCII effect, after living-ascii (MIT, Copyright (c) 2026 Yusen,
// https://github.com/yusen-dev/living-ascii): plain ASCII characters as 5×7 bitmaps — a ramp
// from dark to bright for cells without a clear direction, and the line characters - / | \
// for cells whose texture runs one way. living-ascii draws its own strokes at many angles and
// weights there; on a screen of them the picture reads as a sheet of slashes, not as text.

export const ASCII_CELL_W = 5;
export const ASCII_CELL_H = 7;
/** Direction bins over half a turn that the cell pass hands on; the glyph pass folds them onto - / | \. */
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

/**
 * The line characters for the angles 45, 90 and 135 degrees (y up), drawn like the ramp's '-',
 * which stands for 0. Rows are top-down.
 */
const LINE_GLYPHS: string[][] = [
    ['.....', '...#.', '...#.', '..#..', '.#...', '.#...', '.....'],
    ['.....', '..#..', '..#..', '..#..', '..#..', '..#..', '.....'],
    ['.....', '.#...', '.#...', '..#..', '...#.', '...#.', '.....'],
];
/** Where '-' sits in the ramp. */
export const ASCII_DASH_INDEX = RAMP.indexOf('-');

export const ASCII_RAMP_COUNT = RAMP.length;
export const ASCII_GLYPH_COUNT = RAMP.length + LINE_GLYPHS.length;

export interface AsciiGlyphAtlas {
    /** One strip of glyphs, ASCII_CELL_W wide each, rows bottom-up; 255 where lit. */
    data: Uint8Array;
    width: number;
    height: number;
    /** Fraction of the cell each glyph lights, for the colour solve. */
    covers: Float32Array;
}

const litCount = (rows: string[]) => rows.join('').split('#').length - 1;

/** Rows of every glyph, bottom-up: the ramp, then the line characters for 45, 90 and 135 degrees. */
export const buildAsciiGlyphRows = (): string[][] => [
    ...Array.from(RAMP, ch => RAMP_GLYPHS[ch].slice().reverse()),
    ...LINE_GLYPHS.map(rows => rows.slice().reverse()),
];

let cachedAtlas: AsciiGlyphAtlas | null = null;

/** The glyph strip as single-channel bytes, built once. */
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
