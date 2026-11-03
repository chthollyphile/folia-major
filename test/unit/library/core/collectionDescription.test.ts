import { describe, expect, it } from 'vitest';
import { resolveCollectionDescription } from '@/library/core/collection/collectionDescription';

// test/unit/library/core/collectionDescription.test.ts
// 集合页描述的取法：详情盖在集合描述上（与网格信息面板的合并规则一致），只去首尾空白。

describe('resolveCollectionDescription', () => {
    it('falls back to the descriptor when there is no detail', () => {
        expect(resolveCollectionDescription({ description: 'From the list' }, null)).toBe('From the list');
    });

    it('prefers the detail description', () => {
        expect(resolveCollectionDescription({ description: 'From the list' }, { description: 'From the detail' })).toBe('From the detail');
    });

    it('keeps the descriptor when the detail has no description field', () => {
        expect(resolveCollectionDescription({ description: 'From the list' }, {})).toBe('From the list');
    });

    it('follows the grid merge when the detail carries an empty description', () => {
        expect(resolveCollectionDescription({ description: 'From the list' }, { description: undefined })).toBeUndefined();
        expect(resolveCollectionDescription({ description: 'From the list' }, { description: '' })).toBeUndefined();
    });

    it('trims outer whitespace and keeps inner line breaks', () => {
        expect(resolveCollectionDescription(undefined, { description: '\n  First line\nSecond line  \n' })).toBe('First line\nSecond line');
        expect(resolveCollectionDescription({ description: '   ' }, null)).toBeUndefined();
    });
});
