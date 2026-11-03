import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSeamSplitOffsets } from '@/components/wall/seamPlan';
import bravais, { BRAVAIS_LAYOUT_STORAGE_PREFIX } from '@/library/suites/bravais/entry';
import { computeBravaisFrame } from '@/library/suites/bravais/bravaisFrame';
import { getBlockSize } from '@/components/wall/wallSlots';
import { BRAVAIS_BLOCK_SHAPE, EXPLORE_BLOCK_SIZE, createExploreShape, nearestShapeBoundaryX } from '@/library/suites/bravais/bravaisWallShape';
import {
    fitBravaisLayoutToShape,
    parseBravaisLayoutRecord,
    readBravaisLayout,
    writeBravaisLayout,
} from '@/library/suites/bravais/bravaisLayoutMemory';

// test/unit/library/bravais/bravaisFrameAndMemory.test.ts
// 每帧写到 DOM 的几何（墙的两半各让出半个开口、缝随墙移动并在屏幕边缘挤窄、内容按排版宽度淡出、边缘标签），
// 与每层的布局记忆（sessionStorage 读写、坏数据当没有、manifest 的 layout.forget 按会话键删掉）。

const view = { width: 1200, height: 800, scale: 0.5 };
const metrics = { cellSize: 128, gap: 8 };

describe('computeBravaisFrame', () => {
    it('splits the two halves around an open seam on the base line', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 300, contentWidth: 300, hidden: false });
        const offsets = getSeamSplitOffsets(300, view.scale, metrics);
        expect(frame.left).toEqual({ x: 600 + offsets.left, y: 400 });
        expect(frame.right).toEqual({ x: 600 + offsets.right, y: 400 });
        expect(frame.seam).toEqual({ axis: 'x', x: 600, y: 400, width: 300, visible: true });
        expect(frame.contentOpacity).toBe(1);
        expect(frame.tab.visible).toBe(false);
    });

    it('squeezes the seam near an edge, fades its content and collapses it off screen', () => {
        const near = computeBravaisFrame({ center: { x: 1000, y: 0 }, view, anchorX: 0, openWidth: 300, contentWidth: 300, hidden: false });
        expect(near.seam.x).toBe(100);
        expect(near.seam.width).toBe(2 * (100 - 14));
        expect(near.contentOpacity).toBeLessThan(1);

        const gone = computeBravaisFrame({ center: { x: 3000, y: 0 }, view, anchorX: 0, openWidth: 300, contentWidth: 300, hidden: false });
        expect(gone.seam.visible).toBe(false);
        expect(gone.tab).toEqual({ visible: true, side: 'left' });
    });

    it('lays out against the rendered variant width, not the opening (flip without reflow)', () => {
        const frame = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 150, contentWidth: 300, hidden: false });
        expect(frame.contentOpacity).toBeCloseTo((0.5 - 0.35) / 0.65);
    });

    it('shows the floating tab while folded and closes the wall without a layer', () => {
        const folded = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: 0, openWidth: 0, contentWidth: 0, hidden: true });
        expect(folded.tab.visible).toBe(true);
        expect(folded.left).toEqual(folded.right);

        const none = computeBravaisFrame({ center: { x: 0, y: 0 }, view, anchorX: null, openWidth: 300, contentWidth: 300, hidden: false });
        expect(none.seam.visible).toBe(false);
        expect(none.left).toEqual(none.right);
    });
});

describe('layout memory', () => {
    let storage: Map<string, string>;
    beforeEach(() => {
        storage = new Map();
        vi.stubGlobal('sessionStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
            removeItem: (key: string) => storage.delete(key),
        });
    });
    afterEach(() => vi.unstubAllGlobals());

    const record = { center: { x: 12, y: -40 }, anchorX: -8, startSlotKey: '1,0,3', focusSlotKey: '1,0,4' };

    it('round-trips a record per session key', () => {
        writeBravaisLayout('online:a:playlist:1', record);
        expect(storage.has(`${BRAVAIS_LAYOUT_STORAGE_PREFIX}online:a:playlist:1`)).toBe(true);
        expect(readBravaisLayout('online:a:playlist:1')).toEqual(record);
        expect(readBravaisLayout('online:a:playlist:2')).toBeNull();
    });

    it('is forgotten by the manifest when the host finishes the layer', () => {
        writeBravaisLayout('online:a:playlist:1', record);
        writeBravaisLayout('home', record);
        bravais.layout!.forget('online:a:playlist:1');
        expect(readBravaisLayout('online:a:playlist:1')).toBeNull();
        expect(readBravaisLayout('home')).toEqual(record);
    });

    it('moves a remembered anchor and start onto the shape it is used with', () => {
        const explore = createExploreShape([{ key: 'a', heading: 'A', entries: [{ index: 0, kind: 'album' }] }], { column: 0, row: 0 });
        const blockWidth = getBlockSize(metrics).width;
        // 探索形状记下的（街中线上的锚点、第 2 块地的起点与焦点）拿到块墙上用。
        const fromExplore = { center: { x: 1, y: 2 }, anchorX: 2 * EXPLORE_BLOCK_SIZE.width - 36, startSlotKey: '1,0,4', focusSlotKey: '1,0,4', shapeKind: 'explore' as const };
        const onBlocks = fitBravaisLayoutToShape(fromExplore, BRAVAIS_BLOCK_SHAPE);
        expect(onBlocks.anchorX).toBe(nearestShapeBoundaryX(BRAVAIS_BLOCK_SHAPE, fromExplore.anchorX));
        expect((onBlocks.anchorX! + metrics.gap / 2) % blockWidth).toBe(0);
        const start = BRAVAIS_BLOCK_SHAPE.slotAt(...(onBlocks.startSlotKey!.split(',').map(Number) as [number, number, number]))!;
        expect(Math.floor(start.centerX / EXPLORE_BLOCK_SIZE.width)).toBe(1);
        expect(onBlocks).toMatchObject({ center: fromExplore.center, focusSlotKey: null, shapeKind: 'blocks' });
        // 块墙记下的（没有种类的旧记录也算块）拿到探索形状上：起点是它块中心所在那块地的第一个座位。
        const onExplore = fitBravaisLayoutToShape(record, explore);
        expect(onExplore.anchorX).toBe(nearestShapeBoundaryX(explore, record.anchorX));
        expect(onExplore.startSlotKey).toBe('1,0,0');
        expect(onExplore.focusSlotKey).toBeNull();
        // 同一种形状：照用，只把锚点落到边界上。
        expect(fitBravaisLayoutToShape(record, BRAVAIS_BLOCK_SHAPE)).toEqual({ ...record, anchorX: -metrics.gap / 2, shapeKind: 'blocks' });
    });

    it('drops broken fields instead of trusting them', () => {
        expect(parseBravaisLayoutRecord('not json')).toBeNull();
        expect(parseBravaisLayoutRecord(null)).toBeNull();
        expect(parseBravaisLayoutRecord(JSON.stringify({ center: { x: 'a', y: 1 }, anchorX: Infinity, startSlotKey: 3 }))).toEqual({
            center: null,
            anchorX: null,
            startSlotKey: null,
            focusSlotKey: null,
        });
    });
});
