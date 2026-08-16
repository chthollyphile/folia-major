import {
    BRUT_BLOCKS_PER_MODULE,
    BRUT_MODULE_HEIGHT,
    BRUT_MODULE_LINES,
    BRUT_PAD_DEPTH,
    BRUT_PAD_HALF_WIDTH,
    BRUT_PAD_HEIGHT,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { hash1, hashSigned } from './brutHash';
import { normalizeBrutFace } from './brutFaceBasis';
import { type BrutPlacementTable } from './brutLyricPlacement';

// src/components/visualizer/brut/brutReliefLayout.ts
// Deterministic facade relief for one recyclable module.
//
// The relief is generated FOR the lyric, not independently of it: every module first emits a wide
// flat mounting pad wherever a lyric frame will land, then fills the remaining slots with
// decorative ribs that are pushed clear of those pads. A frame can therefore never bolt onto empty
// wall or clip through a rib. Block count is fixed so the InstancedMesh never resizes.

export interface BrutModulePad {
    face: number;
    lateral: number;
    y: number;
}

export interface BrutReliefBlock {
    face: number;
    lateral: number;
    /** World height of the block centre. */
    y: number;
    width: number;
    height: number;
    depth: number;
    /** Albedo brightness multiplier written into instanceColor. */
    tone: number;
    isPad: boolean;
}

const createBlock = (): BrutReliefBlock => ({
    face: 0,
    lateral: 0,
    y: 0,
    width: 1,
    height: 1,
    depth: 0.3,
    tone: 1,
    isPad: false,
});

/** Preallocates the per-module scratch array so recycling never allocates. */
export const createBrutModuleBlocks = (): BrutReliefBlock[] => (
    Array.from({ length: BRUT_BLOCKS_PER_MODULE }, createBlock)
);

export const createBrutModulePads = (): BrutModulePad[] => (
    Array.from({ length: BRUT_MODULE_LINES }, () => ({ face: 0, lateral: 0, y: 0 }))
);

/** Writes the pads belonging to `moduleIndex` into `out` and returns how many are real. */
export const collectBrutModulePads = (
    table: BrutPlacementTable,
    moduleIndex: number,
    out: BrutModulePad[],
): number => {
    let count = 0;
    const firstOrdinal = moduleIndex * BRUT_MODULE_LINES;
    for (let step = 0; step < BRUT_MODULE_LINES; step += 1) {
        const placement = table.ordinals[firstOrdinal + step];
        if (!placement) {
            continue;
        }
        out[count].face = placement.face;
        out[count].lateral = placement.lateral;
        out[count].y = placement.y;
        count += 1;
    }
    return count;
};

const PAD_CLEARANCE = 0.3;

const overlapsPad = (block: BrutReliefBlock, pad: BrutModulePad): boolean => (
    pad.face === block.face
    && Math.abs(block.lateral - pad.lateral) < block.width / 2 + BRUT_PAD_HALF_WIDTH + PAD_CLEARANCE
    && Math.abs(block.y - pad.y) < block.height / 2 + BRUT_PAD_HEIGHT / 2 + PAD_CLEARANCE
);

const findFreeFace = (pads: BrutModulePad[], padCount: number): number => {
    for (let face = 0; face < 4; face += 1) {
        let used = false;
        for (let index = 0; index < padCount; index += 1) {
            if (pads[index].face === face) {
                used = true;
                break;
            }
        }
        if (!used) {
            return face;
        }
    }
    return 0;
};

/**
 * Pushes a decorative rib clear of the mounting pads. Clearing one pad can push a rib into the
 * next, so this iterates; a module hosts at most BRUT_MODULE_LINES pads and the shaft has four
 * walls, so relocating to a pad-free face is always available as the last resort.
 */
const avoidPads = (
    block: BrutReliefBlock,
    pads: BrutModulePad[],
    padCount: number,
    moduleBase: number,
    seed: number,
) => {
    for (let pass = 0; pass < 3; pass += 1) {
        let moved = false;
        for (let index = 0; index < padCount; index += 1) {
            const pad = pads[index];
            if (!overlapsPad(block, pad)) {
                continue;
            }

            const clearance = BRUT_PAD_HEIGHT / 2 + block.height / 2 + PAD_CLEARANCE + 0.04;
            const up = pad.y + clearance;
            const down = pad.y - clearance;
            const fitsUp = up + block.height / 2 <= moduleBase + BRUT_MODULE_HEIGHT;
            const fitsDown = down - block.height / 2 >= moduleBase;
            if (hash1(seed + index * 3.3) > 0.5 && fitsUp) {
                block.y = up;
            } else if (fitsDown) {
                block.y = down;
            } else if (fitsUp) {
                block.y = up;
            } else {
                block.face = findFreeFace(pads, padCount);
            }
            moved = true;
        }
        if (!moved) {
            return;
        }
    }

    for (let index = 0; index < padCount; index += 1) {
        if (overlapsPad(block, pads[index])) {
            block.face = findFreeFace(pads, padCount);
            return;
        }
    }
};

/**
 * Fills `out` with exactly BRUT_BLOCKS_PER_MODULE blocks for one module. Seeded only by the
 * ABSOLUTE module index, so scrolling away and back reproduces identical geometry.
 */
export const fillBrutModuleBlocks = (
    out: BrutReliefBlock[],
    patternSeed: number,
    moduleIndex: number,
    pads: BrutModulePad[],
    padCount: number,
): void => {
    const moduleBase = moduleIndex * BRUT_MODULE_HEIGHT;

    for (let index = 0; index < padCount; index += 1) {
        const block = out[index];
        const pad = pads[index];
        block.face = pad.face;
        block.lateral = pad.lateral;
        block.y = pad.y;
        block.width = BRUT_PAD_HALF_WIDTH * 2;
        block.height = BRUT_PAD_HEIGHT;
        block.depth = BRUT_PAD_DEPTH;
        block.tone = 1.06;
        block.isPad = true;
    }

    for (let index = padCount; index < BRUT_BLOCKS_PER_MODULE; index += 1) {
        const block = out[index];
        const seed = patternSeed * 7919 + moduleIndex * 131.7 + index * 7.13;
        const isVertical = hash1(seed + 1) > 0.42;
        const width = isVertical ? 0.4 + hash1(seed + 2) * 1.05 : 1.4 + hash1(seed + 2) * 3.1;
        const height = isVertical ? 1.4 + hash1(seed + 3) * 4.4 : 0.32 + hash1(seed + 3) * 0.82;

        block.face = normalizeBrutFace(Math.floor(hash1(seed + 4) * 4));
        block.width = width;
        block.height = height;
        block.depth = 0.18 + hash1(seed + 5) * 0.82;
        block.lateral = hashSigned(seed + 6) * Math.max(0.2, BRUT_SHAFT_HALF * 2 - width - 0.6);
        block.y = moduleBase + height / 2 + 0.12
            + hash1(seed + 7) * Math.max(0, BRUT_MODULE_HEIGHT - height - 0.24);
        block.tone = 0.9 + hash1(seed + 8) * 0.22;
        block.isPad = false;

        avoidPads(block, pads, padCount, moduleBase, seed);
    }
};
