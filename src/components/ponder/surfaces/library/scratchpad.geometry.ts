import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/library/scratchpad.geometry.ts
// scratchpad.surface.tsx 画的那张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录。
// 速记簿是 Bravais 样式（左缘面板、展开整页那张纸）：尺寸照真实界面在 1440 × 900 时量。

/**
 * 整页，坐标系是整页（按 1440 × 900 量的）。
 *
 * 底下是一面资料库的磁贴墙，其中一张歌曲磁贴是指针停着的那张；左缘贴着速记簿的标签（米白小条）。
 * 面板打开时贴着左缘、从顶到底盖在墙上；展开整页时整页都是它。
 * 标签比真的画大了一些：照原样缩进这张图里，它只剩一道细线。
 */
export const SCRATCHPAD_GEOMETRY = {
    handle: { left: 0, top: 0.08, width: 0.028, height: 0.16 },
    card: { left: 0.43, top: 0.2, width: 0.17, height: 0.44 },
    /** 面板：368px 宽，从窗口顶到底。 */
    drawer: { left: 0, top: 0, width: 0.256, bottom: 0 },
    canvas: { left: 0, top: 0, right: 0, bottom: 0 },
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
 * 面板里的几块，坐标系是面板（368 × 900）。
 *
 * 三页各一条米白的纸：这一页的信息条在顶上（探出面板一截，左端压一颗墨色的返回钮收起面板，右端一颗「展开整页」），
 * 另外两页是压在底部的两条细纸带（点一下换过去）。信息条下面是放大的问候、一道短杠、一行说明；然后是按来源分的两组：组头写来源与首数，
 * 右端「本组全部入队」「本组加入歌单」；每一行是封面、歌名、歌手 · 出处，悬停时右端出四颗。细纸带上面一排：全部入队、替换队列播放、清空。
 */
export const SCRATCHPAD_DRAWER = {
    /** 信息条左端的返回钮（收起面板）。 */
    fold: { left: 0.033, top: 0.063, width: 0.087, square: true },
    /** 信息条右端探出面板的那一截上（所以伸出面板右边）。 */
    expand: { left: 0.962, top: 0.063, width: 0.087, square: true },
    band: { left: 0, top: 0.044, width: 1.098, height: 0.071 },
    greeting: { left: 0.049, top: 0.14, right: 0.04, height: 0.03 },
    rule: { left: 0.049, top: 0.183, width: 0.098, height: 0.0045 },
    hint: { left: 0.049, top: 0.198, right: 0.04, height: 0.016 },
    footer: { left: 0.049, right: 0.038, bottom: 0.104, height: 0.036 },
    enqueueAll: { left: 0.049, bottom: 0.104, width: 0.26, height: 0.036 },
    replaceQueue: { left: 0.326, bottom: 0.104, width: 0.33, height: 0.036 },
    clear: { right: 0.038, bottom: 0.104, width: 0.087, height: 0.036 },
    /** 底部两条细纸带（上面一格、下面一格），也探出面板一截。 */
    slimUpper: { left: 0, top: 0.913, width: 1.098, height: 0.031 },
    slimLower: { left: 0, top: 0.951, width: 1.098, height: 0.031 },
} satisfies Record<string, PonderRelativeRect>;

/** 面板里两组的行数：第一组（在线平台）三行，第二组（本地）两行。 */
export const SCRATCHPAD_GROUP_SIZES = [3, 2] as const;

const DRAWER_LIST_TOP = 0.235;
const DRAWER_HEADER_HEIGHT = 0.038;
const DRAWER_ROW_HEIGHT = 0.058;
const DRAWER_GROUP_GAP = 0.011;
/** 行与组头铺满面板。 */
const DRAWER_LIST_LEFT = 0;

/** 第 group 组的组头从哪儿起（坐标系是面板的高）。 */
const drawerGroupTop = (group: number) => {
    let top = DRAWER_LIST_TOP;
    for (let index = 0; index < group; index += 1) {
        top += DRAWER_HEADER_HEIGHT + SCRATCHPAD_GROUP_SIZES[index] * DRAWER_ROW_HEIGHT + DRAWER_GROUP_GAP;
    }
    return top;
};

/** 第 group 组的组头，坐标系是面板。 */
export const scratchpadGroupHeaderRect = (group: number): PonderRelativeRect => (
    { left: DRAWER_LIST_LEFT, right: 0, top: drawerGroupTop(group), height: DRAWER_HEADER_HEIGHT }
);

/** 组头右端那两颗（本组全部入队、本组加入歌单），坐标系是面板。 */
export const scratchpadGroupActionsRect = (group: number): PonderRelativeRect => (
    { right: 0.02, top: drawerGroupTop(group) + 0.004, width: 0.19, height: DRAWER_HEADER_HEIGHT - 0.008 }
);

/** 第 group 组的第 row 行，坐标系是面板。 */
export const scratchpadRowRect = (group: number, row: number): PonderRelativeRect => (
    { left: DRAWER_LIST_LEFT, right: 0, top: drawerGroupTop(group) + DRAWER_HEADER_HEIGHT + row * DRAWER_ROW_HEIGHT, height: DRAWER_ROW_HEIGHT }
);

/** 悬停的那一行右端的四颗（插进队列播放、加入队列、加入歌单、移出速记簿），坐标系是面板。 */
export const scratchpadRowActionsRect = (group: number, row: number): PonderRelativeRect => (
    { right: 0.02, top: drawerGroupTop(group) + DRAWER_HEADER_HEIGHT + row * DRAWER_ROW_HEIGHT + 0.011, width: 0.36, height: DRAWER_ROW_HEIGHT - 0.022 }
);

/** 悬停着、演示行内按钮的那一行。 */
export const SCRATCHPAD_HOVER_ROW = { group: 0, row: 1 } as const;

/**
 * 展开整页之后的几块，坐标系是整页。真实界面里整张纸斜 4°；这张图摆正了画，框才对得上。
 *
 * 顶上横贯一条米白信息条（左端压一颗墨色的返回钮，然后是计数、标题、说明，右端是这一页的按钮）；右上角一块黑色直角三角写问候。
 * 下面两组，每组一条组头（右端多一颗「选中本组」），下面一排笔记本卡；右边一列是跳到栏与操作提示；
 * 另外两页收成两条细纸带压在底下。有选中时，选中的卡片旁边浮出一块墨色的板：「已选 N 首」和对选中的那几颗。
 */
export const SCRATCHPAD_CANVAS = {
    band: { left: 0, right: 0, top: 0.11, height: 0.133 },
    count: { left: 0.165, top: 0.13, width: 0.067, height: 0.089 },
    title: { left: 0.245, top: 0.135, width: 0.16, height: 0.05 },
    meta: { left: 0.245, top: 0.195, width: 0.22, height: 0.018 },
    bandActions: { right: 0.19, top: 0.19, width: 0.2, height: 0.036 },
    triangle: { right: 0, top: 0, width: 0.305, height: 0.24 },
    greeting: { right: 0.014, top: 0.05, width: 0.18, height: 0.03 },
    /** 返回（收回侧栏）：信息条左端那颗墨色的方钮。 */
    collapse: { left: 0.012, top: 0.15, width: 0.033, square: true },
    side: { right: 0.03, top: 0.29, width: 0.086, bottom: 0.17 },
    slimUpper: { left: 0, right: 0, bottom: 0.07, height: 0.04 },
    slimLower: { left: 0, right: 0, bottom: 0.023, height: 0.04 },
    /** 框选：从第二组卡片左边的空白处拖到第二张卡片上。 */
    marquee: { left: 0.112, top: 0.585, width: 0.12, height: 0.15 },
    /** 选中第二组前两张时浮出的板：贴在它们下面。 */
    menu: { left: 0.136, top: 0.75, width: 0.27, height: 0.05 },
} satisfies Record<string, PonderRelativeRect>;

/** 画布上两组卡片的张数。 */
export const SCRATCHPAD_CANVAS_GROUP_SIZES = [5, 3] as const;

const CANVAS_GROUP_TOPS = [0.28, 0.54];
const CANVAS_CARDS_LEFT = 0.136;
const CANVAS_CARD_WIDTH = 0.078;
const CANVAS_CARD_GAP = 0.007;

/** 画布上第 group 组的组头。 */
export const scratchpadCanvasHeaderRect = (group: number): PonderRelativeRect => (
    { left: 0.13, right: 0.15, top: CANVAS_GROUP_TOPS[group], height: 0.034 }
);

/** 画布上第 group 组的第 slot 个卡位。卡片吸附在这些位置上。 */
export const scratchpadCanvasSlotRect = (group: number, slot: number): PonderRelativeRect => (
    { left: CANVAS_CARDS_LEFT + slot * (CANVAS_CARD_WIDTH + CANVAS_CARD_GAP), top: CANVAS_GROUP_TOPS[group] + 0.045, width: CANVAS_CARD_WIDTH, height: 0.147 }
);

/** 演示拖动的那一张：第一组的第三张拖到第一个位置。 */
export const SCRATCHPAD_DRAG = { group: 0, from: 2, to: 0 } as const;

/** 框选框住的：第二组的前两张。 */
export const SCRATCHPAD_SELECTED = { group: 1, slots: [0, 1] } as const;
