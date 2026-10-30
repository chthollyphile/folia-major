// src/components/visualizer/machi/scenes/konbini/layout.ts
// 便利店街角的尺寸表（米，原点在底座中心，y 向上，+z 是前、+x 是右）。几何、灯、天气、招牌、镜头都按这里摆，
// 改一处尺寸不用到处找。人体尺度按真实（门 2.1m、货架 1.5m、冰柜 2m、贩卖机 1.8m），店面按微缩压缩。

export const DEG = Math.PI / 180;

/** 底座：12m 见方、0.6m 厚，顶面就是路面。 */
export const BASE = { half: 6, depth: 0.6, radius: 0.12 } as const;

/** 各层地面的高度。 */
export const LEVEL = {
    road: 0,
    lot: 0.12,
    floor: 0.16,
} as const;

/** 两条路：前面（+z）一条沿 x，右面（+x）一条沿 z，在前右角相交；路外侧各有一条窄人行道到底座边。 */
export const ROAD = {
    inner: 2.2,
    outer: 5.5,
    curbWidth: 0.16,
    edgeLineInset: 0.24,
} as const;

/** 便利店：占后左象限；前面、右面前段是落地玻璃，右面后段和后墙、左墙是实墙。 */
export const STORE = {
    x0: -5.4,
    x1: 0.8,
    z0: -5.4,
    z1: 0.4,
    wall: 0.18,
    wallHeight: 3.2,
    roofTop: 3.42,
    parapetTop: 3.62,
    overhang: 0.12,
    /** 右面玻璃到这里为止，往后是实墙（后场、贩卖机靠着它）。 */
    rightGlassEnd: -2.6,
    /** 前面左端的实墙垛。 */
    frontPillarEnd: -4.6,
    glassBottom: 0.24,
    glassTop: 2.5,
} as const;

/** 自动门（前面靠右，两扇对开）。 */
export const DOOR = {
    x0: -1.3,
    x1: 0.5,
    height: 2.2,
    panelWidth: 0.92,
    slide: 0.86,
} as const;

/** 店招带：绕前面与右面一圈，挂在玻璃上沿与屋顶之间。 */
export const FASCIA = {
    y0: 2.6,
    y1: 3.28,
    depth: 0.16,
} as const;

/** 屋顶的三面广告塔：三角柱，一面正对默认视线，另两面在 ±120°；转到限角边上时侧面接手。 */
export const BOARD = {
    cx: -2.2,
    cz: -2.65,
    faceWidth: 5.6,
    faceHeight: 2.3,
    y0: 4.0,
    /** 正面法线的方位角（与默认镜头一致）。 */
    azimuth: 45 * DEG,
} as const;

/** 默认视角：从前右斜俯视（方位角按 three 的球坐标，从 +z 转向 +x）；整座底座框进去是缩放 1，默认再拉近一些。 */
export const KONBINI_VIEW = {
    azimuth: 45 * DEG,
    elevation: 31 * DEG,
    zoom: 1.58,
} as const;

/** 道具的位置。 */
export const PROPS = {
    utilityPole: { x: -5.3, z: 1.96, height: 7.6 },
    streetLamp: { x: 5.74, z: -1.2, height: 5.2, arm: 1.3 },
    pylon: { x: 1.62, z: -5.4, height: 4.6 },
    curveMirror: { x: -1.2, z: 5.74, height: 2.7 },
    stopSign: { x: 1.95, z: 5.74, height: 2.4 },
    vending: { x: 0.82, z: [-3.25, -4.3] as const, width: 1.0, depth: 0.74, height: 1.83 },
    bikeSlots: [{ x: -4.5, z: 1.32 }, { x: -2.85, z: 1.36 }] as const,
    trash: { x: -3.55, z: 0.68 },
    umbrellaStand: { x: -1.62, z: 0.68 },
    aFrame: { x: 0.95, z: 1.15 },
    groundAc: { x: -5.7, z: [-2.0, -3.1] as const },
    roofAc: [{ x: -0.1, z: -4.75 }, { x: -4.85, z: -0.35 }] as const,
} as const;

/** 底座顶面上，雨能落到的高度：店顶上是屋顶，店外是地面（路面或人行道）。 */
export const groundHeightAt = (x: number, z: number) => {
    if (x >= STORE.x0 - STORE.overhang && x <= STORE.x1 + STORE.overhang && z >= STORE.z0 - STORE.overhang && z <= STORE.z1 + STORE.overhang) {
        return STORE.roofTop;
    }
    const onRoad = (x > ROAD.inner && x < ROAD.outer) || (z > ROAD.inner && z < ROAD.outer);
    return onRoad ? LEVEL.road : LEVEL.lot;
};
