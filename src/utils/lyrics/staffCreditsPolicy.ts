import type { Line, LyricData } from '../../types';
import { finalizeParsedLyricLines, isInterludeLine } from './parserCore';
import { ensureLyricDataRenderHints } from './renderHints';
import { createStaffCreditMatcher, detectStaffBlocks } from './staffCredits';
import type { StaffCreditBlock } from './staffCredits';
import { absorbAdjacentLines } from './staffCreditsAbsorb';
import { resolveStaffDecision } from './staffCreditsDecision';
import { rebuildStaffLines } from './staffCreditsRewrite';
import type {
    LyricStaffAbsorbMode,
    LyricStaffDecision,
    LyricStaffPolicy,
    LyricStaffPolicyOptions,
    LyricStaffVerdict,
} from './types';

// src/utils/lyrics/staffCreditsPolicy.ts
// 按时间预算决定 staff 块的去留：够长就保留（必要时重排），塞不下就整块隐藏。
// 预算窗口是「块首行到下一句正文」，所以开头块看的是前奏，中间块看的是间奏；
// 末尾块后面没有下一句，只看行距，窗口数字只用于报告（见 resolveStaffDecision）。

export type {
    LyricStaffAbsorbMode,
    LyricStaffDecision,
    LyricStaffPolicy,
    LyricStaffPolicyOptions,
    LyricStaffVerdict,
} from './types';

export const DEFAULT_LYRIC_STAFF_POLICY: LyricStaffPolicy = 'smart';
export const DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS = 1.5;
export const DEFAULT_LYRIC_STAFF_ABSORB_MODE: LyricStaffAbsorbMode = 'off';
export const LYRIC_STAFF_MIN_DWELL_RANGE = { min: 0.6, max: 4 } as const;

const POLICY_CYCLE: LyricStaffPolicy[] = ['keep', 'smart', 'hide'];
const ABSORB_MODE_CYCLE: LyricStaffAbsorbMode[] = ['off', 'before', 'both'];

export const nextLyricStaffPolicy = (policy: LyricStaffPolicy): LyricStaffPolicy =>
    POLICY_CYCLE[(POLICY_CYCLE.indexOf(policy) + 1) % POLICY_CYCLE.length];

export const nextLyricStaffAbsorbMode = (mode: LyricStaffAbsorbMode): LyricStaffAbsorbMode =>
    ABSORB_MODE_CYCLE[(ABSORB_MODE_CYCLE.indexOf(mode) + 1) % ABSORB_MODE_CYCLE.length];

const NO_BLOCK_DECISION: LyricStaffDecision = {
    verdict: 'none',
    blockLineCount: 0,
    windowSeconds: 0,
    requiredSeconds: 0,
    staffIndexes: [],
    memberIndexes: [],
    absorbedLineCount: 0,
    absorbedIndexes: [],
};

const clampMinDwell = (value?: number): number => {
    if (!Number.isFinite(value)) {
        return DEFAULT_LYRIC_STAFF_MIN_DWELL_SECONDS;
    }

    return Math.min(LYRIC_STAFF_MIN_DWELL_RANGE.max, Math.max(LYRIC_STAFF_MIN_DWELL_RANGE.min, value as number));
};

const stripInterludes = (lines: Line[]): Line[] => lines.filter(line => !isInterludeLine(line));

type AnalyzedStaffBlock = { block: StaffCreditBlock; decision: LyricStaffDecision };

const analyze = (
    lyrics: LyricData,
    options: LyricStaffPolicyOptions
): { lines: Line[]; entries: AnalyzedStaffBlock[]; minDwell: number } => {
    const minDwell = clampMinDwell(options.minDwellSeconds);
    const policy = options.policy ?? DEFAULT_LYRIC_STAFF_POLICY;
    const lines = stripInterludes(lyrics.lines);
    const detected = detectStaffBlocks(lines, createStaffCreditMatcher(options.pattern), {
        meta: { title: lyrics.title, artist: lyrics.artist },
    });

    if (detected.length === 0) {
        return { lines, entries: [], minDwell };
    }

    // 吸收必须发生在判定之前：吸收行进块后窗口和停留预算都要跟着变，
    // 先判定再吸收会让「够不够放得下」这个问题算在错误的块上。
    //
    // hide 不吸收：它不参与判定，吸收在这里唯一的作用就是让一起删掉的行变多，
    // 而它依赖的「每行最少停留」在这个策略下并不显示，用户无从得知边界在哪。
    // 除当前块以外，其它块占用的行都不许被吸收跨过。
    const occupiedByOthers = (current: StaffCreditBlock): Set<number> => {
        const blocked = new Set<number>();
        detected.forEach(candidate => {
            if (candidate === current) {
                return;
            }
            candidate.memberIndexes.forEach(lineIndex => blocked.add(lineIndex));
        });
        return blocked;
    };

    const entries: AnalyzedStaffBlock[] = detected.map((block, index) => {
        const absorbed = policy === 'hide' || !(index === 0 && block.fromLeading)
            ? block
            : absorbAdjacentLines(lines, block, {
                mode: options.absorbMode ?? DEFAULT_LYRIC_STAFF_ABSORB_MODE,
                maxDuration: minDwell,
                blockedIndexes: occupiedByOthers(block),
            });

        const decision: LyricStaffDecision = policy === 'hide'
            ? {
                ...NO_BLOCK_DECISION,
                verdict: 'hide',
                blockLineCount: absorbed.staffIndexes.length,
                staffIndexes: absorbed.staffIndexes,
                memberIndexes: absorbed.memberIndexes,
                absorbedLineCount: absorbed.absorbedIndexes.length,
                absorbedIndexes: absorbed.absorbedIndexes,
            }
            : resolveStaffDecision(lines, absorbed, minDwell);

        return { block: absorbed, decision };
    });

    return { lines, entries, minDwell };
};

// 多块合并成一份给 UI 看的摘要：序号取并集，verdict 取最重的那一档。
const summarizeRecords = (entries: AnalyzedStaffBlock[]): LyricStaffDecision => {
    if (entries.length === 0) {
        return NO_BLOCK_DECISION;
    }

    // satisfies 而不是 Record<string, number>：verdict 新增档位时这里会编译报错，
    // 逼人补上权重，而不是静默比较出 undefined。
    const rank = { none: 0, keep: 1, retime: 2, hide: 3 } satisfies Record<LyricStaffVerdict, number>;
    const worstEntry = entries.reduce((current, entry) =>
        (rank[entry.decision.verdict] > rank[current.decision.verdict] ? entry : current));
    const worst = worstEntry.decision.verdict;

    return {
        verdict: worst,
        blockLineCount: entries.reduce((sum, entry) => sum + entry.decision.blockLineCount, 0),
        // 窗口和需求取「决定 verdict 的那个块」的值，不做跨块求和：
        // 求和会出现「窗口 20 秒 / 需要 12.5 秒」却判 hide 的矛盾（两个块各自不够）。
        windowSeconds: worstEntry.decision.windowSeconds,
        requiredSeconds: worstEntry.decision.requiredSeconds,
        windowKind: worstEntry.decision.windowKind,
        staffIndexes: entries.flatMap(entry => entry.decision.staffIndexes).sort((a, b) => a - b),
        memberIndexes: entries.flatMap(entry => entry.decision.memberIndexes).sort((a, b) => a - b),
        absorbedLineCount: entries.reduce((sum, entry) => sum + entry.decision.absorbedLineCount, 0),
        absorbedIndexes: entries.flatMap(entry => entry.decision.absorbedIndexes).sort((a, b) => a - b),
    };
};

export const applyLyricStaffPolicy = (
    lyrics: LyricData | null | undefined,
    options: LyricStaffPolicyOptions = {}
): LyricData | null => {
    if (!lyrics) {
        return null;
    }

    const policy = options.policy ?? DEFAULT_LYRIC_STAFF_POLICY;
    if (policy === 'keep') {
        return ensureLyricDataRenderHints(lyrics);
    }

    const { lines, entries, minDwell } = analyze(lyrics, options);

    const actionable = entries.filter(entry => entry.decision.verdict !== 'none' && entry.decision.verdict !== 'keep');

    if (actionable.length === 0) {
        return ensureLyricDataRenderHints(lyrics);
    }

    // 从后往前改：rebuildStaffLines 用的是原始行下标，先处理靠后的块，
    // 前面块的索引就不会因为数组长度变化而失效。
    let next = lines;
    for (let index = actionable.length - 1; index >= 0; index -= 1) {
        const entry = actionable[index];
        next = rebuildStaffLines(next, entry.block, entry.decision, minDwell);
    }

    return {
        ...lyrics,
        lines: finalizeParsedLyricLines(next, { includeInterludes: true }),
    };
};

export interface LyricStaffPreviewLine {
    line: Line;
    index: number;
    isStaff: boolean;
    removed: boolean;
}

/** 单个署名块的判定结果。预览层要按块对齐播放结果，不能只看合并后的 decision。 */
export interface LyricStaffPreviewBlock {
    block: StaffCreditBlock;
    decision: LyricStaffDecision;
}

export interface LyricStaffPreviewResult {
    decision: LyricStaffDecision;
    /** 逐块判定结果，按行下标升序；「始终显示」策略下为空。 */
    blocks: LyricStaffPreviewBlock[];
    lines: LyricStaffPreviewLine[];
}

export const buildLyricStaffPreview = (
    lyrics: LyricData | null | undefined,
    options: LyricStaffPolicyOptions = {}
): LyricStaffPreviewResult => {
    if (!lyrics) {
        return { decision: NO_BLOCK_DECISION, blocks: [], lines: [] };
    }

    const policy = options.policy ?? DEFAULT_LYRIC_STAFF_POLICY;
    if (policy === 'keep') {
        return {
            decision: NO_BLOCK_DECISION,
            blocks: [],
            lines: stripInterludes(lyrics.lines).map((line, index) => ({ line, index, isStaff: false, removed: false })),
        };
    }

    const { lines, entries } = analyze(lyrics, options);
    const decision = summarizeRecords(entries);
    const staffIndexes = new Set(entries.flatMap(entry => entry.decision.staffIndexes));
    // 逐块判断：中间那块可能被隐藏，开头那块只是重排，不能拿整体 verdict 一刀切。
    const removedIndexes = new Set(
        entries
            .filter(entry => entry.decision.verdict === 'hide')
            .flatMap(entry => entry.decision.memberIndexes)
    );

    return {
        decision,
        blocks: entries,
        lines: lines.map((line, index) => ({
            line,
            index,
            isStaff: staffIndexes.has(index),
            removed: removedIndexes.has(index),
        })),
    };
};
