import type { FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import type { StrokeFit } from '../../../services/fontStrokes/fontStrokesFit';
import type { FumeBlock, WordRange } from './fumeTypes';

// src/components/visualizer/fume/fumeHandwriting.ts
// 浮名「手写笔画」的纯逻辑：一帧手写要的东西、字在词里的时间、哪些句子有要手写的字。
// 书写窗口、冻结规则和字内各笔的进度是各样式通用的，在 fontStrokes/strokeWriteTiming.ts；
// 画法在 fumeCanvasText.ts（drawFumeLiveBlock），向笔画服务登记在 useFumeHandwriting.ts。

/** 画一帧手写需要的东西：笔画查询和每个字的冻结决定（跟着文章和字体走，换歌、换字体就换一张）。 */
export interface FumeHandwritingFrame {
    /** 同步取当前字体下一个字的笔画；没算好时 null。 */
    getStrokes: (ch: string) => FontStrokesGlyph | null;
    /** 这个字的笔画落到显示字重 weight 上的样子（笔身膨胀多少、剩下的墨），第一次要现算几毫秒；画不出来时 null。 */
    getFit: (ch: string, strokes: FontStrokesGlyph, weight: number) => StrokeFit | null;
    /** 字还没开写时预热 getFit（一帧最多算一个）。 */
    warmFit: (ch: string, strokes: FontStrokesGlyph, weight: number) => void;
    decisions: Map<string, boolean>;
}

/** 一个字在词里的开始 / 结束时间（和 drawFumeLiveBlock 里的字时间同一算法）。 */
export const resolveGlyphTimes = (range: WordRange, globalOffset: number): { start: number; end: number } => {
    const wordDuration = Math.max(range.word.endTime - range.word.startTime, 0.08);
    const glyphCount = Math.max(range.end - range.start, 1);
    const index = globalOffset - range.start;
    const timing = range.word.syllables?.length
        ? range.graphemeTimings[Math.min(index, Math.max(range.graphemeTimings.length - 1, 0))]
        : undefined;
    return {
        start: timing?.startTime ?? (range.word.startTime + (index / glyphCount) * wordDuration),
        end: timing?.endTime ?? (range.word.startTime + ((index + 1) / glyphCount) * wordDuration),
    };
};

const modelCharBlocks = new WeakMap<FumeBlock, boolean>();
/** 这一句里有没有汉字 / 假名（有就不能用等待快照：快照把整句都画成了暗色衬字）。 */
export const blockHasModelChars = (block: FumeBlock, isModelChar: (ch: string) => boolean): boolean => {
    let has = modelCharBlocks.get(block);
    if (has === undefined) {
        has = block.graphemes.some(isModelChar);
        modelCharBlocks.set(block, has);
    }
    return has;
};
