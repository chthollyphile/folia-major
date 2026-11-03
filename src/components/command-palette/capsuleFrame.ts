// src/components/command-palette/capsuleFrame.ts
// 面板从进度条胶囊原地长出来时用到的几何：打开那一刻量一次胶囊，算出面板贴底的位置、
// body 在胶囊上方还放得下多高，以及从胶囊形状展开到整块面板的 clip-path 起点。

/** 面板最宽 42rem（max-w-2xl），两侧各留 1rem（外层 px-4）。 */
const PANEL_MAX_WIDTH_PX = 672;
const PANEL_SIDE_GUTTER_PX = 16;
/**
 * body 以外占掉的高度：底部输入行、顶上的置顶命令行，再留一点到屏幕顶的空。
 * body 只在胶囊抬得很高、窗口又矮时才会被这一项压低，平时仍是 min(496px, 50vh)。
 */
const PANEL_CHROME_PX = 160;
/** 展开后的面板圆角，和 rounded-3xl 一致。 */
const OPEN_RADIUS_PX = 24;

/** 从胶囊展开、收回胶囊各用多久（秒）。 */
export const CAPSULE_MORPH_DURATION_S = 0.28;
/**
 * 收起时多久把外壳交还给胶囊（毫秒）：比收回动画略早，胶囊在面板最后那点淡出里接上，
 * 两者在同一个位置交叉一下，而不是面板先没了、胶囊再冒出来，或者两个一起缩放。
 */
export const CAPSULE_HANDBACK_DELAY_MS = 200;

export type CapsuleFrame = {
    left: number;
    width: number;
    height: number;
    /** 胶囊下沿到视口底的距离：面板下沿贴在这里。 */
    bottomGap: number;
    viewportWidth: number;
};

/** 打开那一刻量一次胶囊。胶囊不在、没挂上或没有尺寸时返回 null，面板回到普通的遮罩样式。 */
export const readCapsuleFrame = (anchor: HTMLElement | null): CapsuleFrame | null => {
    if (!anchor || !anchor.isConnected || typeof window === 'undefined') {
        return null;
    }
    const rect = anchor.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return null;
    }
    return {
        left: rect.left,
        width: rect.width,
        height: rect.height,
        bottomGap: Math.max(0, window.innerHeight - rect.bottom),
        viewportWidth: window.innerWidth,
    };
};

/** 胶囊模式下 body 的高度：原来的 min(496px, 50vh)，再加上「胶囊上方放得下」这一条。仍由 CSS 解出。 */
export const capsuleBodyHeight = (frame: CapsuleFrame) => (
    `min(496px, 50vh, calc(100vh - ${Math.round(frame.bottomGap + PANEL_CHROME_PX)}px))`
);

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/**
 * 面板外框从胶囊形状开始的 clip-path：只露出底部胶囊那么高、那么宽的一段，圆角是胶囊的半高。
 * 和 PANEL_OPEN_CLIP 的数字个数、单位一一对应，framer-motion 才能逐项插值。
 */
export const capsuleClipPath = (frame: CapsuleFrame) => {
    const panelWidth = Math.min(PANEL_MAX_WIDTH_PX, frame.viewportWidth - PANEL_SIDE_GUTTER_PX * 2);
    const panelLeft = (frame.viewportWidth - panelWidth) / 2;
    const insetLeft = clamp(frame.left - panelLeft, 0, panelWidth);
    const insetRight = clamp(panelWidth - insetLeft - frame.width, 0, panelWidth);
    const round = (value: number) => Math.round(value * 10) / 10;
    return `inset(calc(100% - ${round(frame.height)}px) ${round(insetRight)}px 0px ${round(insetLeft)}px round ${round(frame.height / 2)}px)`;
};

export const PANEL_OPEN_CLIP = `inset(calc(0% - 0px) 0px 0px 0px round ${OPEN_RADIUS_PX}px)`;

/**
 * 匹配列表里一次方向键挪几格。胶囊模式下列表倒着排（第一名贴着底部的输入框），
 * 向上键是离输入框更远、也就是往后一名。
 */
export const listArrowStep = (key: string, isReversed: boolean): number => {
    if (key !== 'ArrowDown' && key !== 'ArrowUp') {
        return 0;
    }
    const step = key === 'ArrowDown' ? 1 : -1;
    return isReversed ? -step : step;
};
