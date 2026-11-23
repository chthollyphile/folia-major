import type {
    Agent as TtmlAgent,
    BackgroundVocal as TtmlBackgroundVocal,
    LyricLine as TtmlLyricLine,
    Syllable as TtmlSyllable,
    SubLyricContent as TtmlSubLyricContent,
    TTMLResult,
} from '@applemusic-like-lyrics/ttml';
import type { Line, LyricAlternateText, LyricBackgroundVocal, LyricData, LyricRuby, LyricSyllable, Word } from '../../types';

// src/utils/lyrics/ttmlConversion.ts
// Maps AMLL/Apple TTML parser output into Folia's stable LyricData shape.

type TimedWordBuilder = (text: string, startTime: number, endTime: number) => Word[];

const NON_WESTERN_TEXT_REGEX = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/u;
const WESTERN_JOINABLE_TEXT_REGEX = /[\p{Script=Latin}\p{N}'’`-]/u;

const seconds = (milliseconds: number | undefined): number => Math.max((milliseconds ?? 0) / 1000, 0);

const optionalArray = <T>(items: T[]): T[] | undefined => items.length > 0 ? items : undefined;

const isWesternJoinableSyllable = (text: string): boolean => {
    const trimmed = text.trim();
    return trimmed.length > 0
        && !NON_WESTERN_TEXT_REGEX.test(trimmed)
        && WESTERN_JOINABLE_TEXT_REGEX.test(trimmed);
};

const convertRuby = (ruby: TtmlSyllable['ruby']): LyricRuby[] | undefined => {
    if (!ruby?.length) {
        return undefined;
    }

    return ruby.map(tag => ({
        text: tag.text,
        startTime: seconds(tag.startTime),
        endTime: seconds(tag.endTime),
    }));
};

const convertSyllable = (syllable: TtmlSyllable): LyricSyllable => ({
    text: syllable.text,
    startTime: seconds(syllable.startTime),
    endTime: seconds(syllable.endTime),
    ...(syllable.endsWithSpace ? { endsWithSpace: true } : {}),
    ...(syllable.obscene ? { obscene: true } : {}),
    ...(typeof syllable.emptyBeat === 'number' ? { emptyBeat: syllable.emptyBeat } : {}),
    ...(syllable.ruby?.length ? { ruby: convertRuby(syllable.ruby) } : {}),
});

// TTML often splits western words into syllables. Preserve those syllables while
// exposing a single Folia Word so visualizers do not introduce layout breaks.
const buildWordsFromSyllables = (
    syllables: TtmlSyllable[] | undefined,
    fallbackText: string,
    startTime: number,
    endTime: number,
    buildTimedWords: TimedWordBuilder
): Word[] => {
    if (!syllables?.length) {
        return fallbackText.trim().length > 0 ? buildTimedWords(fallbackText, startTime, endTime) : [];
    }

    // Line-timed TTML (`itunes:timing="Line"`, Apple's own line lyrics included) reaches here as one
    // syllable holding the whole line: no timing inside it. Kept as is it becomes one unbreakable timed
    // box, which visualizers wrap into several rows lit by a single sweep (#1257). Estimate per-word
    // timing like line-synced LRC does, unless the syllable carries ruby or beat data worth keeping.
    const [onlySyllable] = syllables;
    if (
        syllables.length === 1
        && onlySyllable.text.trim() === fallbackText.trim()
        && !onlySyllable.ruby?.length
        && typeof onlySyllable.emptyBeat !== 'number'
        && !onlySyllable.obscene
    ) {
        const estimated = buildTimedWords(fallbackText, startTime, endTime);
        if (estimated.length > 1) {
            return estimated;
        }
    }

    const converted = syllables.map(convertSyllable);
    const words: Word[] = [];
    let currentGroup: LyricSyllable[] = [];

    const flushGroup = () => {
        if (currentGroup.length === 0) {
            return;
        }

        const text = currentGroup.map(syllable => syllable.text).join('');
        if (text.length > 0) {
            words.push({
                text,
                startTime: currentGroup[0].startTime,
                endTime: currentGroup[currentGroup.length - 1].endTime,
                syllables: currentGroup,
            });
        }
        currentGroup = [];
    };

    for (let index = 0; index < converted.length; index += 1) {
        const current = converted[index];
        const next = converted[index + 1];
        currentGroup.push(current);

        const shouldMergeWithNext = Boolean(
            next
            && !current.endsWithSpace
            && isWesternJoinableSyllable(current.text)
            && isWesternJoinableSyllable(next.text)
        );

        if (!shouldMergeWithNext) {
            flushGroup();
        }
    }

    return words;
};

const convertAlternateTexts = (
    role: 'translation' | 'romanization',
    entries: TtmlSubLyricContent[] | undefined
): LyricAlternateText[] => {
    if (!entries?.length) {
        return [];
    }

    return entries
        .filter(entry => entry.text.trim().length > 0)
        .map(entry => ({
            role,
            ...(entry.language ? { language: entry.language } : {}),
            text: entry.text,
            ...(entry.words?.length ? { syllables: entry.words.map(convertSyllable) } : {}),
        }));
};

const getFirstText = (entries: TtmlSubLyricContent[] | undefined): string | undefined =>
    entries?.find(entry => entry.text.trim().length > 0)?.text;

const isChorusSongPart = (songPart: string | undefined): boolean =>
    songPart?.trim().toLowerCase() === 'chorus';

const convertBackgroundVocal = (
    vocal: TtmlBackgroundVocal | undefined,
    buildTimedWords: TimedWordBuilder
): LyricBackgroundVocal | undefined => {
    if (!vocal || !vocal.text.trim()) {
        return undefined;
    }

    const startTime = seconds(vocal.startTime);
    const endTime = seconds(vocal.endTime);
    const alternateTexts = [
        ...convertAlternateTexts('translation', vocal.translations),
        ...convertAlternateTexts('romanization', vocal.romanizations),
    ];

    return {
        text: vocal.text,
        startTime,
        endTime,
        words: buildWordsFromSyllables(vocal.words, vocal.text, startTime, endTime, buildTimedWords),
        ...(getFirstText(vocal.translations) ? { translation: getFirstText(vocal.translations) } : {}),
        ...(getFirstText(vocal.romanizations) ? { romanization: getFirstText(vocal.romanizations) } : {}),
        ...(alternateTexts.length > 0 ? { alternateTexts } : {}),
    };
};

const convertLine = (line: TtmlLyricLine, buildTimedWords: TimedWordBuilder): Line => {
    const startTime = seconds(line.startTime);
    const endTime = seconds(line.endTime);
    const alternateTexts = [
        ...convertAlternateTexts('translation', line.translations),
        ...convertAlternateTexts('romanization', line.romanizations),
    ];
    const backgroundVocal = convertBackgroundVocal(line.backgroundVocal, buildTimedWords);

    return {
        words: buildWordsFromSyllables(line.words, line.text, startTime, endTime, buildTimedWords),
        startTime,
        endTime,
        fullText: line.text,
        ...(getFirstText(line.translations) ? { translation: getFirstText(line.translations) } : {}),
        ...(line.id ? { id: line.id } : {}),
        ...(line.agentId ? { agentId: line.agentId } : {}),
        ...(line.songPart ? { songPart: line.songPart } : {}),
        ...(isChorusSongPart(line.songPart) ? { isChorus: true, chorusOrigin: 'source' as const } : {}),
        ...(typeof line.blockIndex === 'number' ? { blockIndex: line.blockIndex } : {}),
        ...(getFirstText(line.romanizations) ? { romanization: getFirstText(line.romanizations) } : {}),
        ...(alternateTexts.length > 0 ? { alternateTexts } : {}),
        ...(backgroundVocal ? { backgroundVocal, backgroundVocals: [backgroundVocal] } : {}),
    };
};

const lineToBackgroundVocal = (line: Line): LyricBackgroundVocal => ({
    text: line.fullText,
    startTime: line.startTime,
    endTime: line.endTime,
    words: line.words,
    ...(line.agentId ? { agentId: line.agentId } : {}),
    ...(line.translation ? { translation: line.translation } : {}),
    ...(line.romanization ? { romanization: line.romanization } : {}),
    ...(line.alternateTexts?.length ? { alternateTexts: line.alternateTexts } : {}),
});

const isSameTtmlBlock = (mainLine: Line, candidate: Line): boolean =>
    mainLine.blockIndex === undefined
    || candidate.blockIndex === undefined
    || mainLine.blockIndex === candidate.blockIndex;

const isAgentOverlapHarmony = (mainLine: Line, candidate: Line): boolean =>
    Boolean(
        mainLine.agentId
        && candidate.agentId
        && mainLine.agentId !== candidate.agentId
        && candidate.startTime < mainLine.endTime
        && candidate.endTime > mainLine.startTime
        && isSameTtmlBlock(mainLine, candidate)
    );

// Some TTML files encode simultaneous vocals as overlapping <p> lines with different agents.
// Fold the later line into the still-active main line so every visualizer receives one main timeline.
const foldAgentOverlapHarmonyLines = (lines: Line[]): Line[] => {
    const mainLines: Line[] = [];

    for (const line of lines) {
        const mainLine = [...mainLines]
            .reverse()
            .find(candidate => isAgentOverlapHarmony(candidate, line));

        if (!mainLine) {
            mainLines.push(line);
            continue;
        }

        const inferredVocals = [
            lineToBackgroundVocal(line),
            ...(line.backgroundVocals ?? (line.backgroundVocal ? [line.backgroundVocal] : [])),
        ];
        const existingVocals = mainLine.backgroundVocals
            ?? (mainLine.backgroundVocal ? [mainLine.backgroundVocal] : []);
        const backgroundVocals = [...existingVocals, ...inferredVocals];

        mainLine.backgroundVocals = backgroundVocals;
        mainLine.backgroundVocal = backgroundVocals[0];
    }

    return mainLines;
};

const convertAgents = (agents: Record<string, TtmlAgent> | undefined): LyricData['ttml'] => {
    const entries = Object.entries(agents ?? {});
    if (entries.length === 0) {
        return undefined;
    }

    return {
        agents: Object.fromEntries(entries.map(([id, agent]) => [
            id,
            {
                id: agent.id || id,
                ...(agent.name ? { name: agent.name } : {}),
                ...(agent.type ? { type: agent.type } : {}),
            },
        ])),
    };
};

export const buildLyricDataFromTTMLResult = (
    result: TTMLResult,
    buildTimedWords: TimedWordBuilder
): LyricData => {
    const convertedAgents = convertAgents(result.metadata.agents)?.agents;
    const lines = foldAgentOverlapHarmonyLines(
        result.lines.map(line => convertLine(line, buildTimedWords))
    );
    const ttml = {
        ...(result.metadata.timingMode ? { timingMode: result.metadata.timingMode } : {}),
        ...(convertedAgents ? { agents: convertedAgents } : {}),
    };

    return {
        lines,
        isWordByWord: result.metadata.timingMode === 'Word',
        ...(Object.keys(ttml).length > 0 ? { ttml } : {}),
    };
};
