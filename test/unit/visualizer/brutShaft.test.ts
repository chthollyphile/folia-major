import { describe, expect, it } from 'vitest';
import {
    BRUT_BLOCKS_PER_MODULE,
    BRUT_LINE_RISE,
    BRUT_MODULE_HEIGHT,
    BRUT_MODULE_LINES,
    BRUT_PAD_HALF_WIDTH,
    BRUT_PAD_HEIGHT,
    BRUT_SHAFT_HALF,
    BRUT_SHELL_TILE_V,
} from '@/components/visualizer/brut/brutConstants';
import { buildBrutLinePlacements } from '@/components/visualizer/brut/brutLyricPlacement';
import {
    collectBrutModulePads,
    createBrutModuleBlocks,
    createBrutModulePads,
    fillBrutModuleBlocks,
} from '@/components/visualizer/brut/brutReliefLayout';
import type { Line } from '@/types';

// test/unit/visualizer/brutShaft.test.ts
// Shaft constants and facade relief. The relief is generated FOR the lyric pads, so a frame can
// never bolt onto empty wall or clip a decorative rib.

const SONG: Line[] = Array.from({ length: 30 }, (_, index) => ({
    fullText: `line ${index}`,
    words: [{ text: `line ${index}`, startTime: index, endTime: index + 1 }],
    startTime: index,
    endTime: index + 1,
}));

describe('brut shaft constants', () => {
    it('keeps a module an exact number of lyric lines tall', () => {
        expect(BRUT_MODULE_HEIGHT).toBeCloseTo(BRUT_LINE_RISE * BRUT_MODULE_LINES, 10);
    });

    it('tiles the shell texture a whole number of times per module', () => {
        // Anything else and the concrete visibly jumps every time the shell snaps.
        const tiles = BRUT_MODULE_HEIGHT / BRUT_SHELL_TILE_V;
        expect(Math.abs(tiles - Math.round(tiles))).toBeLessThan(1e-9);
        expect(Math.round(tiles)).toBeGreaterThan(0);
    });
});

describe('fillBrutModuleBlocks', () => {
    const table = buildBrutLinePlacements(SONG, 7.25);

    const fill = (moduleIndex: number) => {
        const blocks = createBrutModuleBlocks();
        const pads = createBrutModulePads();
        const padCount = collectBrutModulePads(table, moduleIndex, pads);
        fillBrutModuleBlocks(blocks, 7.25, moduleIndex, pads, padCount);
        return { blocks, pads, padCount };
    };

    it('always emits a fixed number of blocks', () => {
        [-3, 0, 2, 9].forEach((moduleIndex) => {
            expect(fill(moduleIndex).blocks).toHaveLength(BRUT_BLOCKS_PER_MODULE);
        });
    });

    it('emits one mounting pad per lyric hosted by the module', () => {
        const { blocks, padCount } = fill(1);
        expect(padCount).toBe(BRUT_MODULE_LINES);
        expect(blocks.filter(block => block.isPad)).toHaveLength(BRUT_MODULE_LINES);
        blocks.filter(block => block.isPad).forEach((pad) => {
            expect(pad.width).toBeCloseTo(BRUT_PAD_HALF_WIDTH * 2, 6);
        });
    });

    it('is deterministic per absolute module index', () => {
        expect(fill(4).blocks).toEqual(fill(4).blocks);
        expect(fill(4).blocks).not.toEqual(fill(5).blocks);
    });

    it('keeps decorative ribs clear of the mounting pads', () => {
        for (let moduleIndex = 0; moduleIndex < 8; moduleIndex += 1) {
            const { blocks, pads, padCount } = fill(moduleIndex);
            blocks.filter(block => !block.isPad).forEach((block) => {
                for (let index = 0; index < padCount; index += 1) {
                    const pad = pads[index];
                    if (pad.face !== block.face) continue;
                    const lateralOverlap = Math.abs(block.lateral - pad.lateral)
                        < block.width / 2 + BRUT_PAD_HALF_WIDTH;
                    const verticalOverlap = Math.abs(block.y - pad.y)
                        < block.height / 2 + BRUT_PAD_HEIGHT / 2;
                    expect(lateralOverlap && verticalOverlap).toBe(false);
                }
            });
        }
    });

    it('keeps every block inside the wall', () => {
        const { blocks } = fill(3);
        blocks.forEach((block) => {
            expect(Math.abs(block.lateral) + block.width / 2).toBeLessThanOrEqual(BRUT_SHAFT_HALF + 1e-6);
            expect(block.face).toBeGreaterThanOrEqual(0);
            expect(block.face).toBeLessThan(4);
            expect(block.depth).toBeGreaterThan(0);
        });
    });

    it('reuses the array the caller passed in instead of allocating', () => {
        const blocks = createBrutModuleBlocks();
        const pads = createBrutModulePads();
        const first = blocks[0];
        fillBrutModuleBlocks(blocks, 7.25, 2, pads, collectBrutModulePads(table, 2, pads));
        expect(blocks[0]).toBe(first);
    });
});
