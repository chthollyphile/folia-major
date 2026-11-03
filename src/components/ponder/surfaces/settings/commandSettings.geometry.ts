import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/settings/commandSettings.geometry.ts
// commandSettings.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 设置 · 快捷操作 · 命令窗口里「自定义快捷键」那一行，坐标系是那块面板。
 *
 * 真实那一组是一行两半：左边一对键帽（Alt 已经按下、旁边是待录的那一颗），右边一个
 * 命令下拉。Alt 画成常按下的样子而不是可编辑的一段，因为它在界面上就是不可改的 ——
 * 画成可录的话，这一章讲的那件事（录不出组合键）在图上就不成立。
 */
export const CUSTOM_SHORTCUT_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.34, height: 0.08 },
    card: { left: 0.03, right: 0.03, top: 0.14, bottom: 0.02 },
    copy: { left: 0.06, right: 0.06, top: 0.19, height: 0.18 },
    /** 左半边那对键帽，以及录到之后才出现的那颗清除叉。 */
    capAlt: { left: 0.07, top: 0.46, width: 0.10, height: 0.18 },
    capKey: { left: 0.205, top: 0.46, width: 0.10, height: 0.18 },
    clear: { left: 0.335, top: 0.505, width: 0.05, square: true },
    /** 右半边那个命令下拉，和展开之后压在它下面的那张列表。 */
    command: { right: 0.07, top: 0.46, width: 0.40, height: 0.18 },
    commandList: { right: 0.07, top: 0.66, width: 0.40, height: 0.30 },
    /** 按到一颗已经被占掉的字母时，红字长在键帽下面。 */
    rejection: { left: 0.07, top: 0.68, width: 0.42, height: 0.07 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 设置 · 通用里「固定命令」那一组，坐标系是那块面板。
 *
 * 三个槽位并排，各是一个下拉。结果层画的是命令窗口本身 —— 这一组配的东西不长在
 * 设置里，而是长在窗口下面那一排，不画出来就只是三个不知道通向哪儿的下拉框。
 */
export const PINNED_COMMANDS_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.32, height: 0.08 },
    card: { left: 0.03, right: 0.03, top: 0.14, bottom: 0.02 },
    copy: { left: 0.06, right: 0.06, top: 0.19, height: 0.18 },
    slotFirst: { left: 0.06, top: 0.46, width: 0.28, height: 0.22 },
    slotSecond: { left: 0.36, top: 0.46, width: 0.28, height: 0.22 },
    slotThird: { right: 0.06, top: 0.46, width: 0.28, height: 0.22 },
    /** 以下属于结果层：命令窗口，以及贴在它下面那一排三颗。 */
    palette: { left: 0.08, right: 0.08, top: 0.05, height: 0.60 },
    /** 相对 palette：会随使用次序自己重排的那份列表。 */
    paletteList: { left: 0.05, right: 0.05, top: 0.28, bottom: 0.06 },
    pinnedRow: { left: 0.08, right: 0.08, top: 0.70, height: 0.11 },
} satisfies Record<string, PonderRelativeRect>;
