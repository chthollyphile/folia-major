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
