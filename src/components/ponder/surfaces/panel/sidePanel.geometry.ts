import type { PonderRelativeRect } from '../../../../types/ponder';

// src/components/ponder/surfaces/panel/sidePanel.geometry.ts
// sidePanel.surface.tsx 画的那几张合成界面的尺寸。坐标系一律是「所属容器的 0..1」。
// 界面用 relativeRectStyle 把一条记录翻成定位，教程的 relative 锚点原样引用同一条记录：
// 两边各写一遍百分比必然走散，高亮框就会落在画出来的元素旁边。

/**
 * 右侧展开的控制面板，坐标系是面板自身。
 *
 * 真实面板宽 360，从上到下是：这首歌、当前这一页的内容、最底下一排标签。
 * 封面页上「这首歌」就是整块面板：大封面、歌名歌手专辑、一行动作，没有别的内容；
 * 换到别的页，它收成顶上 48 高的一行，中间才是那一页的内容。
 *
 * 真实面板的高度跟着内容走（封面页 512，控制页 599）；这里画成一个固定的 360 × 540
 * （见 sidePanelAnchor 的 aspect），下面的数是把真实尺寸按这个框换算来的：内边距 12。
 */
export const SIDE_PANEL_GEOMETRY = {
    /** 封面页：大封面，下面歌名、歌手、专辑三行，再下面一行动作。 */
    cover: { left: 0.033, right: 0.033, top: 0.022, square: true },
    credits: { left: 0.045, right: 0.045, top: 0.672, height: 0.085 },
    actions: { left: 0.033, right: 0.033, top: 0.80, height: 0.06 },
    /** 别的页：顶上那一行（小封面、歌名歌手、喜欢），下面是这一页的内容。 */
    header: { left: 0.033, right: 0.033, top: 0.022, height: 0.089 },
    body: { left: 0.033, right: 0.033, top: 0.15, bottom: 0.111 },
    /** 最底下那排标签，每一页都在。 */
    tabs: { left: 0.033, right: 0.033, bottom: 0.022, height: 0.067 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 最底下那排标签里的每一格，坐标系是这一排（SIDE_PANEL_GEOMETRY.tabs），次序就是画的次序。
 *
 * 画的是当前这首有来源时的那一排，五格：本地、Navidrome 和在线歌曲都会在封面后面多出来源那一格，
 * 平时看到的就是它。真实的那一排按名字的长短分宽度，所以「播放列表」那一格最宽。
 * 私人 FM 打开时第四格的名字换成「电台」，位置不动。
 */
export const SIDE_PANEL_TAB_CELLS = {
    cover: { left: 0.01, top: 0.1, width: 0.17, height: 0.8 },
    source: { left: 0.19, top: 0.1, width: 0.17, height: 0.8 },
    controls: { left: 0.37, top: 0.1, width: 0.17, height: 0.8 },
    queue: { left: 0.55, top: 0.1, width: 0.26, height: 0.8 },
    account: { left: 0.82, top: 0.1, width: 0.17, height: 0.8 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 封面页那一行动作，坐标系是这一行（SIDE_PANEL_GEOMETRY.actions）。
 *
 * 左边是喜欢、加入歌单，和写着「播放自哪里」的那一枚；右端是回到首页和设置。
 * 五件各是一个独立动作，所以各自一个锚点。
 */
export const SIDE_PANEL_COVER_ACTIONS = {
    like: { left: 0, top: 0, width: 0.095, height: 1 },
    addToPlaylist: { left: 0.113, top: 0, width: 0.095, height: 1 },
    playingFrom: { left: 0.226, top: 0, width: 0.36, height: 1 },
    home: { right: 0.113, top: 0, width: 0.095, height: 1 },
    settings: { right: 0, top: 0, width: 0.095, height: 1 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 来源那一页里的几块，坐标系是当前标签页内容区（body）。
 *
 * 本地、Navidrome、在线歌词三页共用这一组，从上到下：歌词、时间轴偏移、两颗按钮
 * （在线匹配、导入 / 导出歌词）、音频增益，最底下是这首歌的来历。
 */
export const SIDE_PANEL_SOURCE_PAGE = {
    lyrics: { left: 0, right: 0, top: 0.01, height: 0.09 },
    offset: { left: 0, right: 0, top: 0.13, height: 0.09 },
    matchButton: { left: 0, top: 0.26, width: 0.485, height: 0.09 },
    fileButton: { right: 0, top: 0.26, width: 0.485, height: 0.09 },
    gain: { left: 0, right: 0, top: 0.42, height: 0.12 },
    info: { left: 0, right: 0, top: 0.60, height: 0.14 },
    /** 按下「导入 / 导出歌词」之后弹出的歌词文件窗口：导入、导出这一首、批量导出三段。 */
    fileDialog: { left: 0.02, right: 0.02, top: 0.08, height: 0.72 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 控制页里那几块，坐标系是当前标签页内容区（body）。
 *
 * 歌词样式、背景类型那两行的中间那块要单独量：真实界面里它是一颗按钮 —— 点下去弹出
 * 一格可选的图，而两端那对箭头只换到相邻的一个。所以骨架里它必须是一块能被指住的区域。
 */
export const SIDE_PANEL_CONTROLS_PAGE = {
    volume: { left: 0, right: 0, top: 0.013, height: 0.061 },
    /** 三格：循环、智能过渡、音频效果器。 */
    soundTiles: { left: 0, right: 0, top: 0.103, height: 0.138 },
    /**
     * 一整行：上面是箭头和中间那颗按钮，下面是这个模式其余的小控件。画的是两行都有其余小控件的时候
     * （流光有分词开关，隐现有混合和叠加层）；一个模式没有的话，真实界面里那一行收起。
     */
    modeRowVisualizer: { left: 0, right: 0, top: 0.286, height: 0.183 },
    modeRowBackground: { left: 0, right: 0, top: 0.478, height: 0.183 },
    transparent: { left: 0, right: 0, top: 0.677, height: 0.06 },
    /** 主题来源那一行，以及最底下写着当前主题名的那一行。 */
    themeSource: { left: 0, right: 0, top: 0.808, height: 0.069 },
    themeName: { left: 0, right: 0, top: 0.91, height: 0.06 },
    /**
     * 中间那颗按钮的范围：左右各让开一个箭头，歌词样式那行右边还让开动画强度那一枚。
     * 下拉的小箭头跟在模式名后面，在它里面。
     */
    modeName: { left: 0.095, right: 0.238, top: 0.295, height: 0.096 },
    modeNameBackground: { left: 0.095, right: 0.095, top: 0.487, height: 0.096 },
    /** 歌词样式的动画强度：按钮右边、右箭头之前的那一枚。 */
    modeAside: { right: 0.095, top: 0.312, width: 0.131, height: 0.061 },
    /** 其余的小控件（分词开关、莫奈的布局、取色开关……）在按钮下面一行，和按钮里的小图左对齐。 */
    modeParams: { left: 0.113, right: 0.095, top: 0.404, height: 0.061 },
    modeParamsBackground: { left: 0.113, right: 0.095, top: 0.596, height: 0.061 },
    /**
     * 点开之后弹出来的那一格图，底部一条通往完整设置的出口。
     *
     * 起点压在那颗按钮**下面**：盖住被点开的那颗按钮的话，「点的是这里、掉下来的是它」
     * 就没了 —— 高亮也会落在一块看不见的元素上。真实界面里它也正好盖住按钮下面那行小控件。
     */
    modeList: { left: 0.02, right: 0.02, top: 0.40, bottom: 0.02 },
    modeListFooter: { left: 0.05, right: 0.05, bottom: 0.04, height: 0.085 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 队列页顶上那一行右端的两颗，坐标系是 body：铺成海报墙、打乱。
 * 单独量出来，是给「队列面板上也能打乱」那一章指过去。
 */
export const SIDE_PANEL_QUEUE_PAGE = {
    lattice: { right: 0.115, top: 0, width: 0.095, height: 0.08 },
    shuffle: { right: 0, top: 0, width: 0.095, height: 0.08 },
} satisfies Record<string, PonderRelativeRect>;

/**
 * 电台页里那几块，坐标系是 body。
 *
 * 私人 FM 打开时，队列那一格整格换成它：顶上一颗写着模式的按钮，下面一行是
 * 左端丢弃、中间上一首 / 播放 / 下一首、右端喜欢。没有队列，也就没有「接下来是什么」。
 */
export const SIDE_PANEL_FM_PAGE = {
    modeChip: { left: 0, right: 0, top: 0.02, height: 0.10 },
    discard: { left: 0, top: 0.20, width: 0.12, height: 0.10 },
    transport: { left: 0.2, right: 0.2, top: 0.185, height: 0.13 },
    like: { right: 0, top: 0.20, width: 0.12, height: 0.10 },
} satisfies Record<string, PonderRelativeRect>;
