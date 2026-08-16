import { type Line } from '../../../types';
import {
    BRUT_FACE_COUNT,
    BRUT_FACE_STEP_INTERVAL,
    BRUT_FRAME_MAX_ROLL,
    BRUT_FRAME_MAX_YAW,
    BRUT_LINE_RISE,
    BRUT_PAD_HALF_WIDTH,
    BRUT_SHAFT_HALF,
} from './brutConstants';
import { hash1, hashSigned } from './brutHash';
import { normalizeBrutFace } from './brutFaceBasis';

// src/components/visualizer/brut/brutLyricPlacement.ts
// Maps lyric lines onto the four inner walls of the shaft. Pure and DOM-free so it can be unit
// tested, and a pure function of (lineIndex, patternSeed) so seeking never moves a frame.
//
// The face walk is deliberately constrained: uniformly scattering lines over four faces would put
// half of them at a grazing angle and force ~90-180 degrees of camera yaw per line. Instead the face
// may step by at most +/-1, and only every BRUT_FACE_STEP_INTERVAL ordinals.

export interface BrutLinePlacement {
    /** Index into the original lines array. */
    lineIndex: number;
    /** Index among RENDERED (non-blank) lines. Blank lines consume no ordinal, so the shaft has no gaps. */
    ordinal: number;
    face: number;
    /** World height of the frame centre. */
    y: number;
    /** Offset along the wall from its centre. */
    lateral: number;
    /** Rotation off the wall toward the shaft axis, so side-wall text still faces the viewer. */
    yaw: number;
    roll: number;
}

/** One line inside the render window, already resolved to its wall. */
export interface BrutVisibleLine {
    index: number;
    line: Line;
    placement: BrutLinePlacement;
}

export interface BrutPlacementTable {
    /** Aligned with the input lines; null for blank lines. */
    placements: (BrutLinePlacement | null)[];
    /** Dense, indexed by ordinal. */
    ordinals: BrutLinePlacement[];
    ordinalToLineIndex: Int32Array;
}

const EMPTY_TABLE: BrutPlacementTable = {
    placements: [],
    ordinals: [],
    ordinalToLineIndex: new Int32Array(0),
};

const isRenderableLine = (line: Line | undefined): boolean => Boolean(line?.fullText?.trim());

/** Yaw that turns a frame at `lateral` back toward the shaft axis, softened and clamped. */
const resolveFrameYaw = (lateral: number, jitter: number): number => {
    const toAxis = -Math.atan2(lateral, BRUT_SHAFT_HALF * 2) * 0.85;
    const yaw = toAxis + jitter * 0.08;
    return Math.max(-BRUT_FRAME_MAX_YAW, Math.min(BRUT_FRAME_MAX_YAW, yaw));
};

/** Builds the whole line -> wall table in one O(n) pass. Memoise on (lines, patternSeed). */
export const buildBrutLinePlacements = (lines: Line[], patternSeed: number): BrutPlacementTable => {
    if (!lines.length) {
        return EMPTY_TABLE;
    }

    const placements: (BrutLinePlacement | null)[] = new Array(lines.length).fill(null);
    const ordinals: BrutLinePlacement[] = [];
    let face = Math.floor(hash1(patternSeed + 0.5) * BRUT_FACE_COUNT) % BRUT_FACE_COUNT;
    let lastStepOrdinal = -BRUT_FACE_STEP_INTERVAL;

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        if (!isRenderableLine(lines[lineIndex])) {
            continue;
        }

        const ordinal = ordinals.length;
        if (ordinal > 0 && ordinal - lastStepOrdinal >= BRUT_FACE_STEP_INTERVAL) {
            const roll = hash1(patternSeed * 3.1 + ordinal * 5.77);
            if (roll > 0.46) {
                face = normalizeBrutFace(face + (roll > 0.73 ? 1 : -1));
                lastStepOrdinal = ordinal;
            }
        }

        const seed = patternSeed * 11.3 + ordinal * 1.741;
        // The mounting pad is generated around this offset, so it must leave the pad inside the wall.
        const lateral = hashSigned(seed + 2) * 2 * (BRUT_SHAFT_HALF - BRUT_PAD_HALF_WIDTH - 0.2);
        const placement: BrutLinePlacement = {
            lineIndex,
            ordinal,
            face,
            y: ordinal * BRUT_LINE_RISE,
            lateral,
            yaw: resolveFrameYaw(lateral, hashSigned(seed + 3)),
            roll: hashSigned(seed + 4) * 2 * BRUT_FRAME_MAX_ROLL,
        };

        placements[lineIndex] = placement;
        ordinals.push(placement);
    }

    const ordinalToLineIndex = new Int32Array(ordinals.length);
    ordinals.forEach((placement, index) => {
        ordinalToLineIndex[index] = placement.lineIndex;
    });

    return { placements, ordinals, ordinalToLineIndex };
};

/**
 * Nearest placement at or before `lineIndex`, so the camera has somewhere to be while a blank line
 * or an instrumental gap is active.
 */
export const resolveBrutAnchorPlacement = (
    table: BrutPlacementTable,
    lineIndex: number,
): BrutLinePlacement | null => {
    if (!table.ordinals.length) {
        return null;
    }
    if (lineIndex < 0) {
        return table.ordinals[0];
    }

    for (let index = Math.min(lineIndex, table.placements.length - 1); index >= 0; index -= 1) {
        const placement = table.placements[index];
        if (placement) {
            return placement;
        }
    }

    return table.ordinals[0];
};
