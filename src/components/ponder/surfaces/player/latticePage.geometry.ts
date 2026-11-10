import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/player/latticePage.geometry.ts
// latticePage.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/** 无限墙上的海报，坐标系是 wall。焦点那张同时是 `poster` 锚点，不另外写一份。 */
export const LATTICE_POSTERS: readonly PonderRelativeRect[] = [
    { left: 0.04, top: 0.08, width: 0.20, height: 0.24 },
    { left: 0.26, top: 0.04, width: 0.17, height: 0.29 },
    { left: 0.45, top: 0.10, width: 0.24, height: 0.22 },
    { left: 0.72, top: 0.04, width: 0.20, height: 0.27 },
    { left: 0.02, top: 0.38, width: 0.17, height: 0.25 },
    { left: 0.22, top: 0.37, width: 0.25, height: 0.28 },
    { left: 0.50, top: 0.36, width: 0.18, height: 0.23 },
    { left: 0.71, top: 0.34, width: 0.25, height: 0.30 },
    { left: 0.07, top: 0.68, width: 0.22, height: 0.25 },
    { left: 0.32, top: 0.70, width: 0.17, height: 0.22 },
    { left: 0.52, top: 0.64, width: 0.24, height: 0.27 },
    { left: 0.79, top: 0.70, width: 0.17, height: 0.21 },
];

/** 教程里被聚焦、被展开的那张海报的序号。 */
export const LATTICE_FOCUSED_POSTER = 5;

/**
 * 「拖动平移相机」那一步把墙挪走多少，单位是 wall 自身的比例。
 *
 * 平移之后的聚焦层必须沿用同一个位移：两层墙只在焦点描边上有差别时，交叉淡入看不出破绽；
 * 位移不一致的话，淡入淡出那半秒屏幕上就是两面错开的墙。
 */
export const LATTICE_PAN = { x: -0.068, y: 0.036 };

const latticePannedPoster = (poster: PonderRelativeRect): PonderRelativeRect => ({
    ...poster,
    left: (poster.left ?? 0) + LATTICE_PAN.x,
    top: (poster.top ?? 0) + LATTICE_PAN.y,
});

export const LATTICE_GEOMETRY = {
    /** 相对 page。 */
    wall: { left: 0.06, right: 0.06, top: 0.07, bottom: 0.10 },
    /** 相对 wall。 */
    poster: LATTICE_POSTERS[LATTICE_FOCUSED_POSTER],
    /** 相对 wall：相机平移之后那张焦点海报落在哪。 */
    pannedPoster: latticePannedPoster(LATTICE_POSTERS[LATTICE_FOCUSED_POSTER]),
    back: { left: 0.03, top: 0.04, width: 0.06, square: true },
    tools: { right: 0.04, bottom: 0.05, width: 0.07, square: true },
    expanded: { left: 0.20, right: 0.20, top: 0.13, bottom: 0.14 },
    /** 相对 expanded：展开海报底部那条播放控制。 */
    chrome: { left: 0.06, right: 0.06, bottom: 0.06, height: 0.26 },
    /** 开在定位按钮和工具按钮这一列的上方；两行：队列命令、灯光。 */
    toolsPanel: { right: 0.04, bottom: 0.39, width: 0.38, height: 0.22 },
    /** 有歌时控制条在底部，命令窗口从那里原地往上长，输入行在底。 */
    command: { left: 0.18, right: 0.18, bottom: 0.06, height: 0.66 },
} satisfies Record<string, PonderRelativeRect>;
