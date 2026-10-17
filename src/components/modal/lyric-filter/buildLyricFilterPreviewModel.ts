import type { Line, LyricData } from '../../../types';
import { compileLyricFilterPattern, getLyricFilterError } from '../../../utils/lyrics/filtering';
import { isInterludeLine } from '../../../utils/lyrics/parserCore';
import { applyLyricStaffPolicy, buildLyricStaffPreview } from '../../../utils/lyrics/staffCreditsPolicy';
import type {
    LyricStaffDecision,
    LyricStaffPolicyOptions,
    LyricStaffPreviewResult,
} from '../../../utils/lyrics/staffCreditsPolicy';

// src/components/modal/lyric-filter/buildLyricFilterPreviewModel.ts
// 把两套机制合成一份预览：通用逐行过滤先跑，staff 策略只看它没删掉的行，
// 顺序与 createLyricsSetter 保持一致，预览才不会骗人。

// 预览里的时间只显示到 0.1 秒，差不到半格的不算挪过。
const MOVED_TIME_THRESHOLD_SECONDS = 0.05;

export interface LyricFilterPreviewRow {
    line: Line;
    index: number;
    removedByFilter: boolean;
    /** 在署名块里：署名行、署名之间的分隔符行，或吸收进来的相邻行。 */
    /** 该行是否落在某个署名块内。竖线改由 staffBlockRanges 绘制后，生产代码
     *  已不再消费它，保留给测试与后续清理参考。 */
    inStaffBlock: boolean;
    removedByStaff: boolean;
    /** 两套规则都跑完之后这一行的开始时间（秒）；被删掉的行保留原来的时间。 */
    startTime: number;
    /** staff 策略把这一行挪到了别的时间上。 */
    timeMoved: boolean;
}

export interface LyricFilterPreviewModel {
    rows: LyricFilterPreviewRow[];
    totalCount: number;
    removedCount: number;
    filterError: string | null;
    staff: LyricStaffDecision;
    /** 每个署名块占用的 [起, 止] 行下标，**与 rows 的 index 同一空间（原始行）**；
     *  画竖线用，多块之间不能连成一根。块下标原本来自过滤后的幸存行，输出前已换算回原始行。 */
    staffBlockRanges: Array<[number, number]>;
}

/**
 * 摊开（retime）之后每条留下来的块内行的新开始时间，按它在 lyrics.lines 里的下标给出。
 * 时间直接取自播放用的那份结果（applyLyricStaffPolicy），预览不另算一遍。
 *
 * 结果里每个 retime 块都落在自己的位置：块内被丢掉的分隔符行会让它后面的行整体前移，
 * 所以不能拿「第一个块的起点 + 全局顺序」一套到底 —— 多块时第二块起会整段偏移，
 * 混有 hide 块时更会算到完全不相干的行上。
 */
const readRetimedStartTimes = (
    lyrics: LyricData,
    staffOptions: LyricStaffPolicyOptions,
    staffPreview: LyricStaffPreviewResult
): Map<number, number> => {
    const startTimes = new Map<number, number>();
    const spreadByStart = new Map<number, number[]>();
    const removedIndexes = new Set<number>();

    staffPreview.blocks.forEach(entry => {
        if (entry.decision.verdict === 'retime') {
            spreadByStart.set(
                entry.block.memberIndexes[0],
                [...entry.block.staffIndexes, ...entry.block.absorbedIndexes].sort((left, right) => left - right)
            );
        }
        if (entry.decision.verdict === 'hide' || entry.decision.verdict === 'retime') {
            entry.block.memberIndexes.forEach(index => removedIndexes.add(index));
        }
    });

    if (spreadByStart.size === 0) {
        return startTimes;
    }

    const appliedLines = (applyLyricStaffPolicy(lyrics, staffOptions)?.lines ?? []).filter(line => !isInterludeLine(line));

    let appliedIndex = 0;
    for (let index = 0; index < lyrics.lines.length; index += 1) {
        const spreadIndexes = spreadByStart.get(index);
        if (spreadIndexes) {
            spreadIndexes.forEach((lineIndex, order) => {
                const appliedLine = appliedLines[appliedIndex + order];
                startTimes.set(lineIndex, appliedLine ? appliedLine.startTime : lyrics.lines[lineIndex].startTime);
            });
            appliedIndex += spreadIndexes.length;
        }
        if (!removedIndexes.has(index)) {
            appliedIndex += 1;
        }
    }

    return startTimes;
};

/** 摊开时块内的分隔符行会被丢掉；混有 hide 块时整体 verdict 不是 retime，也要把这些行标成删除。 */
const readRemovedByRetime = (staffPreview: LyricStaffPreviewResult): Set<number> => {
    const removed = new Set<number>();

    staffPreview.blocks.forEach(entry => {
        if (entry.decision.verdict !== 'retime') {
            return;
        }
        const spread = new Set([...entry.block.staffIndexes, ...entry.block.absorbedIndexes]);
        entry.block.memberIndexes.forEach(index => {
            if (!spread.has(index)) {
                removed.add(index);
            }
        });
    });

    return removed;
};

export const buildLyricFilterPreviewModel = (
    lyrics: LyricData | null | undefined,
    filterPattern: string,
    staffOptions: LyricStaffPolicyOptions
): LyricFilterPreviewModel => {
    const baseLines = lyrics ? lyrics.lines.filter(line => !isInterludeLine(line)) : [];
    const filterError = getLyricFilterError(filterPattern);
    const regex = filterError ? null : compileLyricFilterPattern(filterPattern);

    const removedByFilter = baseLines.map(line => Boolean(regex?.test(line.fullText)));
    const survivors = baseLines.filter((_, index) => !removedByFilter[index]);
    const survivorLyrics = lyrics ? { ...lyrics, lines: survivors } : null;
    const staffPreview = buildLyricStaffPreview(survivorLyrics, staffOptions);
    const memberIndexes = new Set(staffPreview.decision.memberIndexes);
    const retimedStartTimes = survivorLyrics
        ? readRetimedStartTimes(survivorLyrics, staffOptions, staffPreview)
        : null;
    const removedByRetime = readRemovedByRetime(staffPreview);
    // 署名块的下标来自「过滤后剩下的行」，而行列表用的是原始下标。
    // 过滤只要在块之前删掉过行，两个空间就差几位，竖线会画到错的段落上。
    const survivorToBase: number[] = [];
    baseLines.forEach((_, index) => {
        if (!removedByFilter[index]) {
            survivorToBase.push(index);
        }
    });
    const staffBlockRanges = staffPreview.blocks.map(entry => {
        const first = survivorToBase[entry.block.memberIndexes[0]];
        const last = survivorToBase[entry.block.memberIndexes[entry.block.memberIndexes.length - 1]];
        return [first, last] as [number, number];
    });

    let survivorCursor = 0;
    const rows = baseLines.map((line, index): LyricFilterPreviewRow => {
        if (removedByFilter[index]) {
            return {
                line,
                index,
                removedByFilter: true,
                inStaffBlock: false,
                removedByStaff: false,
                startTime: line.startTime,
                timeMoved: false,
            };
        }

        const survivorIndex = survivorCursor;
        survivorCursor += 1;
        const inStaffBlock = memberIndexes.has(survivorIndex);
        const startTime = retimedStartTimes?.get(survivorIndex) ?? line.startTime;

        return {
            line,
            index,
            removedByFilter: false,
            inStaffBlock,
            // 摊开时块里只留署名行和吸收行；分隔符行和整块隐藏时一样被拿掉。
            removedByStaff: Boolean(staffPreview.lines[survivorIndex]?.removed) || removedByRetime.has(survivorIndex),
            startTime,
            timeMoved: Math.abs(startTime - line.startTime) >= MOVED_TIME_THRESHOLD_SECONDS,
        };
    });

    return {
        rows,
        totalCount: rows.length,
        removedCount: rows.filter(row => row.removedByFilter || row.removedByStaff).length,
        filterError,
        staff: staffPreview.decision,
        staffBlockRanges,
    };
};
