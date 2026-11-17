// src/services/stemMixer/stemGaps.ts
// 下一段该分的地方：从播放头往后第一处还没有分轨的地方，到下一处已有的地方（或歌尾）为止；播放头以后都有了，
// 再回到歌头找。都有了答 null。区间都是 44.1 kHz 采样的 [from, to)，按 from 排好、互不相交（stemMixerPlayer.ts 的 covered）。

export interface StemGap { from: number; to: number }

export const nextStemGap = (covered: ReadonlyArray<readonly [number, number]>, total: number | null, head: number): StemGap | null => {
    const end = total ?? Infinity;
    const after = (at: number): StemGap | null => {
        let from = at;
        for (const [a, b] of covered) {
            if (b <= from) continue;
            if (a <= from) {
                from = b;
                continue;
            }
            return { from, to: a };
        }
        return from < end ? { from, to: end } : null;
    };
    const ahead = after(Math.max(0, Math.min(head, end)));
    if (ahead) return ahead;
    const behind = after(0);
    return behind && behind.from < head ? behind : null;
};

/** 分好了的采样占整首的比例。 */
export const coveredShare = (covered: ReadonlyArray<readonly [number, number]>, total: number): number => (
    total > 0 ? Math.min(1, covered.reduce((sum, [a, b]) => sum + (Math.min(b, total) - Math.max(a, 0)), 0) / total) : 0
);
