import { describe, expect, it } from 'vitest';
import {
    getSubtitleOverlayRowCount,
    getSubtitleOverlayRows,
    parseSubtitleOverlayLayout,
    subtitleOverlayLayoutFromContentMode,
    withSubtitleOverlayRow,
    withSubtitleOverlayRowCount,
} from '@/utils/lyrics/subtitleOverlayLayout';

// test/unit/lyrics/subtitleOverlayLayout.test.ts
// Pins which strings are bottom subtitle layouts, how the window's row controls edit one, and how a
// user's 副字幕内容 becomes their first layout.

describe('subtitle overlay layout', () => {
    it('accepts the single rows and the stacks that open with the current line', () => {
        for (const value of ['current', 'translation', 'romanization', 'current+next', 'current+romanization+translation', 'current+next+next']) {
            expect(parseSubtitleOverlayLayout(value)).toBe(value);
        }
    });

    it('rejects anything else', () => {
        for (const value of ['next', 'both', 'none', '', 'translation+current', 'current+current', 'current+next+next+next', 'current+', 42, null, undefined]) {
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
    });

    it('changes one row and keeps the current line at the top of a stack', () => {
        expect(withSubtitleOverlayRow('translation', 0, 'current')).toBe('current');
        expect(withSubtitleOverlayRow('current+next+translation', 2, 'romanization')).toBe('current+next+romanization');
        expect(withSubtitleOverlayRow('current+next', 0, 'translation')).toBe('current+next');
        expect(withSubtitleOverlayRow('current+next', 5, 'translation')).toBe('current+next');
    });

    it('carries a user\'s 副字幕内容 over to their first layout', () => {
        expect(subtitleOverlayLayoutFromContentMode('translation')).toBe('translation');
        expect(subtitleOverlayLayoutFromContentMode('romanization')).toBe('romanization');
        expect(subtitleOverlayLayoutFromContentMode('both')).toBe('current+romanization+translation');
        expect(subtitleOverlayLayoutFromContentMode('none')).toBe('current+next');
    });
});
