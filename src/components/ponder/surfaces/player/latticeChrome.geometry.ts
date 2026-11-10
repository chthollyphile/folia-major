import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/player/latticeChrome.geometry.ts
// latticeChrome.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * Lattice 里展开海报底部那条播放控制，坐标系是展开的卡片。
 *
 * 四个额外按钮里，两端是上一首/下一首，中间两个就是底栏那两个可配置槽位 —— 这一章的全部重点
 * 在这里，所以它们各自是一个锚点，而不是笼统的一块「按钮区」。
 */
export const LATTICE_CHROME_GEOMETRY = {
    card: { left: 0.06, right: 0.06, top: 0.05, bottom: 0.06 },
    /** 以下都相对 chrome。 */
    play: { left: 0.03, top: 0.12, width: 0.10, square: true },
    prev: { left: 0.20, top: 0.16, width: 0.085, square: true },
    slotPrimary: { left: 0.315, top: 0.16, width: 0.085, square: true },
    slotSecondary: { left: 0.43, top: 0.16, width: 0.085, square: true },
    next: { left: 0.545, top: 0.16, width: 0.085, square: true },
    time: { left: 0.67, top: 0.26, width: 0.16, height: 0.2 },
    openPlayer: { right: 0.03, top: 0.16, width: 0.085, square: true },
    progress: { left: 0.03, right: 0.03, bottom: 0.14, height: 0.12 },
    /** 卡片之外：海报滚出视口时自动出现的那条底栏。相对 page。 */
    bottomBar: { left: 0.22, right: 0.22, bottom: 0.03, height: 0.13 },
    chrome: { left: 0.04, right: 0.04, bottom: 0.06, height: 0.34 },
} satisfies Record<string, PonderRelativeRect>;
