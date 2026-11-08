import type {
    RecommendationPreferenceChanges,
    RecommendationPreferenceItem,
    RecommendationPreferenceRatio,
} from '../../types/onlineMusic';

// src/components/recommendationPreferences/preferenceDraft.ts
// 偏好面板的草稿：打开时读到的值，加上还没保存的改动。纯函数，store 和面板都用它。

/** 每一项现在在面板上的值，按 key。 */
export type PreferenceDraft = Record<string, string | number>;

/** 读到的值原样做成草稿。 */
export const draftOf = (items: readonly RecommendationPreferenceItem[]): PreferenceDraft => (
    Object.fromEntries(items.map(item => [item.key, item.value]))
);

/** 「重置」要提交的草稿：每一项回到默认值。 */
export const defaultDraftOf = (items: readonly RecommendationPreferenceItem[]): PreferenceDraft => (
    Object.fromEntries(items.map(item => [item.key, item.defaultValue]))
);

/** 比例拖到的值：夹回范围里，离默认够近就算默认。 */
export const snapRatio = (item: RecommendationPreferenceRatio, value: number): number => {
    const inRange = Math.min(item.max, Math.max(item.min, value));
    return item.snapWithin !== undefined && Math.abs(inRange - item.defaultValue) <= item.snapWithin
        ? item.defaultValue
        : inRange;
};

/** 草稿里这一项的值能不能交出去：选项式要是它的一个选项，比例要在范围里。 */
const isValueOf = (item: RecommendationPreferenceItem, value: string | number | undefined): boolean => (
    item.kind === 'choice'
        ? typeof value === 'string' && item.options.some(option => option.value === value)
        : typeof value === 'number' && Number.isFinite(value) && value >= item.min && value <= item.max
);

/** 和读到的值不一样、而且值合法的项：保存只交这些。 */
export const changesOf = (items: readonly RecommendationPreferenceItem[], draft: PreferenceDraft): RecommendationPreferenceChanges => {
    const entries: [string, string | number][] = [];
    for (const item of items) {
        if (!Object.hasOwn(draft, item.key)) continue;
        const value = draft[item.key];
        if (value === undefined || value === item.value || !isValueOf(item, value)) continue;
        entries.push([item.key, value]);
    }
    return Object.fromEntries(entries);
};

/** 比例的值在默认的哪一边：滑杆旁显示「减少推荐 / 默认 / 增加推荐」。 */
export const ratioSide = (item: RecommendationPreferenceRatio, value: number): 'less' | 'default' | 'more' => (
    value < item.defaultValue ? 'less' : value > item.defaultValue ? 'more' : 'default'
);
