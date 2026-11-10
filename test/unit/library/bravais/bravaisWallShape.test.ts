import { describe, expect, it } from 'vitest';
import { createExploreLayout } from '@/components/app/lattice/exploreLayout';
import type { WallSection } from '@/components/app/lattice/wallLayout';
import type { LatticeTile } from '@/components/app/lattice/latticeModel';
import { getBlockSize } from '@/components/wall/wallSlots';
import { BRAVAIS_METRICS } from '@/library/suites/bravais/bravaisConstants';
import { createBravaisDisplay, diffDisplays, resolveSlotFace, resolveSlotItem } from '@/library/suites/bravais/bravaisDisplay';
import { findDisplayItemSlot } from '@/library/suites/bravais/bravaisItemSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import { projectExploreHeadings, projectExploreItems } from '@/library/suites/bravais/bravaisExploreProjection';
import {
    BRAVAIS_BLOCK_SHAPE,
    EXPLORE_BLOCK_SIZE,
    collectShapeSlots,
    createExploreShape,
    isGrownExploreShape,
    moveStartSlotKey,
    nearestShapeBoundaryX,
    resolveLayerShape,
    resolveShiftStart,
    shapeSlotFromKey,
    splitGrownSlots,
} from '@/library/suites/bravais/bravaisWallShape';

const pitch = BRAVAIS_METRICS.cellSize + BRAVAIS_METRICS.gap;
const kinds = ['album', 'playlist', 'song', 'artist', 'song'] as const;
let next = 0;
const section = (key: string, count: number): WallSection => ({
    key,
    heading: key.toUpperCase(),
    entries: Array.from({ length: count }, (_, index) => ({ index: next++, kind: kinds[index % kinds.length] })),
});
next = 0;
const SECTIONS: WallSection[] = [section('a', 5), section('b', 13), section('c', 2), section('d', 20)];
const ENTRY_COUNT = next;
const t = (key: string) => key;

const item = (index: number): BravaisItem => ({ key: `e${index}`, kind: 'track', title: `${index}`, subtitle: '', badge: '' });
const exploreLayer = (): BravaisLayer => ({
    key: 'home:explore',
    sessionKey: 'home',
    surface: 'home',
    mode: 'infinite',
    items: Array.from({ length: ENTRY_COUNT }, (_, index) => item(index)),
    seam: { title: '', crumb: '', meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
    shape: { kind: 'explore', sections: SECTIONS, headings: projectExploreHeadings(SECTIONS, t) },
});

describe('bravais explore shape', () => {
    it('spaces blocks a lot plus a half-cell street apart, as the grid explore wall does', () => {
        expect(EXPLORE_BLOCK_SIZE).toEqual({ width: 12 * pitch + 64, height: 8 * pitch + 64 });
        expect(BRAVAIS_BLOCK_SHAPE.blockSize).toEqual(getBlockSize(BRAVAIS_METRICS));
    });

    it('lays each block out as the grid explore layout lays out its lot, shifted by the origin', () => {
        const origin = { column: 3, row: -2 };
        const shape = createExploreShape(SECTIONS, origin);
        const layout = createExploreLayout(SECTIONS, BRAVAIS_METRICS);
        for (const [column, row] of [[0, 0], [1, 0], [0, 1], [-1, 2], [2, -3]]) {
            const bounds = { left: column * EXPLORE_BLOCK_SIZE.width, top: row * EXPLORE_BLOCK_SIZE.height };
            const { posters, headings } = layout.near({
                left: bounds.left,
                right: bounds.left + EXPLORE_BLOCK_SIZE.width - 65,
                top: bounds.top,
                bottom: bounds.top + EXPLORE_BLOCK_SIZE.height - 65,
            }, 0);
            const slots = shape.blockSlots(column + origin.column, row + origin.row);
            const dx = origin.column * EXPLORE_BLOCK_SIZE.width;
            const dy = origin.row * EXPLORE_BLOCK_SIZE.height;
            // 座位 i 是 slot i，标题是最后一个。
            expect(slots).toHaveLength(posters.length + 1);
            for (const poster of posters) {
                const slot = slots[poster.cellSlot];
                expect({ x: slot.x - dx, y: slot.y - dy, width: slot.width, height: slot.height })
                    .toEqual({ x: poster.x, y: poster.y, width: poster.width, height: poster.height });
                expect(shape.entryAt?.(slot)).toBe(poster.queueIndex);
                expect(shape.headingAt(slot)).toBeNull();
            }
            const heading = slots[slots.length - 1];
            expect({ x: heading.x - dx, y: heading.y - dy, width: heading.width }).toEqual({ x: headings[0].x, y: headings[0].y, width: headings[0].width });
            expect(shape.headingAt(heading)).toBe(headings[0].section);
            expect(shape.entryAt?.(heading)).toBeNull();
        }
    });

    it('puts the first section on the origin block and finds any entry near a point', () => {
        const shape = createExploreShape(SECTIONS, { column: 2, row: 1 });
        expect(shape.headingAt(shape.blockSlots(2, 1).at(-1)!)).toBe(0);
        for (const index of [0, 7, 19, ENTRY_COUNT - 1]) {
            const slot = shape.nearestEntry?.(index, { x: 5000, y: -3000 });
            expect(slot && shape.entryAt?.(slot)).toBe(index);
        }
        expect(shape.slotAt(2, 1, 99)).toBeNull();
    });

    it('grows a seat inside its lot and keeps the heading where it is', () => {
        const shape = createExploreShape(SECTIONS, { column: 0, row: 0 });
        const resting = shape.blockSlots(0, 0);
        const grown = shape.grownBlock(0, 0, 1);
        expect(grown).toHaveLength(resting.length);
        expect(grown![1].width).toBe(6 * pitch - BRAVAIS_METRICS.gap);
        expect(grown!.at(-1)).toEqual(resting.at(-1));
        expect(shape.grownBlock(0, 0, resting.length - 1)).toBeNull();
        // 长大的座位与其余座位都还在这块地里（不伸进街）。
        const lot = { right: 12 * pitch - BRAVAIS_METRICS.gap, bottom: 8 * pitch - BRAVAIS_METRICS.gap };
        for (const slot of grown!) {
            expect(slot.x).toBeGreaterThanOrEqual(0);
            expect(slot.y).toBeGreaterThanOrEqual(0);
            expect(slot.x + slot.width).toBeLessThanOrEqual(lot.right);
            expect(slot.y + slot.height).toBeLessThanOrEqual(lot.bottom);
        }
    });

    it('resolves a layer shape: blocks without explore sections, one object per sections and origin', () => {
        expect(resolveLayerShape(undefined, '1,1,0')).toBe(BRAVAIS_BLOCK_SHAPE);
        expect(resolveLayerShape({ kind: 'explore', sections: [], headings: [] }, null)).toBe(BRAVAIS_BLOCK_SHAPE);
        const shape = { kind: 'explore' as const, sections: SECTIONS, headings: [] };
        const first = resolveLayerShape(shape, '4,-1,3');
        expect(first.kind).toBe('explore');
        expect(resolveLayerShape(shape, '4,-1,0')).toBe(first);
        expect(resolveLayerShape(shape, '5,-1,0')).not.toBe(first);
        expect(first.headingAt(first.blockSlots(4, -1).at(-1)!)).toBe(0);
    });

    it('moves a start slot to the block under its centre on the other shape', () => {
        const explore = createExploreShape(SECTIONS, { column: 0, row: 0 });
        const from = BRAVAIS_BLOCK_SHAPE.slotAt(3, 2, 5)!;
        const moved = moveStartSlotKey(from.key, BRAVAIS_BLOCK_SHAPE, explore);
        expect(moved).toBe(`${Math.floor(from.centerX / EXPLORE_BLOCK_SIZE.width)},${Math.floor(from.centerY / EXPLORE_BLOCK_SIZE.height)},0`);
        const back = moveStartSlotKey(moved, explore, BRAVAIS_BLOCK_SHAPE)!;
        const slot = shapeSlotFromKey(BRAVAIS_BLOCK_SHAPE, back)!;
        const start = shapeSlotFromKey(explore, moved)!;
        expect(Math.floor(start.centerX / getBlockSize(BRAVAIS_METRICS).width)).toBe(slot.column);
        expect(moveStartSlotKey('1,1,1', explore, explore)).toBe('1,1,1');
    });

    it('opens the seam in the middle of the street between two lots', () => {
        const explore = createExploreShape(SECTIONS, { column: 0, row: 0 });
        expect(nearestShapeBoundaryX(explore, 2 * EXPLORE_BLOCK_SIZE.width + 100)).toBe(2 * EXPLORE_BLOCK_SIZE.width - (64 + BRAVAIS_METRICS.gap) / 2);
        expect(nearestShapeBoundaryX(BRAVAIS_BLOCK_SHAPE, 2 * getBlockSize(BRAVAIS_METRICS).width + 100))
            .toBe(2 * getBlockSize(BRAVAIS_METRICS).width - BRAVAIS_METRICS.gap / 2);
    });

    it('re-lays in place only when sections were added after the ones shown, on the same origin', () => {
        const opening = SECTIONS.slice(0, 2);
        const before = createExploreShape(opening, { column: 1, row: 0 });
        const after = createExploreShape(SECTIONS, { column: 1, row: 0 });
        expect(isGrownExploreShape(before, after)).toBe(true);
        expect(isGrownExploreShape(after, before)).toBe(false);
        expect(isGrownExploreShape(before, createExploreShape(SECTIONS, { column: 0, row: 0 }))).toBe(false);
        expect(isGrownExploreShape(createExploreShape([SECTIONS[1], SECTIONS[0]], { column: 1, row: 0 }), after)).toBe(false);
        expect(isGrownExploreShape(BRAVAIS_BLOCK_SHAPE, after)).toBe(false);
        // 原点那一列的前几块地不变：磁贴的挂载身份一样，矩形也一样。
        for (const row of [0, 1]) {
            expect(after.blockKey(1, row)).toBe(before.blockKey(1, row));
            expect(after.blockSlots(1, row)).toEqual(before.blockSlots(1, row));
        }
        expect(BRAVAIS_BLOCK_SHAPE.blockKey(1, 0)).not.toBe(after.blockKey(1, 0));
    });

    it('moves a start key off the previous wall once, and takes a remembered one as it is', () => {
        const explore = { kind: 'explore' as const, sections: SECTIONS, headings: [] };
        // 记忆已经搬到这一层的形状上：照用（以前又按旧形状搬一次，探索地上没有第 11 个座位，起点丢了）。
        const fromExplore = createExploreShape(SECTIONS, { column: 0, row: 0 });
        expect(shapeSlotFromKey(fromExplore, '0,0,11')).toBeNull();
        expect(resolveShiftStart({ remembered: '0,0,11' }, fromExplore, undefined)).toEqual({
            key: '0,0,11',
            slot: shapeSlotFromKey(BRAVAIS_BLOCK_SHAPE, '0,0,11'),
        });
        expect(resolveShiftStart({ remembered: '1,0,0' }, BRAVAIS_BLOCK_SHAPE, explore).key).toBe('1,0,0');
        // 旧墙上的 slot：搬到新形状上，翻牌从它在旧墙上的位置开始。
        const moved = resolveShiftStart({ onPrevious: '2,1,3' }, BRAVAIS_BLOCK_SHAPE, explore);
        expect(moved.key).toBe(moveStartSlotKey('2,1,3', BRAVAIS_BLOCK_SHAPE, resolveLayerShape(explore, null)));
        expect(moved.slot).toEqual(shapeSlotFromKey(BRAVAIS_BLOCK_SHAPE, '2,1,3'));
        expect(resolveShiftStart({ onPrevious: null }, BRAVAIS_BLOCK_SHAPE, explore)).toEqual({ key: null, slot: null });
    });

    it('splits a grown re-lay into blocks that remount and kept tiles that flip when their item changed', () => {
        const opening = SECTIONS.slice(0, 2);
        const layerWith = (sections: WallSection[], items: readonly BravaisItem[]): BravaisLayer => ({
            ...exploreLayer(),
            items,
            shape: { kind: 'explore', sections, headings: projectExploreHeadings(sections, t) },
        });
        const items = exploreLayer().items;
        const before = createBravaisDisplay(layerWith(opening, items), '1,0,0');
        const slots = collectShapeSlots(before.shape, {
            left: 0, top: 0, right: EXPLORE_BLOCK_SIZE.width * 3 - 1, bottom: EXPLORE_BLOCK_SIZE.height * 2 - 1,
        });
        const same = createBravaisDisplay(layerWith(SECTIONS, items), '1,0,0');
        const { kept, remounted } = splitGrownSlots(before.shape, same.shape, slots);
        expect(kept.length).toBeGreaterThan(0);
        expect(remounted.length).toBeGreaterThan(0);
        expect(new Set(kept.map(slot => slot.column))).toEqual(new Set([1]));
        expect(kept.every(slot => before.shape.blockKey(slot.column, slot.row) === same.shape.blockKey(slot.column, slot.row))).toBe(true);
        // 条目没变：留在原地的磁贴都不翻。
        expect(diffDisplays(before, same, kept).filter(change => change.from !== change.to)).toEqual([]);
        // 同一序号换了别的条目：只有那一张要翻。
        const target = kept.find(slot => resolveSlotItem(before, slot))!;
        const index = before.shape.entryAt!(target)!;
        const changed = createBravaisDisplay(layerWith(SECTIONS, items.map((entry, at) => (at === index ? item(1000) : entry))), '1,0,0');
        const flips = diffDisplays(before, changed, kept).filter(change => change.from !== change.to);
        expect(flips.length).toBeGreaterThan(0);
        expect(flips.every(change => resolveSlotItem(changed, change.slot)?.key === 'e1000')).toBe(true);
    });

    it('collects the slots of a view by the shape blocks', () => {
        const explore = createExploreShape(SECTIONS, { column: 0, row: 0 });
        const slots = collectShapeSlots(explore, { left: 0, top: 0, right: EXPLORE_BLOCK_SIZE.width * 2 - 1, bottom: EXPLORE_BLOCK_SIZE.height - 1 });
        expect(new Set(slots.map(slot => slot.column))).toEqual(new Set([0, 1]));
        expect(collectShapeSlots(explore, { left: 0, top: 0, right: 5000, bottom: 5000 }, 3)).toHaveLength(3);
    });
});

describe('bravais explore display', () => {
    it('shows entries by seat and headings as heading tiles that are not items', () => {
        const display = createBravaisDisplay(exploreLayer(), '0,0,0');
        expect(display.shape.kind).toBe('explore');
        expect(display.reservedPerBlock).toBe(0);
        const slots = display.shape.blockSlots(0, 0);
        const heading = slots.at(-1)!;
        expect(resolveSlotItem(display, heading)).toBeNull();
        expect(resolveSlotFace(display, heading)).toMatchObject({ kind: 'heading', item: { title: 'A', badge: '01 / 04' } });
        expect(resolveSlotItem(display, slots[0])?.key).toBe(`e${display.shape.entryAt!(slots[0])}`);
        const found = findDisplayItemSlot(display, 'e20', { x: 0, y: 0 });
        expect(found && resolveSlotItem(display, found)?.key).toBe('e20');
    });

    it('moves a start key off a heading or past the lot to the first seat of its block', () => {
        const display = createBravaisDisplay(exploreLayer(), '0,0,2');
        expect(display.startSlotKey).toBe('0,0,2');
        const headingIndex = display.shape.blockSlots(0, 0).length - 1;
        expect(createBravaisDisplay(exploreLayer(), `0,0,${headingIndex}`).startSlotKey).toBe('0,0,0');
        expect(createBravaisDisplay(exploreLayer(), '0,0,11').startSlotKey).toBe('0,0,0');
    });

    it('turns explore tiles into wall items', () => {
        const song = { id: 1, name: 'S', artists: [{ id: 1, name: 'X' }], album: { id: 1, name: 'Al' }, durationMs: 61000 };
        const tiles = [
            // A song of the app's own sections: the tile id is under the section's, the playback key is the song's own.
            { id: 'folia-recent-plays:online:netease:1', kind: 'song', queueIndex: 0, song, title: 'S', artist: 'X', section: 'upcoming', label: 'Song', entryKind: 'song' },
            { id: 'collection:album:9', kind: 'collection', queueIndex: 1, collection: { id: 9 }, title: 'Al', artist: 'X', section: 'upcoming', label: 'Album', entryKind: 'album' },
            { id: 'collection:playlist:3', kind: 'collection', queueIndex: 2, collection: { id: 3 }, title: 'M', artist: '', section: 'upcoming', label: 'Mix', entryKind: 'mix' },
        ] as unknown as LatticeTile[];
        const [track, album, mix] = projectExploreItems(tiles);
        expect(track).toMatchObject({ key: 'folia-recent-plays:online:netease:1', kind: 'track', playbackKey: 'online:netease:1', album: 'Al', artists: ['X'], durationLabel: '1:01', badge: 'Song' });
        expect(album).toMatchObject({ key: 'collection:album:9', kind: 'album', title: 'Al', badge: 'Album' });
        expect(mix.kind).toBe('playlist');
    });
});
