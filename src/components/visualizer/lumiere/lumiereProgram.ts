// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../types';
import type { ParagraphBoundary, ParagraphKind, StructureLine } from './lumiereKernel';
import { buildStructureLines, draftParagraphs, resolveParagraphGapThreshold, classifyParagraph } from '../paragraphStructure';
import { mergeLumiereParagraphs } from './lumiereSeamless';
import { chooseLumiereTransition, LUMIERE_TRANSITIONS } from './lumiereTransitions';
import {
    advanceChain,
    castShot,
    DEFAULT_LUMIERE_PARAMS,
    planShots,
    type LumiereChain,
    type LumiereParagraph,
    type LumiereParams,
    type LumiereShot,
    type LumiereTransitionKind,
    type PlannedShot,
} from './program';

// src/components/visualizer/lumiere/lumiereProgram.ts
// 绘光在 folia 里的整首编译：歌词 → 段落（分段与段落性质同 tempera / sonnet）→ 每段切镜头、选光位（chain 跨段落）
// → 段落转场与星空开场。对应 lumisynth 统一编译器 + 绘光包的 compileParagraph / toNativeParagraph，
// 但没有编辑器的锁定、组件槽与跨包，全自动；同样的歌词与种子永远得到同样的程序（纯函数，不碰 Pixi）。
//
// 与 lumisynth 的两处差别（folia 没有内核，运行时直接按段落切场景）：
//   1. 段落首尾相接铺满时间轴：第一段从 0 开始（前奏够长时单独出一个间奏段），每段延伸到下一段开始，
//      最后一段延伸到歌曲结束（给了 duration 时）。段后的长间奏在本段里以间奏镜头出现，而不是让上一段的
//      最后一个镜头一直挂着。
//   2. 纯音乐 / 没有歌词：不造虚拟歌词行（绘光会把它们当字画出来），而是在 duration（缺省 480 秒）上
//      铺一串只有间奏镜头的段落，光位从萤尘、星象、天光里选。

export interface LumiereProgramOptions {
    /**
     * 歌曲总时长（秒）。有歌词时最后一段延伸到这里（尾奏出间奏镜头）；没有歌词时按它铺纯间奏的程序
     * （不给用 480 秒）。
     */
    duration?: number;
    /**
     * 轨迹过渡：整首歌编成一个场景单元，段落之间也走光位交接（lumiereSeamless.ts）。镜头与光位和不开时相同，
     * 只是没有段落转场与再次开场。
     */
    seamless?: boolean;
}

export interface LumiereProgram {
    version: 1;
    seed: string;
    /** 没有歌词，整首都是间奏镜头。 */
    instrumental: boolean;
    paragraphGapThreshold: number;
    /** 最后一个段落的结束时间（整个程序覆盖 [0, duration]）。 */
    duration: number;
    /** 最后一行唱完的时刻（片尾卡从这里开始）；纯音乐为 null。 */
    lyricEndTime: number | null;
    paragraphs: LumiereParagraph[];
}

/** 与上一段之间空隙超过这么多秒，才重新播放星空点亮的开场。 */
export const REOPEN_GAP = 2.5;
/** 纯音乐缺省时长、每段时长与每个间奏镜头的目标时长（秒）。 */
const INSTRUMENTAL_DURATION = 480;
const INSTRUMENTAL_PARAGRAPH = 32;
const BRIDGE_SHOT = 10;
/** 间奏镜头长于这么多秒就切成几个（一个光位挂太久会显得停住）。 */
const BRIDGE_SPLIT = 16;

interface ParagraphPlan {
    lines: StructureLine[];
    kind: ParagraphKind;
    boundary: ParagraphBoundary;
    startTime: number;
    endTime: number;
    lyricEndTime: number;
}

/** 把过长的间奏镜头等分成约 BRIDGE_SHOT 秒的几段。 */
const splitLongBridges = (shots: PlannedShot[]): PlannedShot[] => shots.flatMap(shot => {
    const length = shot.endTime - shot.startTime;
    if (!shot.isBridge || length <= BRIDGE_SPLIT) return [shot];
    const count = Math.max(2, Math.round(length / BRIDGE_SHOT));
    return Array.from({ length: count }, (_, index) => {
        const startTime = shot.startTime + (length * index) / count;
        const endTime = index === count - 1 ? shot.endTime : shot.startTime + (length * (index + 1)) / count;
        return { lines: [], startTime, endTime, lyricEndTime: endTime, isBridge: true };
    });
});

/** 有歌词时的段落计划：可选的前奏段 + 分段结果，首尾相接铺到 programEnd。 */
const planLyricParagraphs = (lines: readonly Line[], params: LumiereParams, duration: number | undefined) => {
    const structure = buildStructureLines(lines);
    const paragraphGapThreshold = resolveParagraphGapThreshold(lines);
    const drafts = draftParagraphs(structure, paragraphGapThreshold);
    const lyricEndTime = Math.max(...structure.map(line => line.renderEndTime));
    const programEnd = Math.max(lyricEndTime, duration ?? 0);
    const firstStart = structure[0]!.line.startTime;
    const plans: ParagraphPlan[] = [];
    // 前奏够长（≥ bridgeGap）时单独成一个间奏段：星空开场在 0 秒播放，前奏里有光，第一句不再从全黑开始。
    const intro = firstStart >= params.bridgeGap;
    if (intro) {
        plans.push({ lines: [], kind: 'break', boundary: 'intro', startTime: 0, endTime: firstStart, lyricEndTime: firstStart });
    }
    drafts.forEach((draft, index) => {
        const next = drafts[index + 1];
        plans.push({
            lines: draft.lines,
            kind: classifyParagraph(draft.lines, index, drafts.length),
            boundary: draft.boundary,
            startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0]!.line.startTime,
            endTime: next ? next.lines[0]!.line.startTime : programEnd,
            lyricEndTime: draft.lines.at(-1)!.renderEndTime,
        });
    });
    return { plans, paragraphGapThreshold, lyricEndTime, programEnd };
};

/** 纯音乐的段落计划：duration 等分成约 INSTRUMENTAL_PARAGRAPH 秒的段落。 */
const planInstrumentalParagraphs = (duration: number): ParagraphPlan[] => {
    const count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH));
    return Array.from({ length: count }, (_, index) => {
        const startTime = (duration * index) / count;
        const endTime = index === count - 1 ? duration : (duration * (index + 1)) / count;
        return { lines: [], kind: 'break' as const, boundary: index === 0 ? 'song-start' as const : 'instrumental' as const, startTime, endTime, lyricEndTime: endTime };
    });
};

/**
 * 编译整首歌。lines 是统一歌词（按时间排序），seed 缺省为 'lumiere'；params 覆盖切块参数；
 * options.duration 为歌曲总时长（见 LumiereProgramOptions）。纯函数：同样的输入得到逐字段相同的程序。
 */
export const compileLumiereProgram = (
    lines: readonly Line[],
    seed: string | number | undefined,
    params: Partial<LumiereParams> = {},
    options: LumiereProgramOptions = {},
): LumiereProgram => {
    const resolvedParams: LumiereParams = { ...DEFAULT_LUMIERE_PARAMS, ...params };
    const resolvedSeed = String(seed ?? 'lumiere');
    const instrumental = lines.length === 0;
    const lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration);
    const instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION);
    const plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration);

    const chain: LumiereChain = { recent: [], family: null };
    let previousTransition: LumiereTransitionKind | null = null;
    const paragraphs: LumiereParagraph[] = plans.map((plan, index) => {
        const planned = splitLongBridges(planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams));
        const shots: LumiereShot[] = planned.map((shot, shotIndex) => {
            const kind = castShot({
                seed: resolvedSeed,
                paragraphIndex: index,
                shotIndex,
                kind: plan.kind,
                isBridge: shot.isBridge,
                chain,
            });
            advanceChain(chain, kind);
            return {
                id: `p${index}-lu${shotIndex}`,
                kind,
                lineIndices: shot.lines.map(line => line.sourceIndex),
                startTime: shot.startTime,
                endTime: shot.endTime,
                lyricEndTime: shot.lyricEndTime,
                isBridge: shot.isBridge,
            };
        });

        // 段落转场：结束在下一段开始（= 本段 endTime），时长按与下一段之间的空隙定。
        const next = plans[index + 1];
        let transitionOut: LumiereParagraph['transitionOut'] = null;
        if (next) {
            const kind = chooseLumiereTransition(resolvedSeed, index, previousTransition);
            previousTransition = kind;
            const gap = next.startTime - plan.lyricEndTime;
            transitionOut = {
                kind,
                startTime: Math.max(plan.startTime, plan.endTime - LUMIERE_TRANSITIONS[kind].duration(gap)),
                endTime: plan.endTime,
            };
        }

        // 星空点亮的开场只在第一段、或与上一段唱完之间有明显空隙时播放；否则每段都从全黑重来，太频繁。
        const previous = plans[index - 1];
        const opening = !previous || plan.startTime - previous.lyricEndTime >= REOPEN_GAP;
        const lineIndices = plan.lines.map(line => line.sourceIndex);
        return {
            id: `lumiere-p${index}`,
            index,
            kind: plan.kind,
            boundary: plan.boundary,
            startTime: plan.startTime,
            endTime: plan.endTime,
            lyricEndTime: plan.lyricEndTime,
            lineIndices,
            lines: lineIndices.map(lineIndex => lines[lineIndex]!),
            shots,
            transitionOut,
            opening,
        };
    });

    return {
        version: 1,
        seed: resolvedSeed,
        instrumental,
        paragraphGapThreshold: lyric?.paragraphGapThreshold ?? 0,
        duration: lyric ? lyric.programEnd : instrumentalDuration,
        lyricEndTime: lyric ? lyric.lyricEndTime : null,
        paragraphs: options.seamless ? mergeLumiereParagraphs(paragraphs) : paragraphs,
    };
};

/** 时刻 time 所在的段落序号（第一段之前算第一段，最后一段之后算最后一段）。 */
export const findLumiereParagraphIndexAtTime = (program: LumiereProgram, time: number) => {
    for (let index = program.paragraphs.length - 1; index >= 0; index -= 1) {
        if (time >= program.paragraphs[index]!.startTime) return index;
    }
    return 0;
};
