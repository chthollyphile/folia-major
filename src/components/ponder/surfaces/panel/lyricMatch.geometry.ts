import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/panel/lyricMatch.geometry.ts
// lyricMatch.surface.tsx 画的那张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 匹配歌词的窗口，坐标系是窗口自身（按给本地文件匹配时的 1024 × 622 量的）。
 *
 * 顶上是标题和正在匹配的那首歌；左边六成从上到下是歌词来源一排、搜索一行、结果；右边四成是
 * 选中那一条的封面和名字，下面是它的歌词预览；底边右端取消和保存。
 * 文件名那一行、封面下面的三个开关、歌词来自哪里那一行和底边左端那颗按钮，只有本地文件才有。
 */
export const LYRIC_MATCH_GEOMETRY = {
    header: { left: 0, right: 0, top: 0, height: 0.164 },
    heading: { left: 0.024, top: 0.035, width: 0.26, height: 0.105 },
    close: { right: 0.032, top: 0.062, width: 0.02, square: true },
    sources: { left: 0.017, top: 0.186, width: 0.32, height: 0.062 },
    search: { left: 0.017, top: 0.277, width: 0.587, height: 0.074 },
    results: { left: 0.017, top: 0.376, width: 0.587, height: 0.453 },
    cover: { left: 0.745, top: 0.204, width: 0.125, square: true },
    switches: { left: 0.722, top: 0.424, width: 0.171, height: 0.036 },
    names: { left: 0.68, top: 0.48, width: 0.255, height: 0.115 },
    status: { left: 0.74, top: 0.607, width: 0.135, height: 0.036 },
    /** 封面和它下面的名字，合起来是「选中的这一条」。 */
    chosen: { left: 0.66, top: 0.19, width: 0.295, height: 0.415 },
    lyrics: { left: 0.6445, top: 0.666, width: 0.331, height: 0.18 },
    footer: { left: 0, right: 0, bottom: 0, height: 0.116 },
    noMatch: { left: 0.0244, bottom: 0.027, width: 0.137, height: 0.061 },
    cancel: { right: 0.1025, bottom: 0.027, width: 0.0664, height: 0.061 },
    save: { right: 0.0244, bottom: 0.027, width: 0.0664, height: 0.061 },
} satisfies Record<string, PonderRelativeRect>;

/** 结果一共画几条。 */
export const LYRIC_MATCH_ROW_COUNT = 4;

/** 第几条结果（从 0 数），坐标系是结果那一块（LYRIC_MATCH_GEOMETRY.results）。一条高 66，隔 6。 */
export const lyricMatchRowRect = (index: number): PonderRelativeRect => (
    { left: 0, right: 0, top: index * 0.2553, height: 0.234 }
);
