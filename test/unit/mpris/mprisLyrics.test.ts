import { describe, expect, it, vi } from 'vitest';

// The parser normally runs in the lyrics worker; run the same parser inline, as the other lyric tests do.
vi.mock('@/utils/lyrics/workerClient', async () => {
    const { parseLyricsByFormat } = await import('@/utils/lyrics/parserCore');
    return {
        parseLyricsAsync: vi.fn(async (
            format: Parameters<typeof parseLyricsByFormat>[0],
            content: string,
            translation: string,
            options: Parameters<typeof parseLyricsByFormat>[3],
            romanization: string,
        ) => parseLyricsByFormat(format, content, translation, options, romanization)),
    };
});

import { parseMprisLyricText } from '@/services/mpris/mprisLyrics';

// 播放器自带歌词的解析：有时间轴的 LRC / 增强 LRC 才收，纯文本交给在线匹配。

describe('parseMprisLyricText', () => {
    it('parses the LRC a player sends over xesam:asText', async () => {
        const lyrics = await parseMprisLyricText('[00:01.00]第一句\n[00:03.50]第二句\n');
        expect(lyrics?.lines.map(line => line.fullText)).toEqual(['第一句', '第二句']);
        expect(lyrics?.lines[1]?.startTime).toBeCloseTo(3.5);
    });

    it('rejects plain lyrics without a timeline', async () => {
        expect(await parseMprisLyricText('第一句\n第二句')).toBeNull();
    });

    it('rejects text with timestamps but no lyric lines', async () => {
        expect(await parseMprisLyricText('[00:01.00]')).toBeNull();
    });
});
