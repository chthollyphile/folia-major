import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/command/lyricExport.geometry.ts
// lyricExport.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 命令面板里「导出歌词缓存」那一页，坐标系是命令窗口。
 *
 * 顶上是输入行，下面一段说明，然后按「导哪些 → 导成什么 → 文件怎么命名」排成三节，
 * 每节一个小标题；前两节是并排两张可多选的卡，LRC 的附带项缩在格式那一节右下。
 * 开始按钮不在滚动区里，钉在窗口底边那条操作栏上。
 */
export const LYRIC_EXPORT_GEOMETRY = {
    input: { left: 0.04, right: 0.04, top: 0.03, height: 0.10 },
    /** 滚动区：三节内容所在的那一整块。 */
    card: { left: 0.10, right: 0.10, top: 0.16, bottom: 0.13 },
    copy: { left: 0.12, right: 0.12, top: 0.17, height: 0.05 },
    scope: { left: 0.12, right: 0.12, top: 0.25, height: 0.18 },
    formats: { left: 0.12, right: 0.12, top: 0.46, height: 0.25 },
    names: { left: 0.12, right: 0.12, top: 0.74, height: 0.11 },
    /** 底边操作栏：左边进度文字，右边开始 / 取消。 */
    run: { left: 0, right: 0, bottom: 0, height: 0.10 },
} satisfies Record<string, PonderRelativeRect>;
