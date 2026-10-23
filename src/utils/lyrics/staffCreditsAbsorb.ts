import type { Line } from '../../types';
import { isFillerLine } from './staffCredits';
import type { StaffCreditBlock } from './staffCredits';
import type { LyricStaffAbsorbMode } from './types';

// src/utils/lyrics/staffCreditsAbsorb.ts
// 把开头署名块相邻的持续时间短的行并入块。

export interface StaffAbsorbOptions {
    mode: LyricStaffAbsorbMode;
    /** 单行耗时的上限（秒），取自「每行最少停留」。低于它才算过短。 */
    maxDuration: number;
    /**
     * 禁区：其它署名块占用的行下标。吸收不得跨过它们。
     * 没有这道边界时，全曲扫描出的多个块会互相吞并 —— 前一块会把后一块开头
     * 那几行（往往同样很短）吸进来，随后隐藏前一块时把它们一起删掉。
     */
    blockedIndexes?: Iterable<number>;
}

const isShortLine = (line: Line, maxDuration: number): boolean =>
    !isFillerLine(line) && line.endTime - line.startTime < maxDuration;

const sortAscending = (values: number[]): number[] => [...values].sort((a, b) => a - b);

// 从 start 起按 step 方向连续取耗时过短的行，遇到块内行、分隔符行或耗时达标的行就停。
// 不设行数上限：边界只由「耗时过短」这一个判据决定，多一道行数上限只会让用户看不出为什么第 N+1 行没被带走。
const collectShortRun = (
    lines: Line[],
    start: number,
    step: number,
    memberSet: Set<number>,
    maxDuration: number,
    blocked: Set<number>
): number[] => {
    const taken: number[] = [];

    for (let index = start; index >= 0 && index < lines.length; index += step) {
        // 碰到别的块就停，和碰到自己的行一样 —— 那些行不属于这个块，
        // 吸进来就等于把另一个块的署名拆散。
        if (memberSet.has(index) || blocked.has(index) || !isShortLine(lines[index], maxDuration)) {
            break;
        }

        taken.push(index);
    }

    return taken;
};

/**
 * 把开头署名块相邻的行并入块：before 只向前（索引更小）扫，both 前后都扫。
 */
export const absorbAdjacentLines = (
    lines: Line[],
    block: StaffCreditBlock,
    options: StaffAbsorbOptions
): StaffCreditBlock => {
    if (options.mode === 'off' || block.staffIndexes.length === 0) {
        return block;
    }

    const memberSet = new Set(block.memberIndexes);
    const blocked = new Set(options.blockedIndexes ?? []);
    const blockStart = block.memberIndexes[0];
    const lastMember = block.memberIndexes[block.memberIndexes.length - 1];

    const absorbed = collectShortRun(lines, blockStart - 1, -1, memberSet, options.maxDuration, blocked);

    if (options.mode === 'both') {
        // 留最后一行：把整首都吸进去之后没有「第一句歌词」可言，判定会退化成原样显示。
        const lastIndex = lines.length - 1;
        const backward = collectShortRun(
            lines,
            Math.min(lastMember + 1, lastIndex),
            1,
            memberSet,
            options.maxDuration,
            blocked
        ).filter(index => index < lastIndex);

        absorbed.push(...backward);
    }

    if (absorbed.length === 0) {
        return block;
    }

    const absorbedIndexes = sortAscending(absorbed);
    const memberIndexes = sortAscending([...block.memberIndexes, ...absorbedIndexes]);

    for (let index = memberIndexes[memberIndexes.length - 1] + 1; index < lines.length; index += 1) {
        if (!isFillerLine(lines[index])) {
            break;
        }

        memberIndexes.push(index);
    }

    // 收走块尾 filler 之后，紧邻块尾的就是实词行，第一句歌词直接取下一位。
    // 块吃到数组末尾时取不到，判定退化成原样显示，与检测器自身的处理一致。
    const nextIndex = memberIndexes[memberIndexes.length - 1] + 1;
    const firstLyricIndex = nextIndex < lines.length ? nextIndex : null;

    return {
        ...block,
        memberIndexes,
        firstLyricIndex,
        absorbedIndexes,
    };
};
