import { describe, expect, it } from 'vitest';
import {
    getSubtitleOverlayRowCount,
    getSubtitleOverlayRows,
    parseSubtitleOverlayLayout,
    subtitleOverlayLayoutFromContentMode,
    subtitleOverlayPreviewsUpcoming,
    withSubtitleOverlayRow,
    withSubtitleOverlayRowCount,
    withSubtitleOverlayUpcomingPreview,
} from '@/utils/lyrics/subtitleOverlayLayout';

// test/unit/lyrics/subtitleOverlayLayout.test.ts
// Pins which strings are bottom subtitle layouts, how the window's row controls edit one, and how a
// user's 副字幕内容 becomes their first layout.

describe('subtitle overlay layout', () => {
    it('accepts one to three rows that open with the current line, the translation or the romanization', () => {
        for (const value of ['current', 'translation', 'romanization', 'current+next', 'current+romanization+translation', 'current+next+next', 'romanization+translation', 'translation+romanization', 'translation+next+next']) {
            expect(parseSubtitleOverlayLayout(value)).toBe(value);
        }
    });

    it('rejects anything else', () => {
        for (const value of ['next', 'both', 'none', '', 'translation+current', 'current+current', 'current+next+next+next', 'current+', 'next+translation', '+translation', '|only', 'next|only', 'translation|only|only', 'translation|', 'translation|none', 42, null, undefined]) {
            expect(parseSubtitleOverlayLayout(value)).toBeNull();
        }
    });

    it('reads rows and their count', () => {
        expect(getSubtitleOverlayRows('current+next+translation')).toEqual(['current', 'next', 'translation']);
        expect(getSubtitleOverlayRowCount('romanization')).toBe(1);
        expect(getSubtitleOverlayRowCount('current+next')).toBe(2);
    });

    it('grows a single row into a stack under the current line', () => {
        expect(withSubtitleOverlayRowCount('translation', 2)).toBe('current+translation');
        expect(withSubtitleOverlayRowCount('current', 2)).toBe('current+next');
        expect(withSubtitleOverlayRowCount('translation', 3)).toBe('current+translation+romanization');
        expect(withSubtitleOverlayRowCount('current+next', 3)).toBe('current+next+translation');
    });

    it('shrinks a stack and comes back to the same single row', () => {
        expect(withSubtitleOverlayRowCount('current+romanization+translation', 2)).toBe('current+romanization');
        expect(withSubtitleOverlayRowCount('current+romanization+translation', 1)).toBe('romanization');
        expect(withSubtitleOverlayRowCount(withSubtitleOverlayRowCount('translation', 2), 1)).toBe('translation');
        expect(withSubtitleOverlayRowCount('current+next+next', 1)).toBe('current');
        expect(withSubtitleOverlayRowCount('romanization+translation', 1)).toBe('romanization');
    });

    it('keeps the first row of a stack that leaves the original text out', () => {
        expect(withSubtitleOverlayRowCount('romanization+translation', 3)).toBe('romanization+translation+next');
        expect(withSubtitleOverlayRowCount('translation+next', 3)).toBe('translation+next+romanization');
        expect(withSubtitleOverlayRowCount('translation+romanization+next', 2)).toBe('translation+romanization');
    });

    it('changes one row, the first of a stack included, and never puts a row where it cannot go', () => {
        expect(withSubtitleOverlayRow('translation', 0, 'current')).toBe('current');
        expect(withSubtitleOverlayRow('current+next+translation', 2, 'romanization')).toBe('current+next+romanization');
        expect(withSubtitleOverlayRow('current+next', 0, 'translation')).toBe('translation+next');
        expect(withSubtitleOverlayRow('current+romanization', 0, 'translation')).toBe('translation+romanization');
        expect(withSubtitleOverlayRow('current+next', 0, 'next')).toBe('current+next');
        expect(withSubtitleOverlayRow('translation+romanization', 1, 'current')).toBe('translation+romanization');
    });

    it('moves a row on when the first row takes its content, keeping the row count', () => {
        expect(withSubtitleOverlayRow('current+translation', 0, 'translation')).toBe('translation+romanization');
        expect(withSubtitleOverlayRow(withSubtitleOverlayRowCount('translation', 2), 0, 'translation')).toBe('translation+romanization');
        expect(withSubtitleOverlayRow('current+romanization', 0, 'romanization')).toBe('romanization+translation');
        expect(withSubtitleOverlayRow('current+romanization+translation', 0, 'romanization')).toBe('romanization+next+translation');
        expect(withSubtitleOverlayRow('current+translation+translation|only', 0, 'translation')).toBe('translation+romanization+next|only');
        expect(withSubtitleOverlayRow('current+next+next', 0, 'romanization')).toBe('romanization+next+next');
        expect(withSubtitleOverlayRow('current+translation+next', 2, 'translation')).toBe('current+translation+translation');
        expect(withSubtitleOverlayRow('current+next', 5, 'translation')).toBe('current+next');
    });

    it('accepts a layout that shows its rows and nothing else', () => {
        for (const value of ['translation|only', 'romanization|only', 'current|only', 'current+next+translation|only']) {
            expect(parseSubtitleOverlayLayout(value)).toBe(value);
        }
        expect(getSubtitleOverlayRows('current+next+translation|only')).toEqual(['current', 'next', 'translation']);
        expect(getSubtitleOverlayRowCount('translation|only')).toBe(1);
    });

    it('previews the coming lyrics unless the layout turns it off, and switches it without touching the rows', () => {
        expect(subtitleOverlayPreviewsUpcoming('translation')).toBe(true);
        expect(subtitleOverlayPreviewsUpcoming('translation|only')).toBe(false);
        expect(withSubtitleOverlayUpcomingPreview('translation', false)).toBe('translation|only');
        expect(withSubtitleOverlayUpcomingPreview('translation|only', false)).toBe('translation|only');
        expect(withSubtitleOverlayUpcomingPreview('current+romanization|only', true)).toBe('current+romanization');
        expect(withSubtitleOverlayUpcomingPreview('romanization', true)).toBe('romanization');
    });

    it('keeps that choice while the rows are edited', () => {
        expect(withSubtitleOverlayRow('translation|only', 0, 'romanization')).toBe('romanization|only');
        expect(withSubtitleOverlayRowCount('translation|only', 2)).toBe('current+translation|only');
        expect(withSubtitleOverlayRowCount(withSubtitleOverlayRowCount('translation|only', 3), 1)).toBe('translation|only');
        expect(withSubtitleOverlayRow('current+next|only', 1, 'translation')).toBe('current+translation|only');
        expect(withSubtitleOverlayRow('current+next|only', 5, 'translation')).toBe('current+next|only');
    });

    it('carries a user\'s 副字幕内容 over to their first layout', () => {
        expect(subtitleOverlayLayoutFromContentMode('translation')).toBe('translation');
        expect(subtitleOverlayLayoutFromContentMode('romanization')).toBe('romanization');
        expect(subtitleOverlayLayoutFromContentMode('both')).toBe('current+romanization+translation');
        expect(subtitleOverlayLayoutFromContentMode('none')).toBe('current+next');
    });
});
