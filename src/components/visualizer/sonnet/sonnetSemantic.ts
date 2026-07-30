import type { Line } from '../../../types';
import { buildLineGraphemeTimeline, splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import type { SonnetSemanticSegment } from './types';

// src/components/visualizer/sonnet/sonnetSemantic.ts
// Produces lossless semantic segments while mapping display offsets to parser-derived grapheme timing.
const PUNCTUATION_ONLY = /^[\s\p{P}\p{S}]+$/u;

interface SegmenterPart {
    segment: string;
    index: number;
    isWordLike?: boolean;
}

const getSegmenterParts = (text: string): SegmenterPart[] => {
    const Segmenter = typeof Intl !== 'undefined' ? Intl.Segmenter : undefined;
    if (Segmenter) {
        try {
            return Array.from(new Segmenter(undefined, { granularity: 'word' }).segment(text), part => ({
                segment: part.segment,
                index: part.index,
                isWordLike: part.isWordLike,
            }));
        } catch {
            // The grapheme fallback below preserves every code unit and the line timing.
        }
    }

    let cursor = 0;
    return splitLyricGraphemes(text).map(segment => {
        const part = { segment, index: cursor, isWordLike: !PUNCTUATION_ONLY.test(segment) };
        cursor += segment.length;
        return part;
    });
};

const getGraphemeRanges = (text: string) => {
    let cursor = 0;
    return splitLyricGraphemes(text).map(grapheme => {
        const range = { start: cursor, end: cursor + grapheme.length };
        cursor = range.end;
        return range;
    });
};

const timingForRange = (
    line: Line,
    startOffset: number,
    endOffset: number,
    timeline: ReturnType<typeof buildLineGraphemeTimeline>,
    ranges: ReturnType<typeof getGraphemeRanges>,
) => {
    const indices = ranges.flatMap((range, index) => (
        range.end > startOffset && range.start < endOffset ? [index] : []
    ));
    const graphemes = indices.map(index => timeline[index]).filter(Boolean);
    const wordIndices = [...new Set(graphemes.flatMap(item => (
        typeof item.wordIndex === 'number' ? [item.wordIndex] : []
    )))];

    return {
        graphemes,
        wordIndices,
        startTime: graphemes[0]?.startTime ?? line.startTime,
        endTime: graphemes[graphemes.length - 1]?.endTime ?? line.endTime,
    };
};

export const buildSonnetSemanticSegments = (line: Line): SonnetSemanticSegment[] => {
    if (!line.fullText) return [];
    const timeline = buildLineGraphemeTimeline(line);
    const ranges = getGraphemeRanges(line.fullText);
    const parts = getSegmenterParts(line.fullText);
    const segments = parts.map((part, index) => {
        const startOffset = part.index;
        const endOffset = parts[index + 1]?.index ?? line.fullText.length;
        return {
            text: line.fullText.slice(startOffset, endOffset),
            startOffset,
            endOffset,
            ...timingForRange(line, startOffset, endOffset, timeline, ranges),
            isWordLike: part.isWordLike ?? !PUNCTUATION_ONLY.test(part.segment),
        };
    });

    const sticky: SonnetSemanticSegment[] = [];
    for (const segment of segments) {
        const previous = sticky[sticky.length - 1];
        if (previous && !segment.isWordLike && !/^\s+$/u.test(segment.text)) {
            previous.text += segment.text;
            previous.endOffset = segment.endOffset;
            previous.endTime = Math.max(previous.endTime, segment.endTime);
            previous.graphemes.push(...segment.graphemes);
            previous.wordIndices = [...new Set([...previous.wordIndices, ...segment.wordIndices])];
        } else {
            sticky.push({ ...segment, graphemes: [...segment.graphemes], wordIndices: [...segment.wordIndices] });
        }
    }
    return sticky;
};
