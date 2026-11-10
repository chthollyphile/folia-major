import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/settings/appearanceSettings.geometry.ts
// appearanceSettings.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 设置 · 主页与歌单里「主页」那一组，坐标系是那块面板。
 *
 * 一张卡三行：顶部胶囊入口（右端五个带勾的小块）、歌单卡片样式（右端两张小图，图下面是名字，
 * 选中的那张描着边）、记住主页卡片位置（开关）。教程讲的是中间那一行的两张小图。
 */
export const GRID3D_CARD_STYLE_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.14, height: 0.09 },
    card: { left: 0.03, right: 0.03, top: 0.13, bottom: 0.03 },
    tabsRow: { left: 0.06, right: 0.06, top: 0.15, height: 0.19 },
    styleRow: { left: 0.06, right: 0.06, top: 0.36, height: 0.40 },
    optionImage: { right: 0.22, top: 0.39, width: 0.145, height: 0.34 },
    optionCard: { right: 0.06, top: 0.39, width: 0.145, height: 0.34 },
    rememberRow: { left: 0.06, right: 0.06, top: 0.78, height: 0.17 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 主页与歌单里「网格卡片」那一组，坐标系是那块面板。
 *
 * 标题那一行的右端是「恢复默认衰减」；卡顶上一条预览（一排卡片，离中间越远越小越淡），
 * 下面是全画幅封面、卡片最小尺寸、卡片最小透明度三行。
 * 「正方形卡片」那一行只在「全画幅封面」打开之后才存在，所以它在骨架里也要等一层
 * 结果层才出现 —— 一进场就摆着的话，字幕说「开了才有」就和画面对不上。
 */
export const GRID_VIEW_CARD_GEOMETRY = {
    heading: { left: 0.04, top: 0.015, width: 0.14, height: 0.06 },
    reset: { right: 0.04, top: 0.02, width: 0.19, height: 0.05 },
    card: { left: 0.03, right: 0.03, top: 0.09, bottom: 0.02 },
    preview: { left: 0.05, right: 0.05, top: 0.115, height: 0.26 },
    fullBleed: { left: 0.06, right: 0.06, top: 0.40, height: 0.12 },
    square: { left: 0.10, right: 0.06, top: 0.54, height: 0.12 },
    minScale: { left: 0.06, right: 0.06, top: 0.68, height: 0.13 },
    minOpacity: { left: 0.06, right: 0.06, top: 0.83, height: 0.13 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 播放页里「视图」那一组，坐标系是那块面板。
 *
 * 第一行是「播放后进入的视图」（两张小图）；下面边缘暗角、海报聚焦叠色两行开关。
 * 叠色是层层嵌套的：开了叠色才有缩进的「强制使用自定义颜色」和「叠色强度」，开了自定义颜色才有取色器。
 * 骨架照这个嵌套分两层结果层画，读者才看得出为什么自己那屏上没有取色器。
 */
export const LATTICE_STYLE_GEOMETRY = {
    heading: { left: 0.04, top: 0.015, width: 0.14, height: 0.055 },
    card: { left: 0.03, right: 0.03, top: 0.085, bottom: 0.02 },
    entryView: { left: 0.06, right: 0.06, top: 0.10, height: 0.19 },
    vignette: { left: 0.06, right: 0.06, top: 0.31, height: 0.095 },
    tint: { left: 0.06, right: 0.06, top: 0.425, height: 0.095 },
    customColor: { left: 0.10, right: 0.06, top: 0.54, height: 0.095 },
    picker: { left: 0.10, right: 0.06, top: 0.655, height: 0.17 },
    intensity: { left: 0.10, right: 0.06, top: 0.855, height: 0.095 },
} satisfies Record<string, PonderRelativeRect>;
