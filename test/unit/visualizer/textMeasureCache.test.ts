import { describe, expect, it } from 'vitest';
import { measurePrefixOffsets, rememberBounded } from '@/utils/textMeasureCache';

// test/unit/visualizer/textMeasureCache.test.ts
// 共用的前缀偏移循环与有界缓存必须与各模式原来手写的版本逐位一致：前缀按整段测量（保留字距 / 连字），
// 缓存满时先淘汰最早插入的一项。

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemesOf = (text: string) => Array.from(segmenter.segment(text), ({ segment }) => segment);

// A deliberately non-additive measurer: whole-prefix width differs from the sum of glyph widths, the way
// kerning and ligatures make real text differ, so a per-glyph shortcut would be caught.
const fakeWidth = (text: string) => {
    let width = 0;
    for (const char of text) width += char.codePointAt(0)! % 17 + 3;
    return width - (text.match(/AV|fi|。/g)?.length ?? 0) * 1.5;
};

/** The loop Monet / Fume used before the extraction. */
const legacyOffsets = (graphemes: string[], measure: (prefix: string) => number) => {
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    for (let index = 1; index <= graphemes.length; index += 1) {
        offsets[index] = measure(graphemes.slice(0, index).join(''));
    }
    return offsets;
};

/** Claddagh's loop before the extraction: fallback accumulation, tracking and a monotonic max. */
const legacyCladdaghOffsets = (graphemes: string[], fontPx: number, spacing: number) => {
    const offsets = new Array<number>(graphemes.length + 1).fill(0);
    let fallbackWidth = 0;
    for (let index = 1; index <= graphemes.length; index += 1) {
        fallbackWidth += fontPx * 0.62;
        const baseTracking = Math.max(0, index - 1) * fontPx * 0.18;
        const extraOffset = Math.max(0, index - 1) * spacing;
        offsets[index] = Math.max(offsets[index - 1], (fakeWidth(graphemes.slice(0, index).join('')) || fallbackWidth) + baseTracking + extraOffset);
    }
    return offsets;
};

const samples = ['AVfine waves', '天空很蓝。我们走吧', '👨‍👩‍👧 family 🇯🇵', 'mixed 中英 text, 好的 ok', ''];

describe('measurePrefixOffsets', () => {
    it.each(samples)('matches the legacy prefix loop for %j', text => {
        const graphemes = graphemesOf(text);
        expect(measurePrefixOffsets(graphemes, fakeWidth)).toEqual(legacyOffsets(graphemes, fakeWidth));
    });

    it.each(samples)('matches the legacy claddagh loop for %j', text => {
        const graphemes = graphemesOf(text);
        const fontPx = 24;
        let fallbackWidth = 0;
        const offsets = measurePrefixOffsets(graphemes, (prefix, index, previous) => {
            fallbackWidth += fontPx * 0.62;
            const baseTracking = Math.max(0, index - 1) * fontPx * 0.18;
            const extraOffset = Math.max(0, index - 1) * 3;
            return Math.max(previous, (fakeWidth(prefix) || fallbackWidth) + baseTracking + extraOffset);
        });
        expect(offsets).toEqual(legacyCladdaghOffsets(graphemes, fontPx, 3));
    });

    it('measures whole prefixes, one call per grapheme, in order', () => {
        const prefixes: string[] = [];
        measurePrefixOffsets(graphemesOf('a👍🏽b'), prefix => {
            prefixes.push(prefix);
            return prefix.length;
        });
        expect(prefixes).toEqual(['a', 'a👍🏽', 'a👍🏽b']);
    });
});

describe('rememberBounded', () => {
    it('evicts the oldest entry only when a new key would exceed the limit', () => {
        const cache = new Map<string, number>();
        rememberBounded(cache, 'a', 1, 2);
        rememberBounded(cache, 'b', 2, 2);
        expect(rememberBounded(cache, 'c', 3, 2)).toBe(3);
        expect([...cache.keys()]).toEqual(['b', 'c']);
        rememberBounded(cache, 'c', 4, 2);
        expect([...cache.entries()]).toEqual([['b', 2], ['c', 4]]);
    });

    it('keeps the same contents as the legacy set-then-trim pattern for fresh keys', () => {
        const legacy = new Map<string, number>();
        const shared = new Map<string, number>();
        for (let index = 0; index < 10; index += 1) {
            legacy.set(`k${index}`, index);
            if (legacy.size > 4) legacy.delete(legacy.keys().next().value!);
            rememberBounded(shared, `k${index}`, index, 4);
        }
        expect([...shared.entries()]).toEqual([...legacy.entries()]);
    });
});
