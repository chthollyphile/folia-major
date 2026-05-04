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

    it('uses YRC first and returns chorus-decorated final lyrics', async () => {
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
        expect(result.lyrics?.lines[0].isChorus).toBe(true);
        expect(result.lyrics?.lines[0].chorusEffect).toBe('bars');
        expect(result.lyrics?.lines[1].isChorus).toBeUndefined();
        expect(result.lyrics?.lines[2].isChorus).toBe(true);

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
});
