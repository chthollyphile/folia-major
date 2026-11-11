// src/components/visualizer/pendolo/pendoloParallax.ts
// 时计的分层视差：表盘倾斜时，每一层按自己离表盘平面的高度浮起来（pendoloDialProjection.ts 的
// buildPendoloLayerProjection 和着色器里同一个公式），近的层错开得多。高度按轮盘半径的比例给，
// 再乘「分层视差」的强度。不倾斜时高度不起作用，画面和原来一样。

/** 表盘平面上的东西：中心渐变、封面、外圈刻度环。 */
const DIAL_FACE = 0;

/** 几根轴上最上面那层齿轮的顶面高度（轮盘半径的比例）；中心环和宝石跟着它们。行星轮、惰轮的宝石按前缀和齿轮同高。 */
const MAIN_SUN_TOP = 0.09;
const SECOND_TOP = 0.1;
const TRANS_TOP = 0.14;
/** 摆轮（最高的齿轮）顶面的高度。 */
const PENDOLO_BALANCE_TOP = 0.2;

/** 网格各部件离表盘平面的高度（轮盘半径的比例）；按 pendoloClockworkMeshes 里 pushPart 的 key 前缀找。 */
const PART_HEIGHTS: Array<[prefix: string, height: number]> = [
    ['main-static', DIAL_FACE],
    // 各齿轮中心的环和宝石都和那根轴上最上面一层齿轮同高：高低不一时倾斜下各自往不同方向挪，
    // 看着不在齿轮正中。同高也不会被齿轮自己的面挡住（遮挡面那一遍往下压了一点）
    ['main-jewel', MAIN_SUN_TOP],
    ['main-ticks', 0.02],
    ['main-esc', 0.05],
    ['main-sun', MAIN_SUN_TOP],
    ['idler', 0.08],
    ['second-spin', SECOND_TOP],
    ['second-spoke', SECOND_TOP],
    ['second-jewel', SECOND_TOP],
    ['planet-', 0.11],
    ['trans-spin', TRANS_TOP],
    ['trans-jewel', TRANS_TOP],
    // 游丝和摆轮上的图标也和摆轮顶面同高
    ['balance-static', PENDOLO_BALANCE_TOP],
    ['balance-gear', PENDOLO_BALANCE_TOP],
    ['hairspring', PENDOLO_BALANCE_TOP],
    // 刻度针（焦点轴）指着焦点句，和歌词在同一层，略高于主轮，倾斜时一起浮起来
    ['axis', 0.1],
];

/**
 * 歌词弧线那一层：和刻度针同高，针尖始终指着焦点句。只略高于主轮：浮得太高（之前 0.28），
 * 倾斜加上视差强度后整层会被甩离表盘，看起来错位。
 */
export const PENDOLO_LYRIC_LAYER_HEIGHT = 0.1;
/** 摆轮上的主题图标：和摆轮顶面同高，倾斜时才正好落在摆轮中心。 */
export const PENDOLO_BALANCE_ICON_HEIGHT = PENDOLO_BALANCE_TOP;
/** 随拍的叠加层（刻度点亮、宝石闪光、火花）：贴着刻度。 */
export const PENDOLO_BEAT_OVERLAY_HEIGHT = 0.02;

/** 齿轮的厚度（轮盘半径的比例）：低处线比高处线低这么多，不低于表盘平面。0.05 时小齿轮显得太厚。 */
export const PENDOLO_GEAR_THICKNESS = 0.025;

/** 部件 key 加上它，就是这个齿轮的低处线（齿轮底面那圈齿形）。 */
export const PENDOLO_PART_BASE_SUFFIX = '#base';

/** 一个网格部件的高度（轮盘半径的比例）；没登记的部件留在表盘平面上。 */
export const resolvePendoloPartHeight = (partKey: string): number => {
    if (partKey.endsWith(PENDOLO_PART_BASE_SUFFIX)) {
        const top = resolvePendoloPartHeight(partKey.slice(0, -PENDOLO_PART_BASE_SUFFIX.length));
        return Math.max(0, top - PENDOLO_GEAR_THICKNESS);
    }
    for (const [prefix, height] of PART_HEIGHTS) {
        if (partKey.startsWith(prefix)) return height;
    }
    return DIAL_FACE;
};
