import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LyricData } from '@/types';
import { isInterludeLine } from '@/utils/lyrics/parserCore';
import { parseLyricsAsync } from '@/utils/lyrics/workerClient';
import {
    FOLIUM_CHORUS_RANGE_LIMIT,
    FOLIUM_LYRIC_TEXT_LIMIT,
    normalizeFoliumLyricsTrack,
    resolveFoliumLyricsResult,
} from '@/mods/folium/lyricsSource';
import { FOLIUM_LYRICS_HELPERS } from '@/mods/folium/sharedHelpers';

// test/unit/mod-system/foliumLyricsSource.test.ts
// Lyrics from a mod: raw text plus a format, parsed by the local lyric file pipeline. Covers track
// validation, the wordByWord -> main fallback, what reaches the host provider result, and
// folium.lyrics.parse.

// The local pipeline parses in a worker; run the same parser inline.
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

const YRC = '[1000,800](1000,250,0)你(1250,250,0)好\n[3000,800](3000,400,0)世(3400,400,0)界';
const LRC = '[00:01.00]你好\n[00:03.00]世界';
const TRANSLATION = '[00:01.00]hello\n[00:03.00]world';
const ROMANIZATION = '[00:01.00]ni hao\n[00:03.00]shi jie';
const KRC = '[1000,1200]<0,300,0>H<300,300,0>e<600,600,0>llo\n[3000,1000]<0,500,0>Wo<500,500,0>rld';
const TTML = [
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word">',
    '<body><div begin="00:01.000" end="00:05.000" itunes:songPart="Chorus">',
    '<p begin="00:01.000" end="00:05.000" itunes:key="L1">',
    '<span begin="00:01.000" end="00:02.000">Hello</span> <span begin="00:02.000" end="00:05.000">there</span>',
    '<span ttm:role="x-translation" xml:lang="zh-CN">你好呀</span>',
    '<span ttm:role="x-roman" xml:lang="en-Latn">heh-loh</span>',
    '</p>',
    '</div></body>',
    '</tt>',
].join('');

const textLines = (lyrics: LyricData | null) => (lyrics?.lines ?? []).filter((line) => !isInterludeLine(line));

let warn: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
    warn.mockRestore();
    vi.mocked(parseLyricsAsync).mockClear();
});

describe('normalizeFoliumLyricsTrack', () => {
    it('copies the fields the host reads and drops empty optional text', () => {
        const input = { format: 'yrc', text: YRC, translationText: '', romanizationText: ROMANIZATION, extra: 1 };
        expect(normalizeFoliumLyricsTrack(input)).toEqual({
            track: { format: 'yrc', text: YRC, romanizationText: ROMANIZATION },
        });
    });

    it.each([
        ['not an object', null, 'not an object'],
        ['an unknown format', { format: 'srt', text: LRC }, 'format must be one of'],
        ['a missing format', { text: LRC }, 'format must be one of'],
        ['blank text', { format: 'lrc', text: '  \n' }, 'text must be a non-empty string'],
        ['non-string translation', { format: 'lrc', text: LRC, translationText: 42 }, 'translationText must be a string'],
        ['oversized text', { format: 'lrc', text: 'x'.repeat(FOLIUM_LYRIC_TEXT_LIMIT + 1) }, 'text is longer than'],
        ['oversized romanization', { format: 'lrc', text: LRC, romanizationText: 'x'.repeat(FOLIUM_LYRIC_TEXT_LIMIT + 1) }, 'romanizationText is longer than'],
    ])('rejects %s', (_label, input, reason) => {
        const result = normalizeFoliumLyricsTrack(input);
        expect(result.track).toBeNull();
        expect(result.reason).toContain(reason);
    });
});

describe('resolveFoliumLyricsResult', () => {
    it('shows the word-timed track, borrowing the translation from main', async () => {
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC, translationText: TRANSLATION },
            wordByWord: { format: 'yrc', text: YRC, romanizationText: ROMANIZATION },
        }, 'p');

        expect(result.lyrics?.isWordByWord).toBe(true);
        const lines = textLines(result.lyrics);
        expect(lines.map((line) => line.fullText)).toEqual(['你好', '世界']);
        expect(lines[0].words.map((word) => [word.text, word.startTime])).toEqual([['你', 1], ['好', 1.25]]);
        expect(lines.map((line) => line.translation)).toEqual(['hello', 'world']);
        expect(lines.map((line) => line.romanization)).toEqual(['ni hao', 'shi jie']);
        expect(result).toMatchObject({
            mainText: null,
            wordByWordText: null,
            translationText: TRANSLATION,
            romanizationText: ROMANIZATION,
            isPureMusic: false,
        });
    });

    it('falls back to main when the word-timed track parses to no lines', async () => {
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC },
            wordByWord: { format: 'yrc', text: 'not yrc at all' },
        }, 'p');

        expect(textLines(result.lyrics).map((line) => line.fullText)).toEqual(['你好', '世界']);
        expect(result.lyrics?.isWordByWord).toBe(false);
        expect(result.mainText).toBe(LRC);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('parsed to no lines'));
    });

    it('falls back to main when the word-timed track throws while parsing', async () => {
        vi.mocked(parseLyricsAsync).mockRejectedValueOnce(new Error('worker crashed'));
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC },
            wordByWord: { format: 'yrc', text: YRC },
        }, 'p');

        expect(textLines(result.lyrics).map((line) => line.fullText)).toEqual(['你好', '世界']);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('failed to parse'), expect.objectContaining({ name: 'Error', message: 'worker crashed' }));
    });

    it('ignores a malformed track with a warning naming the provider', async () => {
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC },
            wordByWord: { format: 'srt', text: YRC },
        }, 'folium.mod-a.radio');

        expect(result.lyrics?.isWordByWord).toBe(false);
        expect(warn).toHaveBeenCalledWith(expect.stringContaining('folium.mod-a.radio: ignored the wordByWord lyrics track'));
    });

    it('reads TTML with its inline translation, romanization and chorus part', async () => {
        const result = await resolveFoliumLyricsResult({
            main: { format: 'ttml', text: TTML, translationText: TRANSLATION },
        }, 'p');

        const [line] = textLines(result.lyrics);
        expect(line.fullText).toBe('Hello there');
        expect(line.translation).toBe('你好呀');
        expect(line.romanization).toBe('heh-loh');
        expect(line.isChorus).toBe(true);
        expect(result.lyrics?.isWordByWord).toBe(true);
        // A TTML body is not LRC; the chorus text fallback must not see it.
        expect(result.mainText).toBeNull();
    });

    it('reads decrypted KRC as word-timed lyrics', async () => {
        const result = await resolveFoliumLyricsResult({ main: { format: 'krc', text: KRC } }, 'p');

        expect(result.lyrics?.isWordByWord).toBe(true);
        expect(textLines(result.lyrics).map((line) => line.fullText)).toEqual(['Hello', 'World']);
        expect(result.mainText).toBeNull();
    });

    it('reports an instrumental without parsing either track', async () => {
        const result = await resolveFoliumLyricsResult({ isPureMusic: true, main: { format: 'lrc', text: LRC } }, 'p');

        expect(result).toEqual({ lyrics: null, isPureMusic: true });
        expect(parseLyricsAsync).not.toHaveBeenCalled();
    });

    it('keeps only well-formed chorus ranges, up to the limit', async () => {
        const valid = Array.from({ length: FOLIUM_CHORUS_RANGE_LIMIT + 5 }, (_, index) => ({ startTime: index, endTime: index + 0.5 }));
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC },
            chorusRanges: [
                { startTime: Number.NaN, endTime: 2 },
                { startTime: -1, endTime: 2 },
                { startTime: 3, endTime: 3 },
                null,
                ...valid,
            ],
        }, 'p');

        expect(result.chorusRanges).toHaveLength(FOLIUM_CHORUS_RANGE_LIMIT);
        expect(result.chorusRanges?.[0]).toEqual({ startTime: 0, endTime: 0.5 });
    });

    it('omits chorus ranges when none are usable', async () => {
        const result = await resolveFoliumLyricsResult({ main: { format: 'lrc', text: LRC }, chorusRanges: [{ startTime: 2, endTime: 1 }] }, 'p');
        expect(result).not.toHaveProperty('chorusRanges');
    });

    // The documented contract: the host does not check content against its format label.
    it('parses lyrics in an unsupported form, labelled as a supported one, to nothing', async () => {
        const platformJson = JSON.stringify({ lines: [{ t: 1000, words: [{ w: '你', d: 250 }] }] });
        expect(await resolveFoliumLyricsResult({ main: { format: 'lrc', text: platformJson } }, 'p'))
            .toEqual({ lyrics: null, isPureMusic: false });
    });

    it('falls back to main when the word-timed track is mislabelled', async () => {
        const result = await resolveFoliumLyricsResult({
            main: { format: 'lrc', text: LRC },
            wordByWord: { format: 'ttml', text: YRC },
        }, 'p');

        expect(textLines(result.lyrics).map((line) => line.fullText)).toEqual(['你好', '世界']);
        expect(result.lyrics?.isWordByWord).toBe(false);
    });

    it('answers no lyrics when neither track yields lines', async () => {
        expect(await resolveFoliumLyricsResult({ main: { format: 'yrc', text: 'nothing here' } }, 'p'))
            .toEqual({ lyrics: null, isPureMusic: false });
        expect(await resolveFoliumLyricsResult({}, 'p')).toEqual({ lyrics: null, isPureMusic: false });
        expect(await resolveFoliumLyricsResult(null, 'p')).toEqual({ lyrics: null, isPureMusic: false });
    });
});

describe('folium.lyrics.parse', () => {
    it('returns frozen line DTOs with word timings', async () => {
        const parsed = await FOLIUM_LYRICS_HELPERS.parse({ format: 'yrc', text: YRC, translationText: TRANSLATION });

        expect(parsed.isWordByWord).toBe(true);
        expect(Object.isFrozen(parsed)).toBe(true);
        expect(Object.isFrozen(parsed.lines)).toBe(true);
        const lines = parsed.lines.filter((line) => line.fullText !== '......');
        expect(lines.map((line) => line.fullText)).toEqual(['你好', '世界']);
        expect(lines[0].translation).toBe('hello');
        expect(lines[0].words.map((word) => word.text)).toEqual(['你', '好']);
    });

    it('returns no lines for text that holds none', async () => {
        expect(await FOLIUM_LYRICS_HELPERS.parse({ format: 'yrc', text: 'nothing here' }))
            .toEqual({ lines: [], isWordByWord: false });
    });

    it('rejects a malformed track', async () => {
        await expect(FOLIUM_LYRICS_HELPERS.parse({ format: 'srt' as never, text: LRC }))
            .rejects.toThrow(new TypeError('invalid-lyrics-track: format must be one of lrc, enhanced-lrc, yrc, qrc, krc, ttml, vtt, awlrc'));
    });
});
