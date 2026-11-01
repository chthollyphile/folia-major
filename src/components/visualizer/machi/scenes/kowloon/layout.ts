// src/components/visualizer/machi/scenes/kowloon/layout.ts
// 城寨酒吧的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。左边一排、后排一排高低错落的城寨楼（L 形），
// 前右是一条湿巷子；后排正中一楼是酒吧，楼面上挂着歌词大屏；左边楼面伸出一串霓虹招牌，悬在巷子上空。
// 默认镜头从前右看过来，离镜头最远的是后左角：那里的楼投到画面里最高，所以后左角不比别处高多少。
// 高的东西都在左边和后排，前右只有矮的大排档和电线杆，挡不到酒吧和大屏。

export const DEG = Math.PI / 180;

/** 巷子地面、酒吧地板。 */
export const LEVEL = {
    ground: 0.02,
    floor: 0.06,
} as const;

/** 楼层：一楼是铺面，往上每层 1m（微缩里压扁一点，楼才显得密）。 */
export const FLOORS = {
    ground: 3.0,
    height: 1.0,
} as const;

export interface KowloonBlock {
    name: string;
    x0: number;
    x1: number;
    z0: number;
    z1: number;
    height: number;
    /** 外墙的颜色键。 */
    wall: string;
    /** 一楼掏空的一块（酒吧）：x0..x1、从后面 z0 到楼的前面、高到 y1。 */
    hollow?: { x0: number; x1: number; z0: number; y1: number };
}

/** 楼：左边一排（L0–L5，一栋栋窄楼，进深与高低都错开，越往前越矮），后排一排（B0–B2，B1 是酒吧和大屏）。 */
export const BLOCKS: readonly KowloonBlock[] = [
    { name: 'L0', x0: -6, x1: -3.0, z0: -6, z1: -1.8, height: 6.9, wall: 'wallA' },
    { name: 'L1', x0: -6, x1: -3.35, z0: -1.8, z1: -0.2, height: 7.3, wall: 'wallB' },
    { name: 'L2', x0: -6, x1: -3.6, z0: -0.2, z1: 1.3, height: 6.6, wall: 'wallD' },
    { name: 'L3', x0: -6, x1: -3.2, z0: 1.3, z1: 2.9, height: 6.2, wall: 'wallC' },
    { name: 'L4', x0: -6, x1: -3.45, z0: 2.9, z1: 4.5, height: 5.2, wall: 'wallE' },
    { name: 'L5', x0: -6, x1: -3.75, z0: 4.5, z1: 6, height: 4.0, wall: 'wallD' },
    { name: 'B0', x0: -3.0, x1: -1.6, z0: -6, z1: -1.8, height: 6.4, wall: 'wallE' },
    { name: 'B0b', x0: -1.6, x1: -0.3, z0: -6, z1: -2.05, height: 7.0, wall: 'wallC' },
    { name: 'B1', x0: -0.3, x1: 4.5, z0: -6, z1: -1.5, height: 6.2, wall: 'wallA', hollow: { x0: -0.1, x1: 4.3, z0: -4.2, y1: 2.95 } },
    { name: 'B2', x0: 4.5, x1: 6, z0: -6, z1: -2.3, height: 5.4, wall: 'wallB' },
];

/** 左排楼在 z 处的楼面（x）。 */
export const leftFaceAt = (z: number) => {
    const block = BLOCKS.find(candidate => candidate.name.startsWith('L') && z >= candidate.z0 && z < candidate.z1);
    return block ? block.x1 : -3.4;
};

/** 酒吧：B1 的一楼，玻璃门面略往里收，右边一扇门。 */
export const BAR = {
    x0: -0.1,
    x1: 4.3,
    front: -1.5,
    glass: -1.62,
    back: -4.2,
    ceiling: 2.95,
    door: [3.3, 4.2] as const,
    counter: { x0: 0.2, x1: 3.0, z0: -3.4, z1: -2.85, height: 1.05 },
} as const;

/** 酒吧门头的霓虹店招（曲名）、屏幕下沿的 LED 跑马灯、歌词大屏（面的中心与尺寸，朝 +z）。 */
export const BAR_SIGN = { x: 2.1, y: 2.68, z: -1.38, width: 3.9, height: 0.46 } as const;
export const TICKER = { x: 2.1, y: 3.09, z: -1.41, width: 4.2, height: 0.17 } as const;
export const SCREEN = { x: 2.1, y: 4.22, z: -1.38, width: 4.2, height: 1.8 } as const;

/**
 * 伸出楼面的招牌：从墙面（wall）伸到 tip，底 y0、顶 y1，板面中心在 z（左排楼伸出来的朝 +z），
 * 或在 x（后排楼伸出来的朝 +x）。竖的写竖排字。role 是写什么：artist 写歌手，其余是店名。
 */
export interface KowloonHangingSign {
    axis: 'x' | 'z';
    wall: number;
    tip: number;
    y0: number;
    y1: number;
    at: number;
    vertical: boolean;
    role: 'artist' | 'shop';
}

export const HANGING_SIGNS: readonly KowloonHangingSign[] = [
    { axis: 'x', wall: -3.45, tip: -2.65, y0: 2.95, y1: 4.75, at: 3.65, vertical: true, role: 'artist' },
    { axis: 'x', wall: -3.6, tip: -1.35, y0: 5.15, y1: 5.95, at: 0.55, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.35, tip: -2.67, y0: 3.3, y1: 5.5, at: -0.85, vertical: true, role: 'shop' },
    { axis: 'x', wall: -3.2, tip: -1.45, y0: 3.45, y1: 4.2, at: 2.25, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.2, tip: -1.95, y0: 4.45, y1: 5.05, at: 1.5, vertical: false, role: 'shop' },
    { axis: 'x', wall: -3.75, tip: -3.1, y0: 2.6, y1: 3.75, at: 5.25, vertical: true, role: 'shop' },
    { axis: 'z', wall: -2.05, tip: -1.3, y0: 3.4, y1: 5.7, at: -0.72, vertical: true, role: 'shop' },
    { axis: 'z', wall: -1.8, tip: -1.25, y0: 4.0, y1: 5.5, at: -2.2, vertical: true, role: 'shop' },
];

/** 招牌的板厚。 */
export const SIGN_DEPTH = 0.16;

/** B1 楼顶的大霓虹广告架（「九龍城寨」），在歌词屏正上方。 */
export const ROOF_BILLBOARD = { x0: -0.05, x1: 2.45, z: -2.15, y0: 6.6, y1: 7.5 } as const;

/** 全息投影：巷子里一台地上的投影机，往上投一块转向镜头的面板（下一句）。 */
export const HOLOGRAM = { x: 0.9, z: 2.3, y: 3.0, width: 3.0, height: 1.1, rotationY: 30 * DEG } as const;

/** 大排档：右前一个绿铁皮档口（柜台朝 +z），前面一张折台与几张塑料凳。 */
export const STALL = { x0: 4.1, x1: 5.85, z0: 1.3, z1: 2.25, counter: 1.0, back: 2.1, canopy: 2.35 } as const;
export const STALL_TABLE = { x: 4.85, z: 3.25 } as const;

/** 电线杆：B2 门前，顶上横担拉出一把电线，伸一盏街灯照巷子。 */
export const POLE = { x: 5.55, z: -1.15, height: 7.0, lampArm: 1.25, lampY: 5.05 } as const;

/** 贩卖机：B2 门前。 */
export const VENDING = { x: 4.95, z: -1.95 } as const;

/** 默认视角：从前右斜俯视。 */
export const KOWLOON_VIEW = {
    azimuth: 30 * DEG,
    elevation: 30 * DEG,
    zoom: 1.55,
} as const;
