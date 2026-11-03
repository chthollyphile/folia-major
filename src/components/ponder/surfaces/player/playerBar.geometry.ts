import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/player/playerBar.geometry.ts
// playerBar.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 底部控制条，坐标系是 bar 本身。
 *
 * 这条在真实界面里会随悬停展开/收起、还会被缩放，量当下的 DOM 得到的经常是一根收起来的
 * 进度条，甚至什么都量不到。所以教程里画的是一条完整尺寸的合成胶囊，几何固定在这里。
 */
export const PLAYER_BAR_GEOMETRY = {
    play: { left: 0.035, top: 0.24, width: 0.065, square: true },
    title: { left: 0.14, top: 0.13, width: 0.58, height: 0.30 },
    progress: { left: 0.14, top: 0.56, width: 0.58, height: 0.28 },
    slots: { left: 0.856, top: 0.30, right: 0.04, height: 0.40 },
    primarySlot: { left: 0.856, top: 0.30, width: 0.046, square: true },
    secondarySlot: { left: 0.914, top: 0.30, width: 0.046, square: true },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 胶囊上方那一排快捷操作，坐标系是这一排自己。
 *
 * 六个操作等分在左边，最右那颗是打开命令窗口，前面隔一条细线 —— 和真实那排的顺序一样。
 * 教程要让光标点的正是这一颗，所以它单独记一条。
 */
export const CAPSULE_QUICK_ACTIONS_GEOMETRY = {
    actions: { left: 0.04, top: 0.14, width: 0.76, height: 0.72 },
    /** 打开命令窗口那颗前面的细分隔线。 */
    divider: { left: 0.825, top: 0.25, width: 0.004, height: 0.5 },
    paletteButton: { left: 0.855, top: 0.14, width: 0.105, height: 0.72 },
} satisfies Record<string, PonderRelativeRect>;
