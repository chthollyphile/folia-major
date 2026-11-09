import { describe, expect, it } from 'vitest';
import { moveBlockToIndex, rebaseOrder } from '../../../src/components/app/scratchpad/queueOrder';

// test/unit/scratchpad/queueOrder.test.ts
// 速记簿「播放队列」展开视图的整块挪动，以及草稿接到换了对象的新队列上。

const items = ['a', 'b', 'c', 'd', 'e'];

describe('moveBlockToIndex', () => {
    it('moves one card down and up', () => {
        expect(moveBlockToIndex(items, [0], 2)).toEqual(['b', 'c', 'a', 'd', 'e']);
        expect(moveBlockToIndex(items, [4], 1)).toEqual(['a', 'e', 'b', 'c', 'd']);
        expect(moveBlockToIndex(items, [1], 4)).toEqual(['a', 'c', 'd', 'e', 'b']);
        expect(moveBlockToIndex(items, [3], 0)).toEqual(['d', 'a', 'b', 'c', 'e']);
    });

    it('moves scattered cards together, keeping their order', () => {
        expect(moveBlockToIndex(items, [3, 0], 3)).toEqual(['b', 'c', 'e', 'a', 'd']);
        expect(moveBlockToIndex(items, [4, 1], 0)).toEqual(['b', 'e', 'a', 'c', 'd']);
        expect(moveBlockToIndex(items, [0, 4], 1)).toEqual(['b', 'a', 'e', 'c', 'd']);
    });

    it('clamps the target and returns the same array when nothing changes', () => {
        expect(moveBlockToIndex(items, [0], 99)).toEqual(['b', 'c', 'd', 'e', 'a']);
        expect(moveBlockToIndex(items, [1, 2], 1)).toBe(items);
        expect(moveBlockToIndex(items, [], 2)).toBe(items);
        expect(moveBlockToIndex(items, [9, -1], 2)).toBe(items);
    });

    it('keeps duplicate occurrences apart', () => {
        const song = { id: 1 };
        const other = { id: 2 };
        expect(moveBlockToIndex([song, other, song], [2], 0)).toEqual([song, song, other]);
    });
});

describe('rebaseOrder', () => {
    type Item = { key: string };
    const keyOf = (item: Item) => item.key;
    const a = { key: 'a' };
    const b = { key: 'b' };
    const c = { key: 'c' };

    it('swaps in the new objects when only an entry was replaced', () => {
        const base = [a, b, c];
        const freshB = { key: 'b' };
        const next = [a, freshB, c];
        expect(rebaseOrder(base, [c, b, a], next, keyOf)).toEqual([c, freshB, a]);
        expect(rebaseOrder(base, [c, b, a], next, keyOf)?.[1]).toBe(freshB);
    });

    it('gives the draft back as it is when the queue is the same array', () => {
        const base = [a, b, c];
        const order = [b, a, c];
        expect(rebaseOrder(base, order, base, keyOf)).toBe(order);
    });

    it('gives up when the queue really changed', () => {
        const base = [a, b, c];
        expect(rebaseOrder(base, [c, b, a], [a, b], keyOf)).toBeNull();
        expect(rebaseOrder(base, [c, b, a], [b, a, c], keyOf)).toBeNull();
        expect(rebaseOrder(base, [c, b, a], [a, b, { key: 'd' }], keyOf)).toBeNull();
    });
});
