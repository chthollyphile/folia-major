// Copyright (c) 2026 chthollyphile
import type { Line } from '../../../types';
import {
    buildStructureLines,
    classifyParagraph,
    draftParagraphs,
    resolveParagraphGapThreshold,
    type ParagraphKind,
    type StructureLine,
} from '../paragraphStructure';
import { resolveHanabiChorusSpans, type HanabiChorusSpan } from './hanabiScreenBloom';
import { chooseHanabiTransition, HANABI_TRANSITIONS, type HanabiTransitionKind } from './hanabiTransitions';
import {
    advanceChain,
    castShot,
    DEFAULT_HANABI_PARAMS,
    planShots,
    type HanabiChain,
    type HanabiParagraph,
    type HanabiParams,
    type HanabiShot,
    type PlannedShot,
} from './program';

// src/components/visualizer/hanabi/hanabiProgram.ts
// 花火在 folia 里的整首编译：歌词 → 段落（分段规则与绘光共用 paragraphStructure）→ 每段切镜头、选预设（chain 跨段落）
// → 段落转场。对应 lumisynth 统一编译器 + 花火包的 compileParagraph / toNativeParagraph，但没有编辑器的锁定、
// 组件槽与跨包，全自动；同样的歌词与种子永远得到同样的程序（纯函数，不碰 Pixi）。
//
// 与 lumisynth 的差别（folia 没有内核，运行时直接按段落切场景，同绘光）：
//   1. 段落首尾相接铺满时间轴：前奏够长时单独出一个间奏段，每段延伸到下一段开始，最后一段延伸到歌曲结束。
//      段后的长空隙在本段里以间奏镜头出现（一串スターマイン / 千輪，世界照常上升），而不是让最后一句一直挂着。
//   2. 长间奏切成几个约 BRIDGE_SHOT 秒的间奏镜头：每个镜头边界世界都再升一次，间奏里也是一路往上走的烟花秀。
//   3. 纯音乐 / 没有歌词：不造虚拟歌词行，在 duration（缺省 480 秒）上铺一串只有间奏镜头的段落。

export interface HanabiProgramOptions {
    /** 歌曲总时长（秒）。有歌词时最后一段延伸到这里；没有歌词时按它铺纯间奏的程序（不给用 480 秒）。 */
    duration?: number;
}

/** 编译出的一个段落：lumisynth 的原生段落结构 + 段落序号与性质。 */
export interface HanabiProgramParagraph extends HanabiParagraph {
    index: number;
    kind: ParagraphKind;
    /** 最后一行唱完的时刻（纯间奏段为段落结束）。 */
    lyricEndTime: number;
    transitionOut: { kind: HanabiTransitionKind; startTime: number; endTime: number } | null;
}

export interface HanabiProgram {
    version: 1;
    seed: string;
    /** 没有歌词，整首都是间奏镜头。 */
    instrumental: boolean;
    /** 最后一个段落的结束时间（整个程序覆盖 [0, duration]）。 */
    duration: number;
    /** 最后一行唱完的时刻（片尾卡从这里开始）；纯音乐为 null。 */
    lyricEndTime: number | null;
    paragraphs: HanabiProgramParagraph[];
    /** 副歌时段（按歌词行的副歌标记，相邻的并起来）：全屏辉光在这里亮起来（hanabiScreenBloom.ts）。 */
    chorus: HanabiChorusSpan[];
}

/** 纯音乐缺省时长、每段时长（秒）。 */
const INSTRUMENTAL_DURATION = 480;
const INSTRUMENTAL_PARAGRAPH = 28;
/** 间奏镜头的目标时长；长于 BRIDGE_SPLIT 秒的切成几个。 */
const BRIDGE_SHOT = 7;
const BRIDGE_SPLIT = 10;
/** 段落最后一行唱完到段后间奏开始留的余韵（与 program.ts 行间间奏相同）。 */
const BRIDGE_TAIL = 0.6;

interface ParagraphPlan {
    lines: StructureLine[];
    kind: ParagraphKind;
    startTime: number;
    endTime: number;
    lyricEndTime: number;
}

/** 段落最后一个镜头后面空隙够长时，镜头在唱完后收住，剩下的交给间奏镜头。 */
const closeTail = (shots: PlannedShot[], endTime: number, params: HanabiParams): PlannedShot[] => {
    const last = shots.at(-1);
    if (!last || last.isBridge || endTime - last.lyricEndTime < params.bridgeGap) return shots;
    const end = Math.max(last.startTime + 0.05, last.lyricEndTime + BRIDGE_TAIL);
    return [
        ...shots.slice(0, -1),
        { ...last, endTime: end },
        { slices: [], slot: null, startTime: end, endTime, lyricEndTime: endTime, isBridge: true },
    ];
};

/** 把过长的间奏镜头等分成约 BRIDGE_SHOT 秒的几段。 */
const splitLongBridges = (shots: PlannedShot[]): PlannedShot[] => shots.flatMap(shot => {
    const length = shot.endTime - shot.startTime;
    if (!shot.isBridge || length <= BRIDGE_SPLIT) return [shot];
    const count = Math.max(2, Math.round(length / BRIDGE_SHOT));
    return Array.from({ length: count }, (_, index) => {
        const startTime = shot.startTime + (length * index) / count;
        const endTime = index === count - 1 ? shot.endTime : shot.startTime + (length * (index + 1)) / count;
        return { slices: [], slot: null, startTime, endTime, lyricEndTime: endTime, isBridge: true };
    });
});

/** 有歌词时的段落计划：可选的前奏段 + 分段结果，首尾相接铺到 programEnd。 */
const planLyricParagraphs = (lines: readonly Line[], params: HanabiParams, duration: number | undefined) => {
    const structure = buildStructureLines(lines);
    const drafts = draftParagraphs(structure, resolveParagraphGapThreshold(lines));
    const lyricEndTime = Math.max(...structure.map(line => line.renderEndTime));
    const programEnd = Math.max(lyricEndTime, duration ?? 0);
    const firstStart = structure[0]!.line.startTime;
    const plans: ParagraphPlan[] = [];
    // 前奏够长时单独成一个间奏段：开头就有烟花一路升空，第一句不从空画面开始。
    const intro = firstStart >= params.bridgeGap;
    if (intro) plans.push({ lines: [], kind: 'break', startTime: 0, endTime: firstStart, lyricEndTime: firstStart });
    drafts.forEach((draft, index) => {
        const next = drafts[index + 1];
        plans.push({
            lines: draft.lines,
            kind: classifyParagraph(draft.lines, index, drafts.length),
            startTime: index === 0 && !intro ? Math.min(0, firstStart) : draft.lines[0]!.line.startTime,
            endTime: next ? next.lines[0]!.line.startTime : programEnd,
            lyricEndTime: draft.lines.at(-1)!.renderEndTime,
        });
    });
    return { plans, lyricEndTime, programEnd };
};

/** 纯音乐的段落计划：duration 等分成约 INSTRUMENTAL_PARAGRAPH 秒的段落。 */
const planInstrumentalParagraphs = (duration: number): ParagraphPlan[] => {
    const count = Math.max(1, Math.round(duration / INSTRUMENTAL_PARAGRAPH));
    return Array.from({ length: count }, (_, index) => {
        const startTime = (duration * index) / count;
        const endTime = index === count - 1 ? duration : (duration * (index + 1)) / count;
        return { lines: [], kind: 'break' as const, startTime, endTime, lyricEndTime: endTime };
    });
};

/**
 * 编译整首歌。lines 是按时间排序的歌词，seed 缺省为 'hanabi'；params 覆盖切块参数。
 * 纯函数：同样的输入得到逐字段相同的程序。
 */
export const compileHanabiProgram = (
    lines: readonly Line[],
    seed: string | number | undefined,
    params: Partial<HanabiParams> = {},
    options: HanabiProgramOptions = {},
): HanabiProgram => {
    const resolvedParams: HanabiParams = { ...DEFAULT_HANABI_PARAMS, ...params };
    const resolvedSeed = String(seed ?? 'hanabi');
    const instrumental = lines.length === 0;
    const lyric = instrumental ? null : planLyricParagraphs(lines, resolvedParams, options.duration);
    const instrumentalDuration = Math.max(1, options.duration && options.duration > 0 ? options.duration : INSTRUMENTAL_DURATION);
    const plans = lyric ? lyric.plans : planInstrumentalParagraphs(instrumentalDuration);

    const chain: HanabiChain = { recent: [], family: null };
    let previousTransition: HanabiTransitionKind | null = null;
    const paragraphs = plans.map((plan, index): HanabiProgramParagraph => {
        const planned = splitLongBridges(closeTail(
            planShots(plan.lines, plan.startTime, plan.endTime, resolvedParams),
            plan.endTime,
            resolvedParams,
        ));
        const shots: HanabiShot[] = planned.map((shot, shotIndex) => {
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
                id: `p${index}-hb${shotIndex}`,
                kind,
                slices: shot.slices,
                startTime: shot.startTime,
                endTime: shot.endTime,
                lyricEndTime: shot.lyricEndTime,
                isBridge: shot.isBridge,
            };
        });

        // 段落转场：结束在下一段开始（= 本段 endTime），时长按与下一段之间的空隙定。
        const next = plans[index + 1];
        let transitionOut: HanabiProgramParagraph['transitionOut'] = null;
        if (next) {
            const kind = chooseHanabiTransition(resolvedSeed, index, previousTransition);
            previousTransition = kind;
            const gap = next.startTime - plan.lyricEndTime;
            transitionOut = {
                kind,
                startTime: Math.max(plan.startTime, plan.endTime - HANABI_TRANSITIONS[kind].duration(gap)),
                endTime: plan.endTime,
            };
        }

        const lineIndices = [...new Set(shots.flatMap(shot => shot.slices.map(slice => slice.lineIndex)))].sort((a, b) => a - b);
        return {
            id: `hanabi-p${index}`,
            index,
            kind: plan.kind,
            startTime: plan.startTime,
            endTime: plan.endTime,
            lyricEndTime: plan.lyricEndTime,
            lineIndices,
            lines: lineIndices.map(lineIndex => lines[lineIndex]!),
            shots,
            transitionOut,
        };
    });

    return {
        version: 1,
        seed: resolvedSeed,
        instrumental,
        duration: lyric ? lyric.programEnd : instrumentalDuration,
        lyricEndTime: lyric ? lyric.lyricEndTime : null,
        paragraphs,
        chorus: resolveHanabiChorusSpans(lines),
    };
};

/** 时刻 time 所在的段落序号（第一段之前算第一段，最后一段之后算最后一段）。 */
export const findHanabiParagraphIndexAtTime = (program: HanabiProgram, time: number) => {
    for (let index = program.paragraphs.length - 1; index >= 0; index -= 1) {
        if (time >= program.paragraphs[index]!.startTime) return index;
    }
    return 0;
};
