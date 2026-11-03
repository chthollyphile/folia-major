import { describe, expect, it } from 'vitest';
import { getBlockSlots, type WallSlot } from '@/components/wall/wallSlots';
import { getSeamBoundaryX } from '@/components/wall/seamPlan';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { createBravaisDisplay, resolveFocusReflow, resolveSlotFace } from '@/library/suites/bravais/bravaisDisplay';
import { computeBravaisFrame } from '@/library/suites/bravais/bravaisFrame';
import {
    buildPlateBlock,
    buildPlatePath,
    collectBlockHoles,
    collectMountedBlocks,
    disjointRects,
    getBlockRect,
    getPlateFrame,
    isLeftOfAnchor,
    isSamePlateBlock,
    PLATE_BLEED,
} from '@/library/suites/bravais/bravaisBlockPlate';
import { BRAVAIS_BLOCK_SHAPE, EXPLORE_BLOCK_SIZE } from '@/library/suites/bravais/bravaisWallShape';

// test/unit/library/bravais/bravaisBlockPlate.test.ts
// 透光的实色底板按块画（B12b，设计稿 §11）：每块的洞（窗、全透明的内容、让位后的矩形）、外框只向左 / 上多盖 2px
// （缝右侧第一列多盖一个 GAP，缝的开口下面没有底板、两侧也不漏缝）、路径（evenodd、洞裁进外框）、
// 洞只看块不看裁剪（拖动不改已挂块的路径）。

const metrics = { cellSize: 128, gap: 8 };
const items = (count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `t${index}`,
    kind: 'track',
    title: `t${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer: BravaisLayer = {
    key: 'a',
    sessionKey: 'a',
    surface: 'collection',
    mode: 'infinite',
    items: items(300),
    seam: { title: 'a', crumb: 'a', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
};
const blocks = (columns: number[], rows: number[]): WallSlot[] => (
    columns.flatMap(column => rows.flatMap(row => getBlockSlots(column, row, metrics)))
);
const NO_REFLOW = new Map<string, WallSlot>();
const partial = createBravaisDisplay(layer, null, undefined, { look: 'partial', windowsPerBlock: 3 });
const clear = createBravaisDisplay(layer, null, undefined, { look: 'clear', windowsPerBlock: 3 });
const block = getBlockRect(0, 0);

describe('collectBlockHoles', () => {
    it('digs one hole per window on the partial look', () => {
        const holes = collectBlockHoles(0, 0, partial, null, NO_REFLOW);
        const windows = getBlockSlots(0, 0, metrics).filter(slot => resolveSlotFace(partial, slot).kind === 'window');
        expect(holes.map(hole => hole.key)).toEqual(windows.map(slot => slot.key));
        expect(holes).toHaveLength(3);
    });

    it('digs every tile but the focus card on the clear look', () => {
        const slots = getBlockSlots(0, 0, metrics);
        expect(collectBlockHoles(0, 0, clear, null, NO_REFLOW)).toHaveLength(12);
        expect(collectBlockHoles(0, 0, clear, slots[4].key, NO_REFLOW)).toHaveLength(11);
    });

    it('moves the windows of the focused block with the reflow (keys unchanged, rects re-geared)', () => {
        const slots = getBlockSlots(0, 0, metrics);
        const content = slots.find(slot => resolveSlotFace(partial, slot).kind === 'content')!;
        const reflow = resolveFocusReflow(content.key);
        const holes = collectBlockHoles(0, 0, partial, content.key, reflow);
        expect(holes.map(hole => hole.rect)).toEqual(holes.map((hole) => {
            const rect = reflow.get(hole.key)!;
            return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }));
        expect(holes.some(hole => hole.rect.x !== slots.find(slot => slot.key === hole.key)!.x
            || hole.rect.width !== slots.find(slot => slot.key === hole.key)!.width)).toBe(true);
    });

    it('does not depend on how much of the block is mounted', () => {
        // 拖动 / 补挂改变的是裁剪：同一块的路径不变，已挂的块不重画。
        const whole = buildPlateBlock(2, 1, partial, null, NO_REFLOW, null);
        const again = buildPlateBlock(2, 1, partial, null, NO_REFLOW, null);
        expect(isSamePlateBlock(whole, again)).toBe(true);
        const more = createBravaisDisplay(layer, null, undefined, { look: 'partial', windowsPerBlock: 4 });
        expect(isSamePlateBlock(whole, buildPlateBlock(2, 1, more, null, NO_REFLOW, null))).toBe(false);
    });
});

describe('collectMountedBlocks', () => {
    it('lists each block once, in mount order', () => {
        const slots = [...blocks([1], [0]).slice(0, 2), ...blocks([0], [0]).slice(5, 7), ...blocks([1], [0]).slice(4, 5)];
        expect([...collectMountedBlocks(slots).keys()]).toEqual(['1,0', '0,0']);
    });
});

describe('plate frame', () => {
    it('bleeds 2px to the left and top only, into the previous block’s trailing gap', () => {
        expect(getPlateFrame(0, 0, null)).toEqual({
            x: block.x - PLATE_BLEED,
            y: block.y - PLATE_BLEED,
            width: block.width + PLATE_BLEED,
            height: block.height + PLATE_BLEED,
        });
        // 2px 落在前一块的尾部缝隙（GAP = 8）里，不碰前一块的磁贴；右 / 下止于本块尾部缝隙末尾，不碰下一块的磁贴。
        const previous = getBlockSlots(-1, 0, metrics);
        expect(Math.max(...previous.map(slot => slot.x + slot.width))).toBeLessThanOrEqual(block.x - PLATE_BLEED);
        const next = getBlockSlots(1, 0, metrics);
        const frame = getPlateFrame(0, 0, null);
        expect(Math.min(...next.map(slot => slot.x))).toBeGreaterThanOrEqual(frame.x + frame.width);
    });

    it('bleeds a whole gap on the first column right of the seam', () => {
        const anchorX = getSeamBoundaryX(1, metrics);
        expect(isLeftOfAnchor(0, anchorX)).toBe(true);
        expect(isLeftOfAnchor(1, anchorX)).toBe(false);
        expect(getPlateFrame(1, 0, anchorX).x).toBe(getBlockRect(1, 0).x - metrics.gap);
        expect(getPlateFrame(2, 0, anchorX).x).toBe(getBlockRect(2, 0).x - PLATE_BLEED);
        expect(getPlateFrame(0, 0, anchorX).x).toBe(getBlockRect(0, 0).x - PLATE_BLEED);
    });

    it.each([
        ['blocks', BRAVAIS_BLOCK_SHAPE.blockSize],
        ['explore lots', EXPLORE_BLOCK_SIZE],
    ])('leaves the open seam clear and closes up to both of its edges (%s)', (_, size) => {
        const anchorX = getSeamBoundaryX(1, metrics, size.width);
        const view = { width: 1600, height: 900, scale: 0.76 };
        for (const openWidth of [300, 74, 16]) {
            const frame = computeBravaisFrame({ center: { x: anchorX, y: 0 }, view, anchorX, openWidth, contentWidth: openWidth, hidden: false });
            const seamLeft = frame.seam.x - frame.seam.width / 2;
            const seamRight = frame.seam.x + frame.seam.width / 2;
            const left = getPlateFrame(0, 0, anchorX, size);
            const right = getPlateFrame(1, 0, anchorX, size);
            const leftEdge = frame.left.x + (left.x + left.width) * frame.scale;
            const rightEdge = frame.right.x + right.x * frame.scale;
            expect(leftEdge).toBeCloseTo(seamLeft, 6);
            expect(rightEdge).toBeCloseTo(seamRight, 6);
        }
    });
});

describe('buildPlatePath', () => {
    it('draws the frame and each hole relative to the frame origin', () => {
        const frame = { x: 100, y: 50, width: 200, height: 100 };
        expect(buildPlatePath(frame, [{ x: 110, y: 60, width: 20, height: 10 }]))
            .toBe('M0 0h200v100h-200ZM10 10h20v10h-20Z');
    });

    it('clips holes to the frame (an overshooting reflow must not fill outside the block)', () => {
        const frame = { x: 0, y: 0, width: 100, height: 100 };
        expect(buildPlatePath(frame, [{ x: 90, y: -5, width: 20, height: 20 }, { x: 200, y: 0, width: 10, height: 10 }]))
            .toBe('M0 0h100v100h-100ZM90 0h10v15h-10Z');
    });

    it('splits overlapping holes into disjoint rects (two windows crossing mid-reflow; evenodd would fill the overlap back in)', () => {
        const frame = { x: 0, y: 0, width: 100, height: 100 };
        expect(buildPlatePath(frame, [{ x: 10, y: 10, width: 40, height: 20 }, { x: 30, y: 10, width: 40, height: 20 }]))
            .toBe('M0 0h100v100h-100ZM10 10h60v20h-60Z');
    });

    it('builds the block plate from its windows', () => {
        const plate = buildPlateBlock(0, 0, partial, null, NO_REFLOW, null);
        expect(plate).toMatchObject({ key: '0,0', column: 0, row: 0, ...getPlateFrame(0, 0, null) });
        expect(plate.d.match(/M/g)).toHaveLength(1 + 3);
        expect(buildPlateBlock(0, 0, clear, null, NO_REFLOW, null).d.match(/M/g)).toHaveLength(1 + 12);
    });
});

describe('disjointRects', () => {
    const inside = (rects: readonly { x: number; y: number; width: number; height: number }[], x: number, y: number) => rects
        .filter(rect => x > rect.x && x < rect.x + rect.width && y > rect.y && y < rect.y + rect.height).length;

    it('returns disjoint holes as they are', () => {
        const rects = [{ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 }];
        expect(disjointRects(rects)).toBe(rects);
    });

    it('covers the same area with rects that never overlap', () => {
        const rects = [
            { x: 0, y: 0, width: 50, height: 30 },
            { x: 20, y: 10, width: 50, height: 50 },
            { x: 60, y: 50, width: 30, height: 30 },
        ];
        const out = disjointRects(rects);
        for (let x = 0.5; x < 100; x += 1) {
            for (let y = 0.5; y < 100; y += 1) {
                expect(inside(out, x, y)).toBe(inside(rects, x, y) > 0 ? 1 : 0);
            }
        }
    });
});
