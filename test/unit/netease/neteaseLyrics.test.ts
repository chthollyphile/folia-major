// @builtin-sources
import { beforeAll, describe, expect, it } from 'vitest';
import { getLyricSourceAccess } from '@/utils/lyrics/lyricMatchSources';
import { getLyricSource } from '@/utils/lyrics/lyricSources';

// test/unit/netease/neteaseLyrics.test.ts
// 网易云音乐音源模组的歌词（sources/netease/core/neteaseProvider.ts）：/lyric/new 的回答原样交成歌词轨（neteaseLyricsOf），
// 由宿主解析（lyricsSource.ts）；纯音乐不交歌词轨；匹配到网易云歌的本地歌按歌 id 再取歌词（lyrics@1.songIdOf）。

type LyricsOf = (payload: unknown) => Record<string, unknown>;
let neteaseLyricsOf: LyricsOf;

beforeAll(async () => {
    ({ neteaseLyricsOf } = await import('../../../sources/netease/core/neteaseProvider') as unknown as { neteaseLyricsOf: LyricsOf });
});

describe('NetEase lyrics as tracks', () => {
    it('hands the line-timed lrc with its translation and romanization, and the word-timed yrc with its own', () => {
        expect(neteaseLyricsOf({
            lrc: { lyric: '[00:01.00]Hello' },
            tlyric: { lyric: '[00:01.00]你好' },
            romalrc: { lyric: '[00:01.00]ni hao' },
            yrc: { lyric: '[1000,1000](1000,500,0)Hel(1500,500,0)lo' },
            ytlrc: { lyric: '[00:01.00]你好（逐字）' },
        })).toEqual({
            main: { format: 'lrc', text: '[00:01.00]Hello', translationText: '[00:01.00]你好', romanizationText: '[00:01.00]ni hao' },
            wordByWord: { format: 'yrc', text: '[1000,1000](1000,500,0)Hel(1500,500,0)lo', translationText: '[00:01.00]你好（逐字）' },
        });
    });

    it('reads the enhanced LRC NetEase sometimes hands in lrc as such', () => {
        expect(neteaseLyricsOf({ lrc: { lyric: '[00:01.00]<00:01.00>Hel<00:01.50>lo' } })).toMatchObject({ main: { format: 'enhanced-lrc' } });
    });

    // The host's reading handed no lyrics for an instrumental song; folium.omni.getLyrics tells it as no lines.
    it('hands no track for an instrumental song, flagged or said so in its text', () => {
        expect(neteaseLyricsOf({ pureMusic: true, lrc: { lyric: '[00:00.00]作曲 : 某人' } })).toEqual({ isPureMusic: true });
        expect(neteaseLyricsOf({ lrc: { lyric: '[00:00.00]纯音乐，请欣赏' } })).toEqual({ isPureMusic: true });
    });

    it('hands nothing for an answer without lyrics', () => {
        expect(neteaseLyricsOf(null)).toEqual({});
        expect(neteaseLyricsOf({ code: 200 })).toEqual({});
    });
});

describe('a local song matched to a NetEase song', () => {
    it('keeps that song as its identity, and is fetched again by a positive whole-number id only', () => {
        expect(getLyricSource('netease')).toMatchObject({ id: 'netease', platform: true, localMetadataIdentity: true });
        const access = getLyricSourceAccess('netease');
        // Stored ids: numbers before the move, text after; both are read.
        expect(access.knownById?.(1859082445)).toBe('1859082445');
        expect(access.knownById?.('1859082445')).toBe('1859082445');
        expect(access.knownById?.(' 42 ')).toBe('42');
        for (const id of [0, -1, 1.5, '', 'abc', '12a', '0']) {
            expect(access.knownById?.(id as never), String(id)).toBeNull();
        }
    });
});
