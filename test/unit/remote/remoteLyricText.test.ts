import { describe, expect, it } from 'vitest';
import type { Line, SubtitleContentMode } from '../../../src/types';
import {
    buildRemoteLyricSegments,
    REMOTE_LYRIC_BLOCK_MAX_HEIGHT,
    resolveRemoteLyricBlockHeight,
    resolveRemoteLyricFit,
    resolveRemoteLyricTexts,
} from '../../../src/components/remote/remoteLyricText';

// test/unit/remote/remoteLyricText.test.ts
// The remote window's lyric rules: which text goes under the line being sung, how the block's
// height is shared when the texts are long, and how a line is cut into the pieces that fill.

const MAIN = 'main line';
const NEXT = { fullText: 'next line' };
const next = { text: 'next line', kind: 'next' };
const translation = { text: 'tr', kind: 'translation' };

describe('remote second line', () => {
    // [mode, translation, romanization, has a next line] -> [small romanization line, second line]
    const cases: Array<[SubtitleContentMode, string | undefined, string | undefined, boolean, string | null, unknown]> = [
        ['translation', 'tr', 'ro', true, null, translation],
        ['translation', 'tr', undefined, false, null, translation],
        ['translation', undefined, 'ro', true, null, next],
        ['translation', undefined, 'ro', false, null, null],
        ['translation', undefined, undefined, true, null, next],
        ['romanization', 'tr', 'ro', true, null, { text: 'ro', kind: 'romanization' }],
        ['romanization', undefined, 'ro', false, null, { text: 'ro', kind: 'romanization' }],
        ['romanization', 'tr', undefined, true, null, next],
        ['romanization', 'tr', undefined, false, null, null],
        ['both', 'tr', 'ro', true, 'ro', translation],
        ['both', 'tr', undefined, true, null, translation],
        ['both', undefined, 'ro', true, 'ro', null],
        ['both', undefined, undefined, true, null, next],
        ['both', undefined, undefined, false, null, null],
        ['none', 'tr', 'ro', true, null, next],
        ['none', 'tr', 'ro', false, null, null],
    ];

    it.each(cases)('%s, translation %s, romanization %s, next line %s', (mode, tr, ro, hasNext, romanization, second) => {
        expect(resolveRemoteLyricTexts(mode, { fullText: MAIN, translation: tr, romanization: ro }, hasNext ? NEXT : null))
            .toEqual({ romanization, second });
    });

    it('treats blank texts as missing', () => {
        expect(resolveRemoteLyricTexts('translation', { fullText: MAIN, translation: '  ', romanization: 'ro' }, NEXT).second).toEqual(next);
        expect(resolveRemoteLyricTexts('both', { fullText: MAIN, translation: ' tr ', romanization: '\n' }, NEXT))
            .toEqual({ romanization: null, second: translation });
        expect(resolveRemoteLyricTexts('none', { fullText: MAIN }, { fullText: '   ' }).second).toBeNull();
    });

    it('shows nothing without a line', () => {
        expect(resolveRemoteLyricTexts('translation', null, NEXT)).toEqual({ romanization: null, second: null });
    });

    it('treats a translation or romanization that repeats the lyric as missing', () => {
        expect(resolveRemoteLyricTexts('translation', { fullText: MAIN, translation: ` ${MAIN} ` }, NEXT))
            .toEqual({ romanization: null, second: next });
        expect(resolveRemoteLyricTexts('translation', { fullText: `${MAIN}  `, translation: MAIN }, null))
            .toEqual({ romanization: null, second: null });
        expect(resolveRemoteLyricTexts('romanization', { fullText: MAIN, translation: 'tr', romanization: MAIN }, NEXT))
            .toEqual({ romanization: null, second: next });
        // 'both': the text that repeats the lyric is the missing one, the other stays.
        expect(resolveRemoteLyricTexts('both', { fullText: MAIN, translation: MAIN, romanization: 'ro' }, NEXT))
            .toEqual({ romanization: 'ro', second: null });
        expect(resolveRemoteLyricTexts('both', { fullText: MAIN, translation: 'tr', romanization: MAIN }, NEXT))
            .toEqual({ romanization: null, second: translation });
        expect(resolveRemoteLyricTexts('both', { fullText: MAIN, translation: MAIN, romanization: MAIN }, NEXT))
            .toEqual({ romanization: null, second: next });
    });

    it('shows a romanization that repeats the translation once, as the translation', () => {
        expect(resolveRemoteLyricTexts('both', { fullText: MAIN, translation: 'tr', romanization: ' tr ' }, NEXT))
            .toEqual({ romanization: null, second: translation });
        // Only 'both' draws the two together.
        expect(resolveRemoteLyricTexts('romanization', { fullText: MAIN, translation: 'tr', romanization: 'tr' }, NEXT))
            .toEqual({ romanization: null, second: { text: 'tr', kind: 'romanization' } });
    });
});

// A line whose words follow each other without a pause: [text, start, end] per word.
const timedLine = (words: Array<[string, number, number]>, fullText = words.map(([text]) => text).join('')): Line => ({
    words: words.map(([text, startTime, endTime]) => ({ text, startTime, endTime })),
    startTime: words[0][1],
    endTime: words[words.length - 1][2],
    fullText,
});

// Timed pieces as [text|start-end], untimed ones as (text).
const show = (line: Line) => buildRemoteLyricSegments(line)
    .map(piece => (piece.timed ? `[${piece.text}|${piece.startTime}-${piece.endTime}]` : `(${piece.text})`))
    .join('');

describe('remote lyric pieces', () => {
    it('cuts words that carry their space into a timed word and a space outside it', () => {
        expect(show(timedLine([['Paper ', 10, 10.5], ['boats ', 10.5, 11.25], ['again', 12, 13]])))
            .toBe('[Paper|10-10.5]( )[boats|10.5-11.25]( )[again|12-13]');
    });

    it('keeps the pieces of a word timed by syllable next to each other, with no space between them', () => {
        expect(show(timedLine([['won', 10, 10.5], ['der', 10.5, 11], ['ful ', 11, 11.5], ['morn', 12, 12.5], ['ing', 12.5, 13]])))
            .toBe('[won|10-10.5][der|10.5-11][ful|11-11.5]( )[morn|12-12.5][ing|12.5-13]');
    });

    it('gives each Chinese word one piece, punctuation timed as a word included', () => {
        expect(show(timedLine([['我', 10, 10.5], ['沿着', 10.5, 11.5], ['河岸', 11.5, 12], ['，', 12, 12.25], ['走了', 12.5, 13]])))
            .toBe('[我|10-10.5][沿着|10.5-11.5][河岸|11.5-12][，|12-12.25][走了|12.5-13]');
    });

    it('shares the time of a word with a space inside between its pieces, by their length', () => {
        expect(show(timedLine([['oh my ', 10, 12], ['lantern', 12, 13]])))
            .toBe('[oh|10-11]( )[my|11-12]( )[lantern|12-13]');
        expect(show(timedLine([['a bcd ', 10, 12], ['la la la', 12, 15]])))
            .toBe('[a|10-10.5]( )[bcd|10.5-12]( )[la|12-13]( )[la|13-14]( )[la|14-15]');
    });

    it('leaves punctuation that no word carries as untimed pieces between the words', () => {
        const line = timedLine([['paper', 10, 11], ['boats', 11, 12], ['again', 12, 13]], '(paper) boats, again!');
        expect(show(line)).toBe('(()[paper|10-11]() )[boats|11-12](, )[again|12-13](!)');
    });

    it('loses and repeats no text when the words are written differently from the line', () => {
        // The words cannot be found in the line by their spelling, so they are laid over it by position.
        const line = timedLine([['paper', 10, 11], ['boats', 11, 12]], 'Paper, Boats');
        const pieces = buildRemoteLyricSegments(line);
        expect(pieces.map(piece => piece.text).join('')).toBe('Paper, Boats');
        expect(pieces.filter(piece => piece.timed).every(piece => !/\s/.test(piece.text))).toBe(true);
        const times = pieces.filter(piece => piece.timed).flatMap(piece => [piece.startTime, piece.endTime]);
        expect(times).toEqual([...times].sort((left, right) => left - right));
        expect(times[0]).toBe(10);
        expect(times[times.length - 1]).toBe(12);
    });

    it('returns no pieces for a line timed by line only', () => {
        expect(buildRemoteLyricSegments({ words: [], startTime: 10, endTime: 12, fullText: 'Paper boats' })).toEqual([]);
    });
});

describe('remote lyric fit', () => {
    it('gives the second line two lines under a one-line lyric', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 1, hasRomanization: false, hasSecond: true }))
            .toEqual({ size: 'large', mainLines: 1, showRomanization: false, secondMaxLines: 2 });
    });

    it('keeps the romanization under a one-line lyric and gives the second line one line', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 1, hasRomanization: true, hasSecond: true }))
            .toEqual({ size: 'large', mainLines: 1, showRomanization: true, secondMaxLines: 1 });
    });

    it('cuts the second line to one line and drops the romanization first under a two-line lyric', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 2, hasRomanization: true, hasSecond: true }))
            .toEqual({ size: 'large', mainLines: 2, showRomanization: false, secondMaxLines: 1 });
    });

    it('keeps a romanization that is the only text under a two-line lyric', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 2, hasRomanization: true, hasSecond: false }))
            .toEqual({ size: 'large', mainLines: 2, showRomanization: true, secondMaxLines: 0 });
    });

    it('goes to the small size, two lines, for a lyric over two lines', () => {
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 3, hasRomanization: true, hasSecond: true }))
            .toEqual({ size: 'small', mainLines: 2, showRomanization: false, secondMaxLines: 1 });
        expect(resolveRemoteLyricFit({ mainLinesAtLarge: 5, hasRomanization: false, hasSecond: false }))
            .toEqual({ size: 'small', mainLines: 2, showRomanization: false, secondMaxLines: 0 });
    });

    it('never lets the block pass its 77 px', () => {
        for (const mainLinesAtLarge of [0, 1, 2, 3, 6]) {
            for (const hasRomanization of [false, true]) {
                for (const hasSecond of [false, true]) {
                    const fit = resolveRemoteLyricFit({ mainLinesAtLarge, hasRomanization, hasSecond });
                    expect(
                        resolveRemoteLyricBlockHeight(fit),
                        `${mainLinesAtLarge} lines, romanization ${hasRomanization}, second ${hasSecond}`,
                    ).toBeLessThanOrEqual(REMOTE_LYRIC_BLOCK_MAX_HEIGHT);
                }
            }
        }
    });
});
