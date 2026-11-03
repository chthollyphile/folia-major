import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/gridPage.geometry.ts
// gridPage.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/** Grid3D 轨道上的五张卡，坐标系是 page。中间那张同时是 `focusedCard` 锚点。 */
export const GRID_CARDS: readonly PonderRelativeRect[] = [
    { left: 0.0785, top: 0.3725, width: 0.155, height: 0.30 },
    { left: 0.2455, top: 0.3725, width: 0.155, height: 0.30 },
    { left: 0.4125, top: 0.355, width: 0.175, height: 0.335 },
    { left: 0.5995, top: 0.3725, width: 0.155, height: 0.30 },
    { left: 0.7665, top: 0.3725, width: 0.155, height: 0.30 },
];

export const GRID_FOCUSED_CARD = 2;

const gridTabs = { left: 0.344, top: 0.069, width: 0.322, height: 0.062 };

export const GRID_GEOMETRY = {
    help: { left: 0.04, top: 0.05, width: 0.22, height: 0.10 },
    tabs: gridTabs,
    /** 切换后亮起来的那一格，跟着 tabs 走，不另写一组坐标。 */
    activeTab: {
        left: gridTabs.left + gridTabs.width * 0.26,
        top: gridTabs.top + gridTabs.height * 0.13,
        width: gridTabs.width * 0.21,
        height: gridTabs.height * 0.74,
    },
    search: { left: 0.748, top: 0.072, width: 0.212, height: 0.056 },
    map: { left: 0.42, top: 0.195, width: 0.16, height: 0.054 },
    sourceActions: { left: 0.79, top: 0.195, width: 0.17, height: 0.054 },
    shelf: { left: 0, right: 0, top: 0.357, height: 0.331 },
    focusedCard: GRID_CARDS[GRID_FOCUSED_CARD],
    focusedCopy: { left: 0.29, top: 0.715, width: 0.42, height: 0.105 },
    /** 有歌时控制条在底部，命令窗口从那里原地往上长，输入行在底。 */
    command: { left: 0.18, right: 0.18, bottom: 0.06, height: 0.58 },
} satisfies Record<string, PonderRelativeRect>;

/** 换源之后轨道上摆的那批卡。 */
export const TAB_SWITCH_CARDS: readonly PonderRelativeRect[] = [
    { left: 0.175, top: 0.375, width: 0.145, height: 0.29 },
    { left: 0.345, top: 0.375, width: 0.145, height: 0.29 },
    { left: 0.515, top: 0.375, width: 0.145, height: 0.29 },
    { left: 0.685, top: 0.375, width: 0.145, height: 0.29 },
];
