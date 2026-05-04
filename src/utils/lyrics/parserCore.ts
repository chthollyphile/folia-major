import { LyricData, Line, Word } from '../../types';
import type { TimedLyricFormat } from './formatDetection';
import { annotateLyricLines } from './renderHints';
import type { LyricProcessingOptions } from './types';

export type LyricParseFormat = TimedLyricFormat | 'yrc';

interface TimedTextEntry {
    startTime: number;
    endTime?: number;
    text: string;
}

interface DraftWord {
    text: string;
    startTime: number;
    endTime?: number;
}

interface DraftLine {
    words: DraftWord[];
    startTime: number;
    endTime?: number;
    fullText: string;
}

interface TimestampMarker {
    time: number;
    index: number;
    endIndex: number;
}

interface LrcMetadata {
    title?: string;
    artist?: string;
}

interface ParsedTimedEntriesResult {
    entries: TimedTextEntry[];
    isSorted: boolean;
}

const GLOBAL_LRC_TIME_REGEX = /\[(\d{2}):(\d{2})[.:](\d{2,3})\]/g;
const GLOBAL_ANGLE_TIME_REGEX = /<(\d{2}):(\d{2})[.:](\d{2,3})>/g;
const LRC_LINE_TIME_REGEX = /^\[(\d{2}):(\d{2})[.:](\d{2,3})\]/;
const LEADING_LRC_TAGS_REGEX = /^((?:\[(?:\d{2}):(?:\d{2})[.:](?:\d{2,3})\])+)(.*)$/;
const LRC_METADATA_REGEX = /^\[(ti|ar):([^\]]*)\]$/i;
export const INTERLUDE_FULL_TEXT = '......';

const buildTimedWords = (text: string, startTime: number, endTime: number): Word[] => {
    const duration = Math.max(endTime - startTime, 0.1);
    const rawTokens = text.split(/\s+/).filter(token => token);
    const words: Word[] = [];
    const tokens: Array<{ text: string; weight: number }> = [];
    let totalWeight = 0;

    for (const token of rawTokens) {
        if (/[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(token)) {
            token.split('').forEach(char => {
                const isPunctuation = /[，。！？、：；"'）]/.test(char);
                const weight = isPunctuation ? 0 : 1;
                tokens.push({ text: char, weight });
                totalWeight += weight;
            });
        } else {
            const weight = 1 + (token.length * 0.15);
            tokens.push({ text: token, weight });
            totalWeight += weight;
        }
    }

    if (totalWeight === 0) {
        totalWeight = 1;
    }

    const activeDuration = duration * 0.9;
    const timePerWeight = activeDuration / totalWeight;
    let currentWordStart = startTime;

    tokens.forEach(token => {
        const wordDuration = token.weight * timePerWeight;
        const finalDuration = Math.max(wordDuration, 0.05);

        words.push({
            text: token.text,
            startTime: currentWordStart,
            endTime: currentWordStart + finalDuration
        });

        if (token.weight > 0) {
            currentWordStart += wordDuration;
        } else {
            currentWordStart += 0.05;
        }
    });

    if (words.length > 0) {
        const lastWord = words[words.length - 1];
        if (lastWord.endTime > endTime) {
            const scale = (endTime - startTime) / (lastWord.endTime - startTime);
            words.forEach(word => {
                word.startTime = startTime + ((word.startTime - startTime) * scale);
                word.endTime = startTime + ((word.endTime - startTime) * scale);
            });
        }
    }

    return words;
};

export const isInterludeLine = (line: Pick<Line, 'fullText'>): boolean => line.fullText === INTERLUDE_FULL_TEXT;

export const attachInterludes = (lines: Line[]): Line[] => {
    const finalLines: Line[] = [];

    const createInterlude = (start: number, end: number): Line => {
        const duration = end - start;
        const words: Word[] = [];
        const wordDuration = duration / 6;

        for (let index = 0; index < 6; index += 1) {
            words.push({
                text: '.',
                startTime: start + (index * wordDuration),
                endTime: start + ((index + 1) * wordDuration)
            });
        }

        return {
            startTime: start,
            endTime: end,
            fullText: INTERLUDE_FULL_TEXT,
            words
        };
    };

    if (lines.length > 0 && lines[0].startTime > 3) {
        finalLines.push(createInterlude(0.5, lines[0].startTime - 0.5));
    }

    for (let index = 0; index < lines.length; index += 1) {
        const current = lines[index];
        finalLines.push(current);

        const next = lines[index + 1];
        if (next) {
            const gap = next.startTime - current.endTime;
            if (gap > 3) {
                finalLines.push(createInterlude(current.endTime + 0.05, next.startTime - 0.05));
            }
        }
    }

    return finalLines;
};

export const finalizeParsedLyricLines = (
    lines: Line[],
    options: Pick<LyricProcessingOptions, 'includeInterludes'> = {}
): Line[] => {
    const withOptionalInterludes = options.includeInterludes === false
        ? lines
        : attachInterludes(lines);

    return annotateLyricLines(withOptionalInterludes);
};

const sortByStartTimeIfNeeded = <T extends { startTime: number }>(items: T[], isSorted: boolean): T[] => {
    if (isSorted) {
        return items;
    }

    return [...items].sort((left, right) => left.startTime - right.startTime);
};

const findTranslationsForSortedStartTimes = (
    startTimes: number[],
    entries: TimedTextEntry[]
): Array<string | undefined> => {
    if (startTimes.length === 0 || entries.length === 0) {
        return startTimes.map(() => undefined);
    }

    const translations: Array<string | undefined> = [];
    let upperIndex = 0;

    for (const startTime of startTimes) {
        while (upperIndex < entries.length && entries[upperIndex].startTime < startTime) {
            upperIndex += 1;
        }

        let bestEntry: TimedTextEntry | undefined;
        let bestDiff = 1.0;

        const previous = entries[upperIndex - 1];
        if (previous) {
            const diff = Math.abs(previous.startTime - startTime);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestEntry = previous;
            }
        }

        const current = entries[upperIndex];
        if (current) {
            const diff = Math.abs(current.startTime - startTime);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestEntry = current;
            }
        }

        translations.push(bestEntry?.text);
    }

    return translations;
};

const parseTimestamp = (minute: string, second: string, fraction: string): number => {
    const min = parseInt(minute, 10);
    const sec = parseInt(second, 10);
    const ms = parseFloat(`0.${fraction}`);
    return min * 60 + sec + ms;
};

const collectTimestampMarkers = (content: string, pattern: RegExp): TimestampMarker[] => {
    const regex = new RegExp(pattern.source, 'g');

    return Array.from(content.matchAll(regex)).map(match => {
        const index = match.index ?? 0;
        return {
            time: parseTimestamp(match[1], match[2], match[3]),
            index,
            endIndex: index + match[0].length
        };
    });
};

const parseMetadataLine = (line: string, metadata: LrcMetadata): boolean => {
    const match = line.match(LRC_METADATA_REGEX);
    if (!match) {
        return false;
    }

    const key = match[1].toLowerCase();
    const value = match[2].trim();

    if (key === 'ti' && value) {
        metadata.title = value;
    } else if (key === 'ar' && value) {
        metadata.artist = value;
    }

    return true;
};

const maybeBuildPreciseLineDraft = (
    content: string,
    pattern: RegExp,
    enabled: boolean
): DraftLine | null => {
    if (!enabled) {
        return null;
    }

    const markers = collectTimestampMarkers(content, pattern);
    return buildPreciseLineDraft(content, markers);
};

const buildPreciseLineDraft = (content: string, markers: TimestampMarker[]): DraftLine | null => {
    if (markers.length < 2) {
        return null;
    }

    const words: DraftWord[] = [];
    let fullText = '';

    for (let index = 0; index < markers.length - 1; index += 1) {
        const current = markers[index];
        const next = markers[index + 1];
        const segment = content.slice(current.endIndex, next.index).replace(/\r/g, '');

        fullText += segment;
        if (!segment.trim()) {
            continue;
        }

        words.push({
            text: segment,
            startTime: current.time,
            endTime: next.time
        });
    }

    const trailingText = content.slice(markers[markers.length - 1].endIndex).replace(/\r/g, '');
    fullText += trailingText;

    if (trailingText.trim()) {
        words.push({
            text: trailingText,
            startTime: markers[markers.length - 1].time
        });
    }

    if (!fullText.trim()) {
        return null;
    }

    return {
        words,
        startTime: words[0]?.startTime ?? markers[0].time,
        endTime: words[words.length - 1]?.endTime,
        fullText
    };
};

const parseSimpleTimedTextEntry = (line: string): TimedTextEntry | null => {
    const match = line.match(LEADING_LRC_TAGS_REGEX);
    if (!match) {
        return null;
    }

    const firstTag = match[1].match(LRC_LINE_TIME_REGEX);
    if (!firstTag) {
        return null;
    }

    const text = match[2].trim();
    if (!text) {
        return null;
    }

    return {
        startTime: parseTimestamp(firstTag[1], firstTag[2], firstTag[3]),
        text
    };
};

const parseTimedTextEntries = (content: string): ParsedTimedEntriesResult => {
    const metadata: LrcMetadata = {};
    const entries: TimedTextEntry[] = [];
    let isSorted = true;
    let lastStartTime = Number.NEGATIVE_INFINITY;

    const rawLines = content.replace(/^\uFEFF/, '').split(/\r?\n/);

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (parseMetadataLine(line, metadata)) {
            continue;
        }

        const lineTagMatch = line.match(LRC_LINE_TIME_REGEX);
        const body = lineTagMatch ? line.slice(lineTagMatch[0].length) : line;
        const angleDraft = maybeBuildPreciseLineDraft(body, GLOBAL_ANGLE_TIME_REGEX, body.includes('<'));
        const bracketDraft = angleDraft
            ? null
            : maybeBuildPreciseLineDraft(
                line,
                GLOBAL_LRC_TIME_REGEX,
                line.indexOf('[', 1) !== -1
            );
        const entry = angleDraft
            ? {
                startTime: angleDraft.startTime,
                endTime: angleDraft.endTime,
                text: angleDraft.fullText
            }
            : bracketDraft
                ? {
                    startTime: bracketDraft.startTime,
                    endTime: bracketDraft.endTime,
                    text: bracketDraft.fullText
                }
                : parseSimpleTimedTextEntry(line);

        if (!entry || entry.text.length === 0) {
            continue;
        }

        if (entry.startTime < lastStartTime) {
            isSorted = false;
        }
        lastStartTime = entry.startTime;
        entries.push(entry);
    }

    return {
        entries: sortByStartTimeIfNeeded(entries, isSorted),
        isSorted
    };
};

export const parseLRC = (
    lrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {}
): LyricData => {
    const lines: Line[] = [];
    const rawEntries: TimedTextEntry[] = [];
    let rawEntriesSorted = true;
    let lastStartTime = Number.NEGATIVE_INFINITY;

    for (const rawLine of lrcString.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const entry = parseSimpleTimedTextEntry(rawLine);
        if (!entry || entry.text.length === 0) {
            continue;
        }

        if (entry.startTime < lastStartTime) {
            rawEntriesSorted = false;
        }
        lastStartTime = entry.startTime;
        rawEntries.push(entry);
    }

    const sortedRawEntries = sortByStartTimeIfNeeded(rawEntries, rawEntriesSorted);
    const transEntries = parseTimedTextEntries(translationString).entries;
    const translations = findTranslationsForSortedStartTimes(
        sortedRawEntries.map(entry => entry.startTime),
        transEntries
    );

    for (let index = 0; index < sortedRawEntries.length; index += 1) {
        const current = sortedRawEntries[index];
        const next = sortedRawEntries[index + 1];
        const translation = translations[index];

        let duration = next ? next.startTime - current.startTime : 5;
        const estimatedReadingTime = current.text.length * 0.5;
        if (duration > estimatedReadingTime + 2 && duration > 5) {
            duration = Math.min(duration, estimatedReadingTime + 2);
        }

        const endTime = current.startTime + duration;
        lines.push({
            words: buildTimedWords(current.text, current.startTime, endTime),
            startTime: current.startTime,
            endTime,
            fullText: current.text,
            translation
        });
    }

    return { lines: finalizeParsedLyricLines(lines, options) };
};

export const parseYRC = (
    yrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {}
): LyricData => {
    const rawLinesData: Array<{
        words: Word[];
        startTime: number;
        endTime: number;
        fullText: string;
    }> = [];
    const translationEntries = parseTimedTextEntries(translationString).entries;
    const rawLines = yrcString.replace(/^\uFEFF/, '').split(/\r?\n/);
    let isSorted = true;
    let lastStartTime = Number.NEGATIVE_INFINITY;

    for (const rawLine of rawLines) {
        const lineMatch = rawLine.match(/^\[(\d+),(\d+)\](.*)/);
        if (!lineMatch) {
            continue;
        }

        const lineStartTimeMs = parseInt(lineMatch[1], 10);
        const lineDurationMs = parseInt(lineMatch[2], 10);
        const rest = lineMatch[3];
        const lineStartTime = lineStartTimeMs / 1000;
        const lineEndTime = (lineStartTimeMs + lineDurationMs) / 1000;

        const words: Word[] = [];
        let fullText = '';

        const wordRegex = /\((\d+),(\d+),(\d+)\)([^\(]*)/g;
        let wordMatch: RegExpExecArray | null;

        while ((wordMatch = wordRegex.exec(rest)) !== null) {
            const wordStartMs = parseInt(wordMatch[1], 10);
            const wordDurationMs = parseInt(wordMatch[2], 10);
            const text = wordMatch[4];

            words.push({
                text,
                startTime: wordStartMs / 1000,
                endTime: (wordStartMs + wordDurationMs) / 1000
            });
            fullText += text;
        }

        if (words.length > 0) {
            if (lineStartTime < lastStartTime) {
                isSorted = false;
            }
            lastStartTime = lineStartTime;
            rawLinesData.push({
                words,
                startTime: lineStartTime,
                endTime: lineEndTime,
                fullText
            });
        }
    }

    const sortedRawLines = sortByStartTimeIfNeeded(rawLinesData, isSorted);
    const translations = findTranslationsForSortedStartTimes(
        sortedRawLines.map(line => line.startTime),
        translationEntries
    );
    const lines: Line[] = sortedRawLines.map((line, index) => ({
        ...line,
        translation: translations[index]
    }));

    return { lines: finalizeParsedLyricLines(lines, options) };
};

const parseVttTimestamp = (value: string): number => {
    const normalized = value.trim();
    const parts = normalized.split(':');

    let hours = 0;
    let minutes = 0;
    let seconds = 0;

    if (parts.length === 3) {
        hours = parseInt(parts[0], 10);
        minutes = parseInt(parts[1], 10);
        seconds = parseFloat(parts[2]);
    } else if (parts.length === 2) {
        minutes = parseInt(parts[0], 10);
        seconds = parseFloat(parts[1]);
    } else {
        seconds = parseFloat(parts[0]);
    }

    return (hours * 3600) + (minutes * 60) + seconds;
};

const stripVttCueText = (text: string): string => {
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
};

const parseVTTEntries = (vttString: string): TimedTextEntry[] => {
    const normalized = vttString.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
    if (!normalized) {
        return [];
    }

    const blocks = normalized.split(/\n{2,}/);
    const entries: TimedTextEntry[] = [];
    const timingLineRegex = /^((?:\d{2}:)?\d{2}:\d{2}\.\d{3})\s*-->\s*((?:\d{2}:)?\d{2}:\d{2}\.\d{3})(?:\s+.*)?$/;

    for (const block of blocks) {
        const lines = block
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean);

        if (lines.length === 0 || lines[0] === 'WEBVTT' || lines[0].startsWith('NOTE') || lines[0] === 'STYLE' || lines[0] === 'REGION') {
            continue;
        }

        const timingLineIndex = lines.findIndex(line => timingLineRegex.test(line));
        if (timingLineIndex === -1) {
            continue;
        }

        const timingMatch = lines[timingLineIndex].match(timingLineRegex);
        if (!timingMatch) {
            continue;
        }

        const text = stripVttCueText(lines.slice(timingLineIndex + 1).join(' '));
        if (!text) {
            continue;
        }

        entries.push({
            startTime: parseVttTimestamp(timingMatch[1]),
            endTime: parseVttTimestamp(timingMatch[2]),
            text
        });
    }

    return entries.sort((left, right) => left.startTime - right.startTime);
};

export const parseVTT = (
    vttString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {}
): LyricData => {
    const entries = parseVTTEntries(vttString);
    const translationEntries = parseVTTEntries(translationString);
    const translations = findTranslationsForSortedStartTimes(
        entries.map(entry => entry.startTime),
        translationEntries
    );
    const lines: Line[] = [];

    for (let index = 0; index < entries.length; index += 1) {
        const current = entries[index];
        const next = entries[index + 1];
        const fallbackEndTime = next ? next.startTime : current.startTime + 5;
        const endTime = Math.max(current.endTime || fallbackEndTime, current.startTime + 0.1);

        lines.push({
            words: buildTimedWords(current.text, current.startTime, endTime),
            startTime: current.startTime,
            endTime,
            fullText: current.text,
            translation: translations[index]
        });
    }

    return { lines: finalizeParsedLyricLines(lines, options) };
};

export const parseEnhancedLRC = (
    lrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {}
): LyricData => {
    const metadata: LrcMetadata = {};
    const drafts: DraftLine[] = [];
    const translationEntries = parseTimedTextEntries(translationString).entries;
    const rawLines = lrcString.replace(/^\uFEFF/, '').split(/\r?\n/);
    let isSorted = true;
    let lastStartTime = Number.NEGATIVE_INFINITY;

    for (const rawLine of rawLines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (parseMetadataLine(line, metadata)) {
            continue;
        }

        const lineTagMatch = line.match(LRC_LINE_TIME_REGEX);
        const body = lineTagMatch ? line.slice(lineTagMatch[0].length) : line;
        const angleDraft = maybeBuildPreciseLineDraft(body, GLOBAL_ANGLE_TIME_REGEX, body.includes('<'));
        if (angleDraft) {
            if (angleDraft.startTime < lastStartTime) {
                isSorted = false;
            }
            lastStartTime = angleDraft.startTime;
            drafts.push(angleDraft);
            continue;
        }

        const bracketDraft = maybeBuildPreciseLineDraft(line, GLOBAL_LRC_TIME_REGEX, line.indexOf('[', 1) !== -1);
        if (bracketDraft) {
            if (bracketDraft.startTime < lastStartTime) {
                isSorted = false;
            }
            lastStartTime = bracketDraft.startTime;
            drafts.push(bracketDraft);
            continue;
        }

        const simpleEntry = parseSimpleTimedTextEntry(line);
        if (simpleEntry) {
            if (simpleEntry.startTime < lastStartTime) {
                isSorted = false;
            }
            lastStartTime = simpleEntry.startTime;
            drafts.push({
                words: [],
                startTime: simpleEntry.startTime,
                fullText: simpleEntry.text
            });
        }
    }

    const sortedDrafts = sortByStartTimeIfNeeded(drafts, isSorted);
    const translations = findTranslationsForSortedStartTimes(
        sortedDrafts.map(draft => draft.startTime),
        translationEntries
    );

    const lines: Line[] = sortedDrafts.map((draft, index) => {
        let lineEndTime = Math.max(draft.endTime ?? sortedDrafts[index + 1]?.startTime ?? (draft.startTime + 5), draft.startTime + 0.001);

        const words = draft.words.length > 0
            ? draft.words.map((word, wordIndex) => {
                const nextWordStart = draft.words[wordIndex + 1]?.startTime;
                const fallbackEnd = nextWordStart ?? lineEndTime;
                const endTime = Math.max(word.endTime ?? fallbackEnd, word.startTime + 0.001);
                return {
                    text: word.text,
                    startTime: word.startTime,
                    endTime
                };
            })
            : buildTimedWords(draft.fullText, draft.startTime, lineEndTime);

        if (words.length > 0) {
            lineEndTime = Math.max(lineEndTime, words[words.length - 1].endTime);
        }

        return {
            words,
            startTime: draft.startTime,
            endTime: lineEndTime,
            fullText: draft.fullText,
            translation: translations[index]
        };
    });

    return {
        lines: finalizeParsedLyricLines(lines, options),
        title: metadata.title,
        artist: metadata.artist
    };
};

export const parseLyricsByFormat = (
    format: LyricParseFormat,
    content: string,
    translation: string = '',
    options: LyricProcessingOptions = {}
): LyricData => {
    switch (format) {
        case 'yrc':
            return parseYRC(content, translation, options);
        case 'enhanced-lrc':
            return parseEnhancedLRC(content, translation, options);
        case 'vtt':
            return parseVTT(content, translation, options);
        case 'lrc':
        default:
            return parseLRC(content, translation, options);
    }
};
