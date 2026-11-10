import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/basics/onboarding.geometry.ts
// onboarding.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 入门教程用的示意图，坐标系是 page。
 *
 * 这一张不对应任何一个真实页面 —— 它画的是「思索是怎么用的」这件事本身：
 * 一页界面、指针停在其中一个组件上、旁边浮出提示胶囊、右下角那颗触屏用的灯泡。
 * 原本这里用的是通用的页面轮廓（标题条加两张卡加三行占位），读者从那张图上
 * 学不到任何东西，字幕只能对着一块空白讲。
 */
export const PONDER_ONBOARDING_GEOMETRY = {
    /** 顶栏在右边让出一截，灯泡才有地方站 —— 真实界面里它也是浮在页面之上的。 */
    topBar: { left: 0.05, right: 0.17, top: 0.05, height: 0.09 },
    cardA: { left: 0.06, top: 0.22, width: 0.26, height: 0.34 },
    cardB: { left: 0.37, top: 0.22, width: 0.26, height: 0.34 },
    /** 被指着的那个组件。提示胶囊浮在它下面。 */
    cardC: { right: 0.06, top: 0.22, width: 0.26, height: 0.34 },
    capsule: { right: 0.05, top: 0.61, width: 0.36, height: 0.11 },
    bottomBar: { left: 0.26, right: 0.26, bottom: 0.07, height: 0.11 },
    /**
     * 触屏上代替 Ctrl+G 的那颗灯泡，贴右上角。
     *
     * 不在右下角：那一块是操作按钮最密的地方（底部控制条、集合页的列表按钮、
     * 播放页的侧边手柄），一颗常驻浮动按钮压上去就是挡路。
     */
    touchBulb: { right: 0.035, top: 0.05, width: 0.075, square: true },
} satisfies Record<string, PonderRelativeRect>;
