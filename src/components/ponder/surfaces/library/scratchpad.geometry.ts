import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/scratchpad.geometry.ts
// scratchpad.surface.tsx 画的那张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录。

/**
 * 整页，坐标系是整页（按 1440 × 900 量的）。
 *
 * 底下是一面资料库的磁贴墙，其中一张歌曲磁贴是指针停着的那张；左缘贴着速记簿的把手。
 * 抽屉打开时从左缘滑出来盖在墙上，展开成画布时几乎铺满整页。
 * 把手比真的画大了三成：照原样缩进这张图里，它只剩一道细线。
 */
export const SCRATCHPAD_GEOMETRY = {
    handle: { left: 0, top: 0.07, width: 0.022, height: 0.14 },
    card: { left: 0.43, top: 0.2, width: 0.17, height: 0.44 },
    /** 抽屉贴着左缘：真的离左缘 12px，这里贴齐，好把把手整个盖住（打开时把手本来就不在了）。 */
    drawer: { left: 0, top: 0.044, width: 0.27, bottom: 0.044 },
    canvas: { left: 0, top: 0.044, right: 0.012, bottom: 0.044 },
} satisfies Record<string, PonderRelativeRect>;

/** 墙上其余的磁贴（只是背景），坐标系是整页。 */
export const SCRATCHPAD_WALL_TILES: readonly PonderRelativeRect[] = [
    { left: 0.06, top: 0.06, width: 0.17, height: 0.3 },
    { left: 0.06, top: 0.38, width: 0.17, height: 0.56 },
    { left: 0.245, top: 0.06, width: 0.17, height: 0.48 },
    { left: 0.245, top: 0.56, width: 0.17, height: 0.38 },
    { left: 0.43, top: 0.06, width: 0.17, height: 0.12 },
    { left: 0.43, top: 0.66, width: 0.17, height: 0.28 },
    { left: 0.615, top: 0.06, width: 0.17, height: 0.4 },
    { left: 0.615, top: 0.48, width: 0.17, height: 0.46 },
    { left: 0.8, top: 0.06, width: 0.17, height: 0.56 },
    { left: 0.8, top: 0.64, width: 0.17, height: 0.3 },
];

/** 指针停着的那张歌曲磁贴里的两颗悬浮按钮，坐标系是磁贴。左边加入速记簿，右边收藏到歌单。 */
export const SCRATCHPAD_CARD = {
    collect: { right: 0.27, top: 0.04, width: 0.19, square: true },
    save: { right: 0.05, top: 0.04, width: 0.19, square: true },
    title: { left: 0.08, bottom: 0.1, width: 0.6, height: 0.04 },
    artist: { left: 0.08, bottom: 0.06, width: 0.36, height: 0.022 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 抽屉里的几块，坐标系是抽屉。
 *
 * 顶上是标题、首数，右边展开成画布和关闭两颗；下面一句说明。然后是按来源分的两组：组头写来源与首数，
 * 右端「本组全部入队」「本组加入歌单」；每一行是封面、歌名、歌手 · 出处，悬停时右端出四颗。
 * 最底下一排：全部入队、替换队列播放、清空。
 */
export const SCRATCHPAD_DRAWER = {
    title: { left: 0.06, top: 0.035, width: 0.36, height: 0.04 },
    expand: { right: 0.15, top: 0.03, width: 0.075, square: true },
    close: { right: 0.05, top: 0.03, width: 0.075, square: true },
    hint: { left: 0.06, top: 0.1, right: 0.06, height: 0.025 },
    footer: { left: 0.04, right: 0.04, bottom: 0.02, height: 0.055 },
    enqueueAll: { left: 0.04, bottom: 0.02, width: 0.38, height: 0.055 },
    replaceQueue: { left: 0.45, bottom: 0.02, width: 0.38, height: 0.055 },
    clear: { right: 0.04, bottom: 0.02, width: 0.1, height: 0.055 },
} satisfies Record<string, PonderRelativeRect>;

/** 抽屉里两组的行数：第一组（在线平台）三行，第二组（本地）两行。 */
export const SCRATCHPAD_GROUP_SIZES = [3, 2] as const;

const DRAWER_LIST_TOP = 0.15;
const DRAWER_HEADER_HEIGHT = 0.045;
const DRAWER_ROW_HEIGHT = 0.068;
const DRAWER_GROUP_GAP = 0.025;

/** 第 group 组的组头从哪儿起（坐标系是抽屉的高）。 */
const drawerGroupTop = (group: number) => {
    let top = DRAWER_LIST_TOP;
    for (let index = 0; index < group; index += 1) {
        top += DRAWER_HEADER_HEIGHT + SCRATCHPAD_GROUP_SIZES[index] * DRAWER_ROW_HEIGHT + DRAWER_GROUP_GAP;
    }
    return top;
};

/** 第 group 组的组头，坐标系是抽屉。 */
export const scratchpadGroupHeaderRect = (group: number): PonderRelativeRect => (
    { left: 0.03, right: 0.03, top: drawerGroupTop(group), height: DRAWER_HEADER_HEIGHT }
);

/** 组头右端那两颗（本组全部入队、本组加入歌单），坐标系是抽屉。 */
export const scratchpadGroupActionsRect = (group: number): PonderRelativeRect => (
    { right: 0.05, top: drawerGroupTop(group) + 0.006, width: 0.17, height: DRAWER_HEADER_HEIGHT - 0.012 }
);

/** 第 group 组的第 row 行，坐标系是抽屉。 */
export const scratchpadRowRect = (group: number, row: number): PonderRelativeRect => (
    { left: 0.03, right: 0.03, top: drawerGroupTop(group) + DRAWER_HEADER_HEIGHT + row * DRAWER_ROW_HEIGHT, height: DRAWER_ROW_HEIGHT }
);

/** 悬停的那一行右端的四颗（插进队列播放、加入队列、加入歌单、移出速记簿），坐标系是抽屉。 */
export const scratchpadRowActionsRect = (group: number, row: number): PonderRelativeRect => (
    { right: 0.05, top: drawerGroupTop(group) + DRAWER_HEADER_HEIGHT + row * DRAWER_ROW_HEIGHT + 0.014, width: 0.36, height: DRAWER_ROW_HEIGHT - 0.028 }
);

/** 悬停着、演示行内按钮的那一行。 */
export const SCRATCHPAD_HOVER_ROW = { group: 0, row: 1 } as const;

/**
 * 展开成画布之后的几块，坐标系是画布。
 *
 * 两组上下排开，每组一条组头（右端多一颗「选中本组」），下面是一排卡片；最底下一排和抽屉里一样，
 * 有选中时换成「已选 N 首」和对选中的那几颗。
 */
export const SCRATCHPAD_CANVAS = {
    title: { left: 0.02, top: 0.035, width: 0.12, height: 0.04 },
    collapse: { right: 0.055, top: 0.03, width: 0.022, square: true },
    close: { right: 0.02, top: 0.03, width: 0.022, square: true },
    hint: { left: 0.02, top: 0.1, width: 0.3, height: 0.025 },
    footer: { left: 0.02, right: 0.02, bottom: 0.02, height: 0.055 },
    /** 框选：从第二组卡片左边的空白处拖到第二张卡片上。 */
    marquee: { left: 0.012, top: 0.52, width: 0.17, height: 0.22 },
    selectionBar: { left: 0.02, right: 0.02, bottom: 0.02, height: 0.055 },
} satisfies Record<string, PonderRelativeRect>;

/** 画布上两组卡片的张数。 */
export const SCRATCHPAD_CANVAS_GROUP_SIZES = [5, 3] as const;

const CANVAS_GROUP_TOPS = [0.15, 0.47];
const CANVAS_CARD_WIDTH = 0.075;
const CANVAS_CARD_GAP = 0.009;

/** 画布上第 group 组的组头。 */
export const scratchpadCanvasHeaderRect = (group: number): PonderRelativeRect => (
    { left: 0.02, right: 0.02, top: CANVAS_GROUP_TOPS[group], height: 0.045 }
);

/** 画布上第 group 组的第 slot 个卡位。卡片吸附在这些位置上。 */
export const scratchpadCanvasSlotRect = (group: number, slot: number): PonderRelativeRect => (
    { left: 0.02 + slot * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP), top: CANVAS_GROUP_TOPS[group] + 0.07, width: CANVAS_CARD_WIDTH, height: 0.18 }
);

/** 演示拖动的那一张：第一组的第三张拖到第一个位置。 */
export const SCRATCHPAD_DRAG = { group: 0, from: 2, to: 0 } as const;

/** 框选框住的：第二组的前两张。 */
export const SCRATCHPAD_SELECTED = { group: 1, slots: [0, 1] } as const;
