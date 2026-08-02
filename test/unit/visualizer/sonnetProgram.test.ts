import { describe, expect, it, vi } from 'vitest';
import type { Line } from '@/types';
import {
    buildSonnetSemanticSegments,
    compileSonnetProgram,
    findSonnetParagraphIndexAtTime,
    resolveSonnetParagraphGapThreshold,
} from '@/components/visualizer/sonnet/sonnetProgram';

// test/unit/visualizer/sonnetProgram.test.ts
// Locks Sonnet's lossless semantic compiler, paragraph director, and seek-safe lookup.
const line = (
    fullText: string,
    startTime: number,
    endTime: number,
    words: Line['words'] = [{ text: fullText, startTime, endTime }],
    extra: Partial<Line> = {},
): Line => ({ fullText, startTime, endTime, words, ...extra });

describe('Sonnet program compiler', () => {
    it('preserves CJK, whitespace, punctuation, and parser timing', () => {
        const source = line('世界， 再见！', 1, 4, [
            { text: '世界', startTime: 1, endTime: 2 },
            { text: '再见', startTime: 2.5, endTime: 3.7 },
        ]);
        const segments = buildSonnetSemanticSegments(source);

        expect(segments.map(segment => segment.text).join('')).toBe(source.fullText);
        expect(segments[0].text).toContain('，');
        expect(segments.flatMap(segment => segment.wordIndices)).toContain(0);
        expect(segments.at(-1)?.endTime).toBeLessThanOrEqual(source.endTime);
    });

    it('keeps repeated Latin words and contractions in source order', () => {
        const source = line("It's time, time.", 0, 3, [
            { text: "It's", startTime: 0, endTime: 0.8 },
            { text: 'time', startTime: 1, endTime: 1.7 },
            { text: 'time', startTime: 2, endTime: 2.7 },
        ]);
        const segments = buildSonnetSemanticSegments(source);

        expect(segments.map(segment => segment.text).join('')).toBe(source.fullText);
        expect(segments.filter(segment => segment.text.includes('time'))).toHaveLength(2);
        expect(segments.filter(segment => segment.text.includes('time'))[1].startTime).toBeGreaterThanOrEqual(2);
    });

    it('falls back losslessly when Intl.Segmenter is unavailable', () => {
        const original = Intl.Segmenter;
        vi.stubGlobal('Intl', { ...Intl, Segmenter: undefined });
        const source = line('歌🎵 A!', 0, 2);

        expect(buildSonnetSemanticSegments(source).map(segment => segment.text).join('')).toBe(source.fullText);
        vi.stubGlobal('Intl', { ...Intl, Segmenter: original });
    });

    it('computes an adaptive threshold and respects timed and metadata boundaries', () => {
        const lines = [
            line('one', 0, 1, undefined, { blockIndex: 0 }),
            line('two', 1.2, 2.2, undefined, { blockIndex: 0 }),
            line('three', 5, 6, undefined, { blockIndex: 1 }),
        ];

        expect(resolveSonnetParagraphGapThreshold(lines)).toBeGreaterThanOrEqual(1.25);
        const program = compileSonnetProgram(lines, 'stable-song');
        expect(program.paragraphs).toHaveLength(2);
        expect(program.paragraphs[1].boundary).toBe('metadata');
    });

    it('caps long paragraphs and combines adjacent short lines into one shot', () => {
        const lines = Array.from({ length: 8 }, (_, index) => (
            line(`line ${index}`, index * 1.1, index * 1.1 + 0.8)
        ));
        const program = compileSonnetProgram(lines, 'caps');

        expect(program.paragraphs.length).toBeGreaterThan(1);
        expect(program.paragraphs.every(paragraph => paragraph.lines.length <= 6)).toBe(true);
        expect(program.paragraphs[0].shots[0].lineIndices.length).toBe(2);
    });

    it('is deterministic, avoids adjacent templates, and supports direct seeks', () => {
        const lines = Array.from({ length: 7 }, (_, index) => (
            line(`lyric ${index}!`, index * 2, index * 2 + 1.2, undefined, index === 3 ? { isChorus: true } : {})
        ));
        const first = compileSonnetProgram(lines, 'song-a');
        const second = compileSonnetProgram(lines, 'song-a');
        const shotKinds = first.paragraphs.flatMap(paragraph => paragraph.shots.map(shot => shot.kind));

        expect(first).toEqual(second);
        expect(first.paragraphs.some(paragraph => paragraph.kind === 'chorus')).toBe(true);
        shotKinds.slice(1).forEach((kind, index) => expect(kind).not.toBe(shotKinds[index]));
        expect(findSonnetParagraphIndexAtTime(first, first.paragraphs.at(-1)!.startTime)).toBe(first.paragraphs.length - 1);
    });

    it('extends the visual timeline to renderEndTime without crossing the next line', () => {
        const first = line('tail', 1, 2, undefined, {
            renderHints: {
                rawDuration: 1,
                timingClass: 'normal',
                renderEndTime: 3.5,
                lineTransitionMode: 'normal',
                wordRevealMode: 'normal',
            },
        });
        const second = line('next', 3, 4);
        const program = compileSonnetProgram([first, second], 'render-tail');
        const compiledFirst = program.paragraphs[0].lines[0];

        expect(compiledFirst.renderEndTime).toBe(3);
        expect(program.paragraphs[0].shots[0].endTime).toBeGreaterThanOrEqual(3);
    });

    it('holds the outgoing scene through a lyric gap and transitions immediately before the next scene', () => {
        const program = compileSonnetProgram([
            line('first', 1, 2, undefined, { blockIndex: 0 }),
            line('second', 5, 6, undefined, { blockIndex: 1 }),
        ], 'gap-hold');
        const current = program.paragraphs[0];
        const next = program.paragraphs[1];

        expect(current.transitionOut?.endTime).toBe(next.startTime);
        expect(current.transitionOut?.startTime).toBeGreaterThan(current.endTime);
    });
});
