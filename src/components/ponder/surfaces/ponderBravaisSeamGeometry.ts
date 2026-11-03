import type { PonderRelativeRect, PonderViewportRect } from '../../../types/ponder';

// src/components/ponder/surfaces/ponderBravaisSeamGeometry.ts
// bravais 信息条（缝）教程的几何表：PonderBravaisSeamSurface 和 bravaisSeam.target.ts 共用同一组数，
// 理由同 ponderSurfaceGeometry —— 两边各写一份百分比，高亮就会落在真实元素旁边。
//
// 单独成文件而不并进 ponderSurfaceGeometry：缝这一篇和「墙」那一篇（bravais-wall）是分头写的，
// 各管各的几何表，合并时不在同一个文件里抢行。
//
// 坐标系与 ponderSurfaceGeometry 相同：「所属容器的 0..1」。page 是整块合成界面；缝里的东西相对各自那一档的缝。
// 宽度按真实比例取：页面约 1066px 宽（1440 视口的 74%）时，首页窄缝 120px ≈ 0.12、完整信息条 300px ≈ 0.28、
// 书脊 64px ≈ 0.06、列表面板 420px ≈ 0.40。

/** 合成界面在视口里的位置。与 Lattice / 网格页教程同一块，切教程时画面不跳。 */
export const BRAVAIS_SEAM_PAGE_RECT: PonderViewportRect = { left: 0.5, top: 0.11, width: 0.74, height: 0.64, anchorX: 'center' };

/** 各档缝在 page 里的宽度。 */
export const BRAVAIS_SEAM_WIDTHS = {
    home: 0.12,
    full: 0.28,
    spine: 0.06,
    panel: 0.40,
    hidden: 0,
} as const;

export type BravaisSeamWidthKey = keyof typeof BRAVAIS_SEAM_WIDTHS;

/** 缝与相邻磁贴之间、磁贴与磁贴之间的空隙（page 宽度的比例）。真实实现里两者相等（GAP × scale）。 */
export const BRAVAIS_WALL_GAP_X = 0.007;
export const BRAVAIS_WALL_GAP_Y = 0.011;
/** 墙上一格的宽高（page 比例）。高度按 1066 × 704 的页面算成像素意义上的正方形。 */
export const BRAVAIS_WALL_UNIT_X = 0.1;
export const BRAVAIS_WALL_UNIT_Y = 0.152;

/** 一档缝在 page 里的矩形：竖着贯穿整页，以中线为轴。 */
export const bravaisSeamRect = (key: BravaisSeamWidthKey): PonderRelativeRect => {
    const width = BRAVAIS_SEAM_WIDTHS[key];
    return { left: 0.5 - width / 2, width, top: 0, bottom: 0 };
};

/**
 * 半面墙上的磁贴，单位是格：c 是从缝边往外数第几列，r 是第几行，w/h 是占几格。
 * 两半各用一份图案，左右不对称，读起来才像一面墙而不是镜像。kind 决定画成内容磁贴还是墙面留白。
 */
export type BravaisWallTile = { c: number; r: number; w: number; h: number; accent?: boolean };

export const BRAVAIS_WALL_RIGHT: readonly BravaisWallTile[] = [
    { c: 0, r: 0, w: 2, h: 2, accent: true },
    { c: 2, r: 0, w: 1, h: 1 },
    { c: 3, r: 0, w: 1, h: 1 },
    { c: 4, r: 0, w: 1, h: 2 },
    { c: 2, r: 1, w: 2, h: 1 },
    { c: 0, r: 2, w: 1, h: 1 },
    { c: 1, r: 2, w: 1, h: 2 },
    { c: 2, r: 2, w: 2, h: 2, accent: true },
    { c: 4, r: 2, w: 1, h: 1 },
    { c: 0, r: 3, w: 1, h: 1 },
    { c: 4, r: 3, w: 1, h: 2 },
    { c: 0, r: 4, w: 2, h: 2 },
    { c: 2, r: 4, w: 1, h: 1 },
    { c: 3, r: 4, w: 1, h: 1 },
    { c: 2, r: 5, w: 2, h: 2 },
    { c: 4, r: 5, w: 1, h: 2 },
    { c: 0, r: 6, w: 1, h: 1 },
    { c: 1, r: 6, w: 1, h: 1 },
];

export const BRAVAIS_WALL_LEFT: readonly BravaisWallTile[] = [
    { c: 0, r: 0, w: 1, h: 1 },
    { c: 1, r: 0, w: 1, h: 1 },
    { c: 2, r: 0, w: 2, h: 2 },
    { c: 4, r: 0, w: 1, h: 1 },
    { c: 0, r: 1, w: 2, h: 2 },
    { c: 4, r: 1, w: 1, h: 2 },
    { c: 2, r: 2, w: 1, h: 1, accent: true },
    { c: 3, r: 2, w: 1, h: 1 },
    { c: 0, r: 3, w: 1, h: 1 },
    { c: 1, r: 3, w: 2, h: 2 },
    { c: 3, r: 3, w: 2, h: 2 },
    { c: 0, r: 4, w: 1, h: 2, accent: true },
    { c: 1, r: 5, w: 1, h: 1 },
    { c: 2, r: 5, w: 2, h: 2 },
    { c: 4, r: 5, w: 1, h: 1 },
    { c: 1, r: 6, w: 1, h: 1 },
    { c: 4, r: 6, w: 1, h: 1 },
];

/** 第一行往上探出去一点，墙看起来是无限往上下延伸的，而不是从页面顶边开始码。 */
const WALL_TOP_OFFSET = -0.045;

/**
 * 一张磁贴在 page 里的矩形。side 决定从缝的哪一边往外排：缝变宽时两半墙各自往外让，
 * 磁贴本身的尺寸不变 —— 和真实的「墙两半各自滑开」一致，而不是把磁贴挤窄。
 */
export const bravaisWallTileRect = (
    tile: BravaisWallTile,
    side: 'left' | 'right',
    seamWidth: number,
): PonderRelativeRect => {
    const edge = side === 'right' ? 0.5 + seamWidth / 2 + BRAVAIS_WALL_GAP_X : 0.5 - seamWidth / 2 - BRAVAIS_WALL_GAP_X;
    const width = tile.w * BRAVAIS_WALL_UNIT_X - BRAVAIS_WALL_GAP_X;
    const height = tile.h * BRAVAIS_WALL_UNIT_Y - BRAVAIS_WALL_GAP_Y;
    const offset = tile.c * BRAVAIS_WALL_UNIT_X;
    return {
        left: side === 'right' ? edge + offset : edge - offset - width,
        top: WALL_TOP_OFFSET + tile.r * BRAVAIS_WALL_UNIT_Y,
        width,
        height,
    };
};

/** 首页窄缝（120px）里的各块，相对首页窄缝。从上到下：书库、折叠、页签、中段（二级切换 / 直达）、账户、工具格。 */
const homeTab = (index: number): PonderRelativeRect => ({ left: 0.3, width: 0.4, top: 0.118 + index * 0.07, height: 0.062 });

/** 工具格（搜索、设置 / 队列、⋯）与它上面的账户入口。舞台开着时工具格顶上多一整行，账户入口跟着上移。 */
const homeDock = (stage: boolean) => {
    const toolsTop = stage ? 0.80 : 0.868;
    return {
        stageRow: { left: 0.14, right: 0.14, top: 0.80, height: 0.055 },
        tools: { left: 0.1, right: 0.1, top: toolsTop - 0.008, bottom: 0.008 },
        search: { left: 0.14, top: stage ? 0.868 : toolsTop, width: 0.32, square: true },
        settings: { left: 0.54, top: stage ? 0.868 : toolsTop, width: 0.32, square: true },
        queue: { left: 0.14, top: stage ? 0.93 : toolsTop + 0.062, width: 0.32, square: true },
        more: { left: 0.54, top: stage ? 0.93 : toolsTop + 0.062, width: 0.32, square: true },
        account: { left: 0.1, right: 0.1, top: stage ? 0.715 : 0.782, height: 0.072 },
    } satisfies Record<string, PonderRelativeRect>;
};

export const BRAVAIS_HOME_DOCK = homeDock(false);
export const BRAVAIS_HOME_DOCK_STAGE = homeDock(true);

export const BRAVAIS_HOME_SEAM_GEOMETRY = {
    title: { left: 0.3, width: 0.4, top: 0.028, height: 0.022 },
    fold: { left: 0.38, top: 0.066, width: 0.24, square: true },
    tabs: { left: 0.26, right: 0.26, top: 0.112, height: 0.356 },
    /** 五个一级页签：歌单、电台、专辑、本地、Navidrome。 */
    tab: [homeTab(0), homeTab(1), homeTab(2), homeTab(3), homeTab(4)],
    /** 二级切换（本地四行）：激活那一项写出竖排文字，其余只有图标。 */
    sections: { left: 0.3, width: 0.4, top: 0.482, height: 0.18 },
    /** 直达入口：并排的两列竖排小字，上面一道短分隔线（有二级切换时）。 */
    shortcuts: { left: 0.22, right: 0.22, top: 0.672, height: 0.1 },
    /** 过滤输入位：只在正在输入或有过滤词时出现，在导航区与账户入口之间。 */
    filter: { left: 0.07, right: 0.07, top: 0.728, height: 0.045 },
    /** 过滤中，直达入口被输入位往上顶。 */
    shortcutsFiltering: { left: 0.22, right: 0.22, top: 0.612, height: 0.1 },
    /** 「⋯」菜单：从工具格上方弹出。 */
    menuPopup: { left: 0.035, right: 0.035, top: 0.6, height: 0.255 },
} satisfies Record<string, PonderRelativeRect | PonderRelativeRect[]>;

/** 首页的搜索态：缝展开成完整宽度（300px），相对那一档的缝。 */
export const BRAVAIS_SEARCH_SEAM_GEOMETRY = {
    crumbs: { left: 0.07, right: 0.07, top: 0.028, height: 0.03 },
    box: { left: 0.07, right: 0.07, top: 0.085, height: 0.058 },
    hint: { left: 0.07, right: 0.07, top: 0.162, height: 0.05 },
    submit: { left: 0.07, top: 0.232, width: 0.38, height: 0.052 },
} satisfies Record<string, PonderRelativeRect>;

/** 集合层的完整信息条（300px），相对那一档的缝。 */
export const BRAVAIS_STRIP_GEOMETRY = {
    /** ‹ 与面包屑那一行。 */
    crumbs: { left: 0.06, right: 0.06, top: 0.02, height: 0.045 },
    filter: { left: 0.06, right: 0.06, top: 0.08, height: 0.045 },
    title: { left: 0.04, right: 0.04, top: 0.142, height: 0.48 },
    meta: { left: 0.06, top: 0.652, width: 0.14, height: 0.022 },
    about: { left: 0.06, right: 0.06, top: 0.69, height: 0.085 },
    actions: { left: 0.06, right: 0.06, top: 0.79, height: 0.052 },
    star: { right: 0.06, top: 0.79, width: 0.1, height: 0.052 },
    list: { left: 0.06, top: 0.862, width: 0.27, height: 0.046 },
    more: { left: 0.36, top: 0.862, width: 0.27, height: 0.046 },
    /** 「⋯ 更多」：悬浮在按钮行上方，最后一项是「折叠信息条」。 */
    menu: { left: 0.06, width: 0.6, top: 0.575, height: 0.275 },
    menuFold: { left: 0.06, width: 0.6, top: 0.795, height: 0.05 },
} satisfies Record<string, PonderRelativeRect>;

/** 书脊（64px），相对那一档的缝。 */
export const BRAVAIS_SPINE_GEOMETRY = {
    back: { left: 0.2, top: 0.024, width: 0.6, square: true },
    fold: { left: 0.2, top: 0.088, width: 0.6, square: true },
    title: { left: 0.18, right: 0.18, top: 0.16, height: 0.38 },
    count: { left: 0.3, right: 0.3, top: 0.56, height: 0.06 },
    play: { left: 0.2, top: 0.84, width: 0.6, square: true },
    expand: { left: 0.2, top: 0.905, width: 0.6, square: true },
} satisfies Record<string, PonderRelativeRect>;

/** 折叠之后屏幕侧边那枚竖排标签，相对 page。 */
export const BRAVAIS_EDGE_TAB: PonderRelativeRect = { left: 0, top: 0.3, width: 0.034, height: 0.34 };

/** 列表面板（420px），相对那一档的缝。 */
export const BRAVAIS_PANEL_GEOMETRY = {
    crumbs: { left: 0.05, right: 0.05, top: 0.02, height: 0.045 },
    heading: { left: 0.05, top: 0.085, width: 0.5, height: 0.04 },
    toolbar: { left: 0.05, right: 0.05, top: 0.14, height: 0.045 },
    rows: { left: 0.05, right: 0.05, top: 0.2, height: 0.62 },
    hoverRow: { left: 0.05, right: 0.05, top: 0.2 + 0.0775 * 2, height: 0.0775 },
    footer: { left: 0.05, right: 0.05, top: 0.86, height: 0.05 },
} satisfies Record<string, PonderRelativeRect>;

/** 列表里悬停那一行对应的墙上磁贴（右半面墙第一列第三行），相对 page。 */
export const BRAVAIS_PANEL_LINKED_TILE = { side: 'right' as const, index: 5 };

/** 右下角的墙面工具（与 Lattice 同一颗按钮），相对 page。面板里的各块相对面板。 */
export const BRAVAIS_TOOLS_GEOMETRY = {
    button: { right: 0.016, bottom: 0.03, width: 0.046, square: true },
    panel: { right: 0.016, bottom: 0.12, width: 0.3, height: 0.56 },
    quick: { left: 0.06, right: 0.06, top: 0.05, height: 0.19 },
    volume: { left: 0.06, right: 0.06, top: 0.29, height: 0.1 },
    appearance: { left: 0.06, right: 0.06, top: 0.45, height: 0.43 },
} satisfies Record<string, PonderRelativeRect>;
