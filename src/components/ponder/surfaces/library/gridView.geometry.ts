import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/gridView.geometry.ts
// gridView.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 海报墙右下角那颗操作按钮，坐标系是 page。
 *
 * 它和播放页那颗侧边手柄是同一个手势（都走 SlideActionButton 或它的同形实现），
 * 所以画法也照那边：按钮贴右下角，背后一条向左的滑轨画成虚线 —— 它在那里，只是没显出来。
 */
export const GRID_ACTION_BUTTON_GEOMETRY = {
    shelf: { left: 0.06, right: 0.06, top: 0.12, bottom: 0.26 },
    button: { right: 0.05, bottom: 0.07, width: 0.07, square: true },
    track: { right: 0.05, bottom: 0.07, width: 0.32, height: 0.135 },
    /** 滑轨左端那枚图标要停在轨道**里**：right 比轨道左沿再往里收一点点。 */
    trackEnd: { right: 0.31, bottom: 0.082, width: 0.055, square: true },
    listPanel: { right: 0.04, top: 0.08, width: 0.30, bottom: 0.06 },
    filterBar: { left: 0.22, right: 0.22, top: 0.06, height: 0.10 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 集合页那片网格里的卡片，坐标系是 page。
 *
 * 编辑模式和「手动匹配歌曲信息」共用这一张：两件事讲的都是同一张卡上按钮的增减，
 * 各画一份只会让两边的卡长得不一样。
 */
export const GRID_VIEW_CARDS_GEOMETRY = {
    cards: { left: 0.06, right: 0.06, top: 0.16, bottom: 0.16 },
    /** 相对 cards：中间那张。 */
    card: { left: 0.36, top: 0, width: 0.28, height: 1 },
    /** 以下都相对 card。 */
    title: { left: 0.08, right: 0.20, bottom: 0.30, height: 0.07 },
    pencil: { right: 0.06, bottom: 0.295, width: 0.12, square: true },
    actions: { left: 0.12, right: 0.12, bottom: 0.07, height: 0.14 },
    removeBadge: { right: 0.04, top: 0.04, width: 0.14, square: true },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 信息面板底部那一列来源专属动作，坐标系是那一列自身。
 *
 * 最后一颗是删除，红的。它和上面几颗长得一样只差颜色，这正是要单独讲的理由。
 */
export const LOCAL_FOLDER_ACTIONS_GEOMETRY = {
    playAll: { left: 0.04, right: 0.04, top: 0.04, height: 0.15 },
    addQueue: { left: 0.04, right: 0.04, top: 0.22, height: 0.15 },
    reimport: { left: 0.04, right: 0.04, top: 0.40, height: 0.15 },
    organize: { left: 0.04, right: 0.04, top: 0.58, height: 0.15 },
    remove: { left: 0.04, right: 0.04, top: 0.76, height: 0.15 },
} satisfies Record<string, PonderRelativeRect>;

/** 曲目列表侧板，坐标系是那块面板。排序那两颗只在本地文件夹里出现。 */
export const LOCAL_TRACK_LIST_GEOMETRY = {
    header: { left: 0.04, right: 0.04, top: 0.03, height: 0.09 },
    direction: { left: 0.05, top: 0.035, width: 0.085, square: true },
    sortMenu: { right: 0.05, top: 0.035, width: 0.085, square: true },
    rows: { left: 0.04, right: 0.04, top: 0.15, bottom: 0.03 },
    menu: { right: 0.05, top: 0.14, width: 0.52, height: 0.34 },
} satisfies Record<string, PonderRelativeRect>;
