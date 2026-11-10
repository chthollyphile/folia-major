import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/localLibrary.geometry.ts
// localLibrary.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 本地 Grid3D 顶栏：居中的是顶部视图胶囊的第二层（「全部」、分隔线、分类），右侧是导入维护操作。
 * 分类里当前的「文件夹」带文字、较宽，其余三个只有图标，所以「歌单」是最右那一格窄的。
 */
export const LOCAL_GRID_CONTROLS_GEOMETRY = {
    capsule: { left: 0.14, top: 0.18, width: 0.42, height: 0.32 },
    map: { left: 0.15, top: 0.2, width: 0.1, height: 0.28 },
    tabs: { left: 0.275, top: 0.18, width: 0.285, height: 0.32 },
    folders: { left: 0.28, top: 0.2, width: 0.12, height: 0.28 },
    playlists: { left: 0.505, top: 0.2, width: 0.05, height: 0.28 },
    imports: { left: 0.6, top: 0.18, right: 0.03, height: 0.32 },
    refresh: { left: 0.77, top: 0.18, width: 0.09, height: 0.32 },
    playlistImport: { left: 0.88, top: 0.18, right: 0.03, height: 0.32 },
} satisfies Record<string, PonderRelativeRect>;

/** GridView 在线集合信息面板底部的通用与来源专属动作。 */
export const ONLINE_COLLECTION_ACTIONS_GEOMETRY = {
    playAll: { left: 0.08, right: 0.08, top: 0.08, height: 0.13 },
    addQueue: { left: 0.08, right: 0.08, top: 0.25, height: 0.13 },
    addPlaylist: { left: 0.08, right: 0.08, top: 0.42, height: 0.13 },
    providerAction: { left: 0.08, right: 0.08, top: 0.59, height: 0.13 },
    destructiveAction: { left: 0.08, right: 0.08, top: 0.76, height: 0.13 },
} satisfies Record<string, PonderRelativeRect>;

/** 本地 GridMap 页面与标题展开的批量选择/目录树面板。 */
export const LOCAL_GRID_MAP_GEOMETRY = {
    back: { left: 0.03, top: 0.04, width: 0.06, square: true },
    title: { left: 0.34, top: 0.04, width: 0.32, height: 0.10 },
    cards: { left: 0.08, right: 0.08, top: 0.18, bottom: 0.08 },
    panel: { left: 0.03, top: 0.11, width: 0.21, bottom: 0.07 },
    tree: { left: 0.043, top: 0.25, width: 0.185, height: 0.44 },
    row: { left: 0.052, top: 0.34, width: 0.166, height: 0.065 },
    checkbox: { left: 0.069, top: 0.352, width: 0.019, square: true },
    expand: { left: 0.051, top: 0.352, width: 0.015, square: true },
    rootActions: { left: 0.196, top: 0.352, width: 0.022, height: 0.026 },
    actions: { left: 0.043, top: 0.87, width: 0.185, height: 0.05 },
} satisfies Record<string, PonderRelativeRect>;
