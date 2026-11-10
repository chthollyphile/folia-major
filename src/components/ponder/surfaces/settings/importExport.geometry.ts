import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/settings/importExport.geometry.ts
// importExport.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 设置 · 存储与备份里「备份与导入」那一组，坐标系是那块面板。
 *
 * 一排选「带哪个主题」的小胶囊、一块粘贴用的文本框、底下一排按钮（导出、复制 JSON，
 * 右端单独一颗导入）。导入那颗和别的按钮隔开，因为它是唯一会改动本机设置的那颗。
 */
export const IMPORT_EXPORT_GEOMETRY = {
    heading: { left: 0.04, top: 0.02, width: 0.34, height: 0.07 },
    card: { left: 0.03, right: 0.03, top: 0.12, bottom: 0.02 },
    copy: { left: 0.06, right: 0.06, top: 0.16, height: 0.13 },
    themeChips: { left: 0.06, right: 0.06, top: 0.34, height: 0.10 },
    textarea: { left: 0.06, right: 0.06, top: 0.49, height: 0.26 },
    exportButtons: { left: 0.06, top: 0.80, width: 0.40, height: 0.11 },
    importButton: { right: 0.06, top: 0.80, width: 0.20, height: 0.11 },
    /** 以下属于结果层：按下导入之后先弹的那个逐项对照框。 */
    dialog: { left: 0.10, right: 0.10, top: 0.07, bottom: 0.07 },
    /** 相对 dialog：分组标题、可逐条勾选的改动行、以及总是摊开的衍生改动。 */
    dialogGroups: { left: 0.06, right: 0.06, top: 0.16, height: 0.44 },
    dialogDerived: { left: 0.06, right: 0.06, top: 0.64, height: 0.18 },
} satisfies Record<string, PonderRelativeRect>;
