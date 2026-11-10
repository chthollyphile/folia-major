import type { Line } from '../../../types';
import type { LyricPhase } from '../definition';

// src/components/scenes/engine/lyricPhase.ts
// 宿主替所有场景算的「歌词阶段」：前奏、唱着、句间、间奏、尾奏、纯音乐。纯函数，按歌词时间算。

/** 两句之间空这么久（秒）以上算间奏，短的算句间。 */
export const INTERLUDE_GAP_SEC = 5;

export interface LyricPhaseState {
    phase: LyricPhase;
    /** The line sung or last sung, -1 before the first. */
    lineIndex: number;
    /** Seconds until the next line starts; Infinity when none is left. */
    nextLineIn: number;
}

/** Where `time` (lyric seconds) falls in `lines`. Lines are in start order, as the parser gives them. */
export const computeLyricPhase = (lines: readonly Line[], time: number, interludeGapSec = INTERLUDE_GAP_SEC): LyricPhaseState => {
    if (lines.length === 0) return { phase: 'instrumental', lineIndex: -1, nextLineIn: Infinity };
    if (time < lines[0].startTime) return { phase: 'intro', lineIndex: -1, nextLineIn: lines[0].startTime - time };

    // The last line that has started (binary search: this runs every frame on long lyrics).
    let low = 0;
    let high = lines.length - 1;
    while (low < high) {
        const middle = (low + high + 1) >> 1;
        if (lines[middle].startTime <= time) low = middle;
        else high = middle - 1;
    }
    const line = lines[low];
    const next = lines[low + 1];
    const nextLineIn = next ? next.startTime - time : Infinity;
    if (time < line.endTime) return { phase: 'singing', lineIndex: low, nextLineIn };
    if (!next) return { phase: 'outro', lineIndex: low, nextLineIn };
    const gap = next.startTime - line.endTime;
    return { phase: gap >= interludeGapSec ? 'interlude' : 'between-lines', lineIndex: low, nextLineIn };
};
