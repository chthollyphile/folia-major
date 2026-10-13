import { describe, expect, it } from 'vitest';

// test/unit/onlineMusic/qqCategoryNormalize.test.ts
// 分类筛选的映射判据来自 2026-10-08 对真实响应的实测：`response.data.categories` 里每组带
// `categoryGroupName` 与 `items[]`（`categoryId` 是数字字符串、`categoryName` 是中文名，
// 且上游会把 `&` 写成 HTML 实体 `&#38;`）。id 一律原样字符串化，不做任何拆解。

import { toQqCategoryGroups } from '@/services/onlineMusic/qqProvider';

// 实测形状（节选自 2026-10-08 的 getSongListCategories 响应）
const REAL_SHAPE = {
    response: {
        code: 0,
        data: {
            categories: [
                {
                    categoryGroupName: '语种',
                    items: [
                        { categoryId: 165, categoryName: '国语' },
                        { categoryId: 167, categoryName: '英语' },
                    ],
                },
                {
                    categoryGroupName: '流派',
                    items: [
                        { categoryId: 5, categoryName: '流行' },
                        { categoryId: 19, categoryName: 'R&#38;B' },
                    ],
                },
                { categoryGroupName: '空组', items: [] },
            ],
        },
    },
};

describe('QQ category tree normalization', () => {
    it('maps groups and items, keeping upstream ids as strings', () => {
        const groups = toQqCategoryGroups(REAL_SHAPE);

        expect(groups).toHaveLength(2);
        expect(groups[0]).toMatchObject({
            label: '语种',
            items: [{ id: '165', label: '国语' }, { id: '167', label: '英语' }],
        });
        // id 必须是字符串：上游给的是数字，但它是上游的内部键，拆开就丢了连续性
        expect(groups[1].items[0].id).toBe('5');
    });

    it('decodes HTML entities in labels (R&amp;B → R&B)', () => {
        const groups = toQqCategoryGroups(REAL_SHAPE);
        const rnb = groups[1].items.find(item => item.id === '19');
        expect(rnb?.label).toBe('R&B');
    });

    it('drops groups with no items instead of showing an empty shell', () => {
        const groups = toQqCategoryGroups(REAL_SHAPE);
        expect(groups.some(group => group.label === '空组')).toBe(false);
    });

    it('returns an empty tree for a malformed payload', () => {
        expect(toQqCategoryGroups({})).toEqual([]);
        expect(toQqCategoryGroups({ response: { data: {} } })).toEqual([]);
        expect(toQqCategoryGroups(null)).toEqual([]);
    });
});
