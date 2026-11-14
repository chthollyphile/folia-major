import { describe, expect, it } from 'vitest';
import { shuffledCopy } from '@/utils/shuffledCopy';

// test/unit/utils/shuffledCopy.test.ts
// 集合「随机播放」用的打乱：出一份新数组、元素一个不少，原数组不动。

const sequence = (...draws: number[]) => {
    let index = 0;
    return () => draws[index++ % draws.length];
};

describe('shuffledCopy', () => {
    it('returns a permutation and leaves the input alone', () => {
        const input = [1, 2, 3, 4, 5];
        const output = shuffledCopy(input);
        expect(output).not.toBe(input);
        expect(input).toEqual([1, 2, 3, 4, 5]);
        expect([...output].sort()).toEqual([1, 2, 3, 4, 5]);
    });

    it('swaps from the end with the drawn index (Fisher–Yates)', () => {
        // 全取 0：每一步都和第一个换。
        expect(shuffledCopy(['a', 'b', 'c'], sequence(0))).toEqual(['b', 'c', 'a']);
        // 取到最大：每一步都和自己换，顺序不变。
        expect(shuffledCopy(['a', 'b', 'c'], sequence(0.999))).toEqual(['a', 'b', 'c']);
    });

    it('handles empty and single lists', () => {
        expect(shuffledCopy([])).toEqual([]);
        expect(shuffledCopy(['only'])).toEqual(['only']);
    });
});
