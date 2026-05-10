import { describe, expect, it } from 'vitest';
import type { Line } from '@/types';
// Keep Fume timing tests scoped to the visualizer internals so we can lock the non-parser contract.
import {
    buildWordRangesFromWords,
    resolveLinePassCutoffTime,
    resolvePrintedGraphemeCount,
    resolvePrintedGraphemeProgress,
    resolveVisualProgressWithCutoff,
} from '@/components/visualizer/fume/VisualizerFume';

const makeLine = (
    fullText: string,
    words: Line['words'],
    overrides: Partial<Line> = {},
): Line => ({
    fullText,
    words,
    startTime: words[0]?.startTime ?? 0,
    endTime: words[words.length - 1]?.endTime ?? 0,
    ...overrides,
});

describe('VisualizerFume word timing helpers', () => {
    it('builds grapheme ranges directly from word text order for latin text', () => {
        const line = makeLine('Oh, not again', [
            { text: 'Oh', startTime: 0, endTime: 0.3 },
            { text: ', ', startTime: 0.3, endTime: 0.35 },
            { text: 'not ', startTime: 0.35, endTime: 0.6 },
            { text: 'again', startTime: 0.6, endTime: 1.1 },
        ]);

        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(ranges.map(range => [range.start, range.end])).toEqual([
            [0, 2],
            [2, 4],
            [4, 8],
            [8, 13],
        ]);
        expect(ranges.map(range => line.fullText.slice(range.start, range.end))).toEqual([
            'Oh',
            ', ',
            'not ',
            'again',
        ]);
    });

    it('keeps punctuation and quotes inside the owning word ranges', () => {
        const line = makeLine('train’s gone', [
            { text: 'train', startTime: 0, endTime: 0.5 },
            { text: '’', startTime: 0.5, endTime: 0.55 },
            { text: 's ', startTime: 0.55, endTime: 0.68 },
            { text: 'gone', startTime: 0.68, endTime: 1.1 },
        ]);

        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(ranges.map(range => line.fullText.slice(range.start, range.end))).toEqual([
            'train',
            '’',
            's ',
            'gone',
        ]);
    });

    it('preserves downstream word alignment when punctuation tokens have zero duration', () => {
        const line = makeLine('and come to me', [
            { text: 'and ', startTime: 0, endTime: 0.4 },
            { text: 'come ', startTime: 0.4, endTime: 0.9 },
            { text: 'to ', startTime: 0.9, endTime: 1.1 },
            { text: ', ', startTime: 1.1, endTime: 1.1 },
            { text: 'me', startTime: 1.1, endTime: 1.8 },
        ], {
            fullText: 'and come to , me',
            endTime: 1.8,
        });

        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(ranges.map(range => line.fullText.slice(range.start, range.end))).toEqual([
            'and ',
            'come ',
            'to ',
            ', ',
            'me',
        ]);
        expect(ranges.at(-1)).toMatchObject({
            start: line.fullText.length - 2,
            end: line.fullText.length,
        });
    });

    it('supports overlapping word times while keeping printed count as the maximum continuous prefix', () => {
        const line = makeLine('ABCD', [
            { text: 'AB', startTime: 0, endTime: 1 },
            { text: 'CD', startTime: 0.4, endTime: 1.2 },
        ]);
        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(resolvePrintedGraphemeCount(line, ranges, 4, 0.55)).toBe(1);
        expect(resolvePrintedGraphemeCount(line, ranges, 4, 1.05)).toBe(3);
        expect(resolvePrintedGraphemeCount(line, ranges, 4, 1.25)).toBe(4);
    });

    it('keeps the progressive frontier logic variant-agnostic', () => {
        const line = makeLine('again', [
            { text: 'again', startTime: 0, endTime: 1 },
        ]);
        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(resolvePrintedGraphemeProgress(line, ranges, 5, 0.5)).toBeCloseTo(2.5, 5);
    });

    it('keeps reveal completion aligned with line endTime even when renderEndTime is later', () => {
        const line = makeLine('while inside', [
            { text: 'while ', startTime: 77.92, endTime: 80.9 },
            { text: 'inside', startTime: 80.9, endTime: 81.49 },
        ], {
            renderHints: {
                rawDuration: 3.57,
                timingClass: 'normal',
                renderEndTime: 81.87,
                lineTransitionMode: 'normal',
                wordRevealMode: 'normal',
            },
        });
        const graphemeCount = Array.from(line.fullText).length;
        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));

        expect(resolvePrintedGraphemeCount(line, ranges, graphemeCount, 81.2)).toBeLessThan(graphemeCount);
        expect(resolvePrintedGraphemeCount(line, ranges, graphemeCount, 81.49)).toBe(graphemeCount);
        expect(resolvePrintedGraphemeProgress(line, ranges, graphemeCount, 81.49)).toBe(graphemeCount);
    });

    it('uses renderEndTime as the pass cutoff when there is enough gap before the next line', () => {
        const line = makeLine('linger', [
            { text: 'li', startTime: 12.19, endTime: 12.37 },
            { text: 'nger', startTime: 12.37, endTime: 12.55 },
        ], {
            renderHints: {
                rawDuration: 2.79,
                timingClass: 'normal',
                renderEndTime: 12.93,
                lineTransitionMode: 'normal',
                wordRevealMode: 'normal',
            },
        });

        expect(resolveLinePassCutoffTime(line, 13.4)).toBe(12.93);
        expect(resolveVisualProgressWithCutoff(12.55, 0.45, 12.7, 12.93)).toBeLessThan(1);
    });

    it('cuts the pass window off at the next line start when renderEndTime would overlap it', () => {
        const line = makeLine('linger', [
            { text: 'li', startTime: 12.19, endTime: 12.37 },
            { text: 'nger', startTime: 12.37, endTime: 12.55 },
        ], {
            renderHints: {
                rawDuration: 2.79,
                timingClass: 'normal',
                renderEndTime: 12.93,
                lineTransitionMode: 'normal',
                wordRevealMode: 'normal',
            },
        });
        const graphemeCount = Array.from(line.fullText).length;
        const ranges = buildWordRangesFromWords(line, Array.from(line.fullText));
        const passCutoffTime = resolveLinePassCutoffTime(line, 12.55);

        expect(resolvePrintedGraphemeCount(line, ranges, graphemeCount, 12.49)).toBeLessThan(graphemeCount);
        expect(resolvePrintedGraphemeCount(line, ranges, graphemeCount, 12.55)).toBe(graphemeCount);
        expect(resolvePrintedGraphemeProgress(line, ranges, graphemeCount, 12.55)).toBe(graphemeCount);
        expect(passCutoffTime).toBe(12.55);
        expect(resolveVisualProgressWithCutoff(12.55, 0.45, 12.55, passCutoffTime)).toBe(0);
        expect(resolveVisualProgressWithCutoff(12.55, 0.45, 12.6, passCutoffTime)).toBe(1);
    });
});
