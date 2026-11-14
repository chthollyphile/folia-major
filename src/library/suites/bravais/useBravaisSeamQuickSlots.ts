import { useLayoutEffect, useState, type RefObject } from 'react';
import { quickSlotsForWidth } from './bravaisSeamQuickCells';

// src/library/suites/bravais/useBravaisSeamQuickSlots.ts
// 量动作格那一排放得下几格（方案 C）：容器宽 ÷（格宽 + 间距）。格宽取排里第一格的实际宽度（缝里 36px、海报上 46px、
// 首页工具格 40px，各处样式自己定），间距取容器的 column-gap。容器的样式要让它的宽度不随格子数变（contain: inline-size），
// 量出来的就是它能占的宽度，不会因为少画一格又变窄。首帧前同步量一次（useLayoutEffect），之后窗口或字号变了由
// ResizeObserver 重量；格数没变不 setState。

export const useBravaisSeamQuickSlots = (ref: RefObject<HTMLElement | null>, fallbackCell = 36): number | null => {
    const [slots, setSlots] = useState<number | null>(null);
    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) return undefined;
        const measure = () => {
            const cell = (element.firstElementChild as HTMLElement | null)?.offsetWidth || fallbackCell;
            const gap = parseFloat(getComputedStyle(element).columnGap) || 0;
            const next = quickSlotsForWidth(element.clientWidth, cell, gap);
            setSlots(current => (current === next ? current : next));
        };
        measure();
        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [fallbackCell, ref]);
    return slots;
};
