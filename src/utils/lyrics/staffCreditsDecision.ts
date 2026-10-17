import type { Line } from '../../types';
import type { LyricStaffDecision } from './types';
import type { StaffCreditBlock } from './staffCredits';

// src/utils/lyrics/staffCreditsDecision.ts
// 前奏时间预算：这段前奏放不放得下整块署名。放得下就显示，放不下就整块隐藏，没有中间态。

// 最后一条署名与第一句歌词之间留出的缓冲，避免贴脸切换。
export const TAIL_MARGIN_SECONDS = 1;

// 原始时间戳过密时才重排；作者本来就排得开的块保持原样。
const needsRetime = (staffLines: Line[], windowEnd: number, minDwell: number): boolean => {
    for (let index = 0; index < staffLines.length; index += 1) {
        const nextStart = index + 1 < staffLines.length ? staffLines[index + 1].startTime : windowEnd;
        if (nextStart - staffLines[index].startTime < minDwell) {
            return true;
        }
    }

    return false;
};

export const resolveStaffDecision = (
    lines: Line[],
    block: StaffCreditBlock,
    minDwell: number
): LyricStaffDecision => {
    // 参与显示的行是署名行加吸收行：吸收行一样要占前奏的时间预算，隐藏时也一样一起走。
    // blockLineCount 仍然只报署名行数，吸收行数另算，UI 上才说得清「哪些是识别出来的」。
    const displayIndexes = [...block.staffIndexes, ...block.absorbedIndexes].sort((a, b) => a - b);
    const displayLines = displayIndexes.map(index => lines[index]);
    const blockLineCount = block.staffIndexes.length;
    const windowStart = lines[block.memberIndexes[0]].startTime;
    const firstLyric = block.firstLyricIndex === null ? null : lines[block.firstLyricIndex];

    const base = {
        blockLineCount,
        requiredSeconds: displayLines.length * minDwell + TAIL_MARGIN_SECONDS,
        staffIndexes: block.staffIndexes,
        memberIndexes: block.memberIndexes,
        absorbedLineCount: block.absorbedIndexes.length,
        absorbedIndexes: block.absorbedIndexes,
    };

    // 块后面没有正文行有两种情况，语义完全不同：
    //
    // 1) 整首都是署名：块从第一行开始，全曲没有别的内容可显示，保留是唯一合理选择。
    // 2) 末尾致谢：前面有正文，只是名单排在最后。
    //    它没有可以参照的下一句，窗口就是自己占的时长 —— 「放不放得下」在这里没有意义，
    //    所以只按行距二选一：读得清就 keep，读不清就 hide。
    //
    // 注意 windowSeconds / requiredSeconds 在这条路径上只是报告值，不参与判定；
    // 末尾块拿不到「下一句」，这两个数会自相矛盾（窗口可能大于需求却仍是 hide），
    // 预览界面不应该用它给末尾块下结论。
    if (!firstLyric) {
        const lastLine = lines[lines.length - 1];
        const windowSeconds = Math.max(0, lastLine.endTime - windowStart);

        // 用 fromLeading 而不是 memberIndexes[0] === 0：标题行或首行分隔符会让块
        // 从第 1 行开始，那首歌其实只有标题 + 名单，同样应该保留。
        // 另外这个判据不能随吸收模式翻转（before 会把标题吸进块，让下标变成 0）。
        if (block.fromLeading) {
            // 整首都是署名：没有别的内容可显示，这两个窗口数字只是报告值。
            return { ...base, verdict: 'keep', windowSeconds, windowKind: 'whole-song' };
        }

        // 末尾块后面没有正文可以参照，窗口就是它自己占的那段时间，
        // 「放不放得下」在这里没有意义：能摊开的空间和需要的时间永远一起变。
        // 所以只看行距 —— 读得清就保留，读不清就整块藏掉。
        // needsRetime 的第二个参数是可用的时间上界，这里传无穷大：末尾块没有后续行，
        // 判定不该受解析器给末行补的默认时长影响；TAIL_MARGIN 同理不该算
        // （那 1 秒是给「下一句」留的，末尾块没有下一句）。
        const needsCompact = needsRetime(displayLines, Number.POSITIVE_INFINITY, minDwell);
        return { ...base, verdict: needsCompact ? 'hide' : 'keep', windowSeconds, windowKind: 'tail' };
    }

    const windowSeconds = Math.max(0, firstLyric.startTime - windowStart);

    if (windowSeconds >= base.requiredSeconds) {
        return {
            ...base,
            verdict: needsRetime(displayLines, firstLyric.startTime - TAIL_MARGIN_SECONDS, minDwell) ? 'retime' : 'keep',
            windowSeconds,
        };
    }

    return { ...base, verdict: 'hide', windowSeconds };
};
