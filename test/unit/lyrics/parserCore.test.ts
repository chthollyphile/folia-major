import { describe, expect, it } from 'vitest';
import { detectTimedLyricFormat } from '@/utils/lyrics/formatDetection';
import {
    parseEnhancedLRC,
    parseLRC,
    parseLyricsByFormat,
    parseQRC,
    parseVTT,
    parseYRC
} from '@/utils/lyrics/parserCore';
import { splitCombinedTimeline } from '@/utils/lyrics/timelineSplitter';

const expectNonDecreasingWordTimes = (words: Array<{ startTime: number; endTime: number }>) => {
    for (let index = 1; index < words.length; index += 1) {
        expect(words[index].startTime).toBeGreaterThanOrEqual(words[index - 1].startTime);
        expect(words[index].endTime).toBeGreaterThanOrEqual(words[index].startTime);
    }
};

describe('parserCore', () => {
    it('parses standard LRC with translation matching and interlude insertion', () => {
        const lyrics = parseLRC(
            '[00:04.00]Hello world\n[00:10.00]再见',
            '[00:04.20]你好 世界\n[00:10.10]Goodbye'
        );

        expect(lyrics.lines).toHaveLength(3);
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('Hello world');
        expect(lyrics.lines[1].translation).toBe('你好 世界');
        expect(lyrics.lines[2].fullText).toBe('再见');
        expect(lyrics.lines[2].translation).toBe('Goodbye');
        expectNonDecreasingWordTimes(lyrics.lines[1].words);
    });

    it('parses enhanced LRC metadata and precise word timing', () => {
        const lyrics = parseEnhancedLRC(
            '[ti:Song]\n[ar:Artist]\n[00:00.000]<00:00.000>你<00:00.300>好<00:00.600>!<00:00.900>',
            '[00:00.000]Hello'
        );

        expect(lyrics.title).toBe('Song');
        expect(lyrics.artist).toBe('Artist');
        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].fullText).toBe('你好!');
        expect(lyrics.lines[0].translation).toBe('Hello');
        expect(lyrics.lines[0].words.map(word => word.text)).toEqual(['你', '好', '!']);
        expect(lyrics.lines[0].words[0].startTime).toBe(0);
        expect(lyrics.lines[0].words[0].endTime).toBe(0.3);
    });

    it('parses YRC with translation alignment and preserved word timing', () => {
        const lyrics = parseYRC(
            '[1000,800](1000,250,0)你(1250,250,0)好',
            '[00:01.00]hello'
        );

        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].startTime).toBe(1);
        expect(lyrics.lines[0].endTime).toBe(1.8);
        expect(lyrics.lines[0].fullText).toBe('你好');
        expect(lyrics.lines[0].translation).toBe('hello');
        expect(lyrics.lines[0].words.map(word => word.text)).toEqual(['你', '好']);
        expectNonDecreasingWordTimes(lyrics.lines[0].words);
    });

    it('parses QRC with translation alignment and preserved word timing', () => {
        const lyrics = parseQRC(
            '[1000,800](1000,250)你(1250,250)好',
            '[00:01.00]hello'
        );

        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].startTime).toBe(1);
        expect(lyrics.lines[0].endTime).toBe(1.8);
        expect(lyrics.lines[0].fullText).toBe('你好');
        expect(lyrics.lines[0].translation).toBe('hello');
        expect(lyrics.lines[0].words.map(word => word.text)).toEqual(['你', '好']);
        expectNonDecreasingWordTimes(lyrics.lines[0].words);
    });

    it('parses VTT cues and strips cue markup', () => {
        const lyrics = parseVTT(
            'WEBVTT\n\n00:00.000 --> 00:01.500\n<c.red>Hello&nbsp;&amp; hi</c>',
            'WEBVTT\n\n00:00.000 --> 00:01.500\n你好'
        );

        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].fullText).toBe('Hello & hi');
        expect(lyrics.lines[0].translation).toBe('你好');
        expect(lyrics.lines[0].endTime).toBe(1.5);
    });

    it('dispatches formats through parseLyricsByFormat', () => {
        const lyrics = parseLyricsByFormat(
            'enhanced-lrc',
            '[00:00.000]<00:00.000>A<00:00.500>B<00:01.000>',
            ''
        );

        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].words.map(word => word.text)).toEqual(['A', 'B']);
    });

    it('dispatches qrc through parseLyricsByFormat', () => {
        const lyrics = parseLyricsByFormat(
            'qrc',
            '[1000,800](1000,250)你(1250,250)好',
            '[00:01.00]hello'
        );

        expect(lyrics.lines).toHaveLength(1);
        expect(lyrics.lines[0].fullText).toBe('你好');
        expect(lyrics.lines[0].translation).toBe('hello');
    });

    it('preserves parsing semantics for out-of-order LRC input after conditional sorting', () => {
        const lyrics = parseLRC(
            '[00:10.00]Second\n[00:04.00]First',
            '[00:10.10]Deuxieme\n[00:04.20]Premier'
        );

        expect(lyrics.lines).toHaveLength(3);
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('First');
        expect(lyrics.lines[1].translation).toBe('Premier');
        expect(lyrics.lines[2].fullText).toBe('Second');
        expect(lyrics.lines[2].translation).toBe('Deuxieme');
    });

    it('parses excerpted normal LRC lines from the Hello/How are you fixture', () => {
        const excerpt = [
            '[00:12.428]ハロ窓を開けて小さく呟いた',
            '[00:17.798]ハワユ誰もいない部屋で一人',
            '[00:22.266]モーニン朝が来たよ'
        ].join('\n');

        const lyrics = parseLRC(excerpt);

        expect(lyrics.lines).toHaveLength(4);
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('ハロ窓を開けて小さく呟いた');
        expect(lyrics.lines[2].fullText).toBe('ハワユ誰もいない部屋で一人');
        expect(lyrics.lines[3].fullText).toBe('モーニン朝が来たよ');
        expect(lyrics.lines[1].translation).toBeUndefined();
        expect(lyrics.lines[1].words.length).toBeGreaterThan(5);
        expectNonDecreasingWordTimes(lyrics.lines[1].words);
    });

    it('splits alternating bilingual line-level LRC before parsing through the shared pipeline', () => {
        const combinedExcerpt = [
            '[00:12.428]ハロ窓を開けて小さく呟いた',
            '[00:12.428]你好 打开窗户轻声说道',
            '[00:17.798]ハワユ誰もいない部屋で一人',
            '[00:17.798]你好吗 独自在空无一人的房间里',
            '[00:22.266]モーニン朝が来たよ',
            '[00:22.266]早上好 清晨来临'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(combinedExcerpt);
        const format = detectTimedLyricFormat(main);
        const lyrics = parseLyricsByFormat(format, main, trans);

        expect(format).toBe('lrc');
        expect(main).toContain('[00:12.428]ハロ窓を開けて小さく呟いた');
        expect(main).not.toContain('你好 打开窗户轻声说道');
        expect(trans).toContain('[00:12.428]你好 打开窗户轻声说道');
        expect(lyrics.lines).toHaveLength(4);
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('ハロ窓を開けて小さく呟いた');
        expect(lyrics.lines[1].translation).toBe('你好 打开窗户轻声说道');
        expect(lyrics.lines[2].fullText).toBe('ハワユ誰もいない部屋で一人');
        expect(lyrics.lines[2].translation).toBe('你好吗 独自在空无一人的房间里');
    });

    it('parses bracket-timed enhanced LRC excerpts from the Hello/How are you fixture', () => {
        const combinedExcerpt = [
            '[00:12.428]ハ[00:12.667]ロ[00:13.343]窓[00:13.548]を[00:13.747]開[00:14.073]け[00:14.449]て[00:15.019]小[00:15.426]さ[00:15.637]く[00:15.794]呟[00:16.024]い[00:16.500]た[00:16.986]',
            '[00:12.428]你好 打开窗户轻声说道[00:16.986]',
            '[00:17.798]ハ[00:17.981]ワ[00:18.171]ユ[00:18.380]誰[00:18.528]も[00:18.801]い[00:19.060]な[00:19.463]い[00:20.056]部[00:20.282]屋[00:20.541]で[00:20.800]一[00:21.171]人[00:21.847]',
            '[00:17.798]你好吗 独自在空无一人的房间里[00:21.847]'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(combinedExcerpt);
        const format = detectTimedLyricFormat(main);
        const lyrics = parseLyricsByFormat(format, main, trans);

        expect(format).toBe('enhanced-lrc');
        expect(lyrics.lines).toHaveLength(3);
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('ハロ窓を開けて小さく呟いた');
        expect(lyrics.lines[1].translation).toBe('你好 打开窗户轻声说道');
        expect(lyrics.lines[1].words.slice(0, 4).map(word => word.text)).toEqual(['ハ', 'ロ', '窓', 'を']);
        expect(lyrics.lines[1].words[0].startTime).toBe(12.428);
        expect(lyrics.lines[1].words[0].endTime).toBe(12.667);
    });

    it('parses angle-timed enhanced LRC excerpts from the Hello/How are you fixture', () => {
        const combinedExcerpt = [
            '[00:12.428]<00:12.428>ハ<00:12.667>ロ<00:13.343>窓<00:13.548>を<00:13.747>開<00:14.073>け<00:14.449>て<00:15.019>小<00:15.426>さ<00:15.637>く<00:15.794>呟<00:16.024>い<00:16.500>た<00:16.986>',
            '[00:12.428]<00:12.428>你好 打开窗户轻声说道<00:16.986>',
            '[00:17.798]<00:17.798>ハ<00:17.981>ワ<00:18.171>ユ<00:18.380>誰<00:18.528>も<00:18.801>い<00:19.060>な<00:19.463>い<00:20.056>部<00:20.282>屋<00:20.541>で<00:20.800>一<00:21.171>人<00:21.847>',
            '[00:17.798]<00:17.798>你好吗 独自在空无一人的房间里<00:21.847>'
        ].join('\n');

        const { main, trans } = splitCombinedTimeline(combinedExcerpt);
        const format = detectTimedLyricFormat(main);
        const lyrics = parseLyricsByFormat(format, main, trans);

        expect(format).toBe('enhanced-lrc');
        expect(lyrics.lines).toHaveLength(3);
        expect(lyrics.title).toBeUndefined();
        expect(lyrics.lines[0].fullText).toBe('......');
        expect(lyrics.lines[1].fullText).toBe('ハロ窓を開けて小さく呟いた');
        expect(lyrics.lines[1].translation).toBe('你好 打开窗户轻声说道');
        expect(lyrics.lines[1].words.slice(0, 4).map(word => word.text)).toEqual(['ハ', 'ロ', '窓', 'を']);
        expect(lyrics.lines[1].words[2].startTime).toBe(13.343);
        expect(lyrics.lines[1].words[2].endTime).toBe(13.548);
    });
});
