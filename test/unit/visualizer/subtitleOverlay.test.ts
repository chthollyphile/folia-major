import { describe, expect, it } from 'vitest';
import { getUpcomingLyricsClassName, resolveVisualizerSubtitleOverlayContent } from '@/components/visualizer/VisualizerSubtitleOverlay';
import type { Line, SubtitleOverlayLayout } from '@/types';

// test/unit/visualizer/subtitleOverlay.test.ts
// Locks how the shared bottom subtitle lays a line out in its rows, and the split between hiding the
// whole overlay and a layout that has nothing to show for a line.

describe('VisualizerSubtitleOverlay content resolution', () => {
    it('keeps upcoming lyric blur enabled by default and allows disabling it', () => {
        expect(getUpcomingLyricsClassName()).toContain('blur-[1px]');
        expect(getUpcomingLyricsClassName(false)).not.toContain('blur-[1px]');
    });

    const activeLine: Line = {
        startTime: 1,
        endTime: 2,
        fullText: 'Hello',
        translation: '你好',
        romanization: 'Harō',
        words: [],
    };
    const nextLine: Line = {
        startTime: 2,
        endTime: 3,
        fullText: 'World',
        words: [],
    };
    const lineAfterNext: Line = {
        startTime: 3,
        endTime: 4,
        fullText: 'Again',
        words: [],
    };

    const resolve = (layout: SubtitleOverlayLayout | undefined, overrides: Partial<Parameters<typeof resolveVisualizerSubtitleOverlayContent>[0]> = {}) =>
        resolveVisualizerSubtitleOverlayContent({
            showText: true,
            activeLine,
            recentCompletedLine: null,
            nextLines: [nextLine, lineAfterNext],
            subtitleOverlayLayout: layout,
            ...overrides,
        });
    const texts = (layout: SubtitleOverlayLayout | undefined, overrides?: Parameters<typeof resolve>[1]) =>
        resolve(layout, overrides).rows.map(row => row.text);

    it('hides the entire overlay when the hide setting is enabled', () => {
        const content = resolve('current+romanization+translation', { hideTranslationSubtitle: true });

        expect(content.shouldRenderOverlay).toBe(false);
        expect(content.rows).toEqual([]);
        expect(content.upcomingLines).toEqual([]);
    });

    it('shows the translation alone by default, as before', () => {
        expect(texts(undefined)).toEqual(['你好']);
    });

    it('shows one row of the chosen content in a single-row layout', () => {
        expect(texts('current')).toEqual(['Hello']);
        expect(texts('translation')).toEqual(['你好']);
        expect(texts('romanization')).toEqual(['Harō']);
    });

    it('opens a two-row layout with the current line', () => {
        expect(resolve('current+translation').rows).toEqual([
            { key: 'current', source: 'current', text: 'Hello' },
            { key: 'translation', source: 'translation', text: '你好' },
        ]);
        expect(texts('current+romanization')).toEqual(['Hello', 'Harō']);
        expect(texts('current+next')).toEqual(['Hello', 'World']);
    });

    it('stacks translation and romanization without the original text', () => {
        expect(resolve('romanization+translation').rows).toEqual([
            { key: 'romanization', source: 'romanization', text: 'Harō' },
            { key: 'translation', source: 'translation', text: '你好' },
        ]);
        expect(texts('translation+romanization')).toEqual(['你好', 'Harō']);
        expect(texts('translation+next')).toEqual(['你好', 'World']);
        expect(texts('romanization+translation', { activeLine: { ...activeLine, romanization: undefined } })).toEqual(['你好']);
    });

    it('previews the upcoming lines for such a stack on a line with neither, unless it shows its rows only', () => {
        const bare = { ...activeLine, romanization: undefined, translation: undefined };
        expect(resolve('romanization+translation', { activeLine: bare }).upcomingLines).toEqual([nextLine, lineAfterNext]);
        const strict = resolve('romanization+translation|only', { activeLine: bare });
        expect(strict.rows).toEqual([]);
        expect(strict.upcomingLines).toEqual([]);
    });

    it('does not let the coming lines stand in for a line that has none of its own rows', () => {
        const bare = { ...activeLine, romanization: undefined, translation: undefined };
        const content = resolve('translation+next', { activeLine: bare });
        expect(content.rows).toEqual([]);
        expect(content.upcomingLines).toEqual([nextLine, lineAfterNext]);

        const strict = resolve('translation+next|only', { activeLine: bare });
        expect(strict.rows).toEqual([]);
        expect(strict.upcomingLines).toEqual([]);

        expect(resolve('current+next', { activeLine: { ...activeLine, fullText: '//' } }).rows).toEqual([]);
    });

    it('stacks three rows in order, taking the upcoming lines one after another', () => {
        expect(texts('current+romanization+translation')).toEqual(['Hello', 'Harō', '你好']);
        expect(texts('current+translation+next')).toEqual(['Hello', '你好', 'World']);
        expect(texts('current+next+next')).toEqual(['Hello', 'World', 'Again']);
        expect(resolve('current+next+next').rows.map(row => row.key)).toEqual(['current', 'next-1', 'next-2']);
    });

    it('leaves out a row the line has nothing for, never an empty placeholder', () => {
        expect(texts('current+romanization+translation', { activeLine: { ...activeLine, romanization: undefined } }))
            .toEqual(['Hello', '你好']);
        expect(texts('current+next+next', { nextLines: [nextLine] })).toEqual(['Hello', 'World']);
        expect(texts('current+translation', { nextLines: [], activeLine: { ...activeLine, translation: '//' } }))
            .toEqual(['Hello']);
    });

    it('shows a translation or romanization that repeats a row above it once', () => {
        const sameAsLine = { ...activeLine, translation: 'Hello', romanization: '你好' };
        expect(texts('current+translation', { activeLine: sameAsLine })).toEqual(['Hello']);
        expect(texts('current+romanization+translation', { activeLine: { ...activeLine, romanization: '你好' } }))
            .toEqual(['Hello', '你好']);
        expect(texts('current+translation+translation')).toEqual(['Hello', '你好']);
    });

    it('resolves romanization from alternate texts when the direct field is absent', () => {
        expect(texts('romanization', {
            activeLine: {
                ...activeLine,
                romanization: undefined,
                alternateTexts: [{ role: 'romanization', text: 'Hello' }],
            },
        })).toEqual(['Hello']);
    });

    it('previews the upcoming lines when a single row has nothing for the line', () => {
        const content = resolve('romanization', { activeLine: { ...activeLine, romanization: undefined } });

        expect(content.shouldRenderOverlay).toBe(true);
        expect(content.rows).toEqual([]);
        expect(content.upcomingLines).toEqual([nextLine, lineAfterNext]);
    });

    it('shows nothing for such a line when the layout shows its rows only', () => {
        const content = resolve('romanization|only', { activeLine: { ...activeLine, romanization: undefined } });

        expect(content.shouldRenderOverlay).toBe(true);
        expect(content.rows).toEqual([]);
        expect(content.upcomingLines).toEqual([]);
        expect(texts('romanization|only')).toEqual(['Harō']);
        expect(texts('current+translation+next|only')).toEqual(['Hello', '你好', 'World']);
    });

    it('keeps the line just sung up in a gap, with the lines that follow it', () => {
        const content = resolve('current+next', { activeLine: null, recentCompletedLine: activeLine, nextLines: [nextLine] });

        expect(content.rows.map(row => row.text)).toEqual(['Hello', 'World']);
        expect(content.upcomingLines).toEqual([]);
    });

    it('shows nothing before the first line', () => {
        const content = resolve('current+next', { activeLine: null });

        expect(content.rows).toEqual([]);
        expect(content.upcomingLines).toEqual([]);
    });
});
