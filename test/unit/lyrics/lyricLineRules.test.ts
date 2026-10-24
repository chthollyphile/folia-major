import { describe, expect, it } from 'vitest';
import { LYRIC_FILTER_REGEX_EXAMPLE } from '@/utils/lyrics/filtering';
import {
    applyLyricLineRules,
    compileLyricLineRule,
    compileLyricLineRules,
    isMidSongLine,
    legacyLyricFilterSetting,
    lyricLineRulesKey,
    matchLyricLines,
    narrowerLyricLineRule,
    readLyricLineRules,
    storedLyricLineRules,
    suggestLyricLineRules,
    withLyricLineRuleWord,
    type LyricLineRule,
} from '@/utils/lyrics/lyricLineRules';
import { isInterludeLine, parseLyricsByFormat } from '@/utils/lyrics/parserCore';

// test/unit/lyrics/lyricLineRules.test.ts
// The rules that remove lyric lines: how each shape matches, the middle-of-song test, the rules
// suggested from a clicked line, and the old single expression read as a rule that removes exactly
// the lines it removed before.

const storage = (values: { lyrics_filter_rules?: string; lyrics_filter_pattern?: string; lyrics_filter_enabled?: string }) => ({
    rules: values.lyrics_filter_rules ?? null,
    pattern: values.lyrics_filter_pattern ?? null,
    enabled: values.lyrics_filter_enabled ?? null,
});
const rule = (fields: Partial<LyricLineRule> & Pick<LyricLineRule, 'shape' | 'text'>): LyricLineRule => ({ id: 'r', on: true, ...fields });
const texts = (lyrics: ReturnType<typeof applyLyricLineRules>) => (lyrics?.lines ?? []).filter(line => !isInterludeLine(line)).map(line => line.fullText);

const SONG = parseLyricsByFormat('lrc', [
    '[00:00.00]晚风 - 林夏',
    '[00:00.50]作词：林夏',
    '[00:01.00]作曲 : 周远',
    '[00:01.50]OP：拾光音乐',
    '[00:02.50]歌词贡献者：夜航船',
    '[00:13.00]晚风吹过旧街口 (Live)',
    '[00:17.00]一曲唱到第几遍',
    '[00:22.00]版权所有 未经许可不得翻唱',
    '[00:26.00]路灯一盏一盏亮起',
    '[00:31.00]Copyright © 2020',
].join('\n'));

describe('the old expression as a rule', () => {
    const oldFilter = (pattern: string) => (
        (SONG?.lines ?? []).filter(line => !isInterludeLine(line) && !new RegExp(pattern.trim()).test(line.fullText)).map(line => line.fullText)
    );

    it.each([
        LYRIC_FILTER_REGEX_EXAMPLE,
        '^(作词|作曲)',
        '  OP  ',
        'copyright',
        '\\(Live\\)',
    ])('removes the same lines as before: %s', (pattern) => {
        const rules = readLyricLineRules(storage({ lyrics_filter_pattern: pattern }));
        expect(rules).toEqual([{ id: 'legacy', on: true, shape: 'written', text: pattern.trim() }]);
        expect(texts(applyLyricLineRules(SONG, compileLyricLineRules(rules)))).toEqual(oldFilter(pattern));
    });

    it('keeps the old switch, and an invalid expression removes nothing', () => {
        expect(readLyricLineRules(storage({ lyrics_filter_pattern: 'OP', lyrics_filter_enabled: 'false' }))[0].on).toBe(false);
        expect(readLyricLineRules(storage({ lyrics_filter_pattern: 'OP', lyrics_filter_enabled: 'true' }))[0].on).toBe(true);
        const invalid = readLyricLineRules(storage({ lyrics_filter_pattern: '[' }));
        expect(compileLyricLineRules(invalid)).toEqual([]);
        expect(texts(applyLyricLineRules(SONG, compileLyricLineRules(invalid)))).toHaveLength(10);
        expect(readLyricLineRules(storage({ lyrics_filter_pattern: '   ' }))).toEqual([]);
    });

    it('prefers saved rules, and falls back to the old expression when they cannot be read', () => {
        const saved = [{ id: 'a', on: false, shape: 'starts', text: '作词', colon: true, junk: 1 }, { id: 'b', shape: 'nope', text: 'x' }];
        expect(readLyricLineRules(storage({ lyrics_filter_rules: JSON.stringify(saved), lyrics_filter_pattern: 'OP' })))
            .toEqual([{ id: 'a', on: false, shape: 'starts', text: '作词', colon: true }]);
        expect(readLyricLineRules(storage({ lyrics_filter_rules: '[]', lyrics_filter_pattern: 'OP' }))).toEqual([]);
        expect(readLyricLineRules(storage({ lyrics_filter_rules: '{bad', lyrics_filter_pattern: 'OP' }))[0].id).toBe('legacy');
    });

    it('writes the old rule back to the old keys, or nothing once it is gone', () => {
        expect(legacyLyricFilterSetting([rule({ id: 'legacy', shape: 'written', text: ' OP ', on: false })])).toEqual({ pattern: 'OP', enabled: false });
        expect(legacyLyricFilterSetting([rule({ id: 'x', shape: 'written', text: 'OP' })])).toBeNull();
        expect(legacyLyricFilterSetting([])).toBeNull();
    });
});

describe('simple rules', () => {
    const removed = (draft: LyricLineRule) => {
        const kept = new Set(texts(applyLyricLineRules(SONG, compileLyricLineRules([draft]))));
        return texts(SONG).filter(text => !kept.has(text));
    };

    it('matches by shape, ignoring case, with the words taken literally', () => {
        expect(removed(rule({ shape: 'starts', text: '作曲', colon: true }))).toEqual(['作曲 : 周远']);
        expect(removed(rule({ shape: 'starts', text: 'op', colon: true }))).toEqual(['OP：拾光音乐']);
        expect(removed(rule({ shape: 'contains', text: '(live)' }))).toEqual(['晚风吹过旧街口 (Live)']);
        expect(removed(rule({ shape: 'whole', text: '作词：林夏' }))).toEqual(['作词：林夏']);
        expect(removed(rule({ shape: 'whole', text: '作词' }))).toEqual([]);
        expect(removed(rule({ shape: 'ends', text: '2020' }))).toEqual(['Copyright © 2020']);
        expect(removed(rule({ shape: 'preset', text: 'copyright' }))).toEqual(['版权所有 未经许可不得翻唱', 'Copyright © 2020']);
        expect(removed(rule({ shape: 'preset', text: 'lyricSource' }))).toEqual(['歌词贡献者：夜航船']);
    });

    it('removes nothing without words, when off, or for an unknown preset', () => {
        expect(compileLyricLineRule({ shape: 'contains', text: '  ' })).toBeNull();
        expect(compileLyricLineRule({ shape: 'preset', text: 'constructor' })).toBeNull();
        expect(compileLyricLineRules([rule({ shape: 'contains', text: '曲', on: false })])).toEqual([]);
    });

    it('removes a line that holds any of its words, each held by the shape', () => {
        expect(removed(rule({ shape: 'starts', text: '作词\n作曲', colon: true }))).toEqual(['作词：林夏', '作曲 : 周远']);
        expect(removed(rule({ shape: 'whole', text: '作词\n作词：林夏' }))).toEqual(['作词：林夏']);
        expect(removed(rule({ shape: 'ends', text: '2020\n(live)' }))).toEqual(['晚风吹过旧街口 (Live)', 'Copyright © 2020']);
        expect(removed(rule({ shape: 'contains', text: ' 曲 \n\nOP：' }))).toEqual(['作曲 : 周远', 'OP：拾光音乐', '一曲唱到第几遍']);
        expect(withLyricLineRuleWord('作词\n作曲', ' 作曲 ')).toBe('作词\n作曲');
        expect(withLyricLineRuleWord('', ' 编曲 ')).toBe('编曲');
    });

    it('names the first rule that matched a line', () => {
        const compiled = compileLyricLineRules([rule({ id: 'one', shape: 'contains', text: '作' }), rule({ id: 'two', shape: 'starts', text: '作词' })]);
        expect(matchLyricLines([{ fullText: '作词：A' }], compiled)[0]?.rule.id).toBe('one');
    });
});

describe('the middle of a song', () => {
    it('is after the first quarter and before the last tenth of the lines', () => {
        const mid = Array.from({ length: 20 }, (_, index) => isMidSongLine(index, 20));
        expect(mid.indexOf(true)).toBe(5);
        expect(mid.lastIndexOf(true)).toBe(17);
        expect([0, 1, 2].map(index => isMidSongLine(index, 3))).toEqual([false, true, false]);
        expect(isMidSongLine(0, 1)).toBe(false);
    });

    it('is spared by a rule that removes edges only', () => {
        const lines = Array.from({ length: 20 }, () => ({ fullText: '曲' }));
        const hits = matchLyricLines(lines, compileLyricLineRules([rule({ shape: 'contains', text: '曲', edgesOnly: true })]));
        expect(hits.map(hit => Boolean(hit))).toEqual(lines.map((_, index) => !isMidSongLine(index, 20)));
    });
});

describe('suggestions from a line', () => {
    it('offers the words before the colon, the line, and the words anywhere', () => {
        expect(suggestLyricLineRules(' 歌词贡献者：夜航船 ')).toEqual([
            { shape: 'starts', text: '歌词贡献者', colon: true },
            { shape: 'whole', text: '歌词贡献者：夜航船' },
            { shape: 'contains', text: '歌词贡献者' },
        ]);
        expect(suggestLyricLineRules('版权所有 未经许可')[0]).toEqual({ shape: 'starts', text: '版权所有' });
        expect(suggestLyricLineRules('晚风')).toEqual([{ shape: 'whole', text: '晚风' }, { shape: 'contains', text: '晚风' }]);
        expect(suggestLyricLineRules('  ')).toEqual([]);
    });

    it('narrows a rule to the start of the line, followed by a colon', () => {
        expect(narrowerLyricLineRule({ shape: 'contains', text: '曲' })).toEqual({ shape: 'starts', text: '曲', colon: true });
        expect(narrowerLyricLineRule({ shape: 'starts', text: '曲' })).toEqual({ shape: 'starts', text: '曲', colon: true });
        expect(narrowerLyricLineRule({ shape: 'starts', text: '曲', colon: true })).toBeNull();
        expect(narrowerLyricLineRule({ shape: 'written', text: '曲' })).toBeNull();
        expect(narrowerLyricLineRule({ shape: 'contains', text: '作词：\n作曲\n：' })).toEqual({ shape: 'starts', text: '作词\n作曲', colon: true });
        expect(narrowerLyricLineRule({ shape: 'starts', text: '作曲\n作词：' })).toBeNull();
    });

    it('offers nothing narrower where it would remove other lines', () => {
        expect(narrowerLyricLineRule({ shape: 'whole', text: 'Chorus' })).toBeNull();
        expect(narrowerLyricLineRule({ shape: 'ends', text: 'rights reserved' })).toBeNull();
        expect(narrowerLyricLineRule({ shape: 'starts', text: '作词：' })).toBeNull();
        expect(narrowerLyricLineRule({ shape: 'contains', text: ' ：' })).toBeNull();
    });

    it('drops the colon a contains rule ends with, so the narrower rule still needs only one', () => {
        const narrower = narrowerLyricLineRule({ shape: 'contains', text: '作词：' });
        expect(narrower).toEqual({ shape: 'starts', text: '作词', colon: true });
        expect(compileLyricLineRule(narrower!)!.test('作词：林夏')).toBe(true);
    });
});

describe('character width', () => {
    const hits = (draft: Omit<LyricLineRule, 'id' | 'on'>, text: string) => (
        matchLyricLines([{ fullText: text }], compileLyricLineRules([rule(draft)]))[0] !== null
    );

    it('makes no difference to the words of a simple rule or a preset', () => {
        expect(hits({ shape: 'starts', text: 'OP', colon: true }, 'ＯＰ：拾光音乐')).toBe(true);
        expect(hits({ shape: 'contains', text: 'ＯＰ：' }, 'OP: 拾光音乐')).toBe(true);
        expect(hits({ shape: 'whole', text: 'live' }, 'ＬＩＶＥ')).toBe(true);
        expect(hits({ shape: 'preset', text: 'copyright' }, 'ＣＯＰＹＲＩＧＨＴ 2020')).toBe(true);
    });

    it('folds only width: other compatibility forms stay other characters', () => {
        expect(hits({ shape: 'ends', text: '2' }, '面积 m²')).toBe(false);
        expect(hits({ shape: 'contains', text: '1' }, '① 第一段')).toBe(false);
        expect(hits({ shape: 'contains', text: '...' }, '等一下…')).toBe(false);
    });

    it('leaves a written rule as it was', () => {
        expect(hits({ shape: 'written', text: '^OP' }, 'ＯＰ：拾光音乐')).toBe(false);
    });
});

describe('saving', () => {
    it('keeps the saved items this version cannot read, unchanged', () => {
        const later = { id: 'b', on: true, shape: 'sounds-like', text: 'x', extra: [1] };
        const raw = JSON.stringify([{ id: 'a', on: true, shape: 'contains', text: '作词' }, later, 'damaged']);
        const [read] = readLyricLineRules(storage({ lyrics_filter_rules: raw }));
        const edited = { ...read, text: '作曲' };

        expect(JSON.parse(storedLyricLineRules([edited], raw))).toEqual([edited, later, 'damaged']);
        expect(JSON.parse(storedLyricLineRules([], raw))).toEqual([later, 'damaged']);
        expect(JSON.parse(storedLyricLineRules([edited], null))).toEqual([edited]);
        expect(JSON.parse(storedLyricLineRules([edited], '{bad'))).toEqual([edited]);
    });

    it('keeps the fields a later version added to a rule this version reads', () => {
        const raw = JSON.stringify([{ id: 'a', on: true, shape: 'starts', text: '作词', colon: true, caseSensitive: true }]);
        const [read] = readLyricLineRules(storage({ lyrics_filter_rules: raw }));

        expect(JSON.parse(storedLyricLineRules([{ ...read, text: '作曲', colon: false }], raw)))
            .toEqual([{ id: 'a', on: true, shape: 'starts', text: '作曲', caseSensitive: true }]);
    });
});

describe('the same rules', () => {
    it('are the same whatever their ids and order, and the order of their words', () => {
        const words = rule({ id: 'a', shape: 'contains', text: '作词\n作曲' });
        const preset = rule({ id: 'b', shape: 'preset', text: 'copyright' });
        const same = lyricLineRulesKey([words, preset]);

        expect(lyricLineRulesKey([{ ...preset, id: 'c' }, { ...words, text: '作曲\n 作词 ' }])).toBe(same);
        expect(lyricLineRulesKey([words, { ...preset, on: false }])).not.toBe(same);
        expect(lyricLineRulesKey([{ ...words, shape: 'starts' }, preset])).not.toBe(same);
        expect(lyricLineRulesKey([{ ...words, text: '作词' }, preset])).not.toBe(same);
        // A colon counts only where it is read: after the words at the start.
        expect(lyricLineRulesKey([{ ...words, colon: true }, preset])).toBe(same);
    });
});
