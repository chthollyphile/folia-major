import { describe, expect, it } from 'vitest';
import { planFlip } from '@/components/wall/flipPlan';
import { getBlockSlots, getWallSlot } from '@/components/wall/wallSlots';
import type { BravaisItem, BravaisLayer } from '@/library/suites/bravais/bravaisLayer';
import {
    createBravaisDisplay,
    diffDisplays,
    findItemSlotNear,
    findNearestSlot,
    pointOrigin,
    resolveSlotItem,
    resolveFocusReflow,
    resolveTileTransition,
    toFlipSteps,
} from '@/library/suites/bravais/bravaisDisplay';

// test/unit/library/bravais/bravaisDisplay.test.ts
// 墙上每个 slot 显示哪一项（无限拼贴 + 起点磁贴）、换层前后的翻牌比较、单张磁贴的翻牌状态机（纯部分）、
// 找最近的 slot / 某一项最近的一份、聚焦卡的块内让位（块外不动、key 不变）。

const metrics = { cellSize: 128, gap: 8 };
const items = (prefix: string, count: number): BravaisItem[] => Array.from({ length: count }, (_, index) => ({
    key: `${prefix}${index}`,
    kind: 'track',
    title: `${prefix}${index}`,
    subtitle: '',
    badge: String(index + 1),
}));
const layer = (key: string, entries: BravaisItem[]): BravaisLayer => ({
    key,
    sessionKey: key,
    surface: 'collection',
    mode: 'infinite',
    items: entries,
    seam: { title: key, crumb: key, meta: '' },
    isInteractive: true,
    focusedEntryKey: null,
    nowPlayingKey: null,
    queuedKeys: new Set(),
});
const block = (column: number, row: number) => getBlockSlots(column, row, metrics);

describe('infinite wall with a start tile', () => {
    it('shows item 0 on the start slot, and keeps it there when the item count changes', () => {
        const start = getWallSlot(2, -1, 5, metrics)!;
        const display = createBravaisDisplay(layer('a', items('t', 17)), start.key);
        expect(resolveSlotItem(display, start)?.key).toBe('t0');
        // 补页后条目数变了：重新求循环偏移，起点仍是第 1 项。
        const grown = createBravaisDisplay(layer('a', items('t', 40)), start.key);
        expect(resolveSlotItem(grown, start)?.key).toBe('t0');
    });

    it('shows bare wall for an empty layer and no layer', () => {
        const slot = getWallSlot(0, 0, 0, metrics)!;
        expect(resolveSlotItem(createBravaisDisplay(layer('a', []), null), slot)).toBeNull();
        expect(resolveSlotItem(null, slot)).toBeNull();
    });

    it('repeats every item at least once in a block field larger than the list', () => {
        const display = createBravaisDisplay(layer('a', items('t', 10)), null);
        const shown = new Set(block(0, 0).concat(block(1, 0)).map(slot => resolveSlotItem(display, slot)?.key));
        for (let index = 0; index < 10; index += 1) expect(shown.has(`t${index}`)).toBe(true);
    });
});

describe('flip planning between two displays', () => {
    it('diffs what each rendered slot shows before and after', () => {
        const slots = block(0, 0);
        const before = createBravaisDisplay(layer('home', items('c', 5)), null);
        const after = createBravaisDisplay(layer('a', items('t', 5)), slots[3].key);
        const changes = diffDisplays(before, after, slots);
        expect(changes).toHaveLength(12);
        expect(changes[3]).toMatchObject({ from: resolveSlotItem(before, slots[3])?.key, to: 't0' });
        expect(diffDisplays(null, after, slots).every(change => change.from === null)).toBe(true);
    });

    it('turns a flip plan into per-slot steps that carry the token', () => {
        const slots = block(0, 0);
        const before = createBravaisDisplay(layer('home', items('c', 5)), null);
        const after = createBravaisDisplay(layer('a', items('t', 5)), slots[0].key);
        const plan = planFlip({
            changes: diffDisplays(before, after, slots),
            origin: pointOrigin({ x: slots[0].centerX, y: slots[0].centerY }),
            visible: { left: -1e4, right: 1e4, top: -1e4, bottom: 1e4 },
            metrics,
        });
        const steps = toFlipSteps(7, plan);
        expect(steps.get(slots[0].key)).toMatchObject({ token: 7, to: 't0', delay: 0 });
        expect([...steps.values()].every(step => step.token === 7)).toBe(true);
        expect(createBravaisDisplay(after.layer, after.startSlotKey, { token: 7, plan }).flips).toEqual(steps);
    });
});

describe('tile transition (the pure half of the flip state machine)', () => {
    const step = { token: 1, to: 'b', delay: 40, direction: 1 as const };

    it('does nothing when the tile already shows its target', () => {
        expect(resolveTileTransition('a', 'a', step, false)).toBe('none');
        expect(resolveTileTransition(null, null, undefined, false)).toBe('none');
    });

    it('flips only for the planned target; reduced motion fades the same planned tiles (B11)', () => {
        expect(resolveTileTransition('a', 'b', step, false)).toBe('flip');
        expect(resolveTileTransition('a', 'b', step, true)).toBe('fade');
        expect(resolveTileTransition('a', 'c', step, true)).toBe('swap');
        expect(resolveTileTransition('a', 'b', undefined, true)).toBe('swap');
        expect(resolveTileTransition('a', 'c', step, false)).toBe('swap');
        expect(resolveTileTransition('a', 'b', undefined, false)).toBe('swap');
        expect(resolveTileTransition('a', null, { ...step, to: null }, false)).toBe('flip');
    });
});

describe('finding slots', () => {
    it('picks the slot nearest to a point, honouring a filter', () => {
        const slots = block(0, 0);
        const target = slots[7];
        expect(findNearestSlot(slots, { x: target.centerX, y: target.centerY })).toBe(target);
        expect(findNearestSlot(slots, { x: target.centerX, y: target.centerY }, slot => slot !== target)).not.toBe(target);
        expect(findNearestSlot([], { x: 0, y: 0 })).toBeNull();
    });

    it('finds the copy of an item nearest to the seam point', () => {
        const display = createBravaisDisplay(layer('a', items('t', 30)), null);
        const point = { x: 0, y: 0 };
        const slot = findItemSlotNear(display, 't3', point);
        expect(slot && resolveSlotItem(display, slot)?.key).toBe('t3');
        expect(findItemSlotNear(display, 'missing', point)).toBeNull();
    });
});

describe('focus card reflow', () => {
    it('re-gears only the focused block and keeps every slot key', () => {
        const focused = getWallSlot(1, 2, 4, metrics)!;
        const reflow = resolveFocusReflow(focused.key);
        expect(reflow.size).toBe(12);
        expect([...reflow.keys()].sort()).toEqual(block(1, 2).map(slot => slot.key).sort());
        const card = reflow.get(focused.key)!;
        expect(card.width).toBe(6 * 136 - 8);
        expect(card.height).toBe(6 * 136 - 8);
        expect(resolveFocusReflow(null).size).toBe(0);
    });
});
