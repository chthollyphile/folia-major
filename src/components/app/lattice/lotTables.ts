import type { BlockSlot } from '../../wall/blockTemplates';

// src/components/app/lattice/lotTables.ts
// The explore wall's lot, as data. One section of the explore page stands on a lot of 12 x 8
// units (the footprint of the queue wall's block): its heading and three fields of posters, each
// field cut into seats by the number of entries it holds. Drawn by hand and meant to be redrawn
// by hand: a table may be changed freely as long as its seats cover its field exactly
// (test/unit/lattice/exploreLayout.test.ts checks every lot that can come of these tables).
// A seat is { x, y, cols, rows } in units from its field's top left; their order in a table
// does not matter. Which entry takes which seat: lotSeats.ts. Where a lot stands: exploreLayout.ts.

export const LOT_COLS = 12;
export const LOT_ROWS = 8;
/** The entries one lot holds at most; a longer section is dealt over several lots. */
export const LOT_CAPACITY = 13;

// A lot of three entries or more:
//   heading strip | right
//   --------------| square
//   left          |
//   square        |-------------
//                 | right strip
export const HEADING_STRIP: BlockSlot = { x: 0, y: 0, cols: 6, rows: 2 };
export const LEFT_SQUARE: BlockSlot = { x: 0, y: 2, cols: 6, rows: 6 };
export const RIGHT_SQUARE: BlockSlot = { x: 6, y: 0, cols: 6, rows: 6 };
export const RIGHT_STRIP: BlockSlot = { x: 6, y: 6, cols: 6, rows: 2 };

// A lot of one or two entries: the heading takes the whole left half, the entries the right half.
export const HEADING_HALF: BlockSlot = { x: 0, y: 0, cols: 6, rows: 8 };
/** The right half's seats in units of the lot, by the number of entries (1 or 2). */
export const RIGHT_HALF_SEATS: BlockSlot[][] = [
    [],
    [{ x: 6, y: 0, cols: 6, rows: 8 }],
    [{ x: 6, y: 0, cols: 6, rows: 4 }, { x: 6, y: 4, cols: 6, rows: 4 }],
];

/** A square (6 x 6) cut into m seats: SQUARE_SEATS[m], m from 1 to 9. */
export const SQUARE_SEATS: BlockSlot[][] = [
    [],
    // 1: one 6x6
    [{ x: 0, y: 0, cols: 6, rows: 6 }],
    // 2: two 6x3
    [{ x: 0, y: 0, cols: 6, rows: 3 }, { x: 0, y: 3, cols: 6, rows: 3 }],
    // 3: a 6x4 over two 3x2
    [
        { x: 0, y: 0, cols: 6, rows: 4 },
        { x: 0, y: 4, cols: 3, rows: 2 }, { x: 3, y: 4, cols: 3, rows: 2 },
    ],
    // 4: a 4x4 beside a 2x4, over a 4x2 beside a 2x2
    [
        { x: 0, y: 0, cols: 4, rows: 4 }, { x: 4, y: 0, cols: 2, rows: 4 },
        { x: 0, y: 4, cols: 4, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
    // 5: a 4x4 beside two 2x2, over a 4x2 beside a 2x2
    [
        { x: 0, y: 0, cols: 4, rows: 4 }, { x: 4, y: 0, cols: 2, rows: 2 },
        { x: 4, y: 2, cols: 2, rows: 2 },
        { x: 0, y: 4, cols: 4, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
    // 6: a 4x4 and five 2x2
    [
        { x: 0, y: 0, cols: 4, rows: 4 }, { x: 4, y: 0, cols: 2, rows: 2 },
        { x: 4, y: 2, cols: 2, rows: 2 },
        { x: 0, y: 4, cols: 2, rows: 2 }, { x: 2, y: 4, cols: 2, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
    // 7: four 3x2 over three 2x2
    [
        { x: 0, y: 0, cols: 3, rows: 2 }, { x: 3, y: 0, cols: 3, rows: 2 },
        { x: 0, y: 2, cols: 3, rows: 2 }, { x: 3, y: 2, cols: 3, rows: 2 },
        { x: 0, y: 4, cols: 2, rows: 2 }, { x: 2, y: 4, cols: 2, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
    // 8: two 3x2 over six 2x2
    [
        { x: 0, y: 0, cols: 3, rows: 2 }, { x: 3, y: 0, cols: 3, rows: 2 },
        { x: 0, y: 2, cols: 2, rows: 2 }, { x: 2, y: 2, cols: 2, rows: 2 }, { x: 4, y: 2, cols: 2, rows: 2 },
        { x: 0, y: 4, cols: 2, rows: 2 }, { x: 2, y: 4, cols: 2, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
    // 9: nine 2x2
    [
        { x: 0, y: 0, cols: 2, rows: 2 }, { x: 2, y: 0, cols: 2, rows: 2 }, { x: 4, y: 0, cols: 2, rows: 2 },
        { x: 0, y: 2, cols: 2, rows: 2 }, { x: 2, y: 2, cols: 2, rows: 2 }, { x: 4, y: 2, cols: 2, rows: 2 },
        { x: 0, y: 4, cols: 2, rows: 2 }, { x: 2, y: 4, cols: 2, rows: 2 }, { x: 4, y: 4, cols: 2, rows: 2 },
    ],
];

/** A strip (6 x 2) cut into m seats: STRIP_SEATS[m], m from 1 to 3. */
export const STRIP_SEATS: BlockSlot[][] = [
    [],
    [{ x: 0, y: 0, cols: 6, rows: 2 }],
    [{ x: 0, y: 0, cols: 3, rows: 2 }, { x: 3, y: 0, cols: 3, rows: 2 }],
    [{ x: 0, y: 0, cols: 2, rows: 2 }, { x: 2, y: 0, cols: 2, rows: 2 }, { x: 4, y: 0, cols: 2, rows: 2 }],
];

/**
 * How many of a lot's `count` entries (3 to 13) the right strip takes. Of the rest the left
 * square takes half, rounded down, and the right square what is left.
 */
export const stripSeatsOf = (count: number): number => (count <= 3 ? 1 : count === LOT_CAPACITY ? 3 : 2);

/**
 * The same while one tile of the lot is grown over a square, for the `others` (2 to 12) that
 * share the other square and the right strip: that square takes the rest, nine at most.
 */
export const grownStripSeatsOf = (others: number): number => Math.min(3, Math.max(others - 9, others > 2 ? 2 : 1));
