import { describe, expect, it } from 'vitest';
import { describeDailyStyle, sameDailyStyle, toggleDailyStyleTag } from '@/library/core/collection/dailyStyle';

// test/unit/library/core/dailyStyle.test.ts
// 风格推荐（#938）选择器的两条规则：选中的风格写成一行字，点一个风格之后的选择（一次只选一组）。

const groups = [
    { id: '1000', name: '曲风', tags: [{ id: '10004', name: '电音' }, { id: '10015', name: '二次元' }] },
    { id: '3000', name: '情绪', tags: [{ id: '30001', name: '伤感' }] },
];

describe('daily style picks', () => {
    it('names the picked styles in pick order, leaving out ones it cannot name', () => {
        expect(describeDailyStyle(groups, { groupId: '1000', tagIds: ['10015', '10004'] })).toBe('二次元 · 电音');
        expect(describeDailyStyle(groups, { groupId: '1000', tagIds: ['99999'] })).toBe('');
        expect(describeDailyStyle([], { groupId: '1000', tagIds: ['10004'] })).toBe('');
        expect(describeDailyStyle(groups, null)).toBe('');
    });

    it('adds and removes within a group, and starts over in another group', () => {
        const one = toggleDailyStyleTag(null, '1000', '10004');
        expect(one).toEqual({ groupId: '1000', tagIds: ['10004'] });
        const two = toggleDailyStyleTag(one, '1000', '10015');
        expect(two).toEqual({ groupId: '1000', tagIds: ['10004', '10015'] });
        expect(toggleDailyStyleTag(two, '1000', '10004')).toEqual({ groupId: '1000', tagIds: ['10015'] });
        expect(toggleDailyStyleTag(two, '3000', '30001')).toEqual({ groupId: '3000', tagIds: ['30001'] });
    });

    it('compares picks without regard to order', () => {
        expect(sameDailyStyle({ groupId: '1000', tagIds: ['1', '2'] }, { groupId: '1000', tagIds: ['2', '1'] })).toBe(true);
        expect(sameDailyStyle({ groupId: '1000', tagIds: ['1'] }, { groupId: '3000', tagIds: ['1'] })).toBe(false);
        expect(sameDailyStyle(null, null)).toBe(true);
        expect(sameDailyStyle(null, { groupId: '1000', tagIds: ['1'] })).toBe(false);
    });
});
