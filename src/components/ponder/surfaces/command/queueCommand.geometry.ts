import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/command/queueCommand.geometry.ts
// queueCommand.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 队列命令窗口，坐标系是那扇窗口。
 *
 * 它长得像命令窗口，做的事却是筛队列：输入行是队列的搜索框，`@` 收窄范围，
 * `--` 对筛出来的那些整批下手。三件事各占一块，所以分开量。
 */
export const QUEUE_COMMAND_GEOMETRY = {
    input: { left: 0.04, right: 0.04, top: 0.04, height: 0.13 },
    chips: { left: 0.04, right: 0.04, top: 0.21, height: 0.09 },
    suggestions: { left: 0.04, right: 0.04, top: 0.21, height: 0.32 },
    rows: { left: 0.04, right: 0.04, top: 0.34, bottom: 0.05 },
    /** 收窄之后行变少，底下腾出来给批量预览。 */
    narrowedRows: { left: 0.04, right: 0.04, top: 0.34, bottom: 0.24 },
    preview: { left: 0.04, right: 0.04, bottom: 0.05, height: 0.16 },
} satisfies Record<string, PonderRelativeRect>;
