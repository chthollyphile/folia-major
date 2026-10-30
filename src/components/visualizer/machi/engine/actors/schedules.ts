import { hashVisualizerSeed, visualizerHash01 } from '../../../visualizerSeedHash';

// src/components/visualizer/machi/engine/actors/schedules.ts
// 路上偶尔开过的车（纯函数，只依赖氛围时间与 seed）：按时间切成窗口，每个窗口按哈希决定有没有一辆车、
// 走哪条车道、什么颜色；同时最多一辆。车道由场景给，两端伸出底座，车由裁切面从底座边缘“开出来”。

export interface MachiLane {
    from: readonly [x: number, z: number];
    to: readonly [x: number, z: number];
}

/** 车速（米/秒，约 23 km/h：住宅区里的车速）。 */
export const MACHI_CAR_SPEED = 6.5;
const CAR_WINDOW = 9.5;

export interface MachiCarPass {
    lane: number;
    /** 沿车道走过的米数。 */
    distance: number;
    colorIndex: number;
}

const laneLength = (lane: MachiLane) => Math.hypot(lane.to[0] - lane.from[0], lane.to[1] - lane.from[1]);

/** 时刻 time（氛围时钟）路上的车：没有就是 null。chance 是每个窗口有车的概率。 */
export const resolveMachiCar = (time: number, seed: string | number, lanes: readonly MachiLane[], chance = 0.62): MachiCarPass | null => {
    if (lanes.length === 0) return null;
    const key = hashVisualizerSeed(`car:${seed}`);
    const window = Math.floor(time / CAR_WINDOW);
    // 一辆车可能跨进下一个窗口：先看上一个窗口的车有没有开完。
    for (const index of [window, window - 1]) {
        if (visualizerHash01(key, index, 0x11) > chance) continue;
        const start = index * CAR_WINDOW + visualizerHash01(key, index, 0x22) * (CAR_WINDOW * 0.5);
        const local = time - start;
        const lane = Math.floor(visualizerHash01(key, index, 0x33) * lanes.length);
        if (local < 0 || local > laneLength(lanes[lane]!) / MACHI_CAR_SPEED) continue;
        return {
            lane,
            distance: local * MACHI_CAR_SPEED,
            colorIndex: Math.floor(visualizerHash01(key, index, 0x44) * 1000),
        };
    }
    return null;
};
