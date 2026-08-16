import { describe, expect, it } from 'vitest';
import {
    BRUT_FACE_STEP_INTERVAL,
    BRUT_FRAME_MAX_ROLL,
    BRUT_LINE_RISE,
    BRUT_PAD_HALF_WIDTH,
    BRUT_SHAFT_HALF,
} from '@/components/visualizer/brut/brutConstants';
import { resolveBrutFaceYaw } from '@/components/visualizer/brut/brutFaceBasis';
import {
    buildBrutLinePlacements,
    resolveBrutAnchorPlacement,
} from '@/components/visualizer/brut/brutLyricPlacement';
import type { Line } from '@/types';

// test/unit/visualizer/brutPlacement.test.ts
// The line -> wall table must be a pure function of the seed, or seeking would move the frames and
// the relief pads generated for them.

const makeLines = (texts: string[]): Line[] => texts.map((fullText, index) => ({
    fullText,
    words: fullText.trim() ? [{ text: fullText, startTime: index, endTime: index + 1 }] : [],
    startTime: index,
    endTime: index + 1,
}));

const SONG = makeLines(Array.from({ length: 40 }, (_, index) => (index % 7 === 3 ? '' : `line ${index}`)));

describe('buildBrutLinePlacements', () => {
    it('is deterministic for the same seed', () => {
        expect(buildBrutLinePlacements(SONG, 12.5)).toEqual(buildBrutLinePlacements(SONG, 12.5));
    });

    it('skips blank lines without consuming an ordinal', () => {
        const table = buildBrutLinePlacements(SONG, 12.5);
        SONG.forEach((line, index) => {
            expect(Boolean(table.placements[index])).toBe(Boolean(line.fullText.trim()));
        });
        table.ordinals.forEach((placement, ordinal) => {
            expect(placement.ordinal).toBe(ordinal);
            expect(placement.y).toBeCloseTo(ordinal * BRUT_LINE_RISE, 6);
        });
    });

    it('never steps more than one face, and never twice in a row', () => {
        const { ordinals } = buildBrutLinePlacements(SONG, 12.5);
        let lastStep = -BRUT_FACE_STEP_INTERVAL;
        for (let index = 1; index < ordinals.length; index += 1) {
            const delta = Math.abs(ordinals[index].face - ordinals[index - 1].face);
            const step = Math.min(delta, 4 - delta);
            expect(step).toBeLessThanOrEqual(1);
            if (step === 1) {
                expect(index - lastStep).toBeGreaterThanOrEqual(BRUT_FACE_STEP_INTERVAL);
                lastStep = index;
            }
        }
    });

    it('only ever rolls a block in its own plane, and keeps its pad inside the wall', () => {
        // A yaw or pitch would tilt the block off the wall and bury its far tokens in the concrete.
        buildBrutLinePlacements(SONG, 12.5).ordinals.forEach((placement) => {
            expect(Object.keys(placement)).not.toContain('yaw');
            expect(Math.abs(placement.roll)).toBeLessThanOrEqual(BRUT_FRAME_MAX_ROLL + 1e-9);
            expect(Math.abs(placement.lateral) + BRUT_PAD_HALF_WIDTH).toBeLessThanOrEqual(BRUT_SHAFT_HALF);
        });
    });

    it('maps ordinals back to their line index', () => {
        const table = buildBrutLinePlacements(SONG, 12.5);
        table.ordinals.forEach((placement, ordinal) => {
            expect(table.ordinalToLineIndex[ordinal]).toBe(placement.lineIndex);
        });
    });

    it('survives an empty or fully blank song', () => {
        expect(buildBrutLinePlacements([], 3).ordinals).toEqual([]);
        const blank = buildBrutLinePlacements(makeLines(['', '  ']), 3);
        expect(blank.ordinals).toEqual([]);
        expect(resolveBrutAnchorPlacement(blank, 0)).toBeNull();
    });

    it('anchors a blank or negative index to the nearest earlier frame', () => {
        const table = buildBrutLinePlacements(SONG, 12.5);
        expect(resolveBrutAnchorPlacement(table, -1)).toBe(table.ordinals[0]);
        expect(resolveBrutAnchorPlacement(table, 3)?.lineIndex).toBe(2);
    });
});

describe('resolveBrutFaceYaw', () => {
    it('always takes the shortest angular path', () => {
        for (let face = 0; face < 4; face += 1) {
            for (let turns = -3; turns <= 3; turns += 1) {
                const current = turns * Math.PI * 0.9;
                expect(Math.abs(resolveBrutFaceYaw(face, current) - current)).toBeLessThanOrEqual(Math.PI + 1e-9);
            }
        }
    });
});
