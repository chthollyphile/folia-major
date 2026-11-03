import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/studio/lyricStyle.geometry.ts
// lyricStyle.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 歌词样式那张图的预览内部，坐标系是 VIS_PLAYGROUND_GEOMETRY.preview。
 *
 * 外框（顶栏、预览、右栏、行）直接用歌词样式窗口那张表：设置直达打开的就是那个窗口，
 * 教程里的样子和按下按钮之后看到的得是同一个东西。
 */
export const LYRIC_STYLE_GEOMETRY = {
    /** 一般样式的歌词：居中的几行。 */
    lyrics: { left: 0.14, right: 0.14, top: 0.24, height: 0.40 },
    /** 通用底部副字幕：大多数样式共用的那一条。莫奈等自己排版的样式没有它。 */
    subtitle: { left: 0.18, right: 0.18, bottom: 0.08, height: 0.12 },
    /** 莫奈：左边一列歌词，下面一段歌曲描述。 */
    monetRail: { left: 0.06, top: 0.12, width: 0.46, height: 0.50 },
    monetDescription: { left: 0.06, bottom: 0.10, width: 0.46, height: 0.16 },
    /** 莫奈：右边的肖像，顶上一颗拖拽调整按钮，底下一条音频图案。 */
    monetPortrait: { right: 0.07, top: 0.12, width: 0.34, bottom: 0.26 },
    monetHanger: { right: 0.21, top: 0.06, width: 0.06, square: true },
    monetAudio: { right: 0.07, bottom: 0.08, width: 0.34, height: 0.12 },
} satisfies Record<string, PonderRelativeRect>;
