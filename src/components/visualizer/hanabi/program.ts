// Copyright (c) 2026 chthollyphile
import type { Line, Word } from '../../../types';
import { splitLyricGraphemes } from '../../../utils/lyrics/graphemeTiming';
import { segmentLyricWords } from '../../../utils/lyrics/wordSegmentation';
import type { ParagraphKind, StructureLine } from '../paragraphStructure';
import type { Mood } from './hanabiKernel';
import { createRng } from './hanabiRandom';
import { burstPreset, HANABI_KINDS, profileOf } from './catalog';
import type { BlockStyle, BurstKind, EnterFx, HanabiProfile } from './types';

// src/components/visualizer/hanabi/program.ts
// 花火的编译：切块（一行一个镜头，太长的行在词边界切开；行间长空隙出间奏镜头）与选预设。纯数据，不碰 Pixi。
// 与 lumisynth 的差别：folia 没有编辑器，选预设没有锁定、风格库偏好与显式 energy，全按段落性质自动挑。

export interface HanabiSlice {
    lineIndex: number;
    /** 行内文字偏移（UTF-16），[start, end)。 */
    startOffset: number;
    endOffset: number;
}

export interface HanabiShot {
    id: string;
    kind: string;
    /** 覆盖的文字（一般一段；别的包转来的镜头可能跨两行）；间奏镜头为空。 */
    slices: HanabiSlice[];
    startTime: number;
    endTime: number;
    lyricEndTime: number;
    isBridge: boolean;
    /** 组件（不写 = 预设默认）。typography 是借用哪个预设的文字处理（排法、字号、色块、逐字动画）。 */
    typography?: string;
    block?: BlockStyle;
    enter?: EnterFx;
    burst?: BurstKind;
    /** 跨包借排版的宿主：这个镜头的字由别的包排，自己的字隐去，烟花与装饰照常。 */
    textHidden?: true;
}

export interface HanabiParagraph {
    id: string;
    startTime: number;
    endTime: number;
    /** 单元涉及的歌词行（全曲行序号）与行本身。 */
    lineIndices: number[];
    lines: Line[];
    shots: HanabiShot[];
    transitionOut: { kind: string; startTime: number; endTime: number } | null;
}

export interface HanabiChain {
    /** 最近用过的预设（新的在后）。 */
    recent: string[];
    family: string | null;
}

export interface HanabiParams {
    /** 行与行之间空隙不少于这么多秒出间奏镜头。 */
    bridgeGap: number;
    /** 一行超过这么多个字就在词边界切成两三个镜头。 */
    maxChars: number;
    /** 一行长于这么多秒也切开。 */
    maxLineSeconds: number;
}

export const DEFAULT_HANABI_PARAMS: HanabiParams = {
    bridgeGap: 3,
    maxChars: 18,
    maxLineSeconds: 6,
};

/** 一行里的一个词（切镜头的边界）：行内偏移与时间。 */
export interface HanabiSegment {
    startOffset: number;
    endOffset: number;
    startTime: number;
    endTime: number;
}

/** 最近用过的几个预设不马上再用。 */
const RECENT = 6;
/** 间奏（スターマイン / 千輪）偏向的族。 */
const BRIDGE_FAMILIES = ['senrin', 'uchiage', 'kiku', 'shakudama'];
/** 行唱完到间奏开始留的余韵（秒）。 */
const BRIDGE_TAIL = 0.6;
/** 一行最多切成几个镜头。 */
const MAX_PIECES = 3;

const MOODS_BY_KIND: Record<ParagraphKind, Mood[] | null> = {
    chorus: ['loud', 'neutral'],
    lift: ['loud', 'neutral'],
    verse: ['neutral', 'quiet'],
    breath: ['quiet', 'neutral'],
    outro: ['quiet', 'neutral'],
    break: null,
};

// ─── 分词与切片 ─────────────────────────────────────────────────────────

/** 逐字时间里的词在 fullText 里的位置；对不上返回 null。 */
const locateWords = (line: Line): Array<{ word: Word; start: number; end: number }> | null => {
    const text = line.fullText;
    const located: Array<{ word: Word; start: number; end: number }> = [];
    let cursor = 0;
    for (const word of line.words ?? []) {
        if (!word.text) continue;
        const index = text.indexOf(word.text, cursor);
        if (index < 0) return null;
        located.push({ word, start: index, end: index + word.text.length });
        cursor = index + word.text.length;
    }
    return located.length > 0 ? located : null;
};

const hasLetters = (text: string) => /[\p{L}\p{N}]/u.test(text);

/**
 * 把一行切成词（切长行的边界）：有逐字时间就用逐字时间的词，否则用应用的分词（手动分词 → icu-folia →
 * Intl.Segmenter，与文字排版同一份），时间按文字偏移在整行里线性分配。空白与标点并进前一个词。
 */
export const segmentHanabiLine = (line: Line): HanabiSegment[] => {
    const text = line.fullText;
    const located = locateWords(line);
    if (located && located.length >= 2) {
        return located.map(({ word, start, end }) => ({ startOffset: start, endOffset: end, startTime: word.startTime, endTime: word.endTime }));
    }
    const pieces = segmentLyricWords(line).map(({ segment, index }) => ({ start: index, end: index + segment.length, text: segment }));
    const merged: Array<{ start: number; end: number }> = [];
    for (const piece of pieces) {
        const last = merged.at(-1);
        if (last && !hasLetters(piece.text)) last.end = piece.end;
        else merged.push({ start: piece.start, end: piece.end });
    }
    const length = Math.max(text.length, 1);
    const timeAt = (offset: number) => line.startTime + (line.endTime - line.startTime) * (offset / length);
    return merged.map(({ start, end }) => ({ startOffset: start, endOffset: end, startTime: timeAt(start), endTime: timeAt(end) }));
};

/** 一行在 [start, end) 这段文字上的切片：词按偏移裁开，时间按比例分配。整行时原样返回。 */
export const sliceLine = (line: Line, startOffset: number, endOffset: number): Line => {
    const text = line.fullText;
    const start = Math.max(0, Math.min(startOffset, text.length));
    const end = Math.max(start, Math.min(endOffset, text.length));
    if (start === 0 && end === text.length) return line;
    const located = locateWords(line) ?? [{ word: { text, startTime: line.startTime, endTime: line.endTime }, start: 0, end: text.length }];
    const words: Word[] = [];
    for (const { word, start: ws, end: we } of located) {
        const from = Math.max(ws, start);
        const to = Math.min(we, end);
        if (to <= from) continue;
        const span = Math.max(we - ws, 1);
        const duration = word.endTime - word.startTime;
        words.push({
            text: text.slice(from, to),
            startTime: word.startTime + duration * ((from - ws) / span),
            endTime: word.startTime + duration * ((to - ws) / span),
        });
    }
    const fullText = text.slice(start, end);
    if (words.length === 0) {
        const length = Math.max(text.length, 1);
        const timeAt = (offset: number) => line.startTime + (line.endTime - line.startTime) * (offset / length);
        words.push({ text: fullText, startTime: timeAt(start), endTime: timeAt(end) });
    }
    return {
        ...line,
        fullText,
        words,
        startTime: words[0]!.startTime,
        endTime: words.at(-1)!.endTime,
        translation: undefined,
        romanization: undefined,
    };
};

/** 镜头的文字：切片拼成一行（跨行的切片之间加一个空格）。间奏返回 null。 */
export const shotLine = (lines: ReadonlyMap<number, Line>, slices: readonly HanabiSlice[]): Line | null => {
    const parts = slices
        .map(slice => {
            const line = lines.get(slice.lineIndex);
            return line ? sliceLine(line, slice.startOffset, slice.endOffset) : null;
        })
        .filter((line): line is Line => line !== null && line.fullText.trim().length > 0);
    if (parts.length === 0) return null;
    if (parts.length === 1) return parts[0]!;
    const words: Word[] = [];
    parts.forEach((part, index) => {
        if (index > 0) {
            const gapAt = words.at(-1)!.endTime;
            words.push({ text: ' ', startTime: gapAt, endTime: Math.max(gapAt, part.startTime) });
        }
        words.push(...part.words);
    });
    return {
        ...parts[0]!,
        fullText: words.map(word => word.text).join(''),
        words,
        startTime: parts[0]!.startTime,
        endTime: Math.max(...parts.map(part => part.endTime)),
    };
};

const visibleLength = (text: string) => splitLyricGraphemes(text).filter(grapheme => grapheme.trim().length > 0).length;

export interface LinePiece {
    slice: HanabiSlice;
    startTime: number;
    lyricEndTime: number;
}

/** 一行 → 1–3 段：超过 maxChars 个字或 maxLineSeconds 秒时，在最接近等分处的词边界切开。 */
export const splitLine = (unified: StructureLine, params: HanabiParams): LinePiece[] => {
    const { line } = unified;
    const text = line.fullText;
    const whole: LinePiece[] = [{
        slice: { lineIndex: unified.sourceIndex, startOffset: 0, endOffset: text.length },
        startTime: line.startTime,
        lyricEndTime: unified.renderEndTime,
    }];
    const count = visibleLength(text);
    const duration = line.endTime - line.startTime;
    const maxChars = Math.max(4, params.maxChars);
    const maxSeconds = Math.max(1, params.maxLineSeconds);
    if (count <= maxChars && duration <= maxSeconds) return whole;
    const segments = segmentHanabiLine(line);
    const pieces = Math.min(MAX_PIECES, segments.length, Math.max(2, Math.ceil(Math.max(count / maxChars, duration / maxSeconds))));
    if (pieces < 2) return whole;
    // 可切的位置：第 j 个词之后（下一个词的起点）。
    const cuts: number[] = [];
    let after = -1;
    for (let k = 1; k < pieces; k += 1) {
        const target = (text.length * k) / pieces;
        let best = -1;
        // 给后面的切口留位置。
        for (let j = after + 1; j <= segments.length - 1 - (pieces - k); j += 1) {
            const offset = segments[j + 1]!.startOffset;
            if (best < 0 || Math.abs(offset - target) < Math.abs(segments[best + 1]!.startOffset - target)) best = j;
        }
        if (best < 0) break;
        cuts.push(best);
        after = best;
    }
    if (cuts.length === 0) return whole;
    const bounds = [-1, ...cuts, segments.length - 1];
    const result: LinePiece[] = [];
    for (let k = 0; k < bounds.length - 1; k += 1) {
        const first = segments[bounds[k]! + 1]!;
        const last = segments[bounds[k + 1]!]!;
        const isFirst = k === 0;
        const isLast = k === bounds.length - 2;
        result.push({
            slice: {
                lineIndex: unified.sourceIndex,
                startOffset: isFirst ? 0 : first.startOffset,
                endOffset: isLast ? text.length : segments[bounds[k + 1]! + 1]!.startOffset,
            },
            startTime: isFirst ? line.startTime : first.startTime,
            lyricEndTime: isLast ? unified.renderEndTime : last.endTime,
        });
    }
    return result;
};

export interface PlannedShot {
    slices: HanabiSlice[];
    /** 该行上的第几个镜头（`s<n>`）；间奏为 null。 */
    slot: string | null;
    startTime: number;
    endTime: number;
    lyricEndTime: number;
    isBridge: boolean;
}

/**
 * 镜头的时间：一段一个镜头，从它的第一个字开始（段首镜头从段落开始），到下一个镜头开始为止，首尾相接；
 * 行后的空隙不少于 bridgeGap 时，镜头在唱完后 0.6 秒收住，空隙交给间奏镜头。
 */
export const planShots = (
    lines: readonly StructureLine[],
    paragraphStart: number,
    paragraphEnd: number,
    params: HanabiParams,
): PlannedShot[] => {
    const pieces = lines.flatMap(line => splitLine(line, params).map((piece, index) => ({ ...piece, slot: `s${index}` })));
    const shots: PlannedShot[] = [];
    let cursor = pieces.length > 0 ? Math.min(paragraphStart, pieces[0]!.startTime) : paragraphStart;
    pieces.forEach((piece, index) => {
        const start = cursor;
        const nextStart = Math.max(pieces[index + 1]?.startTime ?? paragraphEnd, start + 0.05);
        const lyricEnd = piece.lyricEndTime;
        if (index < pieces.length - 1 && nextStart - lyricEnd >= params.bridgeGap) {
            const end = Math.max(start + 0.05, lyricEnd + BRIDGE_TAIL);
            shots.push({ slices: [piece.slice], slot: piece.slot, startTime: start, endTime: end, lyricEndTime: lyricEnd, isBridge: false });
            shots.push({ slices: [], slot: null, startTime: end, endTime: nextStart, lyricEndTime: nextStart, isBridge: true });
        } else {
            const end = index < pieces.length - 1 ? nextStart : Math.max(nextStart, lyricEnd);
            shots.push({ slices: [piece.slice], slot: piece.slot, startTime: start, endTime: end, lyricEndTime: Math.min(lyricEnd, end), isBridge: false });
        }
        cursor = shots.at(-1)!.endTime;
    });
    if (pieces.length === 0 && paragraphEnd > paragraphStart) {
        shots.push({ slices: [], slot: null, startTime: paragraphStart, endTime: paragraphEnd, lyricEndTime: paragraphEnd, isBridge: true });
    }
    return shots;
};

// ─── 选预设 ─────────────────────────────────────────────────────────────

/**
 * 选预设：全部预设 → 间奏偏向的族 → 段落性质对应的 mood → 避开最近用过的与上一个的族；每一步筛空了就不收。
 */
export const castShot = (options: {
    seed: string;
    paragraphIndex: number;
    shotIndex: number;
    kind: ParagraphKind;
    isBridge: boolean;
    chain: HanabiChain;
}): string => {
    const { chain } = options;
    let candidates: readonly string[] = HANABI_KINDS;
    const narrow = (keep: (kind: string) => boolean) => {
        const next = candidates.filter(keep);
        if (next.length > 0) candidates = next;
    };
    const moods = MOODS_BY_KIND[options.kind];
    if (options.isBridge) narrow(kind => BRIDGE_FAMILIES.includes(profileOf(kind).family));
    if (moods) narrow(kind => moods.includes(profileOf(kind).mood));
    narrow(kind => !chain.recent.includes(kind));
    if (chain.family) narrow(kind => profileOf(kind).family !== chain.family);
    const random = createRng(`${options.seed}:${options.paragraphIndex}:${options.shotIndex}:hanabi-cast`);
    return candidates[Math.floor(random() * candidates.length)]!;
};

/** 选定之后更新 chain（跨段落保留）。 */
export const advanceChain = (chain: HanabiChain, kind: string) => {
    chain.recent = [...chain.recent, kind].slice(-RECENT);
    chain.family = profileOf(kind).family;
};

/** 镜头的预设套上逐镜头的组件（色块、入场、主烟花种类）。 */
/** 镜头的文字处理：排版组件指向的预设的 text，再套上色块与入场组件。 */
export const shotText = (shot: Pick<HanabiShot, 'kind' | 'typography' | 'block' | 'enter'>) => {
    const text = profileOf(shot.typography ?? shot.kind).text;
    const block = shot.block ?? text.block;
    const enter = shot.enter ?? text.enter;
    return block === text.block && enter === text.enter ? text : { ...text, block, enter };
};

export const resolveShotProfile = (shot: Pick<HanabiShot, 'kind' | 'typography' | 'block' | 'enter' | 'burst'>): HanabiProfile => {
    const base = profileOf(shot.kind);
    const text = shotText(shot);
    const burst = shot.burst && shot.burst !== base.burst?.kind ? burstPreset(shot.burst, base.burst?.colors) : base.burst;
    if (text === base.text && burst === base.burst) return base;
    return { ...base, text, burst };
};
