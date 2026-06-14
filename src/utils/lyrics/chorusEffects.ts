import { LyricData } from '../../types';
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
                chorusEffect: effectMap.get(text)
            };
        })
    };
};

export interface NeteaseChorusRange {
    startTime: number; // in milliseconds
    endTime: number; // in milliseconds
}

/**
 * Apply chorus effects to lyrics using precise timestamp ranges from Netease API.
 * Any lyric line overlapping with a chorus range will be decorated with chorus status and a visual effect.
 */
export const applyNeteaseChorusByTime = (
    lyrics: LyricData,
    chorusRanges: NeteaseChorusRange[],
    random: () => number = Math.random
): LyricData => {
    if (!chorusRanges || chorusRanges.length === 0) {
        return lyrics;
    }

    const rangeEffects = chorusRanges.map(() => {
        const index = Math.floor(random() * CHORUS_EFFECTS.length) % CHORUS_EFFECTS.length;
        return CHORUS_EFFECTS[index];
    });

    return {
        ...lyrics,
        lines: lyrics.lines.map(line => {
            const lineStart = line.startTime;
            const lineEnd = line.endTime;

            if (typeof lineStart !== 'number' || typeof lineEnd !== 'number') {
                return line;
            }

            let matchedRangeIndex = -1;
            for (let i = 0; i < chorusRanges.length; i++) {
                const range = chorusRanges[i];
                const rangeStart = range.startTime / 1000;
                const rangeEnd = range.endTime / 1000;

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
                chorusEffect: rangeEffects[matchedRangeIndex]
            };
        })
    };
};

