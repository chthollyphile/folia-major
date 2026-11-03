import { LyricData, Line, Word } from '../../types';
import type { TimedLyricFormat } from './formatDetection';
import { annotateLyricLines } from './renderHints';
import type { LyricProcessingOptions } from './types';
import { TTMLParser } from '@applemusic-like-lyrics/ttml';
import { DOMParser } from '@xmldom/xmldom';
import { buildLyricDataFromTTMLResult } from './ttmlConversion';

export type LyricParseFormat = TimedLyricFormat | 'yrc' | 'qrc' | 'krc' | 'awlrc';

export interface TimedTextEntry {
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

// Minutes have two digits, or three in a track of a hundred minutes and more.
const GLOBAL_LRC_TIME_REGEX = /\[(\d{2,3}):(\d{2})[.:](\d{2,3})\]/g;
const GLOBAL_ANGLE_TIME_REGEX = /<(\d{2,3}):(\d{2})[.:](\d{2,3})>/g;
const LRC_LINE_TIME_REGEX = /^\[(\d{2,3}):(\d{2})[.:](\d{2,3})\]/;
const LEADING_LRC_TAGS_REGEX = /^((?:\[(?:\d{2,3}):(?:\d{2})[.:](?:\d{2,3})\])+)(.*)$/;
const LRC_METADATA_REGEX = /^\[(ti|ar):([^\]]*)\]$/i;
// Mirrors LX Music's own `timeExp` (lrc-file-parser): 1..3 colon-separated fields plus a fraction,
// so `[ss.ms]`, `[mm:ss.ms]` and `[hh:mm:ss.ms]` all parse.
const AWLRC_LINE_REGEX = /^\[(\d{1,3}(?::\d{1,3}){0,2})\.(\d{1,3})\](.*)$/;
// LX normalises KRC's three-field syllable tag down to two fields, but accept the original as well.
const AWLRC_WORD_REGEX = /<(\d+),(\d+)(?:,\d+)?>([^<]*)/g;
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

const ALTERNATE_TRACK_MATCH_WINDOW = 1.0;

/** First index whose startTime is >= `time`; `entries` is sorted by startTime. */
const lowerBoundByStartTime = (entries: TimedTextEntry[], time: number): number => {
    let low = 0;
    let high = entries.length;
    while (low < high) {
        const middle = (low + high) >> 1;
        if (entries[middle].startTime < time) {
            low = middle + 1;
        } else {
            high = middle;
        }
    }
    return low;
};

/**
 * Pairs each lyric line with the translation (or romanization) entry that belongs to it.
 *
 * Every line and every entry is used at most once, and the closest pairs are settled first:
 * all candidate pairs within the ±1s window are ranked by time difference and taken greedily.
 * Exact timestamp matches therefore always win, and a line with no entry of its own no longer
 * borrows its neighbour's — the old nearest-neighbour lookup let one entry serve every line within
 * a second of it, so a line sung right after a translated one showed that translation twice, and
 * two lines starting together (a duet) both got the first line's translation.
 */
export const findTranslationsForSortedStartTimes = (
    startTimes: number[],
    entries: TimedTextEntry[]
): Array<string | undefined> => {
    const translations: Array<string | undefined> = startTimes.map(() => undefined);
    if (startTimes.length === 0 || entries.length === 0) {
        return translations;
    }

    const candidates: Array<{ line: number; entry: number; diff: number }> = [];
    startTimes.forEach((startTime, line) => {
        for (
            let entry = lowerBoundByStartTime(entries, startTime - ALTERNATE_TRACK_MATCH_WINDOW);
            entry < entries.length && entries[entry].startTime < startTime + ALTERNATE_TRACK_MATCH_WINDOW;
            entry += 1
        ) {
            const diff = Math.abs(entries[entry].startTime - startTime);
            if (diff < ALTERNATE_TRACK_MATCH_WINDOW) {
                candidates.push({ line, entry, diff });
            }
        }
    });

    // Ties go to the earlier line, then the earlier entry, so equal timestamps pair up in order.
    candidates.sort((left, right) => left.diff - right.diff || left.line - right.line || left.entry - right.entry);

    const lineTaken = new Array<boolean>(startTimes.length).fill(false);
    const entryTaken = new Array<boolean>(entries.length).fill(false);
    for (const candidate of candidates) {
        if (lineTaken[candidate.line] || entryTaken[candidate.entry]) continue;
        lineTaken[candidate.line] = true;
        entryTaken[candidate.entry] = true;
        translations[candidate.line] = entries[candidate.entry].text;
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
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
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
    const romanizationEntries = parseTimedTextEntries(romanizationString).entries;
    const translations = findTranslationsForSortedStartTimes(
        sortedRawEntries.map(entry => entry.startTime),
        transEntries
    );
    const romanizations = findTranslationsForSortedStartTimes(
        sortedRawEntries.map(entry => entry.startTime),
        romanizationEntries
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
            translation,
            romanization: romanizations[index]
        });
    }

    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: false };
};

export const parseYRC = (
    yrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const rawLinesData: Array<{
        words: Word[];
        startTime: number;
        endTime: number;
        fullText: string;
    }> = [];
    const translationEntries = parseTimedTextEntries(translationString).entries;
    const romanizationEntries = parseTimedTextEntries(romanizationString).entries;
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
    const romanizations = findTranslationsForSortedStartTimes(
        sortedRawLines.map(line => line.startTime),
        romanizationEntries
    );
    const lines: Line[] = sortedRawLines.map((line, index) => ({
        ...line,
        translation: translations[index],
        romanization: romanizations[index]
    }));

    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: true };
};

export const parseQRC = (
    qrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const rawLinesData: Array<{
        words: Word[];
        startTime: number;
        endTime: number;
        fullText: string;
    }> = [];
    const parseQrcTrackEntries = (track: string): TimedTextEntry[] => {
        if (!track.trim()) return [];

        const qrcLines = parseQRC(track).lines;
        if (qrcLines.length > 0) {
            return qrcLines.map(line => ({ startTime: line.startTime, text: line.fullText }));
        }

        return parseTimedTextEntries(track).entries;
    };
    const translationEntries = parseQrcTrackEntries(translationString);
    const romanizationEntries = parseQrcTrackEntries(romanizationString);
    const rawLines = qrcString.replace(/^\uFEFF/, '').split(/\r?\n/);
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
        const tagRegex = /\((\d+),(\d+)(?:,\d+)?\)/g;
        const tags: Array<{ startMs: number; durationMs: number; tagStart: number; tagEnd: number; }> = [];
        let tagMatch: RegExpExecArray | null;

        while ((tagMatch = tagRegex.exec(rest)) !== null) {
            tags.push({
                startMs: parseInt(tagMatch[1], 10),
                durationMs: parseInt(tagMatch[2], 10),
                tagStart: tagMatch.index,
                tagEnd: tagMatch.index + tagMatch[0].length,
            });
        }

        if (tags.length === 0) {
            continue;
        }

        const textChunks: string[] = [];
        let cursor = 0;
        for (const tag of tags) {
            textChunks.push(rest.slice(cursor, tag.tagStart));
            cursor = tag.tagEnd;
        }
        textChunks.push(rest.slice(cursor));

        const prefersLeadingText = textChunks[0].trim().length > 0 && textChunks[textChunks.length - 1].trim().length === 0;
        const prefersTrailingText = textChunks[0].trim().length === 0 && textChunks[textChunks.length - 1].trim().length > 0;

        for (let index = 0; index < tags.length; index += 1) {
            const tag = tags[index];
            const leadingText = textChunks[index] ?? '';
            const trailingText = textChunks[index + 1] ?? '';
            let text = '';

            if (prefersLeadingText) {
                text = leadingText;
            } else if (prefersTrailingText) {
                text = trailingText;
            } else if (trailingText.trim().length > 0 && leadingText.trim().length === 0) {
                text = trailingText;
            } else if (leadingText.trim().length > 0 && trailingText.trim().length === 0) {
                text = leadingText;
            } else {
                text = trailingText.length >= leadingText.length ? trailingText : leadingText;
            }

            if (!text) {
                continue;
            }

            words.push({
                text,
                startTime: tag.startMs / 1000,
                endTime: (tag.startMs + tag.durationMs) / 1000
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
    const romanizations = findTranslationsForSortedStartTimes(
        sortedRawLines.map(line => line.startTime),
        romanizationEntries
    );
    const lines: Line[] = sortedRawLines.map((line, index) => ({
        ...line,
        translation: translations[index],
        romanization: romanizations[index]
    }));

    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: true };
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
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const entries = parseVTTEntries(vttString);
    const translationEntries = parseVTTEntries(translationString);
    const romanizationEntries = parseVTTEntries(romanizationString);
    const translations = findTranslationsForSortedStartTimes(
        entries.map(entry => entry.startTime),
        translationEntries
    );
    const romanizations = findTranslationsForSortedStartTimes(
        entries.map(entry => entry.startTime),
        romanizationEntries
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
            translation: translations[index],
            romanization: romanizations[index]
        });
    }

    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: false };
};

export const parseTTML = (
    ttmlString: string,
    _translationString: string = '',
    options: LyricProcessingOptions = {},
    _romanizationString: string = ''
): LyricData => {
    const ttmlResult = TTMLParser.parse(ttmlString.replace(/^\uFEFF/, ''), {
        domParser: new DOMParser(),
    });
    const parsed = buildLyricDataFromTTMLResult(ttmlResult, buildTimedWords);
    const adapted = {
        ...parsed,
        lines: finalizeParsedLyricLines(parsed.lines, options),
    };

    console.log('[TTML] Adapted lyric data for visualizers:', adapted);

    return adapted;
};

export const parseEnhancedLRC = (
    lrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const metadata: LrcMetadata = {};
    const drafts: DraftLine[] = [];
    const translationEntries = parseTimedTextEntries(translationString).entries;
    const romanizationEntries = parseTimedTextEntries(romanizationString).entries;
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
    const romanizations = findTranslationsForSortedStartTimes(
        sortedDrafts.map(draft => draft.startTime),
        romanizationEntries
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
            translation: translations[index],
            romanization: romanizations[index]
        };
    });

    return {
        lines: finalizeParsedLyricLines(lines, options),
        title: metadata.title,
        artist: metadata.artist,
        // Enhanced LRC may mix timed and plain lines; any line that carried its own word
        // timestamps makes the file word-timed. Plain lines got evenly spread placeholder words.
        isWordByWord: sortedDrafts.some(draft => draft.words.length > 0),
    };
};

/**
 * Parses Kugou KRC lyric format.
 * KRC is structured similar to QRC/YRC but uses angle brackets (<...>) for word tags
 * and relative millisecond offsets instead of absolute timestamps.
 */
export const parseKRC = (
    krcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const rawLinesData: Array<{
        words: Word[];
        startTime: number;
        endTime: number;
        fullText: string;
    }> = [];

    // Decode [language:...] tag from the KRC string itself if available
    let embeddedTranslations: string[] = [];
    let embeddedRomanizations: string[] = [];
    const langMatch = krcString.match(/\[language:([^\]]*)\]/);
    if (langMatch) {
        try {
            let cleanB64 = langMatch[1].trim();
            while (cleanB64.length % 4 !== 0) {
                cleanB64 += '=';
            }
            const decoded = typeof Buffer !== 'undefined'
                ? Buffer.from(cleanB64, 'base64').toString('utf8')
                : new TextDecoder('utf-8').decode(Uint8Array.from(atob(cleanB64), c => c.charCodeAt(0)));
            const obj = JSON.parse(decoded);
            const readEmbeddedTrack = (type: number): string[] => {
                const track = obj.content?.find((item: any) => item.type === type);
                if (!track || !Array.isArray(track.lyricContent)) return [];
                return track.lyricContent.map((lines: any) => {
                    if (Array.isArray(lines)) {
                        return lines.join('').trim();
                    }
                    return String(lines).trim();
                });
            };
            embeddedRomanizations = readEmbeddedTrack(0);
            embeddedTranslations = readEmbeddedTrack(1);
        } catch (err) {
            console.error('[Kugou KRC] Failed to decode/parse language tag:', err);
        }
    }

    const translationEntries = parseTimedTextEntries(translationString).entries;
    const romanizationEntries = parseTimedTextEntries(romanizationString).entries;
    const rawLines = krcString.replace(/^\uFEFF/, '').split(/\r?\n/);
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

        const wordRegex = /\<(\d+),(\d+)(?:,\d+)?\>([^\<]*)/g;
        let wordMatch: RegExpExecArray | null;

        while ((wordMatch = wordRegex.exec(rest)) !== null) {
            const wordStartOffsetMs = parseInt(wordMatch[1], 10);
            const wordDurationMs = parseInt(wordMatch[2], 10);
            const text = wordMatch[3];

            // Note: KRC word start offset is relative to the line start time.
            const wordStartMs = lineStartTimeMs + wordStartOffsetMs;

            words.push({
                text,
                startTime: wordStartMs / 1000,
                endTime: (wordStartMs + wordDurationMs) / 1000
            });
            fullText += text;
        }

        // If no word tags but text is present, build timed words
        const trimmedRest = rest.trim();
        if (words.length === 0 && trimmedRest.length > 0 && !trimmedRest.startsWith('[') && !trimmedRest.startsWith('<')) {
            words.push(...buildTimedWords(trimmedRest, lineStartTime, lineEndTime));
            fullText = trimmedRest;
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
    const lines: Line[] = sortedRawLines.map((line, index) => {
        let translation = embeddedTranslations[index] || undefined;
        let romanization = embeddedRomanizations[index] || undefined;
        if (!translation && translationEntries.length > 0) {
            const externalTrans = findTranslationsForSortedStartTimes([line.startTime], translationEntries);
            translation = externalTrans[0] || undefined;
        }
        if (!romanization && romanizationEntries.length > 0) {
            const externalRomanization = findTranslationsForSortedStartTimes([line.startTime], romanizationEntries);
            romanization = externalRomanization[0] || undefined;
        }
        return {
            ...line,
            translation,
            romanization
        };
    });

    return { lines: finalizeParsedLyricLines(lines, options), isWordByWord: true };
};

/**
 * Converts an awlrc line head to seconds.
 *
 * LX Music builds these stamps as `${mm}:${ss}.${ms}` where `ms` is the raw `time % 1000` remainder,
 * and its KuGou and Migu adapters emit it without zero padding (only the QQ adapter pads to three
 * digits). So the fraction is a verbatim millisecond count, not a decimal fraction: `[02:43.97]` is
 * 43s 97ms, not 43s 970ms. Reading it as an LRC centisecond fraction shifts those lines by up to
 * 900ms and pushes them past the following line.
 */
const parseAwlrcTimestamp = (fields: string, fraction: string): number => {
    const parts = fields.split(':').map(part => parseInt(part, 10));
    while (parts.length < 3) {
        parts.unshift(0);
    }

    const [hours, minutes, seconds] = parts;
    return (hours * 3600) + (minutes * 60) + seconds + (parseInt(fraction, 10) / 1000);
};

/** Reads a plain (non word-by-word) container track using awlrc timestamp semantics. */
const parseAwlrcAlternateTrack = (content: string): TimedTextEntry[] => {
    const entries: TimedTextEntry[] = [];

    for (const rawLine of content.replace(/^﻿/, '').split(/\r?\n/)) {
        const match = rawLine.trim().match(AWLRC_LINE_REGEX);
        const text = match?.[3]?.trim();
        if (!match || !text) {
            continue;
        }

        entries.push({ startTime: parseAwlrcTimestamp(match[1], match[2]), text });
    }

    return entries;
};

/**
 * Resolves an alternate track against line start times.
 *
 * KuGou's container tracks are timestamp-identical to the awlrc track, so a single exact hit proves
 * the track is timestamp-keyed; from there every lookup stays exact. A line with no exact counterpart
 * genuinely has no alternate text (title and composer credits are blank rows in those tracks), and
 * falling back to the ±1s nearest-neighbour match there would hand it the next line's translation.
 * Only a track with zero exact hits — a differently-timed source — uses the nearest-neighbour match.
 */
const resolveAlternateTracks = (
    startTimes: number[],
    entries: TimedTextEntry[]
): Array<string | undefined> => {
    if (entries.length === 0) {
        return startTimes.map(() => undefined);
    }

    const exactByMs = new Map<number, string>();
    for (const entry of entries) {
        const key = Math.round(entry.startTime * 1000);
        if (!exactByMs.has(key)) {
            exactByMs.set(key, entry.text);
        }
    }

    const exact = startTimes.map(startTime => exactByMs.get(Math.round(startTime * 1000)));
    if (exact.some(text => text !== undefined)) {
        return exact;
    }

    return findTranslationsForSortedStartTimes(startTimes, entries);
};

/**
 * Parses the word-by-word track of a KuGou/LX `[awlrc:...]` container.
 * Unlike KRC, the line head carries only a start timestamp — the line end is derived from the last
 * syllable, whose `<offsetMs,durationMs>` marker is relative to the line start.
 */
export const parseAwlrc = (
    awlrcString: string,
    translationString: string = '',
    options: LyricProcessingOptions = {},
    romanizationString: string = ''
): LyricData => {
    const metadata: LrcMetadata = {};
    const drafts: Array<{ words: Word[]; startTime: number; endTime: number; fullText: string }> = [];

    for (const rawLine of awlrcString.replace(/^﻿/, '').split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || parseMetadataLine(line, metadata)) {
            continue;
        }

        const lineMatch = line.match(AWLRC_LINE_REGEX);
        if (!lineMatch) {
            continue;
        }

        const startTime = parseAwlrcTimestamp(lineMatch[1], lineMatch[2]);
        const words: Word[] = [];
        let fullText = '';
        // Cursor repairs the zero-duration and backwards syllable markers KuGou occasionally emits.
        let cursorMs = 0;

        AWLRC_WORD_REGEX.lastIndex = 0;
        let wordMatch: RegExpExecArray | null;
        while ((wordMatch = AWLRC_WORD_REGEX.exec(lineMatch[3])) !== null) {
            const offsetMs = Math.max(parseInt(wordMatch[1], 10), cursorMs);
            const durationMs = Math.max(parseInt(wordMatch[2], 10), 1);

            words.push({
                text: wordMatch[3],
                startTime: startTime + (offsetMs / 1000),
                endTime: startTime + ((offsetMs + durationMs) / 1000)
            });
            cursorMs = offsetMs + durationMs;
            fullText += wordMatch[3];
        }

        if (words.length === 0 || !fullText.trim()) {
            continue;
        }

        drafts.push({ words, startTime, endTime: startTime + (cursorMs / 1000), fullText });
    }

    // Some exports order the credit lines by fraction digits rather than by value (`.79` before `.181`).
    drafts.sort((left, right) => left.startTime - right.startTime);

    // The container's tracks are all stamped by the same LX writer, so they must be read with the
    // same timestamp semantics as the awlrc track or the exact-match alignment below falls apart.
    const startTimes = drafts.map(draft => draft.startTime);
    const translations = resolveAlternateTracks(startTimes, parseAwlrcAlternateTrack(translationString));
    const romanizations = resolveAlternateTracks(startTimes, parseAwlrcAlternateTrack(romanizationString));

    const lines: Line[] = drafts.map((draft, index) => {
        const next = drafts[index + 1];
        // The derived end may overrun the next line when the final syllable is padded.
        const endTime = next ? Math.min(draft.endTime, next.startTime) : draft.endTime;

        return {
            words: draft.words,
            startTime: draft.startTime,
            endTime: Math.max(endTime, draft.startTime),
            fullText: draft.fullText,
            translation: translations[index],
            romanization: romanizations[index]
        };
    });

    return {
        lines: finalizeParsedLyricLines(lines, options),
        title: metadata.title,
        artist: metadata.artist,
        isWordByWord: true
    };
};

export const parseLyricsByFormat = (
    format: LyricParseFormat,
    content: string,
    translation: string = '',
    options: LyricProcessingOptions = {},
    romanization: string = ''
): LyricData => {
    switch (format) {
        case 'yrc':
            return parseYRC(content, translation, options, romanization);
        case 'qrc':
            return parseQRC(content, translation, options, romanization);
        case 'krc':
            return parseKRC(content, translation, options, romanization);
        case 'awlrc':
            return parseAwlrc(content, translation, options, romanization);
        case 'enhanced-lrc':
            return parseEnhancedLRC(content, translation, options, romanization);
        case 'vtt':
            return parseVTT(content, translation, options, romanization);
        case 'ttml':
            return parseTTML(content, translation, options, romanization);
        case 'lrc':
        default:
            return parseLRC(content, translation, options, romanization);
    }
};
