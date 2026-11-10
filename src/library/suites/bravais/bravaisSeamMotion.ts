import type { Transition } from 'framer-motion';
import { BRAVAIS_REDUCED_FADE_MS, BRAVAIS_SEAM_FLIP_IN_MS, BRAVAIS_SEAM_FLIP_OUT_MS } from './bravaisConstants';

// src/library/suites/bravais/bravaisSeamMotion.ts
// 缝里的动效词汇（设计稿 §7「缝内的过渡」）：只动 transform / opacity，两类——
// - 换内容 = 翻牌：与墙上磁贴同一种半圈（转到 90° 换内容，再从 −90° 转回来），时长与缓动用缝的翻转常量
//   （BRAVAIS_SEAM_FLIP_OUT_MS / IN_MS）。整条缝（换层、换形态）与竖着的一块（首页中段）绕 Y 轴转，与墙一致；横着的一行
//   （过滤位、表单里的一排按钮、状态行、计数）绕 X 轴转，像翻牌显示板的一格。
// - 弹出 = 从锚点方向放大 + 位移 + 淡入，收起反过来（framer-motion 的 AnimatePresence）。
// 「降低动态效果」沿用 B11 的判断（bravaisMotion：lattice 或 collectionMorph 任一降级）：翻牌换成 0.18s 淡出 → 换 →
// 淡入（BRAVAIS_REDUCED_FADE_MS，各占一半），弹出只淡入淡出。
// 正在过渡的元素挂 data-bravais-seam-flip（flip-out / flip-in / fade-out / fade-in），放完摘掉：用例等它消失再量。

export type BravaisSeamFlipAxis = 'x' | 'y';
export type BravaisSeamFlipPhase = 'flip-out' | 'flip-in' | 'fade-out' | 'fade-in';

export const BRAVAIS_SEAM_FLIP_ATTRIBUTE = 'data-bravais-seam-flip';
const PERSPECTIVE_PX = 1400;
export const BRAVAIS_SEAM_FLIP_OUT_EASING = 'ease-in';
export const BRAVAIS_SEAM_FLIP_IN_EASING = 'cubic-bezier(.2,.7,.25,1)';
/** 同一条转进缓动给 framer-motion 用的写法。 */
export const BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER = [0.2, 0.7, 0.25, 1] as const;
const FADE_HALF_MS = BRAVAIS_REDUCED_FADE_MS / 2;

export const seamFlipTransform = (axis: BravaisSeamFlipAxis, degrees: number) => (
    `perspective(${PERSPECTIVE_PX}px) rotate${axis === 'x' ? 'X' : 'Y'}(${degrees}deg)`
);

const setPhase = (element: HTMLElement, phase: BravaisSeamFlipPhase | null) => {
    if (phase) element.setAttribute(BRAVAIS_SEAM_FLIP_ATTRIBUTE, phase);
    else element.removeAttribute(BRAVAIS_SEAM_FLIP_ATTRIBUTE);
};

/** 转出半圈（降级时是淡出的前一半）：停在 90° / 透明，等调用方换内容。 */
export const playSeamFlipOut = (element: HTMLElement, axis: BravaisSeamFlipAxis, reduced: boolean): Animation => {
    setPhase(element, reduced ? 'fade-out' : 'flip-out');
    return reduced
        ? element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_HALF_MS, easing: 'ease-in', fill: 'forwards' })
        : element.animate(
            [{ transform: seamFlipTransform(axis, 0) }, { transform: seamFlipTransform(axis, 90) }],
            { duration: BRAVAIS_SEAM_FLIP_OUT_MS, easing: BRAVAIS_SEAM_FLIP_OUT_EASING, fill: 'forwards' },
        );
};

/**
 * 转进半圈（降级时是淡入的后一半）：新内容从 −90° / 透明回正。放完摘掉过渡标记（被下一次打断时由下一次接手标记）。
 * `onSettled` 只在自然放完时调用。
 */
export const playSeamFlipIn = (element: HTMLElement, axis: BravaisSeamFlipAxis, reduced: boolean, onSettled?: () => void): Animation => {
    setPhase(element, reduced ? 'fade-in' : 'flip-in');
    const animation = reduced
        ? element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_HALF_MS, easing: 'ease-out' })
        : element.animate(
            [{ transform: seamFlipTransform(axis, -90) }, { transform: seamFlipTransform(axis, 0) }],
            { duration: BRAVAIS_SEAM_FLIP_IN_MS, easing: BRAVAIS_SEAM_FLIP_IN_EASING },
        );
    animation.onfinish = () => {
        setPhase(element, null);
        onSettled?.();
    };
    return animation;
};

/** 过渡被取消（卸载、又换了）：摘掉标记。 */
export const clearSeamFlipPhase = (element: HTMLElement | null) => {
    if (element) setPhase(element, null);
};

/** 换内容时焦点在旧内容里：新内容渲染出来后落到哪里（选中的那一项，否则第一个能聚焦的）。 */
const FOCUS_TARGETS = [
    '[aria-selected="true"]:not(:disabled)',
    '[aria-pressed="true"]:not(:disabled)',
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
];

export const refocusWithin = (element: HTMLElement) => {
    if (element.contains(document.activeElement)) return;
    for (const selector of FOCUS_TARGETS) {
        const target = element.querySelector<HTMLElement>(selector);
        if (target) {
            target.focus({ preventScroll: true });
            return;
        }
    }
};

/** 弹出类（菜单、弹层）从哪个方向长出来。 */
export type BravaisPopAnchor = 'below' | 'above';

/**
 * 弹出 / 收起的 framer-motion 参数：从锚点那一侧放大、位移、淡入；收起更快一点、不接指针。降级时只淡入淡出。
 * `above`：菜单长在锚点上方（首页工具格的「⋯」），从底边长出来；`below`：长在锚点下方（集合层的「⋯ 更多」）。
 */
export const bravaisPopMotion = (anchor: BravaisPopAnchor, reduced: boolean) => {
    const direction = anchor === 'above' ? 1 : -1;
    const enter: Transition = { duration: reduced ? BRAVAIS_REDUCED_FADE_MS / 1000 : 0.18, ease: BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER };
    const leave: Transition = { duration: reduced ? FADE_HALF_MS / 1000 : 0.12, ease: 'easeIn' };
    return {
        style: { originX: 0.5, originY: anchor === 'above' ? 1 : 0 },
        initial: reduced ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 8 * direction },
        animate: { opacity: 1, scale: 1, y: 0, pointerEvents: 'auto' as const, transition: enter },
        exit: reduced
            ? { opacity: 0, pointerEvents: 'none' as const, transition: leave }
            : { opacity: 0, scale: 0.96, y: 4 * direction, pointerEvents: 'none' as const, transition: leave },
    };
};

/**
 * 缝里的菜单往哪边弹：横的信息条在视口上半时往下（bravaisSeamRow.css 按 data-bravais-seam-half 把菜单放到按钮下方），
 * 其余往上。读的是缝节点上 renderFrame 写的属性，菜单挂载的那一次渲染里调（动画参数只在挂载时取）。
 */
export const seamPopAnchorFor = (element: Element | null): BravaisPopAnchor => {
    const seam = element?.closest<HTMLElement>('[data-bravais-seam]');
    return seam?.dataset.bravaisSeamAxis === 'y' && seam.dataset.bravaisSeamHalf === 'top' ? 'below' : 'above';
};

/** 出现 / 消失的小块（结果提示、管理隐藏的开关、扫描进度）：淡入 + 轻微位移；降级时只淡入淡出。 */
export const bravaisRevealMotion = (reduced: boolean) => ({
    initial: reduced ? { opacity: 0 } : { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0, transition: { duration: reduced ? BRAVAIS_REDUCED_FADE_MS / 1000 : 0.2, ease: BRAVAIS_SEAM_FLIP_IN_EASING_BEZIER } },
    exit: { opacity: 0, transition: { duration: FADE_HALF_MS / 1000, ease: 'easeIn' as const } },
});
