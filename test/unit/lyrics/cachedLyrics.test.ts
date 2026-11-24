import { describe, expect, it } from 'vitest';
import type { Line, LyricData } from '@/types';
import { savedBeforeChorusOrigin } from '@/utils/lyrics/cachedLyrics';
import { applyChorusRangesByTime, findSourceChorusStart } from '@/utils/lyrics/chorusEffects';
import { resolveProviderLyricsChorus } from '@/utils/lyrics/chorusResolver';
import { ensureLyricDataRenderHints } from '@/utils/lyrics/renderHints';

// test/unit/lyrics/cachedLyrics.test.ts
// Telling lyrics saved before chorus lines recorded their origin (#1333) from newer ones.

const line = (startTime: number, fullText: string, extra: Partial<Line> = {}): Line => ({
    startTime, endTime: startTime + 4, fullText, words: [{ text: fullText, startTime, endTime: startTime + 4 }], ...extra,
});

const lyricsOf = (lines: Line[]): LyricData => ensureLyricDataRenderHints({ lines, isWordByWord: false })!;

// What an entry saved before #1333 looks like: chorus lines that do not say where their chorus came from.
const beforeOrigins = lyricsOf([
    line(0, 'verse'),
    line(32, 'chorus a', { isChorus: true, chorusEffect: 'bars' }),
    line(36, 'chorus b', { isChorus: true, chorusEffect: 'bars' }),
]);

describe('lyrics saved before chorus origins', () => {
    it('tells an entry whose chorus lines all lack an origin', () => {
        expect(savedBeforeChorusOrigin(beforeOrigins)).toBe(true);
    });

    it('keeps lyrics the current host marks, and ones with no chorus at all', () => {
        const plain = lyricsOf([line(0, 'a'), line(4, 'b')]);
        const fromSource = applyChorusRangesByTime(plain, [{ startTime: 3, endTime: 6 }]);
        // As applyDetectedChorusEffects marks a chorus guessed from repeated lines.
        const guessed = lyricsOf([line(0, 'x', { isChorus: true, chorusOrigin: 'text' }), line(4, 'y')]);
        expect(savedBeforeChorusOrigin(plain)).toBe(false);
        expect(findSourceChorusStart(fromSource)).toBe(3);
        expect(savedBeforeChorusOrigin(fromSource)).toBe(false);
        expect(savedBeforeChorusOrigin(guessed)).toBe(false);
    });

    // A Folia document (a source's `folia` lyrics, an export of guessed marks) brings marks of its own.
    it('records marks that came with the lyrics without an origin as guessed, so they are never taken for old ones', async () => {
        const { result, mode } = await resolveProviderLyricsChorus({ lyrics: beforeOrigins, isPureMusic: false }, { providerId: 'netease', songId: 1 });
        expect(mode).toBe('existing');
        expect(result.lyrics!.lines.filter(candidate => candidate.isChorus).every(candidate => candidate.chorusOrigin === 'text')).toBe(true);
        expect(savedBeforeChorusOrigin(result.lyrics!)).toBe(false);
        expect(findSourceChorusStart(result.lyrics)).toBeNull();
    });

    it('leaves marks that already say where they came from', async () => {
        const marked = applyChorusRangesByTime(lyricsOf([line(0, 'a'), line(4, 'b')]), [{ startTime: 3, endTime: 6 }]);
        const { result } = await resolveProviderLyricsChorus({ lyrics: marked, isPureMusic: false }, { providerId: 'netease', songId: 1 });
        expect(result.lyrics).toBe(marked);
    });
});
