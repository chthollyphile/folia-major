import { useEffect, useMemo } from 'react';
import type { MotionValue } from 'framer-motion';
import type { Theme } from '../../../types';
import { resolveThemeFontStack, resolveThemeFontWeight } from '../../../utils/fontStacks';
import { fontStrokes, isModelChar } from '../fontStrokes/fontStrokesQueue';
import { buildHandwritingDemand, findHandwritingAnchor, type FumeHandwritingFrame } from './fumeHandwriting';
import type { FumeArticleLayout } from './fumeTypes';

// src/components/visualizer/fume/useFumeHandwriting.ts
// 浮名「手写笔画」和共用笔顺队列（fontStrokes）的接线：开着时才 attach，按播放位置向队列报要哪些字，
// 并把「字体 + 遮罩查询 + 每个字的冻结决定」交给舞台。关着时什么都不做（不 attach、不推理、不下载模型）。

/** 隔多久看一次播放位置；位置跨到另一句才重新报需求，平时只是一次比较。 */
const TICK_MS = 250;
/** 主歌词和标题的默认字重，同 fumeTextMeasure.ts 的 buildFontSpec。 */
const HERO_WEIGHT = 780;
const BODY_WEIGHT = 640;

export const useFumeHandwriting = (
    enabled: boolean,
    article: FumeArticleLayout | null,
    theme: Theme,
    currentTime: MotionValue<number>,
): FumeHandwritingFrame | null => {
    const family = resolveThemeFontStack(theme);
    const heroWeight = resolveThemeFontWeight(theme, HERO_WEIGHT);
    const bodyWeight = resolveThemeFontWeight(theme, BODY_WEIGHT);
    const frame = useMemo<FumeHandwritingFrame | null>(() => {
        if (!enabled || !article) return null;
        return {
            family,
            weightOf: variant => (variant === 'hero' ? heroWeight : bodyWeight),
            getReveal: (ch, fontFamily, weight) => fontStrokes.getReveal(ch, fontFamily, weight),
            // 换歌 / 换字体 / 重排都换一张：冻结的决定不跨文章
            decisions: new Map<string, boolean>(),
        };
    }, [article, bodyWeight, enabled, family, heroWeight]);

    useEffect(() => {
        if (!frame || !article) return;
        const handle = fontStrokes.attach(() => { /* 画面每帧都在画，到了新字下一帧自然用上 */ });
        const blocks = article.chronologicalBlocks;
        let anchor = -1;
        const tick = () => {
            const next = findHandwritingAnchor(blocks, currentTime.get());
            if (next === anchor) return;
            anchor = next;
            handle.want(buildHandwritingDemand(blocks, next, frame.weightOf, isModelChar), frame.family, bodyWeight);
        };
        tick();
        const timer = window.setInterval(tick, TICK_MS);
        return () => {
            window.clearInterval(timer);
            handle.detach();
        };
    }, [article, bodyWeight, currentTime, frame]);

    return frame;
};
