import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/basics/signIn.geometry.ts
// signIn.surface.tsx 画的那张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 没有人登录时的主页，坐标系是整页（按 1440 × 900 量的）。
 *
 * 中间是一句标题、两行提示和「登录」按钮；右下角那一枚一直都在。登录窗口宽 772、高 420，居中。
 * 按钮和右下角那一枚比真的画大了两成：照原样缩进这张图里，它们只剩二三十像素，看不出是什么。
 */
export const SIGN_IN_GEOMETRY = {
    title: { left: 0.42, top: 0.415, width: 0.16, height: 0.03 },
    prompt: { left: 0.39, top: 0.46, width: 0.22, height: 0.04 },
    homeButton: { left: 0.442, top: 0.526, width: 0.116, height: 0.064 },
    pill: { right: 0.017, bottom: 0.027, width: 0.088, height: 0.07 },
    window: { left: 0.232, top: 0.267, width: 0.536, height: 0.467 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 登录窗口里的几块，坐标系是窗口。
 *
 * 左边一列是全部平台；右边顶上是「登录到 平台」和关闭，下面左边那一块画（二维码，或者账号的头像），
 * 它右边是标题、一句说明和操作；登录途中右下角有一串步骤标记。
 */
export const SIGN_IN_WINDOW = {
    column: { left: 0, top: 0, width: 0.275, height: 1 },
    title: { left: 0.306, top: 0.045, width: 0.24, height: 0.062 },
    close: { right: 0.03, top: 0.052, width: 0.026, square: true },
    tile: { left: 0.306, top: 0.31, width: 0.259, square: true },
    message: { left: 0.596, top: 0.33, right: 0.031, height: 0.2 },
    steps: { right: 0.031, top: 0.72, width: 0.172, height: 0.068 },
    /** 账号那一幅：头像那一块和它右边的名字，合起来是「这个平台的账号」。 */
    account: { left: 0.306, top: 0.31, right: 0.031, height: 0.476 },
    actions: { left: 0.596, top: 0.71, width: 0.262, height: 0.077 },
} satisfies Record<string, PonderRelativeRect>;

/** 那一列里一共画几行。 */
export const SIGN_IN_ROW_COUNT = 6;

/** 那一列里的第几行（从 0 数），坐标系是窗口。一行高 36，行与行挨着。 */
export const signInRowRect = (index: number): PonderRelativeRect => (
    { left: 0.0104, top: 0.019 + index * 0.0857, width: 0.254, height: 0.0857 }
);

/** 已经登录的那一行画在第几行：它的右端有头像，账号那一章点的就是它。 */
export const SIGN_IN_SIGNED_IN_ROW = 1;
