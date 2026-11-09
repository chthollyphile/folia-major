import type { Line, LyricData } from '../../../types';
import { isMidSongLine, matchLyricLines, type CompiledLyricLineRule, type LyricLineRule } from '../../../utils/lyrics/lyricLineRules';
import { isInterludeLine } from '../../../utils/lyrics/parserCore';
import { applyLyricStaffPolicy, buildLyricStaffPreview } from '../../../utils/lyrics/staffCreditsPolicy';
import type { LyricStaffDecision, LyricStaffPolicyOptions } from '../../../utils/lyrics/staffCreditsPolicy';

// src/components/modal/lyric-filter/buildLyricFilterPreviewModel.ts
// 把两套机制合成一份预览：通用逐行过滤先跑，staff 策略只看它没删掉的行，
// 顺序与 createLyricsSetter 保持一致，预览才不会骗人。

// 预览里的时间只显示到 0.1 秒，差不到半格的不算挪过。
const MOVED_TIME_THRESHOLD_SECONDS = 0.05;

export interface LyricFilterPreviewRow {
    line: Line;
    index: number;
    removedByFilter: boolean;
    /** 删掉这一行的那条规则（第一条命中的）。 */
    rule: LyricLineRule | null;
    /** 这一行在歌曲中段（isMidSongLine）。 */
    midSong: boolean;
    /** 在开头署名块里：署名行、署名之间的分隔符行，或吸收进来的相邻行。 */
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
    staff: LyricStaffDecision;
}

/**
 * 摊开（retime）之后每条留下来的块内行的新开始时间，按它在 lyrics.lines 里的下标给出。
 * 时间直接取自播放用的那份结果（applyLyricStaffPolicy），预览不另算一遍：
 * 它把摊开的行放在块首的位置上、块之前的行原样留在前面，所以第 k 条摊开行就是结果里第「块首下标 + k」条。
 */
const readRetimedStartTimes = (
    lyrics: LyricData,
    staffOptions: LyricStaffPolicyOptions,
    decision: LyricStaffDecision
): Map<number, number> => {
    const appliedLines = (applyLyricStaffPolicy(lyrics, staffOptions)?.lines ?? []).filter(line => !isInterludeLine(line));
    const spreadIndexes = [...decision.staffIndexes, ...decision.absorbedIndexes].sort((left, right) => left - right);
    const startTimes = new Map<number, number>();

    spreadIndexes.forEach((lineIndex, order) => {
        const appliedLine = appliedLines[decision.memberIndexes[0] + order];
        startTimes.set(lineIndex, appliedLine ? appliedLine.startTime : lyrics.lines[lineIndex].startTime);
    });

    return startTimes;
};

export const buildLyricFilterPreviewModel = (
    lyrics: LyricData | null | undefined,
    lineRules: readonly CompiledLyricLineRule[],
    staffOptions: LyricStaffPolicyOptions
): LyricFilterPreviewModel => {
    const baseLines = lyrics ? lyrics.lines.filter(line => !isInterludeLine(line)) : [];
    const hits = matchLyricLines(baseLines, lineRules);
    const removedByFilter = hits.map(Boolean);
    const survivors = baseLines.filter((_, index) => !removedByFilter[index]);
    const survivorLyrics = lyrics ? { ...lyrics, lines: survivors } : null;
    const staffPreview = buildLyricStaffPreview(survivorLyrics, staffOptions);
    const memberIndexes = new Set(staffPreview.decision.memberIndexes);
    const retimedStartTimes = survivorLyrics && staffPreview.decision.verdict === 'retime'
        ? readRetimedStartTimes(survivorLyrics, staffOptions, staffPreview.decision)
        : null;

    let survivorCursor = 0;
    const rows = baseLines.map((line, index): LyricFilterPreviewRow => {
        if (removedByFilter[index]) {
            return {
                line,
                index,
                removedByFilter: true,
                rule: hits[index]?.rule ?? null,
                midSong: isMidSongLine(index, baseLines.length),
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
            rule: null,
            midSong: isMidSongLine(index, baseLines.length),
            inStaffBlock,
            // 摊开时块里只留署名行和吸收行，分隔符行和整块隐藏时一样被拿掉。
            removedByStaff: Boolean(staffPreview.lines[survivorIndex]?.removed)
                || (retimedStartTimes !== null && inStaffBlock && !retimedStartTimes.has(survivorIndex)),
            startTime,
            timeMoved: Math.abs(startTime - line.startTime) >= MOVED_TIME_THRESHOLD_SECONDS,
        };
    });

    return {
        rows,
        totalCount: rows.length,
        removedCount: rows.filter(row => row.removedByFilter || row.removedByStaff).length,
        staff: staffPreview.decision,
    };
};
