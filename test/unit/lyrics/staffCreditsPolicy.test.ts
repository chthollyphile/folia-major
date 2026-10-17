import { describe, expect, it } from 'vitest';
import { applyLyricStaffPolicy, buildLyricStaffPreview } from '@/utils/lyrics/staffCreditsPolicy';
import { parseLyricsByFormat } from '@/utils/lyrics/parserCore';
import { detectStaffBlocks, createStaffCreditMatcher } from '@/utils/lyrics/staffCredits';
import type { Line, LyricData } from '@/types';

// test/unit/lyrics/staffCreditsPolicy.test.ts

const parse = (lrc: string) => parseLyricsByFormat('lrc', lrc);
const texts = (lyrics: { lines: { fullText: string }[] } | null) =>
    (lyrics?.lines ?? []).map(line => line.fullText).filter(text => text !== '......');

const DENSE_HEAD = [
    '[00:00.00]作词 : A',
    '[00:00.20]作曲 : B',
    '[00:00.40]编曲 : C',
    '[00:00.60]制作人 : D',
].join('\n');

describe('lyric staff credit policy', () => {
    it('keeps a dense staff block but spreads it across a long intro', () => {
        const lyrics = parse(`${DENSE_HEAD}\n[00:40.00]第一句歌词`);
        const preview = buildLyricStaffPreview(lyrics);

        expect(preview.decision.verdict).toBe('retime');
        expect(preview.decision.blockLineCount).toBe(4);

        const result = applyLyricStaffPolicy(lyrics);
        expect(texts(result)).toEqual(['作词 : A', '作曲 : B', '编曲 : C', '制作人 : D', '第一句歌词']);

        const staffLines = result!.lines.filter(line => line.fullText.includes(' : '));
        const gaps = staffLines.slice(1).map((line, index) => line.startTime - staffLines[index].startTime);
        gaps.forEach(gap => expect(gap).toBeGreaterThanOrEqual(1.5));
    });

    it('leaves an already readable staff block untouched', () => {
        const lyrics = parse('[00:00.00]作词 : A\n[00:05.00]作曲 : B\n[00:10.00]编曲 : C\n[00:40.00]第一句歌词');
        const preview = buildLyricStaffPreview(lyrics);

        expect(preview.decision.verdict).toBe('keep');
        expect(applyLyricStaffPolicy(lyrics)).toEqual(lyrics);
    });

    it('hides the whole block when the intro is only long enough for part of it', () => {
        const lyrics = parse('[00:00.50]作词 : A\n[00:00.70]作曲 : B\n[00:00.90]编曲 : C\n[00:01.10]混音 : D\n[00:05.00]第一句歌词');
        const preview = buildLyricStaffPreview(lyrics);

        expect(preview.decision.verdict).toBe('hide');
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('extends the block past the dictionary through neighbouring credit-shaped lines', () => {
        const lyrics = parse([
            '[00:00.00]作词 Lyricist：A',
            '[00:00.20]作曲 Composer：B',
            '[00:00.40]指挥 Conductor：C',
            '[00:00.60]绞弦琴 Hurdy-Gurdy：D',
            '[00:02.00]第一句歌词',
        ].join('\n'));

        expect(buildLyricStaffPreview(lyrics).decision.blockLineCount).toBe(4);
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('does not stop at long bilingual credit labels', () => {
        const lyrics = parse([
            '[00:00.00]作词 Lyricist：哈尼 Hani / 项柳 Hsiang Liu',
            '[00:00.20]作曲 Composer：菀迪萌 Dimeng Yuan (HOYO-MiX)',
            '[00:00.40]编曲 Arranger：菀迪萌 Dimeng Yuan (HOYO-MiX)',
            '[00:00.60]斯瓦希里语顾问 Swahili Language Consultant：Sarah Mirza',
            '[00:00.80]指挥 Conductor：Robert Ziegler',
            '[00:01.00]乐队 Orchestra：伦敦交响乐团 London Symphony Orchestra',
            '[00:01.20]印第安笛 Native American Flute / 排箫 Pan Flute / 盖那笛 Quena：Genshin Folk Ensemble',
            '[00:03.00]第一句歌词',
        ].join('\n'));

        expect(buildLyricStaffPreview(lyrics).decision.blockLineCount).toBe(7);
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('matches bilingual cover and subtitle roles without spaces between languages', () => {
        const lyrics = parse([
            '[00:00.00]歌词字幕Subtitles：郭欣翔Hsin-Hsiang Kuo',
            '[00:00.20]单曲封面及标准字设计Cover&Title Card Designer ：吴建龙FKWU',
            '[00:00.40]单曲封面摄影Cover Photographer：郭欣翔Hsin-Hsiang Kuo',
            '[00:03.00]第一句歌词',
        ].join('\n'));

        expect(buildLyricStaffPreview(lyrics).decision.blockLineCount).toBe(3);
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('takes the separator lines between credits with the block', () => {
        const lyrics = parse([
            '[00:00.00]作词 Lyricist：A',
            '[00:00.10]#',
            '[00:00.20]作曲 Composer：B',
            '[00:00.30]#',
            '[00:00.40]指挥 Conductor：C',
            '[00:00.50]#',
            '[00:00.60]乐队 Orchestra：D',
            '[00:00.70]//',
            '[00:02.00]第一句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics);
        expect(preview.decision.blockLineCount).toBe(4);
        expect(preview.decision.memberIndexes).toHaveLength(8);
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('does not let structural extension swallow a lone colon-shaped lyric line', () => {
        const lyrics = parse('[00:00.00]作词 : A\n[00:00.20]作曲 : B\n[00:01.00]他说：我爱你\n[00:03.00]第一句歌词');

        const preview = buildLyricStaffPreview(lyrics);
        expect(preview.decision.blockLineCount).toBe(2);
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['他说：我爱你', '第一句歌词']);
    });

    it('hides the block when the intro cannot hold even one card', () => {
        const lyrics = parse(`${DENSE_HEAD}\n[00:02.00]第一句歌词`);
        const preview = buildLyricStaffPreview(lyrics);

        expect(preview.decision.verdict).toBe('hide');
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['第一句歌词']);
    });

    it('tolerates a leading title line before the staff block', () => {
        const lyrics = parse(
            '[00:00.00]某首歌 - 某歌手\n[00:01.00]作词 : A\n[00:01.20]作曲 : B\n[00:01.40]编曲 : C\n[00:03.00]第一句歌词'
        );

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('hide');
        expect(texts(applyLyricStaffPolicy(lyrics))).toEqual(['某首歌 - 某歌手', '第一句歌词']);
    });

    it('does not treat a colon-shaped lyric line as a credit block', () => {
        const lyrics = parse('[00:00.00]鼓起勇气：向前走\n[00:00.20]他说：我爱你\n[00:02.00]第一句歌词');

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('none');
        expect(applyLyricStaffPolicy(lyrics)).toEqual(lyrics);
    });

    it('needs at least two credit lines before it touches anything', () => {
        const lyrics = parse('[00:00.00]作词 : A\n[00:02.00]第一句歌词\n[00:06.00]第二句歌词');

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('none');
    });

    it('still matches the common combined and aliased credit formats', () => {
        const lyrics = parse([
            '[00:00.00]词曲：某某',
            '[00:00.20]混音/母带：X',
            '[00:00.40]鼓 Drums：Y',
            '[00:02.00]第一句歌词',
        ].join('\n'));

        expect(buildLyricStaffPreview(lyrics).decision.blockLineCount).toBe(3);
    });

    it('ignores credit-shaped lines that are not at the head', () => {
        const lyrics = parse('[00:01.00]第一句歌词\n[00:02.00]第二句歌词\n[00:03.00]演唱 : A\n[00:04.00]第三句歌词');

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('none');
        expect(applyLyricStaffPolicy(lyrics)).toEqual(lyrics);
    });

    it('retimes every nested timeline, not just the main words', () => {
        const richStaffLine = (text: string, startTime: number, endTime: number): Line => ({
            fullText: text,
            startTime,
            endTime,
            words: [{
                text,
                startTime,
                endTime,
                syllables: [{ text, startTime, endTime, ruby: [{ text: 'ruby', startTime, endTime }] }],
            }],
            alternateTexts: [{ role: 'translation', text: 'translated', syllables: [{ text: 'translated', startTime, endTime }] }],
            backgroundVocals: [{
                text: 'background',
                startTime,
                endTime,
                words: [{ text: 'background', startTime, endTime }],
            }],
        });

        const lyrics: LyricData = {
            lines: [
                richStaffLine('作词 : A', 0, 0.2),
                richStaffLine('作曲 : B', 0.2, 0.4),
                { fullText: '第一句歌词', startTime: 40, endTime: 44, words: [] },
            ],
        };

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('retime');

        const retimed = applyLyricStaffPolicy(lyrics)!.lines.find(line => line.fullText === '作词 : A')!;
        const word = retimed.words[0];
        const syllable = word.syllables![0];

        expect(retimed.startTime).toBe(0);
        expect(retimed.endTime).toBeGreaterThan(1.5);
        expect([word.startTime, syllable.startTime, syllable.ruby![0].startTime]).toEqual([
            retimed.startTime, retimed.startTime, retimed.startTime,
        ]);
        expect([word.endTime, syllable.endTime, syllable.ruby![0].endTime]).toEqual([
            retimed.endTime, retimed.endTime, retimed.endTime,
        ]);
        expect(retimed.alternateTexts![0].syllables![0]).toMatchObject({
            startTime: retimed.startTime,
            endTime: retimed.endTime,
        });
        expect(retimed.backgroundVocals![0]).toMatchObject({
            startTime: retimed.startTime,
            endTime: retimed.endTime,
        });
        expect(retimed.backgroundVocals![0].words[0]).toMatchObject({
            startTime: retimed.startTime,
            endTime: retimed.endTime,
        });
    });

    it('never touches lyrics under the keep policy and always hides under the hide policy', () => {
        const lyrics = parse(`${DENSE_HEAD}\n[00:40.00]第一句歌词`);

        expect(applyLyricStaffPolicy(lyrics, { policy: 'keep' })).toEqual(lyrics);
        expect(texts(applyLyricStaffPolicy(lyrics, { policy: 'hide' }))).toEqual(['第一句歌词']);
    });

    it('honours a custom staff pattern instead of the built-in dictionary', () => {
        const lyrics = parse('[00:00.00]Special Thanks : A\n[00:00.20]Special Thanks : B\n[00:02.00]第一句歌词');

        expect(buildLyricStaffPreview(lyrics).decision.verdict).toBe('none');
        expect(texts(applyLyricStaffPolicy(lyrics, { pattern: '^Special Thanks' }))).toEqual(['第一句歌词']);
    });

    it('respects the minimum dwell setting when sizing the intro budget', () => {
        const lyrics = parse('[00:00.00]作词 : A\n[00:00.20]作曲 : B\n[00:06.00]第一句歌词');

        expect(buildLyricStaffPreview(lyrics, { minDwellSeconds: 1.5 }).decision.verdict).toBe('retime');
        expect(buildLyricStaffPreview(lyrics, { minDwellSeconds: 4 }).decision.verdict).toBe('hide');
    });
});

describe('lyric staff credit absorption', () => {
    // 块首前面是一条 0.5 秒的标题行，后面是一条词表没认出来的署名行（同样 0.5 秒）。
    const WITH_NEIGHBOURS = [
        '[00:00.00]某首歌 - 某歌手',
        '[00:01.00]作词 : A',
        '[00:01.20]作曲 : B',
        '[00:01.40]编曲 : C',
        '[00:03.00]第一句歌词',
    ].join('\n');

    it('leaves the block alone while absorption is off', () => {
        const lyrics = parse(WITH_NEIGHBOURS);
        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'off' });

        expect(preview.decision.absorbedLineCount).toBe(0);
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'off' }))).toEqual([
            '某首歌 - 某歌手', '第一句歌词',
        ]);
    });

    it('folds the short line before the block into it', () => {
        const lyrics = parse(WITH_NEIGHBOURS);
        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'before' });

        expect(preview.decision.absorbedLineCount).toBe(1);
        expect(preview.decision.absorbedIndexes).toEqual([0]);
        // 吸收行进了 memberIndexes，隐藏判定下和署名行一起消失。
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'before' }))).toEqual(['第一句歌词']);
    });

    it('folds short lines on both sides of the block into it', () => {
        // 块后这条没有冒号，进不了词表也进不了结构续接，只能靠吸收带走。
        const lyrics = parse([
            '[00:00.00]某首歌 - 某歌手',
            '[00:01.00]作词 : A',
            '[00:01.20]作曲 : B',
            '[00:01.40]Genshin Folk Ensemble',
            '[00:02.50]第一句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'both' });

        expect(preview.decision.absorbedLineCount).toBe(2);
        expect(preview.decision.absorbedIndexes).toEqual([0, 3]);
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'both' }))).toEqual(['第一句歌词']);
    });

    it('folds a run of short lines however long it is', () => {
        // 边界只由「耗时过短」决定，不设行数上限：块后连续 6 条 0.2 秒的碎片要整段带走，
        // 末尾那条 Ah~ 唱足 5 秒，是耗时达标后停下来的地方。
        const lyrics = parse([
            '[00:00.00]作词 : A',
            '[00:00.20]作曲 : B',
            '[00:00.40]短行一',
            '[00:00.60]短行二',
            '[00:00.80]短行三',
            '[00:01.00]短行四',
            '[00:01.20]短行五',
            '[00:01.40]短行六',
            '[00:01.60]Ah~~~~~~',
            '[00:08.00]第一句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'both' });

        expect(preview.decision.blockLineCount).toBe(2);
        expect(preview.decision.absorbedLineCount).toBe(6);
        expect(preview.decision.absorbedIndexes).toEqual([2, 3, 4, 5, 6, 7]);
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'both' }))).toEqual(['Ah~~~~~~', '第一句歌词']);
    });

    it('judges absorption by duration, not by text length', () => {
        // 唱足 3 秒的 "Ah~" 字数很短，但耗时达标，不能被吸走。
        const lyrics = parse([
            '[00:00.00]作词 : A',
            '[00:00.20]作曲 : B',
            '[00:01.00]Ah~~~~~~',
            '[00:04.00]第一句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'both' });

        expect(preview.decision.absorbedLineCount).toBe(0);
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'both' }))).toEqual([
            'Ah~~~~~~', '第一句歌词',
        ]);
    });

    it('spreads absorbed lines together with the credits when the intro is long enough', () => {
        const lyrics = parse([
            '[00:00.00]某首歌 - 某歌手',
            '[00:01.00]作词 : A',
            '[00:01.20]作曲 : B',
            '[00:40.00]第一句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'before' });
        expect(preview.decision.verdict).toBe('retime');

        const result = applyLyricStaffPolicy(lyrics, { absorbMode: 'before' })!;
        expect(texts(result)).toEqual(['某首歌 - 某歌手', '作词 : A', '作曲 : B', '第一句歌词']);

        const spread = result.lines.slice(0, 3);
        const gaps = spread.slice(1).map((line, index) => line.startTime - spread[index].startTime);
        gaps.forEach(gap => expect(gap).toBeGreaterThanOrEqual(1.5));
    });

    it('counts absorbed lines in the required intro budget', () => {
        const lyrics = parse([
            '[00:00.00]某首歌 - 某歌手',
            '[00:01.00]作词 : A',
            '[00:01.20]作曲 : B',
            '[00:08.00]第一句歌词',
        ].join('\n'));

        const without = buildLyricStaffPreview(lyrics, { absorbMode: 'off' }).decision;
        const withAbsorb = buildLyricStaffPreview(lyrics, { absorbMode: 'before' }).decision;

        // 吸收进来的一行也要占一份停留时间，需要的秒数比不吸收时多一个 minDwell。
        expect(withAbsorb.requiredSeconds - without.requiredSeconds).toBeCloseTo(1.5, 5);
    });

    it('never swallows the last line while absorbing backwards', () => {
        const lyrics = parse([
            '[00:00.00]作词 : A',
            '[00:00.20]作曲 : B',
            '[00:00.40]第一句歌词',
            '[00:00.60]第二句歌词',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { absorbMode: 'both' });

        expect(preview.decision.absorbedLineCount).toBe(1);
        expect(texts(applyLyricStaffPolicy(lyrics, { absorbMode: 'both' }))).toEqual(['第二句歌词']);
    });

    it('reports no absorption when there is no block', () => {
        const lyrics = parse('[00:01.00]第一句歌词\n[00:04.00]第二句歌词');

        expect(buildLyricStaffPreview(lyrics, { absorbMode: 'both' }).decision.absorbedLineCount).toBe(0);
    });
});

describe('staff credits outside the intro', () => {
    // 《告白》那种排法：开头就是歌词，制作名单塞在中间的间奏里。
    // 只认开头块的检测会把这些行当正文唱出来。
    const MID_SONG = [
        '[00:00.50]又到这一天 熟悉的地方',
        '[00:07.01]颤抖的指尖 拨响了吉他',
        '[00:25.91]',
        '[00:27.03]作词：Siren',
        '[00:30.35]作曲：Siren',
        '[00:33.15]编曲：璐儿爷',
        '[00:36.13]制作人：MusikM',
        '[00:50.16]',
        '[00:51.43]天明之前 陪我去银河',
    ].join('\n');

    it('finds a credit block that sits in the middle of the song', () => {
        const lyrics = parse(MID_SONG);
        const preview = buildLyricStaffPreview(lyrics, { policy: 'hide' });

        expect(preview.decision.blockLineCount).toBe(4);
        expect(preview.decision.staffIndexes).toEqual([2, 3, 4, 5]);
    });

    it('hides only the mid-song block and leaves both lyrics intact', () => {
        const result = applyLyricStaffPolicy(parse(MID_SONG), { policy: 'hide' });

        expect(texts(result)).toEqual([
            '又到这一天 熟悉的地方',
            '颤抖的指尖 拨响了吉他',
            '天明之前 陪我去银河',
        ]);
    });

    it('keeps the mid-song block untouched under the keep policy', () => {
        const lyrics = parse(MID_SONG);
        expect(texts(applyLyricStaffPolicy(lyrics, { policy: 'keep' }))).toContain('作词：Siren');
    });

    it('finds a credit block at the end of the song', () => {
        // 非开头块要求至少三行署名，所以这里给三条：两行以下的名单不再被识别。
        const lyrics = parse([
            '[00:10.00]第一句歌词',
            '[00:20.00]第二句歌词',
            '[01:40.00]作词：X',
            '[01:42.00]作曲：Y',
            '[01:44.00]编曲：Z',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { policy: 'hide' });
        expect(preview.decision.staffIndexes).toEqual([2, 3, 4]);
        expect(texts(applyLyricStaffPolicy(lyrics, { policy: 'hide' }))).toEqual(['第一句歌词', '第二句歌词']);
    });

    it('does not treat a lone colon line inside the lyrics as a block', () => {
        const lyrics = parse([
            '[00:10.00]鼓起勇气：向前走',
            '[00:20.00]他说：我爱你',
            '[00:30.00]第三句',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics, { policy: 'hide' });
        expect(preview.decision.verdict).toBe('none');
        expect(texts(applyLyricStaffPolicy(lyrics, { policy: 'hide' }))).toEqual([
            '鼓起勇气：向前走', '他说：我爱你', '第三句',
        ]);
    });
});

describe('staff credits outside the intro under the default smart policy', () => {
    // 中间块：块首 27.03，块后第一句 51.43 → 窗口约 24 秒，够放七行。
    const MID = [
        '[00:00.50]又到这一天 熟悉的地方',
        '[00:07.01]颤抖的指尖 拨响了吉他',
        '[00:27.03]作词：Siren',
        '[00:30.35]作曲：Siren',
        '[00:33.15]编曲：璐儿爷',
        '[00:36.13]制作人：MusikM',
        '[00:51.43]天明之前 陪我去银河',
    ].join('\n');

    it('evaluates a mid-song block under smart instead of silently skipping it', () => {
        const lyrics = parse(MID);
        const preview = buildLyricStaffPreview(lyrics);

        // 窗口 24.40 秒、需求 7.00 秒，够放且行距已经排得开 → keep。
        expect(preview.decision.blockLineCount).toBe(4);
        expect(preview.decision.verdict).toBe('keep');
    });

    it('never loses lyrics under smart, whatever the verdict is', () => {
        const result = applyLyricStaffPolicy(parse(MID));
        const texts = (result?.lines ?? []).map(line => line.fullText);

        expect(texts).toContain('又到这一天 熟悉的地方');
        expect(texts).toContain('颤抖的指尖 拨响了吉他');
        expect(texts).toContain('天明之前 陪我去银河');
    });

    it('handles an end-of-song block whose firstLyricIndex is null', () => {
        // 末尾块没有「之后的正文行」，firstLyricIndex 在这条路径上是 null，
        // 旧实现只在「整首都是署名」时才遇到 null，这里要确认不会算出 NaN。
        const lyrics = parse([
            '[00:10.00]第一句歌词',
            '[00:20.00]第二句歌词',
            '[01:40.00]作词：X',
            '[01:42.00]作曲：Y',
            '[01:44.00]编曲：Z',
        ].join('\n'));

        const preview = buildLyricStaffPreview(lyrics);

        expect(preview.decision.verdict).toBe('keep');
        expect(Number.isFinite(preview.decision.windowSeconds)).toBe(true);
        const texts = (applyLyricStaffPolicy(lyrics)?.lines ?? []).map(line => line.fullText);
        expect(texts).toContain('第一句歌词');
        expect(texts).toContain('第二句歌词');
    });

    it('keeps the previous lyric timing when a mid-song block is hidden', () => {
        const raw = parse(MID);
        const reference = raw!.lines.find(item => item.fullText === '颤抖的指尖 拨响了吉他')!;
        const result = applyLyricStaffPolicy(raw, { policy: 'hide' });
        const line = (result?.lines ?? []).find(item => item.fullText === '颤抖的指尖 拨响了吉他');

        expect(line).toBeTruthy();
        // 与未处理时同一行严格相等：块被摘掉不该改动前一句的结束时间。
        expect(line!.endTime).toBeCloseTo(reference.endTime, 5);
    });
});

describe('staff credits: verdicts that actually exercise the new paths', () => {
    it('hides a mid-song block when its window is too small', () => {
        // 四行署名挤在 1 秒内，后一句 1 秒后就到：窗口 1 秒 < 需求 7 秒 → hide。
        const lyrics = parse([
            '[00:00.00]第一句',
            '[00:05.00]作词：A',
            '[00:05.20]作曲：B',
            '[00:05.40]编曲：C',
            '[00:05.60]制作人：D',
            '[00:06.00]第二句',
        ].join('\n'));

        const result = applyLyricStaffPolicy(lyrics, { policy: 'smart' });
        const texts = (result?.lines ?? []).map(line => line.fullText);

        expect(texts).toEqual(['第一句', '第二句']);
    });

    it('retimes a mid-song block whose lines are packed too tight', () => {
        // 窗口 30 秒足够，但四行只隔 0.1 秒 → 必须重排，且结果要落在前后句之间。
        const lyrics = parse([
            '[00:00.00]第一句',
            '[00:20.00]作词：A',
            '[00:20.10]作曲：B',
            '[00:20.20]编曲：C',
            '[00:50.00]第二句',
        ].join('\n'));

        const result = applyLyricStaffPolicy(lyrics, { policy: 'smart' });
        const lines = result?.lines ?? [];
        const credits = lines.filter(line => line.fullText.includes('：'));

        expect(credits.length).toBeGreaterThanOrEqual(3);
        // 时间必须单调递增，且全部落在前一句与后一句之间。
        credits.forEach((line, index) => {
            if (index > 0) expect(line.startTime).toBeGreaterThan(credits[index - 1].startTime);
            // 块首行 20 秒，下一句 50 秒；重排后必须落在这个区间里。
            expect(line.startTime).toBeGreaterThanOrEqual(20);
            expect(line.endTime).toBeLessThanOrEqual(49);
        });
        // 每行至少停留用户设定的 1.5 秒。
        credits.forEach((line, index) => {
            const end = index + 1 < credits.length ? credits[index + 1].startTime : line.endTime;
            expect(end - line.startTime).toBeGreaterThanOrEqual(1.5);
        });
    });

    it('processes two blocks that both need work in one pass', () => {
        // 开头一个块（2 行，够开头门槛）、中间一个块（3 行），hide 下两块都要被摘掉。
        const lyrics = parse([
            '[00:00.00]歌名 - 歌手',
            '[00:01.00]作词：A',
            '[00:02.00]作曲：B',
            '[00:03.00]第一句歌词',
            '[00:20.00]作词：C',
            '[00:20.20]作曲：D',
            '[00:20.40]编曲：E',
            '[00:40.00]第二句歌词',
        ].join('\n'));

        const result = applyLyricStaffPolicy(lyrics, { policy: 'hide' });
        const texts = (result?.lines ?? []).map(line => line.fullText);

        expect(texts).toContain('歌名 - 歌手');
        expect(texts).toContain('第一句歌词');
        expect(texts).toContain('第二句歌词');
        expect(texts.some(text => text.includes('作词'))).toBe(false);
    });

});

describe('staff credits: block boundaries', () => {
    it('keeps two adjacent blocks as separate ranges', () => {
        const lyrics = parse([
            '[00:00.00]歌名 - 歌手',
            '[00:01.00]作词：A',
            '[00:02.00]作曲：B',
            '[00:03.00]短句',
            '[00:03.50]作词：C',
            '[00:04.00]作曲：D',
            '[00:04.50]编曲：E',
            '[00:20.00]正文',
        ].join('\n'));

        const lines = lyrics!.lines;
        const blocks = detectStaffBlocks(lines, createStaffCreditMatcher());

        expect(blocks.length).toBe(2);
        expect(blocks[0].fromLeading).toBe(true);
        expect(blocks[1].fromLeading).toBeUndefined();

        // 两个块的下标区间不能相交：否则隐藏第一个块会连带删掉第二个块的署名行。
        const first = new Set(blocks[0].memberIndexes);
        const overlap = blocks[1].memberIndexes.filter(index => first.has(index));
        expect(overlap).toEqual([]);
    });
});

describe('staff credits: absorb must not reach into another block', () => {
    it('keeps both blocks intact under smart + both', () => {
        // 审查推演过的场景：块 2 的前两行各只有 0.5 秒，算短行，
        // 没有禁区时会被块 1 一路吸进来，随后随块 1 一起被删掉。
        const lyrics = parse([
            '[00:00.00]歌名 - 歌手',
            '[00:01.00]作词：A',
            '[00:02.00]作曲：B',
            '[00:03.00]短句',
            '[00:03.50]作词：C',
            '[00:04.00]作曲：D',
            '[00:04.50]编曲：E',
            '[00:20.00]正文',
        ].join('\n'));

        const result = applyLyricStaffPolicy(lyrics, { policy: 'smart', absorbMode: 'both' });
        const texts = (result?.lines ?? []).map(line => line.fullText);

        // 标题行会被 both 模式吸收（这是 absorbAdjacentLines 的既有语义，不是本次改动），
        // 真正要守住的是：块 2 的三行不能被块 1 吞掉后一起删除，正文也不能丢。
        expect(texts).toEqual(['......', '作词：C', '作曲：D', '编曲：E', '正文']);
    });
});

describe('staff credits: whole-song credits behind a title line', () => {
    const withTitle = (head: string) => parse([
        head,
        '[00:01.00]作词：A',
        '[00:02.00]作曲：B',
        '[00:03.00]编曲：C',
    ].join('\n'));

    it('keeps the whole-song block when it starts after a title line', () => {
        const preview = buildLyricStaffPreview(withTitle('[00:00.00]某首歌 - 某歌手'));

        expect(preview.decision.verdict).toBe('keep');
    });

    it('keeps the whole-song block when it starts after a filler line', () => {
        const preview = buildLyricStaffPreview(withTitle('[00:00.00]###'));

        expect(preview.decision.verdict).toBe('keep');
    });

    it('does not flip the verdict with the absorb mode', () => {
        const off = buildLyricStaffPreview(withTitle('[00:00.00]某首歌 - 某歌手'), { absorbMode: 'off' });
        const before = buildLyricStaffPreview(withTitle('[00:00.00]某首歌 - 某歌手'), { absorbMode: 'before' });

        expect(off.decision.verdict).toBe('keep');
        expect(before.decision.verdict).toBe('keep');
    });
});

describe('staff credits: end-of-song block verdicts', () => {
    // 末尾块没有可以参照的下一句，判定只看行距：读得清 keep，读不清 hide。
    // windowSeconds 在这条路径上只是报告值，不参与判定。
    const tail = (rows: string[]) => parse([
        '[00:10.00]第一句歌词',
        '[00:20.00]第二句歌词',
        ...rows,
    ].join('\n'));

    it('hides a densely packed end-of-song block', () => {
        const preview = buildLyricStaffPreview(tail(['[01:00.00]作词：X', '[01:00.20]作曲：Y', '[01:00.40]编曲：Z']));
        expect(preview.decision.verdict).toBe('hide');
    });

    // 末尾块按设计不做 retime：没有下一句可以把它摊开，重排只会把行推到块尾之外。

    it('hides an end-of-song block whose spacing is still under the dwell floor', () => {
        // 三条行距 1.0 秒：旧窗口规则会算出窗口 7.0 >= 需求 5.5 然后判 retime，
        // 新规则只看行距（1.0 < 1.5）判 hide。这条能把规则变回去的改动拦住。
        const preview = buildLyricStaffPreview(tail(['[01:00.00]作词：X', '[01:01.00]作曲：Y', '[01:02.00]编曲：Z']));
        expect(preview.decision.verdict).toBe('hide');
    });

    it('keeps an end-of-song block that is already readable', () => {
        const preview = buildLyricStaffPreview(tail(['[01:00.00]作词：X', '[01:03.00]作曲：Y', '[01:06.00]编曲：Z']));
        expect(preview.decision.verdict).toBe('keep');
    });
});

describe('staff credits: two credit runs separated by a filler line', () => {
    it('merges them into one block without losing any credit line', () => {
        // 块 1 后面紧跟一行 #（分隔符，会被块 1 的块尾逻辑收走），再往下一行就是块 2。
        const lyrics = parse([
            '[00:00.00]歌名 - 歌手',
            '[00:01.00]作词：A',
            '[00:02.00]作曲：B',
            '[00:03.00]#',
            '[00:03.50]作词：C',
            '[00:04.00]作曲：D',
            '[00:04.50]编曲：E',
            '[00:20.00]正文',
        ].join('\n'));

        const blocks = detectStaffBlocks(lyrics!.lines, createStaffCreditMatcher());

        // 中间只隔一个分隔符的连续署名会被并成一个块 —— 这是扩展规则本身的行为
        // （词表命中就续接，# 只是块内分隔符），不是本次改动引入的。
        // 要守住的是合并不丢行：五条署名行全部在块里，而且正文不受影响。
        expect(blocks.length).toBe(1);
        expect(blocks[0].staffIndexes).toEqual([1, 2, 4, 5, 6]);

        const texts = (applyLyricStaffPolicy(lyrics, { policy: 'hide' })?.lines ?? []).map(line => line.fullText);
        expect(texts).toContain('正文');
        expect(texts.some(text => text.includes('作词'))).toBe(false);
    });
});

describe('staff credits: per-block records for the preview layer', () => {
    // 开头块和中间块都要摊开：预览层需要逐块判定，不能只拿合并后的摘要。
    const TWO_RETIME = parse([
        '[00:00.00]某首歌 - 某歌手',
        '[00:01.00]作词 : A',
        '[00:01.50]作曲 : B',
        '[00:10.00]第一句歌词',
        '[00:20.00]编曲 : C',
        '[00:20.50]制作人 : D',
        '[00:21.00]混音 : E',
        '[00:40.00]第二句歌词',
    ].join('\n'));

    it('exposes one record per detected block instead of only a merged summary', () => {
        const preview = buildLyricStaffPreview(TWO_RETIME);

        expect(preview.blocks.map(entry => entry.decision.verdict)).toEqual(['retime', 'retime']);
        expect(preview.blocks.map(entry => entry.decision.blockLineCount)).toEqual([2, 3]);
        expect(preview.blocks.map(entry => entry.block.fromLeading === true)).toEqual([true, false]);
    });

    it('marks the tail block window as report-only', () => {
        const preview = buildLyricStaffPreview(parse([
            '[00:10.00]第一句歌词',
            '[00:20.00]第二句歌词',
            '[01:00.00]作词：X',
            '[01:03.00]作曲：Y',
            '[01:06.00]编曲：Z',
        ].join('\n')));

        expect(preview.decision.verdict).toBe('keep');
        expect(preview.decision.windowKind).toBe('tail');
    });

    it('marks whole-song credits as their own window kind', () => {
        const preview = buildLyricStaffPreview(parse([
            '[00:00.00]某首歌 - 某歌手',
            '[00:01.00]作词：X',
            '[00:05.00]作曲：Y',
            '[00:09.00]编曲：Z',
        ].join('\n')));

        expect(preview.decision.verdict).toBe('keep');
        expect(preview.decision.windowKind).toBe('whole-song');
    });

    it('keeps normal window decisions comparable', () => {
        const preview = buildLyricStaffPreview(parse([
            '[00:00.00]作词：X',
            '[00:05.00]作曲：Y',
            '[00:40.00]第一句歌词',
        ].join('\n')));

        expect(preview.decision.verdict).toBe('keep');
        expect(preview.decision.windowKind).toBeUndefined();
    });
});
