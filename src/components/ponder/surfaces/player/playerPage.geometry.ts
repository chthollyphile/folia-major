import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/player/playerPage.geometry.ts
// playerPage.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 播放页，坐标系是 page。
 *
 * 真实的播放页是整屏：可视化和歌词铺满，控制条浮在底部中间，侧边手柄贴右缘且和控制条同高。
 * 这里照这个关系摆，位置才讲得出「在哪」。
 */
export const PLAYER_PAGE_GEOMETRY = {
    lyrics: { left: 0.10, right: 0.34, top: 0.16, bottom: 0.30 },
    // 收窄到 60%，和真实那条一样：再宽就会压到右缘手柄背后那条滑轨上。
    bar: { left: 0.20, right: 0.20, bottom: 0.06, height: 0.14 },
    /** 侧边手柄贴右缘，底边和控制条对齐。 */
    toggle: { right: 0.03, bottom: 0.065, width: 0.058, square: true },
    /**
     * 手柄背后向左伸出的滑轨，长度是手柄的两倍、高度和手柄相同。
     * 高度必须按宽度推（aspect），不能写 height：手柄是 square，高度跟着页面宽度走，
     * 写死 height 就跟着页面高度走，宽高比一变手柄就缩到滑轨右下角去了。
     */
    track: { right: 0.03, bottom: 0.065, width: 0.116, aspect: 0.5 },
    /** 手柄上方展开的控制面板。 */
    panel: { right: 0.03, bottom: 0.225, width: 0.25, height: 0.60 },
    /**
     * 命令窗口：播放页上有歌时控制条在，窗口从控制条原地往上长 —— 下沿和控制条齐平，
     * 正好盖住它（真实的控制条这时会让出来）。
     */
    palette: { left: 0.19, right: 0.19, bottom: 0.06, height: 0.5 },
} satisfies Record<string, PonderRelativeRect>;
