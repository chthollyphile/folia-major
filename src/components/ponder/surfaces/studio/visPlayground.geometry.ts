import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/studio/visPlayground.geometry.ts
// 歌词样式窗口那张合成界面的尺寸，visPlayground.surface.tsx 和 lyricStyle.surface.tsx 都画它。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/** 样式架：一排七张，两排。 */
export const VIS_STYLE_SHELF_COLUMNS = 7;
export const VIS_STYLE_SHELF_COUNT = 14;

/** 样式架上第 index 张图的位置，坐标系是样式架。图下面那条名字不算在内。 */
export const visStyleTileRect = (index: number): PonderRelativeRect => ({
    left: (index % VIS_STYLE_SHELF_COLUMNS) / VIS_STYLE_SHELF_COLUMNS + 0.004,
    top: 0.16 + Math.floor(index / VIS_STYLE_SHELF_COLUMNS) * 0.44,
    width: 1 / VIS_STYLE_SHELF_COLUMNS - 0.016,
    height: 0.27,
});

/** 右栏一页里第 index 行的位置，坐标系是右栏。五页共用这九个槽位，各自往里填自己的行。 */
export const visPanelRowRect = (index: number): PonderRelativeRect => ({
    left: 0.03,
    right: 0.02,
    top: 0.11 + index * 0.094,
    height: 0.062,
});

/**
 * 歌词样式窗口，坐标系是整个窗口。
 *
 * 左边一列：上面是实时预览，下面是一架样式图；右边一条窄设置栏，栏顶一行文字标签。
 * 预览上那三块热区是这一屏最藏的东西：它们平时完全透明、没有描边也没有底色，
 * 指针压上去才显形。所以骨架里它们必须是三块独立的区域，而不是预览里一块笼统的高亮。
 */
export const VIS_PLAYGROUND_GEOMETRY = {
    header: { left: 0.02, right: 0.02, top: 0.012, height: 0.07 },
    preview: { left: 0.02, right: 0.357, top: 0.085, height: 0.575 },
    /** 以下三块相对 preview：顶上一条是背景，中间一大块是歌词动画，底下一条是字幕。 */
    hotspotBackground: { left: 0.02, right: 0.02, top: 0.035, height: 0.20 },
    hotspotVisualizer: { left: 0.10, right: 0.10, top: 0.28, height: 0.48 },
    hotspotSubtitle: { left: 0.02, right: 0.02, bottom: 0.053, height: 0.18 },
    /** 相对 preview：右上角那颗暂停，点一下预览停在当前这一帧，再点继续。 */
    pause: { right: 0.016, top: 0.027, width: 0.042, square: true },
    /** 预览下面那一架样式图：歌词样式在这里选。 */
    shelf: { left: 0.02, right: 0.357, top: 0.685, bottom: 0.03 },
    panel: { left: 0.672, right: 0.01, top: 0.085, bottom: 0.02 },
    /** 以下相对 panel。标签是一行文字：歌词动画、背景、通用、字幕、全局；右端是只退当前这一页的「默认」。 */
    tabs: { left: 0.03, right: 0.02, top: 0.012, height: 0.05 },
    tabAnimation: { left: 0.03, top: 0.012, width: 0.16, height: 0.05 },
    tabBackground: { left: 0.225, top: 0.012, width: 0.09, height: 0.05 },
    tabCommon: { left: 0.35, top: 0.012, width: 0.09, height: 0.05 },
    tabSubtitle: { left: 0.475, top: 0.012, width: 0.09, height: 0.05 },
    tabGlobal: { left: 0.6, top: 0.012, width: 0.09, height: 0.05 },
    panelReset: { right: 0.02, top: 0.012, width: 0.09, height: 0.05 },
    rows: { left: 0.03, right: 0.02, top: 0.095, bottom: 0.03 },
    rowOne: visPanelRowRect(0),
    rowTwo: visPanelRowRect(1),
    rowThree: visPanelRowRect(2),
    rowFour: visPanelRowRect(3),
    rowFive: visPanelRowRect(4),
    rowSix: visPanelRowRect(5),
    rowSeven: visPanelRowRect(6),
    rowEight: visPanelRowRect(7),
    rowNine: visPanelRowRect(8),
    /** 「背景」页上那一格背景图：占前三行的位置。 */
    backgroundPictures: { left: 0.03, right: 0.02, top: 0.11, height: 0.25 },
} satisfies Record<string, PonderRelativeRect>;
