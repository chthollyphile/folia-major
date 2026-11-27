import { useEffect, useMemo } from 'react';
import type { Line, Theme } from '../../../types';
import { fontStrokesKeyOf, getFontStrokes, registerFontStrokesConsumer } from '../../../services/fontStrokes';
import type { StrokeWriteSource } from './strokeWriteSource';

// src/components/visualizer/fontStrokes/useStrokeWriteSource.ts
// DOM 写字的样式（流光 / 云阶 / 心象）和笔画服务的接线：开关开着时向服务登记「这个字体（字重）的笔画要用」和本首要显示的字，
// 画的时候同步查笔画、按冻结规则定每个字的状态。关着时返回 null，什么都不做（不登记，服务就不算、不下载模型）。

/**
 * 开关开着时登记使用方（字体键 + 整首歌词的字），返回给画法用的笔画来源；关着（或没有歌词）时 null。
 * weight 是这个样式画字的字重，现在的字体键还不分字重：服务改成按显示字重存之后，下面建键那一行改成带上它。
 */
export const useStrokeWriteSource = (
    enabled: boolean,
    theme: Theme,
    weight: number,
    lines: readonly Line[] | null | undefined,
): StrokeWriteSource | null => {
    // 换成 fontStrokesKeyOf(theme, weight) 即按显示字重取笔画
    const fontKey = fontStrokesKeyOf(theme);
    // 整首的字一起报：笔画在这句出现之前就到，冻结规则不会因为来晚了把这句定成普通画法
    const chars = useMemo(() => (enabled && lines ? lines.map(line => line.fullText).join('') : ''), [enabled, lines]);

    useEffect(() => {
        if (!enabled) return undefined;
        return registerFontStrokesConsumer({ fontKey, chars });
    }, [chars, enabled, fontKey]);

    return useMemo<StrokeWriteSource | null>(() => {
        if (!enabled || !lines) return null;
        return {
            getStrokes: ch => getFontStrokes(fontKey, ch),
            // 换歌 / 换字体都换一张：冻结的决定不跨歌
            decisions: new Map<string, boolean>(),
        };
    }, [enabled, fontKey, lines]);
};
