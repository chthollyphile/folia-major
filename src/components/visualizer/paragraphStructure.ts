// Copyright (c) 2026 chthollyphile
import type { Line } from '../../types';
import { getLineRenderEndTime } from '../../utils/lyrics/renderHints';
import { segmentLyricWords } from '../../utils/lyrics/wordSegmentation';

// src/components/visualizer/paragraphStructure.ts
// 歌词分段（绘光、花火共用）：与 tempera / sonnet 的分段规则相同（空隙中位数 × 2.5 定阈值、元数据变化切段、超限段落在
// 最大空隙处切开、按副歌标记 / 时长 / 词数 / 标点分类），取自 lumisynth 编译器的 structure 步骤。
// 唯一的差别是超限段落的左半部分也继续切（lumisynth 的 recursiveSplit，folia 原版只切右半部分）。
// tempera / sonnet 的分段函数是模块私有的，所以这里带一份。

/** 段落性质（与 tempera / sonnet 的分段分类相同）。 */
export type ParagraphKind = 'breath' | 'verse' | 'lift' | 'chorus' | 'break' | 'outro';

/** 段落从哪里切开：歌曲开头、时间空隙、歌词元数据（blockIndex / songPart）变化、超出时长或行数上限；intro / instrumental 为各模式自己补的间奏段。 */
export type ParagraphBoundary = 'song-start' | 'time-gap' | 'metadata' | 'duration-cap' | 'line-cap' | 'intro' | 'instrumental';

/** 编译时的一行：全曲行序号、行本身、视觉结束时间（不越过下一行开始）。 */
export interface StructureLine {
    sourceIndex: number;
    line: Line;
    renderEndTime: number;
}

export interface ParagraphStructureParams {
    /** 段落切分阈值 = 相邻行空隙中位数 × multiplier，钳在 [min, max] 秒。 */
    gapMultiplier: number;
    gapMin: number;
    gapMax: number;
    /** 超过行数或时长的段落在最大空隙处切开。 */
    maxLines: number;
    maxDuration: number;
    /** 超限段落的左半部分也继续切。 */
    recursiveSplit: boolean;
}

export const DEFAULT_PARAGRAPH_STRUCTURE_PARAMS: ParagraphStructureParams = {
    gapMultiplier: 2.5, gapMin: 1.25, gapMax: 3.5, maxLines: 6, maxDuration: 18, recursiveSplit: true,
};

export interface ParagraphDraft {
    lines: StructureLine[];
    boundary: ParagraphBoundary;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const median = (values: number[]) => {
    if (values.length === 0) return 0.5;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? ((sorted[middle - 1] ?? sorted[middle]!) + sorted[middle]!) / 2
        : sorted[middle]!;
};

/** 编译用的行：视觉结束时间可以超出 endTime，但不越过下一行开始。 */
export const buildStructureLines = (lines: readonly Line[]): StructureLine[] => lines.map((line, sourceIndex) => ({
    sourceIndex,
    line,
    renderEndTime: Math.max(
        line.startTime,
        Math.min(getLineRenderEndTime(line), lines[sourceIndex + 1]?.startTime ?? Number.POSITIVE_INFINITY),
    ),
}));

export const resolveParagraphGapThreshold = (lines: readonly Line[], params: ParagraphStructureParams = DEFAULT_PARAGRAPH_STRUCTURE_PARAMS) => {
    const gaps = lines.slice(1).map((line, index) => (
        line.startTime - Math.min(getLineRenderEndTime(lines[index]), line.startTime)
    )).filter(gap => gap > 0);
    return clamp(median(gaps) * params.gapMultiplier, params.gapMin, params.gapMax);
};

export const metadataChanged = (previous: Line, next: Line) => (
    (previous.blockIndex !== undefined && next.blockIndex !== undefined && previous.blockIndex !== next.blockIndex)
    || (previous.songPart !== undefined && next.songPart !== undefined && previous.songPart !== next.songPart)
);

/** 超过行数或时长的段落在最大空隙处切开；recursiveSplit 时左半部分也继续切。 */
export const splitOversizedDraft = (draft: ParagraphDraft, params: ParagraphStructureParams): ParagraphDraft[] => {
    const output: ParagraphDraft[] = [];
    let remaining = draft.lines;
    let boundary = draft.boundary;
    let loopGuard = 0;
    while (remaining.length > params.maxLines || (remaining.length > 1 && (remaining.at(-1)!.renderEndTime - remaining[0]!.line.startTime) > params.maxDuration)) {
        if (loopGuard++ > 1000) break;
        const candidates = remaining.slice(2, -1).map((line, offset) => ({
            splitIndex: offset + 2,
            gap: line.line.startTime - remaining[offset + 1]!.renderEndTime,
        }));
        const validCandidates = candidates.filter(candidate => !Number.isNaN(candidate.gap));
        const rawSplitIndex = validCandidates.sort((a, b) => b.gap - a.gap)[0]?.splitIndex ?? Math.min(4, remaining.length - 1);
        const splitIndex = Math.max(1, rawSplitIndex);
        const head: ParagraphDraft = { lines: remaining.slice(0, splitIndex), boundary };
        output.push(...(params.recursiveSplit ? splitOversizedDraft(head, params) : [head]));
        remaining = remaining.slice(splitIndex);
        boundary = output.at(-1)!.lines.length >= params.maxLines ? 'line-cap' : 'duration-cap';
    }
    output.push({ lines: remaining, boundary });
    return output;
};

/** 自动分段：元数据变化或空隙超过阈值处切开，再按上限切开超长的段落。 */
export const draftParagraphs = (
    lines: readonly StructureLine[],
    threshold: number,
    params: ParagraphStructureParams = DEFAULT_PARAGRAPH_STRUCTURE_PARAMS,
): ParagraphDraft[] => {
    const drafts: ParagraphDraft[] = [];
    let current: ParagraphDraft = { lines: [], boundary: 'song-start' };
    lines.forEach((line, index) => {
        const previous = lines[index - 1];
        const gap = previous ? line.line.startTime - previous.renderEndTime : 0;
        const boundary = previous && metadataChanged(previous.line, line.line)
            ? 'metadata'
            : previous && gap >= threshold
                ? 'time-gap'
                : null;
        if (boundary && current.lines.length > 0) {
            drafts.push(...splitOversizedDraft(current, params));
            current = { lines: [], boundary };
        }
        current.lines.push(line);
    });
    if (current.lines.length > 0) drafts.push(...splitOversizedDraft(current, params));
    return drafts;
};

/** 一行里「像词」的片段数。 */
export const countWordLike = (line: Line) => segmentLyricWords(line).filter(part => part.isWordLike).length;

/** 段落性质：副歌标记 → 间奏标记 → 最后一段是尾声 → 短或词少是换气 → 标点多或词密是上扬 → 其余是主歌。 */
export const classifyParagraph = (lines: readonly StructureLine[], index: number, total: number): ParagraphKind => {
    if (lines.some(item => item.line.isChorus || /chorus|副歌/i.test(item.line.songPart ?? ''))) return 'chorus';
    if (lines.some(item => /bridge|break|間奏|ブリッジ/i.test(item.line.songPart ?? ''))) return 'break';
    if (index === total - 1) return 'outro';
    const duration = lines.at(-1)!.renderEndTime - lines[0]!.line.startTime;
    const segmentCount = lines.reduce((sum, line) => sum + countWordLike(line.line), 0);
    const punctuationCount = lines.reduce((sum, line) => sum + (line.line.fullText.match(/[!?！？…]/g)?.length ?? 0), 0);
    if (duration <= 3.5 || segmentCount <= 3) return 'breath';
    if (punctuationCount >= 2 || segmentCount / Math.max(duration, 1) > 2.5) return 'lift';
    return 'verse';
};
