import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

// 钉住 Dux `lyrics.get` 的结果到 Folia Now Playing 歌词负载的映射：逐字行要变成 QRC，只有行时间戳的
// 要变成 LRC；文本里的换行和控制字符不能把 QRC/LRC 的行结构弄坏。

const require = createRequire(import.meta.url);
const { buildDuxLyricPayload, lrcTimestamp, qrcLine, sanitizePlain } = require('../../../electron/dux/qrcLyrics.cjs') as {
    buildDuxLyricPayload: (result: unknown) => {
        source: string;
        hasLyric: boolean;
        hasKaraokeLyric: boolean;
        lrc: string | null;
        karaokeLyric: string | null;
    } | null;
    lrcTimestamp: (milliseconds: number) => string;
    qrcLine: (line: unknown, nextLine?: unknown) => string | null;
    sanitizePlain: (value: unknown) => string;
};

describe('buildDuxLyricPayload', () => {
    it('turns word-synced lines into QRC with absolute millisecond word times', () => {
        const payload = buildDuxLyricPayload({
            found: true,
            synced: [
                { t: 7.026, e: 10.342, x: '描いた地図は', w: [{ t: 7.026, e: 7.953, x: '描いた' }, { t: 7.953, e: 8.783, x: '地図は' }] },
                { t: 10.895, e: 14.325, x: '世界は', w: [{ t: 10.895, e: 11.928, x: '世界は' }] },
            ],
        });
        expect(payload).toMatchObject({
            source: 'dux',
            hasLyric: true,
            hasKaraokeLyric: true,
            lrc: '[00:07.02]描いた地図は\n[00:10.89]世界は',
        });
        expect(payload?.karaokeLyric).toBe([
            '[7026,3316](7026,927)描いた(7953,830)地図は',
            '[10895,3430](10895,1033)世界は',
        ].join('\n'));
    });

    it('uses LRC only when the provider has no word timings', () => {
        const payload = buildDuxLyricPayload({
            found: true,
            synced: [{ t: 1.5, e: 3.2, x: '第一行' }, { t: 3.2, e: 5, x: '第二行' }],
        });
        expect(payload).toMatchObject({ hasKaraokeLyric: false, karaokeLyric: null });
        expect(payload?.lrc).toBe('[00:01.50]第一行\n[00:03.20]第二行');
    });

    it('falls back to plain lyrics when there are no timed lines', () => {
        const payload = buildDuxLyricPayload({ found: true, synced: [], plain: '第一行\n第二行' });
        expect(payload).toMatchObject({ hasKaraokeLyric: false, lrc: '第一行\n第二行' });
    });

    it('returns null for a miss or an empty result', () => {
        expect(buildDuxLyricPayload({ found: false })).toBeNull();
        expect(buildDuxLyricPayload({ found: true, synced: [], plain: '' })).toBeNull();
        expect(buildDuxLyricPayload(null)).toBeNull();
    });

    it('keeps a line break out of a QRC body', () => {
        const line = qrcLine({ t: 1, e: 2, x: 'one\ntwo' });
        expect(line).toBe('[1000,1000](1000,1000)one two');
    });

    it('gives a word without an end the next word start', () => {
        const line = qrcLine({
            t: 1,
            e: 3,
            x: 'ab',
            w: [{ t: 1, x: 'a' }, { t: 2, e: 2.5, x: 'b' }],
        });
        expect(line).toBe('[1000,2000](1000,1000)a(2000,500)b');
    });
});

describe('lrcTimestamp', () => {
    it('formats minutes, seconds and centiseconds', () => {
        expect(lrcTimestamp(0)).toBe('[00:00.00]');
        expect(lrcTimestamp(61234)).toBe('[01:01.23]');
        expect(lrcTimestamp(3600000)).toBe('[60:00.00]');
    });
});

describe('sanitizePlain', () => {
    it('keeps line breaks and drops other control characters', () => {
        expect(sanitizePlain('a\r\nb\u0000c')).toBe('a\nb c');
    });
});
