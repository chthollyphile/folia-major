// @builtin-sources
import { describe, expect, it, vi } from 'vitest';

// The host parses a source's tracks in the lyrics worker; run the same parser inline.
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

import { answerBodianRequests, bodianProvider, hostBodianSong } from '../helpers/bodianSource';

// test/unit/lyrics/bodianLyrics.test.ts — adapt decoded API text through Folia's shared parsers.
// Folium 2.0 S5: the Bodian source mod hands its text as tracks (lyrics@1, sources/bodian/client/bodianLyrics.ts) and
// the host parses them (src/mods/folium/lyricsSource.ts): read here through the registered provider.

const { request } = answerBodianRequests();
const parseBodianLyrics = async (payload: { mainText: string; wordByWordText: string | null }) => {
    request.mockResolvedValueOnce(payload);
    return bodianProvider().lyrics!.getLyrics(hostBodianSong({ id: 1, name: 'Song' }));
};

describe('Bodian lyric adaptation', () => {
    it('preserves decoded word timing in the common model', async () => {
        const result = await parseBodianLyrics({ mainText: '[00:29.264]甲乙丙',
            wordByWordText: '[00:29.264]<0,390>甲<390,392>乙<782,448>丙' });
        expect(result.lyrics?.isWordByWord).toBe(true);
        const words = result.lyrics!.lines.find(line => line.fullText === '甲乙丙')!.words;
        expect(words[0].startTime).toBeCloseTo(29.264);
        expect(words[0].endTime).toBeCloseTo(29.654);
        expect(words[2].startTime).toBeCloseTo(30.046);
        expect(words[2].endTime).toBeCloseTo(30.494);
        expect(request).toHaveBeenLastCalledWith('lyrics', { id: '1' });
    });
    it('falls back to line lyrics without a valid word track', async () => {
        const result = await parseBodianLyrics({ mainText: '[00:01.000]甲', wordByWordText: null });
        expect(result.lyrics?.lines[0].fullText).toBe('甲');
        // Folium 2.0 S5: a source's lyrics name a missing track's text null (it was left undefined).
        expect(result.wordByWordText).toBeNull();
    });
    it('distinguishes missing lyrics from a declared instrumental', async () => {
        expect(await parseBodianLyrics({ mainText: '', wordByWordText: null })).toMatchObject({ lyrics: null, isPureMusic: false });
        expect(await parseBodianLyrics({ mainText: '[00:00.000]纯音乐，请欣赏', wordByWordText: null })).toMatchObject({ isPureMusic: true });
    });
});
