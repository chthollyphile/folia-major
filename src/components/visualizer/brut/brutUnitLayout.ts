import { BRUT_UNIT_GAP_EM, BRUT_UNIT_ROW_EM, BRUT_UNIT_ROW_STEP_EM } from './brutConstants';
import { hash1, hashSigned } from './brutHash';

// src/components/visualizer/brut/brutUnitLayout.ts
// Scatters one line's install units across the wall.
//
// The units come from the project's own tokenisation (CJK per character, latin per word, sticky
// punctuation attached), so this only decides WHERE each token is bolted. Reading order survives
// because the scatter is a flow: tokens run left to right, wrap down a row when the row budget is
// spent, and only then take a hash-derived jitter in position, depth, roll and size. The result
// reads as signage installed piece by piece over a facade rather than a single ticker bar.
//
// Pure and DOM-free: sizes come in as em, so the caller can scale the whole block afterwards.

export interface BrutUnitSlot {
    /** Offsets in em from the block centre, along the wall tangent and vertically. */
    x: number;
    y: number;
    /** Extra protrusion in world units, so tokens sit on different depths of relief. */
    depth: number;
    roll: number;
    /** Per-token size multiplier. */
    scale: number;
}

export interface BrutUnitBlock {
    slots: BrutUnitSlot[];
    /** Extent of the whole scatter in em, used to frame the camera. */
    widthEm: number;
    heightEm: number;
}

const EMPTY_BLOCK: BrutUnitBlock = { slots: [], widthEm: 1, heightEm: 1 };

interface FlowRow {
    from: number;
    to: number;
    width: number;
}

/** Packs the tokens into rows of at most BRUT_UNIT_ROW_EM, never splitting a token. */
const buildFlowRows = (widths: number[]): FlowRow[] => {
    const rows: FlowRow[] = [];
    let from = 0;
    let width = 0;
    for (let index = 0; index < widths.length; index += 1) {
        const advance = widths[index] + BRUT_UNIT_GAP_EM;
        if (width > 0 && width + advance > BRUT_UNIT_ROW_EM) {
            rows.push({ from, to: index - 1, width: width - BRUT_UNIT_GAP_EM });
            from = index;
            width = 0;
        }
        width += advance;
    }
    if (widths.length) {
        rows.push({ from, to: widths.length - 1, width: Math.max(0, width - BRUT_UNIT_GAP_EM) });
    }
    return rows;
};

/**
 * Lays out one line's tokens. `seed` must be derived from the line, not from playback state, so the
 * scatter is identical every time the line is revisited.
 */
export const layoutBrutUnits = (widthsEm: number[], seed: number): BrutUnitBlock => {
    if (!widthsEm.length) {
        return EMPTY_BLOCK;
    }

    const rows = buildFlowRows(widthsEm);
    const widest = rows.reduce((maximum, row) => Math.max(maximum, row.width), 1);
    const blockHeight = rows.length * BRUT_UNIT_ROW_STEP_EM;
    const slots: BrutUnitSlot[] = new Array(widthsEm.length);

    rows.forEach((row, rowIndex) => {
        let cursor = -row.width / 2;
        // Rows run top to bottom so the reading order descends, matching how the eye scans a wall.
        const rowY = blockHeight / 2 - (rowIndex + 0.5) * BRUT_UNIT_ROW_STEP_EM;

        for (let index = row.from; index <= row.to; index += 1) {
            const tokenSeed = seed * 13.7 + index * 3.911;
            const width = widthsEm[index];
            const scale = 0.88 + hash1(tokenSeed + 1) * 0.34;
            slots[index] = {
                x: cursor + width / 2 + hashSigned(tokenSeed + 2) * BRUT_UNIT_GAP_EM * 0.9,
                y: rowY + hashSigned(tokenSeed + 3) * BRUT_UNIT_ROW_STEP_EM * 0.34,
                depth: hash1(tokenSeed + 4) * 0.22,
                roll: hashSigned(tokenSeed + 5) * 0.11,
                scale,
            };
            cursor += width + BRUT_UNIT_GAP_EM;
        }
    });

    return {
        slots,
        widthEm: widest + BRUT_UNIT_GAP_EM * 2,
        heightEm: blockHeight + BRUT_UNIT_ROW_STEP_EM * 0.5,
    };
};
