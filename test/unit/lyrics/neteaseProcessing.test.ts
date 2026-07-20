import { beforeEach, describe, expect, it, vi } from 'vitest';
import { extractNeteaseLyricPayload, processNeteaseLyrics } from '@/utils/lyrics/neteaseProcessing';
import { parseLyricsAsync } from '@/utils/lyrics/workerClient';

vi.mock('@/utils/lyrics/workerClient', () => ({
    parseLyricsAsync: vi.fn()
}));

describe('neteaseProcessing', () => {
    const parseLyricsAsyncMock = vi.mocked(parseLyricsAsync);

    beforeEach(() => {
        parseLyricsAsyncMock.mockReset();
    });

    it('extracts nested YRC payloads and translation preference', () => {
        const payload = extractNeteaseLyricPayload({
            type: 'netease',
            lrc: {
                lyric: '[00:00.00]主歌',
                yrc: { lyric: '[0,100](0,100,0)主歌' },
                ytlrc: { lyric: '[00:00.00]verse' }
            },
            tlyric: { lyric: '[00:00.00]fallback' }
        });

        expect(payload.mainLrc).toBe('[00:00.00]主歌');
        expect(payload.yrcLrc).toBe('[0,100](0,100,0)主歌');
        expect(payload.transLrc).toBe('[00:00.00]verse');
        expect(payload.isPureMusic).toBe(false);
    });

    it('uses YRC first without binding provider chorus behavior to parsed lyrics', async () => {
        parseLyricsAsyncMock.mockResolvedValue({
            lines: [
                { fullText: '副歌', startTime: 0, endTime: 1, words: [] },
                { fullText: '主歌', startTime: 1, endTime: 2, words: [] },
                { fullText: '副歌', startTime: 2, endTime: 3, words: [] }
            ]
        });
        const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);

        const result = await processNeteaseLyrics({
            type: 'netease',
            lrc: { lyric: '[00:00.00]副歌\n[00:01.00]主歌\n[00:02.00]副歌' },
            yrc: { lyric: '[0,100](0,100,0)副歌' },
            ytlrc: { lyric: '[00:00.00]chorus' },
            tlyric: { lyric: '[00:00.00]fallback' }
        });

        expect(parseLyricsAsyncMock).toHaveBeenCalledWith(
            'yrc',
            '[0,100](0,100,0)副歌',
            '[00:00.00]chorus',
            { includeInterludes: true }
        );
        expect(result.isPureMusic).toBe(false);
        expect(result.lyrics?.lines[0].isChorus).toBeUndefined();
        expect(result.lyrics?.lines[0].chorusEffect).toBeUndefined();
        expect(result.lyrics?.lines[1].isChorus).toBeUndefined();
        expect(result.lyrics?.lines[2].isChorus).toBeUndefined();

        randomSpy.mockRestore();
    });

    it('short-circuits pure music responses without parsing', async () => {
        const result = await processNeteaseLyrics({
            type: 'netease',
            pureMusic: true,
            lrc: { lyric: '[00:00.00]纯音乐，请欣赏' }
        });

        expect(result.isPureMusic).toBe(true);
        expect(result.lyrics).toBeNull();
        expect(parseLyricsAsyncMock).not.toHaveBeenCalled();
    });

    it('returns null when no usable lyric text exists', async () => {
        const result = await processNeteaseLyrics({
            type: 'netease',
            lrc: {},
            yrc: {}
        });

        expect(result.lyrics).toBeNull();
        expect(result.mainLrc).toBeNull();
        expect(result.yrcLrc).toBeNull();
        expect(parseLyricsAsyncMock).not.toHaveBeenCalled();
    });

    it('leaves provider chorus resolution outside the format parser', async () => {
        parseLyricsAsyncMock.mockResolvedValue({
            lines: [
                { fullText: 'Line 1', startTime: 10, endTime: 15, words: [] },
                { fullText: 'Line 2', startTime: 20, endTime: 25, words: [] },
                { fullText: 'Line 3', startTime: 30, endTime: 35, words: [] }
            ]
        });
        const fetchChorusRanges = vi.fn(async () => [{ startTime: 19.5, endTime: 26 }]);

        const result = await processNeteaseLyrics(
            {
                type: 'netease',
                lrc: { lyric: '[00:10.00]Line 1\n[00:20.00]Line 2\n[00:30.00]Line 3' }
            },
            {
                songId: 12345,
                fetchChorusRanges,
            }
        );

        expect(fetchChorusRanges).not.toHaveBeenCalled();
        expect(result.chorusRanges).toEqual([]);
        expect(result.lyrics?.lines[0].isChorus).toBeUndefined();
        expect(result.lyrics?.lines[1].isChorus).toBeUndefined();
        expect(result.lyrics?.lines[2].isChorus).toBeUndefined();
    });
});
