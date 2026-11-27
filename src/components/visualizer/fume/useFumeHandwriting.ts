import { useEffect, useMemo } from 'react';
import type { Theme } from '../../../types';
import { fontStrokesKeyOf, getFontStrokeFit, getFontStrokes, registerFontStrokesConsumer, warmFontStrokeFit } from '../../../services/fontStrokes';
import type { FumeHandwritingFrame } from './fumeHandwriting';
import type { FumeArticleLayout } from './fumeTypes';

// src/components/visualizer/fume/useFumeHandwriting.ts
// 浮名「手写笔画」和笔画服务（services/fontStrokes）的接线：开着时向服务登记当前字体，画的时候同步查笔画。
// 算哪些字、什么时候算、存哪都归服务里的预备服务。关着时什么都不做（不登记，服务就不算、不下载模型）。
// 不订阅新结果：舞台播放时每帧都在画，新到的字下一帧自然查得到；暂停时没有字会因为新结果改画法（冻结规则在第一次看到字时就定了）。

export const useFumeHandwriting = (
    enabled: boolean,
    article: FumeArticleLayout | null,
    theme: Theme,
): FumeHandwritingFrame | null => {
    const fontKey = fontStrokesKeyOf(theme);

    useEffect(() => {
        if (!enabled) return undefined;
        return registerFontStrokesConsumer({ fontKey });
    }, [enabled, fontKey]);

    return useMemo<FumeHandwritingFrame | null>(() => {
        if (!enabled || !article) return null;
        return {
            getStrokes: ch => getFontStrokes(fontKey, ch),
            getFit: (ch, strokes, weight) => getFontStrokeFit(fontKey, strokes, ch, weight),
            warmFit: (ch, strokes, weight) => warmFontStrokeFit(fontKey, strokes, ch, weight),
            // 换歌 / 换字体 / 重排都换一张：冻结的决定不跨文章
            decisions: new Map<string, boolean>(),
        };
    }, [article, enabled, fontKey]);
};
