// src/components/visualizer/pendolo/pendoloParallax.ts
// 时计的分层视差：表盘倾斜时，每一层按自己离表盘平面的高度浮起来（pendoloDialProjection.ts 的
// buildPendoloLayerProjection 和着色器里同一个公式），近的层错开得多。高度按轮盘半径的比例给，
// 再乘「分层视差」的强度。不倾斜时高度不起作用，画面和原来一样。

/** 表盘平面上的东西：中心渐变、封面、外圈刻度环。 */
const DIAL_FACE = 0;

/** 网格各部件离表盘平面的高度（轮盘半径的比例）；按 pendoloClockworkMeshes 里 pushPart 的 key 前缀找。 */
const PART_HEIGHTS: Array<[prefix: string, height: number]> = [
    ['main-static', DIAL_FACE],
    ['main-ticks', 0.02],
    ['main-esc', 0.05],
    ['main-sun', 0.09],
    ['idler', 0.08],
    ['second-spin', 0.1],
    ['second-spoke', 0.1],
    ['second-jewel', 0.12],
    ['planet-', 0.11],
    ['trans-spin', 0.14],
    ['trans-jewel', 0.16],
    ['balance-static', 0.18],
    ['balance-gear', 0.2],
    ['hairspring', 0.22],
    // 焦点轴指向歌词，和歌词在同一层
    ['axis', 0.28],
];

/** 歌词弧线那一层：浮在最上面。 */
export const PENDOLO_LYRIC_LAYER_HEIGHT = 0.28;
/** 摆轮上的主题图标：和游丝同高。 */
export const PENDOLO_BALANCE_ICON_HEIGHT = 0.22;
/** 随拍的叠加层（刻度点亮、宝石闪光、火花）：贴着刻度。 */
export const PENDOLO_BEAT_OVERLAY_HEIGHT = 0.02;

/** 一个网格部件的高度（轮盘半径的比例）；没登记的部件留在表盘平面上。 */
export const resolvePendoloPartHeight = (partKey: string): number => {
    for (const [prefix, height] of PART_HEIGHTS) {
        if (partKey.startsWith(prefix)) return height;
    }
    return DIAL_FACE;
};
