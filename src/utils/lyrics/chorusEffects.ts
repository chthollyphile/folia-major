import type { LyricChorusOrigin, LyricData } from '../../types';
import type { ChorusRange } from '../../types/onlineMusic';
import { detectChorusLines } from '../chorusDetector';

const CHORUS_EFFECTS: Array<'bars' | 'circles' | 'beams'> = ['bars', 'circles', 'beams'];

export const applyDetectedChorusEffects = (
    lyrics: LyricData,
    mainLrc: string,
    random: () => number = Math.random
): LyricData => {
    const chorusLines = detectChorusLines(mainLrc);
    if (chorusLines.size === 0) {
        return lyrics;
    }

    const effectMap = new Map<string, 'bars' | 'circles' | 'beams'>();
    chorusLines.forEach(text => {
        const index = Math.floor(random() * CHORUS_EFFECTS.length) % CHORUS_EFFECTS.length;
        effectMap.set(text, CHORUS_EFFECTS[index]);
    });

    return {
        ...lyrics,
        lines: lyrics.lines.map(line => {
            const text = line.fullText.trim();
            if (!chorusLines.has(text)) {
                return line;
            }

            return {
                ...line,
                isChorus: true,
                chorusEffect: effectMap.get(text),
                chorusOrigin: 'text' as const,
            };
        })
    };
};

export type { ChorusRange };

/**
 * Apply chorus effects to lyrics using precise timestamp ranges a lyric source gave.
 * Any lyric line overlapping with a chorus range will be decorated with chorus status and a visual effect.
 * `origin` is where the ranges came from: a source's own ranges unless they were read back off lines
 * the host had marked from repeated text.
 */
export const applyChorusRangesByTime = (
    lyrics: LyricData,
    chorusRanges: ChorusRange[],
    random: () => number = Math.random,
    origin: LyricChorusOrigin = 'source',
): LyricData => {
    if (!chorusRanges || chorusRanges.length === 0) {
        return lyrics;
    }

    const rangeEffects = chorusRanges.map(() => {
        const index = Math.floor(random() * CHORUS_EFFECTS.length) % CHORUS_EFFECTS.length;
        return CHORUS_EFFECTS[index];
    });

    const lines = lyrics.lines.map(line => {
        const lineStart = line.startTime;
        const lineEnd = line.endTime;

        if (typeof lineStart !== 'number' || typeof lineEnd !== 'number') {
            return line;
        }

        let matchedRangeIndex = -1;
        for (let i = 0; i < chorusRanges.length; i++) {
            const range = chorusRanges[i];
            const rangeStart = range.startTime;
            const rangeEnd = range.endTime;

            if (lineStart < rangeEnd && lineEnd > rangeStart) {
                matchedRangeIndex = i;
                break;
            }
        }

        if (matchedRangeIndex === -1) {
            return line;
        }

        return {
            ...line,
            isChorus: true,
            chorusEffect: rangeEffects[matchedRangeIndex],
            chorusOrigin: origin,
        };
    });
    const marked = lines.some((line, index) => line !== lyrics.lines[index]);
    return {
        ...lyrics,
        lines,
        ...(marked && origin === 'source'
            ? { sourceChorusRanges: chorusRanges.map(range => ({ startTime: range.startTime, endTime: range.endTime })) }
            : {}),
    };
};

/**
 * Where the first chorus the lyric data itself marked starts, in seconds on the lyric clock; null when
 * the lyrics have none, or only choruses the host guessed from repeated lines. A line is marked when it
 * overlaps a source's range, so a line-timed line that runs into the range is marked from its own
 * start; the range's start, where the lyrics kept it, is the later and truer of the two.
 */
export const findSourceChorusStart = (lyrics: LyricData | null | undefined): number | null => {
    const line = lyrics?.lines.find(candidate => candidate.isChorus && candidate.chorusOrigin === 'source');
    if (!line || !Number.isFinite(line.startTime)) return null;
    const range = lyrics?.sourceChorusRanges?.find(candidate => (
        line.startTime < candidate.endTime && line.endTime > candidate.startTime
    ));
    return range && Number.isFinite(range.startTime) ? Math.max(line.startTime, range.startTime) : line.startTime;
};
