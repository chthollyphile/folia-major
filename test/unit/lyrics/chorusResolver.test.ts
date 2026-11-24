import { describe, expect, it, vi } from 'vitest';
import { resolveProviderLyricsChorus } from '@/utils/lyrics/chorusResolver';

// test/unit/lyrics/chorusResolver.test.ts

const lyrics = () => ({
    lines: [
        { fullText: '主歌', startTime: 1, endTime: 2, words: [] },
        { fullText: '副歌', startTime: 10, endTime: 12, words: [] },
        { fullText: '副歌', startTime: 20, endTime: 22, words: [] },
    ],
    isWordByWord: false,
});

describe('resolveProviderLyricsChorus', () => {
    it('uses provider-native ranges when available', async () => {
        const result = await resolveProviderLyricsChorus({
            lyrics: lyrics(),
            isPureMusic: false,
        }, {
            providerId: 'kugou',
            songId: 'hash',
            fetchChorusRanges: async () => [{ startTime: 9, endTime: 13 }],
        });

        expect(result.mode).toBe('native');
        expect(result.result.lyrics?.lines[1].isChorus).toBe(true);
        expect(result.result.lyrics?.lines[2].isChorus).toBeUndefined();
        expect(result.result.chorusRanges).toEqual([{ startTime: 9, endTime: 13 }]);
        expect(result.result.lyrics?.lines[1].chorusOrigin).toBe('source');
    });

    it('falls back to repeated text when native ranges are empty', async () => {
        const result = await resolveProviderLyricsChorus({
            lyrics: lyrics(),
            mainText: '[00:10.00]副歌\n[00:20.00]副歌\n[00:30.00]主歌',
            isPureMusic: false,
        }, {
            providerId: 'kugou',
            songId: 'hash-empty',
            fetchChorusRanges: async () => [],
        });

        expect(result.mode).toBe('text');
        expect(result.result.lyrics?.lines[1].isChorus).toBe(true);
        expect(result.result.lyrics?.lines[2].isChorus).toBe(true);
        expect(result.result.lyrics?.lines[1].chorusOrigin).toBe('text');
    });

    it('warns and falls back when the provider request fails', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const result = await resolveProviderLyricsChorus({
            lyrics: lyrics(),
            mainText: '[00:10.00]副歌\n[00:20.00]副歌',
            isPureMusic: false,
        }, {
            providerId: 'netease',
            songId: 1,
            fetchChorusRanges: async () => { throw new Error('offline'); },
        });

        expect(result.mode).toBe('text');
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });

    // An automatic match lends the playing song's ranges to the lyric it picked; that lyric may come marked already.
    describe('lyrics that come with chorus marks', () => {
        const marked = (origin: 'source' | 'text') => {
            const base = lyrics();
            return {
                ...base,
                lines: base.lines.map((line, index) => (index === 2 ? { ...line, isChorus: true, chorusEffect: 'bars' as const, chorusOrigin: origin } : line)),
            };
        };

        it('puts the source\'s ranges over marks guessed from repeated lines', async () => {
            const result = await resolveProviderLyricsChorus(
                { lyrics: marked('text'), isPureMusic: false, chorusRanges: [{ startTime: 9, endTime: 13 }] },
                { providerId: 'kugou', songId: 'hash' },
            );

            expect(result.mode).toBe('native');
            expect(result.result.lyrics?.lines[1]).toMatchObject({ isChorus: true, chorusOrigin: 'source' });
            // The guess the ranges do not reach goes.
            expect(result.result.lyrics?.lines[2].isChorus).toBeUndefined();
            expect(result.result.lyrics?.lines[2].chorusOrigin).toBeUndefined();
            expect(result.result.lyrics?.sourceChorusRanges).toEqual([{ startTime: 9, endTime: 13 }]);
        });

        it('keeps marks the lyric data vouches for (a TTML songPart)', async () => {
            const own = marked('source');
            const result = await resolveProviderLyricsChorus(
                { lyrics: own, isPureMusic: false, chorusRanges: [{ startTime: 9, endTime: 13 }] },
                { providerId: 'kugou', songId: 'hash' },
            );

            expect(result.mode).toBe('existing');
            expect(result.result.lyrics).toBe(own);
        });

        it('keeps the guess where the ranges reach none of the lines, or there are none', async () => {
            const guessed = marked('text');
            const missing = await resolveProviderLyricsChorus(
                { lyrics: guessed, isPureMusic: false, chorusRanges: [{ startTime: 100, endTime: 110 }] },
                { providerId: 'kugou', songId: 'hash' },
            );
            const none = await resolveProviderLyricsChorus({ lyrics: guessed, isPureMusic: false }, { providerId: 'qq', songId: 'mid' });

            expect(missing).toMatchObject({ mode: 'existing', result: { lyrics: guessed } });
            expect(none).toMatchObject({ mode: 'existing', result: { lyrics: guessed } });
        });

        // A Folia document can keep ranges from when it was saved while its marks were since made guesses.
        it('does not take ranges the lyrics kept from before for these having marked a line', async () => {
            const guessed = { ...marked('text'), sourceChorusRanges: [{ startTime: 19, endTime: 23 }] };
            const result = await resolveProviderLyricsChorus(
                { lyrics: guessed, isPureMusic: false, chorusRanges: [{ startTime: 100, endTime: 110 }] },
                { providerId: 'kugou', songId: 'hash' },
            );

            expect(result).toMatchObject({ mode: 'existing', result: { lyrics: guessed } });
        });
    });

    it('leaves empty provider results untouched without probing chorus capabilities', async () => {
        const fetchChorusRanges = vi.fn(async () => [{ startTime: 1, endTime: 2 }]);
        const providerResult = { lyrics: null, isPureMusic: true, chorusRanges: [] };

        const result = await resolveProviderLyricsChorus(providerResult, {
            providerId: 'netease',
            songId: 2,
            fetchChorusRanges,
        });

        expect(result).toEqual({ result: providerResult, mode: 'none' });
        expect(fetchChorusRanges).not.toHaveBeenCalled();
    });
});
