import React, { useLayoutEffect, useMemo, useRef } from 'react';
import type { MotionValue } from 'framer-motion';
import type { GraphemeTiming } from '../../utils/lyrics/graphemeTiming';
import { isModelChar } from '../../services/fontStrokes/fontStrokesRaster';
import { resolveSourceGlyphState, type StrokeWriteSource } from './fontStrokes/strokeWriteSource';
import { StrokeWriteSlot } from './fontStrokes/strokeWriteSlot';
import { wordGlowWritingFilter } from './wordGlow';

// src/components/visualizer/glowWordHandwriting.tsx
// GlowWord（流光 / 云阶）的「手写笔画」：开关开着、词里有汉字 / 假名时，正文层和光晕层里这些字各自包成 inline-block span，
// 按书写时序套 SVG 遮罩写出来（fontStrokes/strokeWriteSlot.ts）。光晕层的字外面再包一层：正在写时那层上 drop-shadow 滤镜，
// 字本身去掉 text-shadow、带上颜色再套遮罩——光晕只跟着写出来的墨（text-shadow 会被遮罩硬切）。写完全部还原。
// 逐帧只在 currentTime 变化时改遮罩，不进 React state。开关关着时 GlowWord 不调这里的渲染，DOM 和原来一样。

interface HwNodes {
    body: (HTMLSpanElement | null)[];
    glowWrap: (HTMLSpanElement | null)[];
    glowInk: (HTMLSpanElement | null)[];
}

export interface GlowWordHandwriting {
    /** 正文层的内容：汉字 / 假名各一个 inline-block span，其余连着的字照原样是文字。 */
    body: React.ReactNode;
    /** 光晕层第 index 个字的内容（汉字 / 假名包两层 span，其余原样）。 */
    glyph: (char: string, index: number) => React.ReactNode;
}

const INK_STYLE: React.CSSProperties = { display: 'inline-block' };

/**
 * 开关开着（source 不为 null）且词里有要手写的字时返回两层的内容，并在 currentTime 每次变化时更新各字的状态；否则返回 null。
 * 字的开始 / 结束时间取 graphemeTimings（同 GlowWord 的逐字光晕）。
 */
export const useGlowWordHandwriting = (
    source: StrokeWriteSource | null | undefined,
    wordStartTime: number,
    graphemeTimings: GraphemeTiming[],
    currentTime: MotionValue<number>,
    activeColor: string,
    wordRevealMode: string | null | undefined,
): GlowWordHandwriting | null => {
    const nodes = useRef<HwNodes>({ body: [], glowWrap: [], glowInk: [] });
    const active = !!source && graphemeTimings.some(timing => isModelChar(timing.char));

    const content = useMemo<GlowWordHandwriting | null>(() => {
        if (!active) return null;
        const n = nodes.current;
        const body: React.ReactNode[] = [];
        let run = '';
        graphemeTimings.forEach((timing, index) => {
            if (!isModelChar(timing.char)) {
                run += timing.char;
                return;
            }
            if (run) body.push(run);
            run = '';
            body.push(<span key={index} ref={el => { n.body[index] = el; }} style={INK_STYLE}>{timing.char}</span>);
        });
        if (run) body.push(run);
        return {
            body,
            glyph: (char, index) => (isModelChar(char)
                ? (
                    <span ref={el => { n.glowWrap[index] = el; }} style={INK_STYLE}>
                        <span ref={el => { n.glowInk[index] = el; }} style={INK_STYLE}>{char}</span>
                    </span>
                )
                : char),
        };
    }, [active, graphemeTimings]);

    useLayoutEffect(() => {
        if (!source || !active) return undefined;
        const n = nodes.current;
        const glowFilter = wordGlowWritingFilter(activeColor, wordRevealMode);
        const slots: { slot: StrokeWriteSlot; index: number }[] = [];
        graphemeTimings.forEach((timing, index) => {
            const bodyInk = n.body[index];
            if (!isModelChar(timing.char) || !bodyInk) return;
            const glowInk = n.glowInk[index];
            const glowWrap = n.glowWrap[index];
            const masked = glowInk ? [bodyInk, glowInk] : [bodyInk];
            const slot = new StrokeWriteSlot(timing.char, {
                masked,
                onWriting: (writing) => {
                    if (!glowInk) return;
                    // text-shadow 是继承的：遮罩会把它硬切掉，正在写时光晕改由外层的 drop-shadow 画
                    glowInk.style.textShadow = writing ? 'none' : '';
                    if (glowFilter) {
                        glowInk.style.color = writing ? activeColor : '';
                        if (glowWrap) glowWrap.style.filter = writing ? glowFilter : '';
                    }
                },
            });
            slots.push({ slot, index });
        });
        const tick = (time: number) => {
            for (const { slot, index } of slots) {
                const timing = graphemeTimings[index];
                const state = resolveSourceGlyphState(source, `${wordStartTime}:${index}`, timing.char, time, timing.startTime, timing.endTime);
                slot.apply(state, typeof state === 'number' ? source.getStrokes(timing.char) : null);
            }
        };
        // 首帧就定好（还没开写的字在画出来之前就藏起来）
        tick(currentTime.get());
        const unsubscribe = currentTime.on('change', tick);
        return () => {
            unsubscribe();
            for (const { slot } of slots) slot.dispose();
        };
    }, [active, activeColor, currentTime, graphemeTimings, source, wordRevealMode, wordStartTime]);

    return content;
};
