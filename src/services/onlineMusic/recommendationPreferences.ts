import type {
    RecommendationPreferenceChanges,
    RecommendationPreferenceChoice,
    RecommendationPreferenceEntry,
    RecommendationPreferenceItem,
    RecommendationPreferenceLabel,
    RecommendationPreferenceRatio,
    RecommendationPreferences,
} from '../../types/onlineMusic';

// src/services/onlineMusic/recommendationPreferences.ts
// 推荐偏好（能力 `recommendationPreferences`）的共用整理：平台交来的偏好项、入口和要保存的改动，在 omni 里过一遍再交给界面或平台。
// 不认识的种类、缺字段的项、重复的 key 都丢掉；比例的值夹回范围里；选项式的值不在选项里时退回默认。不认任何平台。

/** 界面认得的入口，按这个顺序。 */
export const RECOMMENDATION_PREFERENCE_ENTRIES: readonly RecommendationPreferenceEntry[] = ['explore', 'personal-fm', 'daily'];

const isRecord = (value: unknown): value is Record<string, unknown> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const labelOf = (value: unknown): RecommendationPreferenceLabel | null => {
    if (!isRecord(value) || typeof value.labelFallback !== 'string') return null;
    return typeof value.labelKey === 'string' && value.labelKey
        ? { labelKey: value.labelKey, labelFallback: value.labelFallback }
        : { labelFallback: value.labelFallback };
};

const choiceOf = (raw: Record<string, unknown>, key: string, label: RecommendationPreferenceLabel): RecommendationPreferenceChoice | null => {
    if (!Array.isArray(raw.options)) return null;
    const options: RecommendationPreferenceChoice['options'] = [];
    for (const option of raw.options) {
        if (!isRecord(option) || typeof option.value !== 'string') continue;
        const optionLabel = labelOf(option.label);
        if (!optionLabel || options.some(kept => kept.value === option.value)) continue;
        options.push({ value: option.value, label: optionLabel });
    }
    // 少于两个选项就没得选。
    if (options.length < 2) return null;
    const has = (value: unknown): value is string => typeof value === 'string' && options.some(option => option.value === value);
    if (!has(raw.defaultValue)) return null;
    const value = has(raw.value) ? raw.value : raw.defaultValue;
    return { kind: 'choice', key, label, options, value, defaultValue: raw.defaultValue };
};

const ratioOf = (raw: Record<string, unknown>, key: string, label: RecommendationPreferenceLabel): RecommendationPreferenceRatio | null => {
    const { min, max, defaultValue } = raw;
    if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(defaultValue)) return null;
    const low = min as number;
    const high = max as number;
    const middle = defaultValue as number;
    if (!(low < high) || middle < low || middle > high) return null;
    const value = Number.isFinite(raw.value) ? Math.min(high, Math.max(low, raw.value as number)) : middle;
    const snapWithin = Number.isFinite(raw.snapWithin) && (raw.snapWithin as number) > 0 ? raw.snapWithin as number : undefined;
    return { kind: 'ratio', key, label, min: low, max: high, defaultValue: middle, ...(snapWithin === undefined ? {} : { snapWithin }), value };
};

/** 平台交来的偏好：留下认得、完整的项（同一个 key 只留第一项），没有说明行就不带。 */
export const normalizeRecommendationPreferences = (answer: unknown): RecommendationPreferences => {
    const items: RecommendationPreferenceItem[] = [];
    const rawItems = isRecord(answer) && Array.isArray(answer.items) ? answer.items : [];
    for (const raw of rawItems) {
        if (!isRecord(raw) || typeof raw.key !== 'string' || !raw.key) continue;
        if (items.some(item => item.key === raw.key)) continue;
        const label = labelOf(raw.label);
        if (!label) continue;
        const item = raw.kind === 'choice' ? choiceOf(raw, raw.key, label)
            : raw.kind === 'ratio' ? ratioOf(raw, raw.key, label)
                : null;
        if (item) items.push(item);
    }
    const note = isRecord(answer) ? labelOf(answer.note) : null;
    return note ? { items, note } : { items };
};

/** 平台声明的入口：只留认得的，去重，按固定顺序。 */
export const readRecommendationPreferenceEntries = (declared: unknown): RecommendationPreferenceEntry[] => {
    const list: readonly unknown[] = Array.isArray(declared) ? declared : [];
    return RECOMMENDATION_PREFERENCE_ENTRIES.filter(entry => list.includes(entry));
};

/** 要保存的改动：key 不能空，值是字符串或有限的数，否则是调用方写错了。 */
export const checkRecommendationPreferenceChanges = (changes: RecommendationPreferenceChanges): RecommendationPreferenceChanges => {
    if (!isRecord(changes)) throw new TypeError('Recommendation preference changes must be an object');
    const entries = Object.entries(changes);
    for (const [key, value] of entries) {
        if (!key) throw new TypeError('A recommendation preference change has no key');
        if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
            throw new TypeError(`Recommendation preference change ${key} is neither a string nor a finite number`);
        }
    }
    return Object.fromEntries(entries);
};
