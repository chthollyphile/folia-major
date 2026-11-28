import type { FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import { isModelChar } from '../../../services/fontStrokes/fontStrokesRaster';
import { resolveWriteGlyphState, type WriteGlyphState } from './strokeWriteTiming';

// src/components/visualizer/fontStrokes/strokeWriteSource.ts
// DOM 写字的笔画来源（useStrokeWriteSource 给的）和按它定一个字此刻状态的纯函数；不引入笔画服务本身，画法组件只依赖这里。

/** 一帧手写要的东西：笔画查询和每个字的冻结决定（跟着歌词和字体走，换歌、换字体就换一张）。 */
export interface StrokeWriteSource {
    getStrokes: (ch: string) => FontStrokesGlyph | null;
    decisions: Map<string, boolean>;
}

/**
 * 一个字此刻的手写状态（null 普通画、'hidden' 还没开写、数字是书写进度），规则同浮名（strokeWriteTiming.ts）。
 * 只有汉字 / 假名会手写；key 在同一张 decisions 里唯一标识这个字（同一个字出现两次要不同的 key）。
 */
export const resolveSourceGlyphState = (
    source: StrokeWriteSource,
    key: string,
    ch: string,
    time: number,
    start: number,
    end: number,
): WriteGlyphState => {
    if (!isModelChar(ch)) return null;
    return resolveWriteGlyphState(source.decisions, key, time, start, end, () => source.getStrokes(ch) !== null);
};
