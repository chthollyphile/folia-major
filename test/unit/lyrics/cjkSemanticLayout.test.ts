import { describe, expect, it, vi } from 'vitest';
import type { Word } from '@/types';
import {
    buildCjkSemanticLayoutUnits,
    buildDisplayWordsFromLayoutUnits,
    buildPostLyricLayoutUnits,
    createSingleWordLayoutUnits,
} from '@/utils/lyrics/cjkSemanticLayout';

// test/unit/lyrics/cjkSemanticLayout.test.ts
// Verifies CJK layout grouping while preserving original word timing.

const createCharacterWords = (text: string): Word[] => Array.from(text).map((char, index) => ({
    text: char,
    startTime: index,
    endTime: index + 0.5,
}));

const createTokenWords = (tokens: string[]): Word[] => tokens.map((token, index) => ({
    text: token,
    startTime: index,
    endTime: index + 0.5,
}));

describe('buildCjkSemanticLayoutUnits', () => {
    it('groups a CJK word while preserving per-character timing', () => {
        const words = createCharacterWords('世界');
        const units = buildCjkSemanticLayoutUnits({ fullText: '世界', words });

        expect(units).toHaveLength(1);
        expect(units[0].text).toBe('世界');
        expect(units[0].words).toEqual(words);
        expect(units[0].startTime).toBe(0);
        expect(units[0].endTime).toBe(1.5);
        expect(units[0].isSemantic).toBe(true);
    });

    it('keeps common Chinese words together for layout', () => {
        const fullText = '编织那没有诗意，却能将你带到现实的神文之诗。';
        const units = buildCjkSemanticLayoutUnits({
            fullText,
            words: createCharacterWords(fullText),
        });
        const unitTexts = units.map(unit => unit.text);

        expect(unitTexts).toContain('编织');
        expect(unitTexts).toContain('没有');
        expect(unitTexts).toContain('诗意，');
        expect(unitTexts).toContain('现实');
        expect(units.find(unit => unit.text === '现实')?.words.map(word => word.text)).toEqual(['现', '实']);
    });

    it('maps common Japanese preview segments', () => {
        const fullText = '詩情を持たずとも、あなたを現実へと導くその神文の詩を紡ぐ。';
        const units = buildCjkSemanticLayoutUnits({
            fullText,
            words: createCharacterWords(fullText),
        });
        const unitTexts = units.map(unit => unit.text);

        expect(unitTexts).toContain('詩情');
        expect(unitTexts).toContain('あなた');
        expect(unitTexts).toContain('現実');
        expect(units.find(unit => unit.text === 'あなた')?.words.map(word => word.text)).toEqual(['あ', 'な', 'た']);
    });

    it('leaves non-CJK tokenized lyrics unchanged', () => {
        const words = createTokenWords(['Weave', 'that', 'prosaic', 'divine', 'poem']);
        const units = buildCjkSemanticLayoutUnits({
            fullText: 'Weave that prosaic divine poem',
            words,
        });

        expect(units.map(unit => unit.text)).toEqual(words.map(word => word.text));
        expect(units.every(unit => unit.words.length === 1 && !unit.isSemantic)).toBe(true);
    });

    it('falls back when Intl.Segmenter is unavailable', () => {
        vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });

        try {
            const words = createCharacterWords('世界');
            const units = buildCjkSemanticLayoutUnits({ fullText: '世界', words });

            expect(units.map(unit => unit.text)).toEqual(['世', '界']);
            expect(units.every(unit => unit.words.length === 1 && !unit.isSemantic)).toBe(true);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('aligns word-by-word lyrics whose words carry the line spaces (#990)', () => {
        // YRC/QRC glue a line's spaces onto the syllable before them.
        const words = createTokenWords(['四', '季', '日', '月', '的', '更', '迭  ', '都', '只', '在', '你  ', '一', '眼', '之', '间']);
        const fullText = '四季日月的更迭  都只在你  一眼之间';
        const units = buildCjkSemanticLayoutUnits({
            fullText,
            words,
            autoWordSegments: ['四季', '日月的', '更迭', '  ', '都', '只', '在', '你', '  ', '一眼', '之间'],
        });

        expect(units.map(unit => unit.text)).toEqual(['四季', '日月的', '更迭  ', '都', '只', '在', '你  ', '一眼', '之间']);
        expect(units.flatMap(unit => unit.words)).toEqual(words);
        expect(units.find(unit => unit.text === '更迭  ')).toMatchObject({ isSemantic: true, startTime: 5, endTime: 6.5 });
    });

    it('keeps whitespace-only words with the unit before them', () => {
        const words = createTokenWords(['世', '界', ' ', '你', '好']);
        const units = buildCjkSemanticLayoutUnits({
            fullText: '世界 你好',
            words,
            autoWordSegments: ['世界', ' ', '你好'],
        });

        expect(units.map(unit => unit.text)).toEqual(['世界 ', '你好']);
        expect(units.map(unit => unit.words.map(word => word.text))).toEqual([['世', '界', ' '], ['你', '好']]);
        expect(units.every(unit => unit.isSemantic)).toBe(true);
    });

    it('falls back when fullText cannot be aligned to words', () => {
        const words = createCharacterWords('世界');
        const units = buildCjkSemanticLayoutUnits({ fullText: '世界啊', words });

        expect(units.map(unit => unit.text)).toEqual(['世', '界']);
        expect(units.every(unit => unit.words.length === 1 && !unit.isSemantic)).toBe(true);
    });
});

describe('buildPostLyricLayoutUnits', () => {
    it('keeps single-word units by default', () => {
        const words = createTokenWords(['Weave', 'that', 'poem']);
        const units = buildPostLyricLayoutUnits({
            fullText: 'Weave that poem',
            words,
        });

        expect(units).toEqual(createSingleWordLayoutUnits(words));
    });

    it('keeps CJK semantic grouping when semantic is enabled without sticky punctuation', () => {
        const words = createCharacterWords('世界');
        const units = buildPostLyricLayoutUnits({ fullText: '世界', words }, {
            semantic: true,
            sticky: false,
        });

        expect(units).toHaveLength(1);
        expect(units[0]).toMatchObject({
            text: '世界',
            isSemantic: true,
        });
        expect(units[0].isSticky).toBeUndefined();
        expect(units[0].words).toEqual(words);
    });

    it('keeps split latin apostrophe suffixes in one sticky unit', () => {
        const words = createTokenWords(['It', '’', 's', 'unbelievable']);
        const units = buildPostLyricLayoutUnits({
            fullText: 'It’s unbelievable',
            words,
        }, {
            semantic: false,
            sticky: true,
        });
        const displayWords = buildDisplayWordsFromLayoutUnits(units);

        expect(units.map(unit => unit.text)).toEqual(['It’s', 'unbelievable']);
        expect(units[0]).toMatchObject({
            text: 'It’s',
            isSemantic: false,
            isSticky: true,
            startTime: 0,
            endTime: 2.5,
        });
        expect(displayWords.map(word => word.text)).toEqual(['It’s', 'unbelievable']);
    });

    it('attaches latin trailing punctuation to the previous sticky unit', () => {
        const words = createTokenWords(['Hello', ',', 'world']);
        const units = buildPostLyricLayoutUnits({
            fullText: 'Hello, world',
            words,
        }, {
            sticky: true,
        });

        expect(units.map(unit => unit.text)).toEqual(['Hello,', 'world']);
        expect(units[0].isSticky).toBe(true);
        expect(buildDisplayWordsFromLayoutUnits(units).map(word => word.text)).toEqual(['Hello,', 'world']);
    });

    it('attaches CJK trailing punctuation through the same sticky rule', () => {
        const words = createTokenWords(['世界', '。', '继续']);
        const units = buildPostLyricLayoutUnits({
            fullText: '世界。继续',
            words,
        }, {
            sticky: true,
        });

        expect(units.map(unit => unit.text)).toEqual(['世界。', '继续']);
        expect(units[0].isSticky).toBe(true);
        expect(buildDisplayWordsFromLayoutUnits(units).map(word => word.text)).toEqual(['世界。', '继续']);
    });

    it('applies sticky punctuation after CJK semantic grouping', () => {
        const words = createCharacterWords('世界。');
        const units = buildPostLyricLayoutUnits({
            fullText: '世界。',
            words,
        }, {
            semantic: true,
            sticky: true,
        });

        expect(units.map(unit => unit.text)).toEqual(['世界。']);
        expect(units[0]).toMatchObject({
            isSemantic: true,
            isSticky: true,
        });
        expect(units[0].words.map(word => word.text)).toEqual(['世', '界', '。']);
    });

    it('keeps semantic units split into original words for display timing', () => {
        const words = createCharacterWords('世界');
        const units = buildPostLyricLayoutUnits({ fullText: '世界', words }, {
            semantic: true,
            sticky: false,
        });
        const displayWords = buildDisplayWordsFromLayoutUnits(units);

        expect(units[0].isSemantic).toBe(true);
        expect(displayWords).toEqual(words);
    });

    it('keeps split latin contractions together in mixed CJK and English lines', () => {
        const words = createTokenWords(['这', '是', ' ', 'It', '’', 's ', 'unbelievable']);
        const units = buildPostLyricLayoutUnits({
            fullText: '这是 It’s unbelievable',
            words,
        }, {
            semantic: true,
            sticky: true,
        });
        const displayWords = buildDisplayWordsFromLayoutUnits(units);

        // The spaces in the words no longer break alignment, so the line follows the segmenter and
        // the whitespace-only word stays with 是.
        expect(units.map(unit => unit.text)).toEqual(['这', '是 ', 'It’s ', 'unbelievable']);
        expect(units[2]).toMatchObject({
            text: 'It’s ',
            isSemantic: false,
            isSticky: true,
        });
        expect(displayWords.map(word => word.text)).toEqual(['这', '是', ' ', 'It’s ', 'unbelievable']);
        expect(displayWords[3]).toMatchObject({
            text: 'It’s ',
            startTime: 3,
            endTime: 5.5,
        });
    });
});
