import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/gridViewPage.geometry.ts
// gridViewPage.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/** GridView 的卡片阵列：六列错行，坐标系是 cards。 */
export const GRID_VIEW_CARD_COLUMNS = 6;
export const GRID_VIEW_CARD_COUNT = 17;
export const GRID_VIEW_FOCUSED_CARD = 8;

/**
 * 按序号算出一张卡在 cards 里的位置。锚点和界面都走它，错行偏移只写一遍。
 *
 * 列距、卡宽和错行量三个数要满足 5×列距 + 卡宽 + 错行量 ≤ 1：不满足的话，错行的那几排
 * 最后一张会整块长到 cards 之外 —— 屏幕上就是一张卡莫名其妙地比别的排凸出去一截。
 * 整排再按剩下的空隙左右居中，错行的一半往右、另一半往左。
 */
const GRID_VIEW_CARD_PITCH = 0.15;
const GRID_VIEW_CARD_WIDTH = 0.13;
const GRID_VIEW_CARD_STAGGER = 0.075;
const GRID_VIEW_CARD_INSET = (
    1 - ((GRID_VIEW_CARD_COLUMNS - 1) * GRID_VIEW_CARD_PITCH + GRID_VIEW_CARD_WIDTH + GRID_VIEW_CARD_STAGGER)
) / 2;

export const gridViewCardRect = (index: number): PonderRelativeRect => {
    const column = index % GRID_VIEW_CARD_COLUMNS;
    const row = Math.floor(index / GRID_VIEW_CARD_COLUMNS);
    return {
        left: GRID_VIEW_CARD_INSET + column * GRID_VIEW_CARD_PITCH + (row % 2 ? GRID_VIEW_CARD_STAGGER : 0),
        top: row * 0.34,
        width: GRID_VIEW_CARD_WIDTH,
        height: 0.26,
    };
};

export const GRID_VIEW_GEOMETRY = {
    back: { left: 0.03, top: 0.04, width: 0.06, square: true },
    title: { left: 0.33, top: 0.04, width: 0.34, height: 0.10 },
    cards: { left: 0.07, right: 0.07, top: 0.17, bottom: 0.08 },
    /** 相对 cards。 */
    card: gridViewCardRect(GRID_VIEW_FOCUSED_CARD),
    info: { left: 0.04, top: 0.16, bottom: 0.07, width: 0.34 },
    filter: { left: 0.22, right: 0.22, top: 0.08, height: 0.11 },
} satisfies Record<string, PonderRelativeRect>;
