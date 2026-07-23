import type { LyricData, Line, Word } from '../../types';
import type { StructuredLyric, StructuredLyricCueLine } from '../../types/navidrome';
import { detectTimedLyricFormat } from './formatDetection';
import { finalizeParsedLyricLines, findTranslationsForSortedStartTimes, type TimedTextEntry } from './parserCore';
import type { LyricProcessingOptions } from './types';

// Converts OpenSubsonic songLyrics v2 cue timing into Folia's native lyric timeline.
const pickMainCueLines = (lyrics: StructuredLyric): StructuredLyricCueLine[] => {
    const mainAgentIds = new Set(
        lyrics.agents?.filter(agent => agent.role === 'main').map(agent => agent.id) ?? []
    );
    const byIndex = new Map<number, StructuredLyricCueLine>();

    for (const cueLine of lyrics.cueLine ?? []) {
        const existing = byIndex.get(cueLine.index);
        if (!existing || (cueLine.agentId && mainAgentIds.has(cueLine.agentId) && !mainAgentIds.has(existing.agentId ?? ''))) {
            byIndex.set(cueLine.index, cueLine);
        }
    }

    return [...byIndex.values()].sort((left, right) => (
        left.index - right.index || (left.start ?? 0) - (right.start ?? 0)
    ));
};

const finiteTime = (value: number | undefined): number | undefined => (
    typeof value === 'number' && Number.isFinite(value) ? value / 1000 : undefined
);

const getOffsetSeconds = (lyrics: StructuredLyric): number => finiteTime(lyrics.offset) ?? 0;

const getAdjustedTime = (value: number | undefined, lyrics: StructuredLyric): number | undefined => {
    const time = finiteTime(value);
    return time === undefined ? undefined : time + getOffsetSeconds(lyrics);
};

const hasNonEmptyLines = (lyrics: StructuredLyric): boolean => (
    lyrics.line?.some(line => line.value.trim().length > 0) ?? false
);

const hasCueTiming = (lyrics: StructuredLyric): boolean => (
    lyrics.cueLine?.some(cueLine => cueLine.cue?.some(cue => finiteTime(cue.start) !== undefined)) ?? false
);

const hasEnhancedLineTiming = (lyrics: StructuredLyric): boolean => (
    lyrics.line?.some(line => detectTimedLyricFormat(line.value) === 'enhanced-lrc') ?? false
);

export const hasEnhancedNavidromeStructuredLyrics = (lyrics: StructuredLyric | null | undefined): boolean => (
    Boolean(lyrics && (hasCueTiming(lyrics) || hasEnhancedLineTiming(lyrics)))
);

export const isNavidromeStructuredLyricCollection = (
    lyrics: StructuredLyric | StructuredLyric[] | StructuredLyric['line'] | undefined
): lyrics is StructuredLyric[] => (
    Array.isArray(lyrics) && lyrics.every(item => Array.isArray((item as StructuredLyric).line))
);

// Selects one track of a kind; translations are intentionally limited to one display line.
export const selectPreferredNavidromeStructuredLyric = (
    items: StructuredLyric[] | null | undefined,
    kind: 'main' | 'translation' | 'pronunciation' = 'main'
): StructuredLyric | null => {
    const candidates = items?.filter(item => item.kind === kind && hasNonEmptyLines(item)) ?? [];
    if (kind === 'main') {
        const fallbackCandidates = items?.filter(hasNonEmptyLines) ?? [];
        return candidates.find(hasCueTiming) || candidates.find(hasEnhancedLineTiming)
            || candidates.find(item => item.synced) || candidates[0]
            || items?.find(item => hasNonEmptyLines(item) && hasCueTiming(item))
            || fallbackCandidates.find(hasEnhancedLineTiming)
            || fallbackCandidates.find(item => item.synced)
            || fallbackCandidates[0]
            || null;
    }

    return candidates.find(item => item.synced) || candidates[0] || null;
};

const getTrackTimedEntries = (lyrics: StructuredLyric | null): TimedTextEntry[] => {
    if (!lyrics) {
        return [];
    }

    return lyrics.line.flatMap(line => {
        const startTime = getAdjustedTime(line.start, lyrics);
        const text = line.value.trim();
        return startTime === undefined || !text ? [] : [{ startTime, text }];
    }).sort((left, right) => left.startTime - right.startTime);
};

// Converts synchronized line-level tracks when a server has no word cue timing.
const parseNavidromeLineLyrics = (
    lyrics: StructuredLyric,
    options: LyricProcessingOptions
): LyricData | null => {
    if (!lyrics.synced || hasEnhancedLineTiming(lyrics)) {
        return null;
    }

    const timedLines = getTrackTimedEntries(lyrics);
    if (timedLines.length === 0) {
        return null;
    }

    const lines: Line[] = timedLines.map((line, index) => ({
        words: [],
        startTime: line.startTime,
        endTime: Math.max(timedLines[index + 1]?.startTime ?? (line.startTime + 5), line.startTime + 0.001),
        fullText: line.text,
    }));

    return {
        lines: finalizeParsedLyricLines(lines, options),
        title: lyrics.displayTitle,
        artist: lyrics.displayArtist,
    };
};

// Navidrome v0.63+ stores untimed translations next to their indexed cue line.
const findInlineTranslation = (lyrics: StructuredLyric, cueLine: StructuredLyricCueLine): string | undefined => {
    const mainLine = lyrics.line[cueLine.index];
    const translationLine = lyrics.line[cueLine.index + 1];

    if (
        !mainLine
        || !translationLine
        || mainLine.start !== translationLine.start
        || lyrics.cueLine?.some(candidate => candidate.index === cueLine.index + 1)
    ) {
        return undefined;
    }

    const translation = translationLine.value.trim();
    return translation && translation !== cueLine.value.trim() ? translation : undefined;
};

export const parseNavidromeStructuredLyrics = (
    lyrics: StructuredLyric,
    options: LyricProcessingOptions = {}
): LyricData | null => {
    const cueLines = pickMainCueLines(lyrics).filter(cueLine => cueLine.cue?.some(cue => finiteTime(cue.start) !== undefined));
    if (cueLines.length === 0) {
        return parseNavidromeLineLyrics(lyrics, options);
    }

    const lines: Line[] = cueLines.map((cueLine, lineIndex) => {
        const cues = cueLine.cue ?? [];
        const startTime = getAdjustedTime(cueLine.start, lyrics) ?? getAdjustedTime(cues[0]?.start, lyrics) ?? 0;
        const nextLineStart = getAdjustedTime(cueLines[lineIndex + 1]?.start, lyrics);
        const explicitEnd = getAdjustedTime(cueLine.end, lyrics);
        const fallbackLineEnd = explicitEnd ?? nextLineStart ?? (startTime + 5);
        const words: Word[] = cues.flatMap((cue, wordIndex) => {
            const wordStart = getAdjustedTime(cue.start, lyrics);
            if (wordStart === undefined) {
                return [];
            }

            const nextWordStart = getAdjustedTime(cues[wordIndex + 1]?.start, lyrics);
            const wordEnd = Math.max(
                getAdjustedTime(cue.end, lyrics) ?? nextWordStart ?? fallbackLineEnd,
                wordStart + 0.001
            );
            return [{ text: cue.value, startTime: wordStart, endTime: wordEnd }];
        });
        const endTime = Math.max(explicitEnd ?? words[words.length - 1]?.endTime ?? fallbackLineEnd, startTime + 0.001);

        return {
            words,
            startTime,
            endTime,
            fullText: cueLine.value || words.map(word => word.text).join(''),
            translation: findInlineTranslation(lyrics, cueLine),
        };
    });

    return {
        lines: finalizeParsedLyricLines(lines, options),
        title: lyrics.displayTitle,
        artist: lyrics.displayArtist,
    };
};

// Merges the official enhanced response tracks into Folia's single display timeline.
export const parseNavidromeStructuredLyricsCollection = (
    lyricsList: StructuredLyric[],
    options: LyricProcessingOptions = {}
): LyricData | null => {
    const mainLyrics = selectPreferredNavidromeStructuredLyric(lyricsList);
    if (!mainLyrics) {
        return null;
    }

    const parsedMainLyrics = parseNavidromeStructuredLyrics(mainLyrics, options);
    if (!parsedMainLyrics) {
        return null;
    }

    const translations = findTranslationsForSortedStartTimes(
        parsedMainLyrics.lines.map(line => line.startTime),
        getTrackTimedEntries(selectPreferredNavidromeStructuredLyric(lyricsList, 'translation'))
    );
    const romanizations = findTranslationsForSortedStartTimes(
        parsedMainLyrics.lines.map(line => line.startTime),
        getTrackTimedEntries(selectPreferredNavidromeStructuredLyric(lyricsList, 'pronunciation'))
    );

    return {
        ...parsedMainLyrics,
        lines: parsedMainLyrics.lines.map((line, index) => ({
            ...line,
            translation: translations[index] ?? line.translation,
            romanization: romanizations[index] ?? line.romanization,
        })),
    };
};
