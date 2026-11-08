import { describe, expect, it } from 'vitest';
import {
    changesOf,
    defaultDraftOf,
    draftOf,
    ratioSide,
    snapRatio,
} from '@/components/recommendationPreferences/preferenceDraft';
import type { RecommendationPreferenceItem, RecommendationPreferenceRatio } from '@/types/onlineMusic';

// test/unit/recommendationPreferences/preferenceDraft.test.ts
// 偏好面板的草稿：读到的值、重置成默认、比例的吸附、只交改动过且合法的项、比例在默认的哪一边。

const ratio: RecommendationPreferenceRatio = {
    kind: 'ratio', key: 'live', label: { labelFallback: 'Live' }, min: 1, max: 99, defaultValue: 50, snapWithin: 4, value: 70,
};
const items: RecommendationPreferenceItem[] = [
    {
        kind: 'choice',
        key: 'mood',
        label: { labelFallback: 'Mood' },
        options: [{ value: 'sad', label: { labelFallback: 'Sad' } }, { value: 'same', label: { labelFallback: 'Same' } }],
        value: 'sad',
        defaultValue: 'same',
    },
    ratio,
];

describe('preference draft', () => {
    it('starts from what was read, and resets to the defaults', () => {
        expect(draftOf(items)).toEqual({ mood: 'sad', live: 70 });
        expect(defaultDraftOf(items)).toEqual({ mood: 'same', live: 50 });
    });

    it('snaps a ratio near its default onto it, and keeps it in range', () => {
        expect(snapRatio(ratio, 46)).toBe(50);
        expect(snapRatio(ratio, 54)).toBe(50);
        expect(snapRatio(ratio, 45)).toBe(45);
        expect(snapRatio(ratio, 120)).toBe(99);
        expect(snapRatio({ ...ratio, snapWithin: undefined }, 51)).toBe(51);
    });

    it('hands over only what changed and is a value the item takes', () => {
        expect(changesOf(items, { mood: 'sad', live: 70 })).toEqual({});
        expect(changesOf(items, { mood: 'same', live: 60 })).toEqual({ mood: 'same', live: 60 });
        expect(changesOf(items, { mood: 'angry', live: 300 })).toEqual({});
        expect(changesOf(items, { live: 50 })).toEqual({ live: 50 });
    });

    it('copies and changes __proto__ as an own preference key', () => {
        const item = { ...ratio, key: '__proto__' };
        const draft = draftOf([item]);
        expect(Object.keys(draft)).toEqual(['__proto__']);
        expect(draft.__proto__).toBe(70);
        const defaults = defaultDraftOf([item]);
        expect(defaults.__proto__).toBe(50);
        expect(Object.entries(changesOf([item], defaults))).toEqual([['__proto__', 50]]);
    });

    it('says which side of the default a ratio is on', () => {
        expect(ratioSide(ratio, 30)).toBe('less');
        expect(ratioSide(ratio, 50)).toBe('default');
        expect(ratioSide(ratio, 80)).toBe('more');
    });
});
