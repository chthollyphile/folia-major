import type { DailyStyleGroup, DailyStyleSelection } from '../../../types/onlineMusic';

// src/library/core/collection/dailyStyle.ts
// 每日推荐的风格推荐（#938）在选择器里的两条规则，网格和 Bravais 共用：选中的风格怎么写成一行字，
// 点一个风格之后选择变成什么样（一次只能选同一组里的风格，点了别的组的风格就从那一组重新选）。

/** 选中的风格写成「电音 · 二次元」；分组还没取到时认不出名字的风格不写，一个都认不出时返回 ''。 */
export const describeDailyStyle = (
    groups: readonly DailyStyleGroup[],
    selection: DailyStyleSelection | null,
): string => {
    if (!selection) return '';
    const tags = groups.find(group => group.id === selection.groupId)?.tags ?? [];
    return selection.tagIds
        .map(id => tags.find(tag => tag.id === id)?.name)
        .filter((name): name is string => Boolean(name))
        .join(' · ');
};

/** 点了 groupId 组里的 tagId：同组的选中就取消、没选中就加上；别的组的风格换成只有它。 */
export const toggleDailyStyleTag = (
    selection: DailyStyleSelection | null,
    groupId: string,
    tagId: string,
): DailyStyleSelection => {
    if (!selection || selection.groupId !== groupId) return { groupId, tagIds: [tagId] };
    return selection.tagIds.includes(tagId)
        ? { groupId, tagIds: selection.tagIds.filter(id => id !== tagId) }
        : { groupId, tagIds: [...selection.tagIds, tagId] };
};

/** 两个选择是不是同一组的同一些风格（不看顺序）。 */
export const sameDailyStyle = (left: DailyStyleSelection | null, right: DailyStyleSelection | null): boolean => {
    if (!left || !right) return left === right;
    return left.groupId === right.groupId
        && left.tagIds.length === right.tagIds.length
        && left.tagIds.every(id => right.tagIds.includes(id));
};
