import { describe, expect, it } from 'vitest';
import type { Line, LyricData } from '../../../src/types';
import { resolveRemoteLyricLine } from '../../../src/components/remote/remoteLyricLine';
import { attachInterludes, isInterludeLine } from '../../../src/utils/lyrics/parserCore';

// test/unit/remote/remoteLyricLine.test.ts
// Which line the remote window shows at a given time: the interlude lines ("......") the parser
// adds for the intro and for every pause over 3 s are gaps, never lines.

const sung = (fullText: string, startTime: number, endTime: number, extra: Partial<Line> = {}): Line => ({
    words: [],
    startTime,
    endTime,
    fullText,
    ...extra,
});

const one = sung('one', 10, 12);
const two = sung('two', 13, 15);
const three = sung('three', 20, 22);
// The parser's own interludes: 0.5 .. 9.5 before the first line, 15.05 .. 19.95 between two and three.
const lyrics: LyricData = { lines: attachInterludes([one, two, three]) };

describe('remote lyric line', () => {
    it('has the interlude lines the parser adds in its sample', () => {
        expect(lyrics.lines.map(line => (isInterludeLine(line) ? `(${line.startTime}-${line.endTime})` : line.fullText)))
            .toEqual(['(0.5-9.5)', 'one', 'two', '(15.05-19.95)', 'three']);
    });

    it('shows no line through the whole intro, interlude or not', () => {
        for (const time of [0, 0.2, 0.5, 5, 9.5, 9.99]) {
            expect(resolveRemoteLyricLine(lyrics, time), `at ${time}`).toEqual({ line: null, nextLine: one, isSinging: false });
        }
    });

    it('shows the line being sung with the next line that has words', () => {
        expect(resolveRemoteLyricLine(lyrics, 10)).toEqual({ line: one, nextLine: two, isSinging: true });
        expect(resolveRemoteLyricLine(lyrics, 12)).toEqual({ line: one, nextLine: two, isSinging: true });
        // The line after "two" in the data is an interlude: the next line is "three".
        expect(resolveRemoteLyricLine(lyrics, 14)).toEqual({ line: two, nextLine: three, isSinging: true });
    });

    it('keeps the line lit through a breath under 3 s', () => {
        for (const time of [12.001, 12.5, 12.999]) {
            expect(resolveRemoteLyricLine(lyrics, time), `at ${time}`).toEqual({ line: one, nextLine: two, isSinging: true });
        }
    });

    it('keeps the last line, dimmed, through an interlude in the middle and its two edges', () => {
        for (const time of [15.001, 15.049, 15.05, 17, 19.95, 19.999]) {
            expect(resolveRemoteLyricLine(lyrics, time), `at ${time}`).toEqual({ line: two, nextLine: three, isSinging: false });
        }
        expect(resolveRemoteLyricLine(lyrics, 20)).toEqual({ line: three, nextLine: null, isSinging: true });
    });

    it('keeps the last line, dimmed, after it', () => {
        expect(resolveRemoteLyricLine(lyrics, 22.001)).toEqual({ line: three, nextLine: null, isSinging: false });
        expect(resolveRemoteLyricLine(lyrics, 500)).toEqual({ line: three, nextLine: null, isSinging: false });
    });

    it('dims a pause of 3 s or more that has no interlude line in the data', () => {
        const bare: LyricData = { lines: [one, sung('late', 15, 17)] };
        expect(resolveRemoteLyricLine(bare, 13)).toEqual({ line: one, nextLine: bare.lines[1], isSinging: false });
    });

    it('measures the breath from where the line is drawn to, not from its timed end', () => {
        const held = sung('held', 10, 12, {
            renderHints: { rawDuration: 2, timingClass: 'normal', renderEndTime: 12.4, lineTransitionMode: 'normal', wordRevealMode: 'normal' },
        });
        const after = sung('after', 15.2, 17);
        const data: LyricData = { lines: [held, after] };
        expect(resolveRemoteLyricLine(data, 12.3)).toEqual({ line: held, nextLine: after, isSinging: true });
        // 15.2 - 12.4 = 2.8 s: a breath, although the timed ends are 3.2 s apart.
        expect(resolveRemoteLyricLine(data, 13)).toEqual({ line: held, nextLine: after, isSinging: true });
    });

    it('shows the later of two lines that start together, and never offers a started line as the next one', () => {
        const first = sung('first voice', 30, 36);
        const second = sung('second voice', 30, 33);
        const last = sung('last', 37, 39);
        const data: LyricData = { lines: [one, first, second, last] };
        expect(resolveRemoteLyricLine(data, 30)).toEqual({ line: second, nextLine: last, isSinging: true });
        expect(resolveRemoteLyricLine(data, 33)).toEqual({ line: second, nextLine: last, isSinging: true });
        // The shorter one is over and the longer one still runs: the line that follows is still "last".
        expect(resolveRemoteLyricLine(data, 34)).toEqual({ line: first, nextLine: last, isSinging: true });
    });

    it('keeps the line that was heard last after two lines overlapped, not the one that started last', () => {
        const long = sung('long voice', 40, 46);
        const short = sung('short voice', 41, 43);
        const last = sung('last', 47, 49);
        const data: LyricData = { lines: [long, short, last] };
        // Both are over. "long voice" ended 1 s before the next line: a breath, so it stays lit.
        expect(resolveRemoteLyricLine(data, 46.5)).toEqual({ line: long, nextLine: last, isSinging: true });
    });

    it('shows nothing without lyrics', () => {
        const none = { line: null, nextLine: null, isSinging: false };
        expect(resolveRemoteLyricLine(null, 10)).toEqual(none);
        expect(resolveRemoteLyricLine(undefined, 10)).toEqual(none);
        expect(resolveRemoteLyricLine({ lines: [] }, 10)).toEqual(none);
    });
});
