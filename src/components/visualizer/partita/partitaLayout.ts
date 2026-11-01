import React from 'react';
import { DEFAULT_PARTITA_TUNING, Line, Theme, Word as WordType, type PartitaTuning } from '../../../types';
import { buildDisplayWordsFromLayoutUnits, buildPostLyricLayoutUnits, type LyricLayoutUnit } from '../../../utils/lyrics/cjkSemanticLayout';
import { getWordSegmentationKey } from '../../../utils/lyrics/wordSegmentation';
import { type VisualizerPreheatWindow } from '../runtime';
import { resolveWordColor } from '../wordColoring';
import { rememberBounded } from '../textMeasureCache';

// src/components/visualizer/partita/partitaLayout.ts
// 云阶的分栏布局：把当前行切成 chunk 排进若干列，算出每个词的偏移 / 旋转 / 缩放，并按 key 缓存。

export interface WordLayoutConfig {
    id: string;
    x: number;
    y: number;
    rotate: number;
    scale: number;
    marginBottom: string;
    alignSelf: string;
    passedRotate: number;
}

interface LineLayoutConfig {
    perspective: number;
    justifyContent: string;
    alignItems: string;
    columnGap: string;
}

interface PartitaColumn {
    id: string;
    words: Array<{
        chunkUnits: LyricLayoutUnit[];
        chunkWords: WordType[];
        displayWords: WordType[];
        config: WordLayoutConfig;
        order: number;
        rowIndex: number;
    }>;
}

export interface PartitaSequentialLayout {
    columns: PartitaColumn[];
    totalGraphemes: number;
    lineConfig: LineLayoutConfig;
}

export const EMPTY_PARTITA_LAYOUT: PartitaSequentialLayout = {
    columns: [],
    totalGraphemes: 0,
    lineConfig: {
        perspective: 1000,
        justifyContent: 'justify-center',
        alignItems: 'items-center',
        columnGap: '1.6rem',
    },
};

const PARTITA_LAYOUT_CACHE_LIMIT = 48;
// Inline-end so the gap trails each word in an RTL chunk too.
export const PARTITA_WORD_LAYOUT_STYLE: React.CSSProperties = { marginInlineEnd: '0.8rem' };
export const PARTITA_PREHEAT_WINDOW: VisualizerPreheatWindow = {
    minLead: 0.18,
    maxLead: 1.2,
};

const isCJK = (text: string) => /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/.test(text);
const graphemeSegmenter = typeof Intl !== 'undefined'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null;
const splitGraphemes = (text: string) => {
    if (!text) return [] as string[];
    if (graphemeSegmenter) {
        return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment);
    }
    return Array.from(text);
};
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clampPartitaStagger = (value: number, fallback: number) => Number.isFinite(value)
    ? clamp(value, 0, 180)
    : fallback;

export const resolvePartitaTuning = (tuning?: PartitaTuning): PartitaTuning => {
    const rawMin = clampPartitaStagger(tuning?.staggerMin ?? DEFAULT_PARTITA_TUNING.staggerMin, DEFAULT_PARTITA_TUNING.staggerMin);
    const rawMax = clampPartitaStagger(tuning?.staggerMax ?? DEFAULT_PARTITA_TUNING.staggerMax, DEFAULT_PARTITA_TUNING.staggerMax);

    return {
        showGuideLines: tuning?.showGuideLines ?? DEFAULT_PARTITA_TUNING.showGuideLines,
        useSemanticLayout: tuning?.useSemanticLayout ?? DEFAULT_PARTITA_TUNING.useSemanticLayout,
        staggerMin: Math.min(rawMin, rawMax),
        staggerMax: Math.max(rawMin, rawMax),
    };
};

export const getActiveColor = (wordText: string, theme: Theme) => {
    return resolveWordColor(wordText, theme.wordColors, theme.accentColor);
};

const getTargetColumnCount = (totalGraphemes: number, wordCount: number) => {
    if (wordCount <= 2 || totalGraphemes <= 5) return 1;
    if (totalGraphemes <= 10) return 2;
    if (totalGraphemes <= 16) return 3;
    if (totalGraphemes <= 24) return 4;
    return 5;
};

const buildSequentialColumns = (line: Line, theme: Theme, windowHeight: number, tuning: PartitaTuning): PartitaSequentialLayout => {
    // Partita wants the line to feel "composed", not scattered.
    // So instead of throwing each word around independently, first decide how many chunks/rows the line should have.
    const intensity = theme.animationIntensity;
    const isChaotic = intensity === 'chaotic';
    const isCalm = intensity === 'calm';
    const totalGraphemes = Math.max(splitGraphemes(line.fullText.replace(/\s+/g, '')).length, line.words.length, 1);
    const layoutUnits = buildPostLyricLayoutUnits(line, {
        semantic: tuning.useSemanticLayout,
        sticky: true,
    });

    const columns: PartitaColumn[] = [];
    let currentWords: PartitaColumn['words'] = [];

    const baseRowHeight = 100;
    const availableHeight = windowHeight * 0.65;
    const targetRowCount = Math.max(1, Math.floor(availableHeight / baseRowHeight));
    const actualRowCount = Math.min(layoutUnits.length, targetRowCount);

    let seed = line.startTime;
    const random = () => {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    };

    const chunks: LyricLayoutUnit[][] = [];
    let remainingUnits = layoutUnits.length;
    let remainingChunks = actualRowCount;
    let unitIndex = 0;

    for (let c = 0; c < actualRowCount; c++) {
        // Chunk lengths are intentionally uneven.
        // Perfectly even splitting looked too mechanical and killed the handwritten score vibe.
        const isLastChunk = c === actualRowCount - 1;
        const avg = remainingUnits / remainingChunks;

        let chunkLength = 1;
        if (isLastChunk) {
            chunkLength = remainingUnits;
        } else {
            const max = Math.ceil(avg * 1.5);
            const min = 1;
            const randVal = random();
            chunkLength = Math.max(min, Math.min(max, Math.round(avg + (randVal - 0.5) * avg)));
        }

        chunkLength = Math.max(1, Math.min(chunkLength, remainingUnits - (remainingChunks - 1)));

        chunks.push(layoutUnits.slice(unitIndex, unitIndex + chunkLength));
        unitIndex += chunkLength;
        remainingUnits -= chunkLength;
        remainingChunks--;
    }

    chunks.forEach((chunkUnits, rowIndex) => {
        const chunkWords = chunkUnits.flatMap(unit => unit.words);
        const displayWords = buildDisplayWordsFromLayoutUnits(chunkUnits);
        if (chunkWords.length === 0) return;

        const mergedTextForConfig = chunkWords.map(w => w.text.trim()).join('');
        const graphemeCount = splitGraphemes(mergedTextForConfig.replace(/\s+/g, '')).length;
        const rowBias = rowIndex - (actualRowCount - 1) / 2;

        const isStaggeredLeft = rowIndex % 2 === 0;

        // Stagger is the core "Partita" move.
        // The chunk positions should feel offset and sequenced, but still readable as a single line.
        const staggerMagnitude = tuning.staggerMin + random() * Math.max(tuning.staggerMax - tuning.staggerMin, 0);
        const staggerX = isStaggeredLeft ? -staggerMagnitude : staggerMagnitude;

        const staggerScale = isCalm ? 1 : 0.8 + random() * 0.9;

        currentWords.push({
            chunkUnits,
            chunkWords,
            displayWords,
            order: rowIndex,
            rowIndex,
            config: {
                id: `${rowIndex}-${chunkWords[0].startTime}`,
                x: staggerX,
                y: isCalm ? 0 : rowBias * 2.5,
                rotate: isChaotic ? (isStaggeredLeft ? -3 : 3) : 0,
                scale: (isChaotic ? 1 + Math.min(graphemeCount * 0.01, 0.05) : 1) * staggerScale,
                marginBottom: isChaotic ? '0.4rem' : '0.6rem',
                alignSelf: 'center',
                passedRotate: (rowIndex % 2 === 0 ? 1 : -1) * (isChaotic ? 6 : 3),
            },
        });
    });

    if (currentWords.length > 0) {
        columns.push({
            id: `column-${line.startTime}-0`,
            words: currentWords,
        });
    }

    return {
        columns,
        totalGraphemes,
        lineConfig: {
            perspective: theme.animationIntensity === 'chaotic' ? 720 : 1000,
            alignItems: 'items-center',
            justifyContent: 'justify-center',
            columnGap: '2rem',
        },
    };
};

export const buildPartitaLayoutCacheKey = (
    line: Line,
    theme: Theme,
    windowHeight: number,
    tuning: PartitaTuning
) => {
    const windowHeightBucket = Math.round(windowHeight / 24);
    return [
        'semantic-layout-v1',
        line.startTime,
        line.endTime,
        line.words.length,
        line.fullText,
        // The saved split feeds buildPostLyricLayoutUnits below, so it changes the columns. The
        // cache outlives a re-segmentation of the song playing (it is only bounded by its LRU),
        // so without this a line already on screen kept the layout built from the old split.
        getWordSegmentationKey(line),
        theme.animationIntensity,
        theme.fontWeight ?? 'auto',
        windowHeightBucket,
        tuning.staggerMin,
        tuning.staggerMax,
        tuning.showGuideLines ? 1 : 0,
        tuning.useSemanticLayout ? 1 : 0,
    ].join('|');
};

export const getOrBuildPartitaLayout = (
    cache: Map<string, PartitaSequentialLayout>,
    line: Line,
    theme: Theme,
    windowHeight: number,
    tuning: PartitaTuning
): PartitaSequentialLayout => {
    const cacheKey = buildPartitaLayoutCacheKey(line, theme, windowHeight, tuning);
    const cached = cache.get(cacheKey);
    if (cached) {
        // Layout cache matters here because rebuilding columns on every frame would be pointless and expensive.
        return cached;
    }

    const layout = buildSequentialColumns(line, theme, windowHeight, tuning);
    return rememberBounded(cache, cacheKey, layout, PARTITA_LAYOUT_CACHE_LIMIT);
};
