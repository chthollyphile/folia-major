import type { RefObject } from 'react';

// src/components/ponder/hold/ponderHoldProgress.ts
// 长按进入思索时那组进度反馈：胶囊里从左到右的擦除，两段文案交叉淡入，文案那一格跟着变宽。
//
// 抽出来是因为它有两个入口 —— 悬停某个组件后长按 G，和任意页面上长按 Ctrl+G。
// 两条路必须看起来完全一样，各写一份必然走散；而「一样」正是这个反馈的全部意义：
// 用户学会的是「按住，等擦除走满」，不是学会两套。
//
// 进度用 WAAPI（element.animate）而不是 anime.js：胶囊在常驻链路上，把 animejs 拉进来
// 等于把那个 ~38KB 的 chunk 塞回 bootstrap，正是 App.tsx:20-22 那条注释在防的事。

export const PONDER_HOLD_DURATION_MS = 400;

export type PonderHoldProgressRefs = {
    /** 胶囊里那道从左到右的高亮擦除。 */
    wipeRef: RefObject<HTMLElement | null>;
    /** 静止时的文案。 */
    labelRef: RefObject<HTMLElement | null>;
    /** 「进入思索」，压在上面淡入。 */
    holdLabelRef: RefObject<HTMLElement | null>;
    /** 两段文案共用的那一格：「进入思索」更宽时，从静止文案的宽度变到它的宽度。不给就不动宽度。 */
    cellRef?: RefObject<HTMLElement | null>;
};

/**
 * 起一轮长按进度动画，返回这轮产生的 Animation，取消时逐个 cancel。
 *
 * 进度反馈是功能性的，不是装饰 —— 即使用户关了微动效也要看得见还要按多久，
 * 所以这里不读 reduced motion，只用最朴素的线性变换。
 */
export const startPonderHoldProgress = ({
    wipeRef,
    labelRef,
    holdLabelRef,
    cellRef,
}: PonderHoldProgressRefs): Animation[] => {
    const timing: KeyframeAnimationOptions = {
        duration: PONDER_HOLD_DURATION_MS,
        easing: 'linear',
        fill: 'forwards',
    };
    const animations: Animation[] = [];

    if (wipeRef.current) {
        animations.push(wipeRef.current.animate(
            [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
            timing,
        ));
    }
    if (labelRef.current) {
        animations.push(labelRef.current.animate([{ opacity: 1 }, { opacity: 0 }], timing));
    }
    if (holdLabelRef.current) {
        animations.push(holdLabelRef.current.animate([{ opacity: 0 }, { opacity: 1 }], timing));
    }
    if (cellRef?.current && labelRef.current && holdLabelRef.current) {
        const restWidth = labelRef.current.offsetWidth;
        const holdWidth = holdLabelRef.current.offsetWidth;
        // 只变宽：「进入思索」比静止文案短的语言里，这一格缩了会把还没淡完的静止文案切掉一截。
        if (holdWidth > restWidth) {
            animations.push(cellRef.current.animate(
                [{ width: `${restWidth}px` }, { width: `${holdWidth}px` }],
                timing,
            ));
        }
    }

    return animations;
};
