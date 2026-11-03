import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/studio/themePark.geometry.ts
// Theme Park 那张合成界面的尺寸，themePark.surface.tsx 画它。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * Theme Park，坐标系是整个窗口。和歌词样式窗口同一个外壳：标题栏、左边实时预览、右边设置栏。
 */
export const THEME_PARK_GEOMETRY = {
    header: { left: 0.02, right: 0.02, top: 0.012, height: 0.07 },
    /** 以下四块相对 header：标题后面紧跟着编辑目标那一对和一行提示，右端是重置和保存。 */
    targetToggle: { left: 0.134, top: 0.2, width: 0.132, height: 0.6 },
    hint: { left: 0.277, top: 0.42, width: 0.14, height: 0.16 },
    reset: { right: 0.084, top: 0.2, width: 0.044, height: 0.6 },
    save: { right: 0, top: 0.2, width: 0.076, height: 0.6 },
    preview: { left: 0.02, right: 0.357, top: 0.085, bottom: 0.03 },
    /** 以下三块相对 preview：左上角是主题的名字和描述，右上角暂停，底下一行是小卡片、进度条和按钮。 */
    previewName: { left: 0.025, top: 0.03, width: 0.2, height: 0.06 },
    pause: { right: 0.016, top: 0.022, width: 0.042, square: true },
    previewFooter: { left: 0.025, right: 0.025, bottom: 0.03, height: 0.075 },
    panel: { left: 0.672, right: 0.01, top: 0.085, bottom: 0.02 },
    /** 以下相对 panel。标签是一行文字：配色、信息、内容、AI。 */
    tabs: { left: 0.03, right: 0.02, top: 0.012, height: 0.05 },
    tabColors: { left: 0.03, top: 0.012, width: 0.07, height: 0.05 },
    tabDetails: { left: 0.15, top: 0.012, width: 0.07, height: 0.05 },
    tabContent: { left: 0.27, top: 0.012, width: 0.07, height: 0.05 },
    tabAi: { left: 0.39, top: 0.012, width: 0.05, height: 0.05 },
    /** 「配色」页：亮暗那一对，四种颜色的 2×2 格，下面一张卡是取色器。 */
    modeToggle: { left: 0.03, right: 0.02, top: 0.092, height: 0.045 },
    colorWells: { left: 0.03, right: 0.02, top: 0.155, height: 0.16 },
    picker: { left: 0.03, right: 0.02, top: 0.332, height: 0.535 },
    /** 取色器那张卡里的四块，仍然相对 panel：色域、色相条、HEX、推荐色。 */
    pickerArea: { left: 0.06, right: 0.05, top: 0.395, height: 0.27 },
    hue: { left: 0.06, right: 0.05, top: 0.682, height: 0.014 },
    hex: { left: 0.06, right: 0.05, top: 0.716, height: 0.046 },
    recommended: { left: 0.06, right: 0.05, top: 0.782, height: 0.07 },
} satisfies Record<string, PonderRelativeRect>;
