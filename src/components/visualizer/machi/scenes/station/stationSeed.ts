import { createVisualizerRng } from '../../../visualizerSeedHash';

// src/components/visualizer/machi/scenes/station/stationSeed.ts
// 加油站停车场按歌变的东西（只依赖 seed，不碰 three）：三个车位停什么（至少一辆出租车）、车身颜色、出租车公司的配色、
// 加油机旁和空地上有没有车、哪辆车打双闪、风向、水洼。

export type StationStall = 'taxi' | 'sedan' | 'empty';

export interface StationVariation {
    stalls: StationStall[];
    /** 轿车、加油机旁的车、轻卡的颜色序号（在场景的车色表里取）。 */
    carColors: number[];
    pumpColor: number;
    keiColor: number;
    taxiLivery: number;
    pumpCar: boolean;
    keiTruck: boolean;
    /** 打双闪的车位（-1 是没有）。 */
    hazardStall: number;
    windYaw: number;
    windSlant: number;
    puddleOffset: [number, number];
    puddleAmount: number;
}

const STALL_PATTERNS: StationStall[][] = [
    ['taxi', 'sedan', 'taxi'],
    ['sedan', 'taxi', 'taxi'],
    ['taxi', 'taxi', 'sedan'],
    ['taxi', 'empty', 'taxi'],
    ['sedan', 'taxi', 'empty'],
    ['empty', 'taxi', 'sedan'],
];

export const resolveStationVariation = (seed: string | number, colorCount: number, liveryCount: number): StationVariation => {
    const random = createVisualizerRng(`station:${seed}`);
    const pick = (min: number, max: number) => min + (max - min) * random();
    const stalls = STALL_PATTERNS[Math.floor(random() * STALL_PATTERNS.length)]!;
    const occupied = stalls.map((kind, index) => (kind === 'sedan' ? index : -1)).filter(index => index >= 0);
    return {
        stalls,
        carColors: stalls.map(() => Math.floor(random() * colorCount)),
        pumpColor: Math.floor(random() * colorCount),
        keiColor: Math.floor(random() * colorCount),
        taxiLivery: Math.floor(random() * liveryCount),
        pumpCar: random() < 0.7,
        keiTruck: random() < 0.6,
        hazardStall: occupied.length && random() < 0.75 ? occupied[Math.floor(random() * occupied.length)]! : -1,
        windYaw: pick(-0.6, 0.6),
        windSlant: pick(0.06, 0.2),
        puddleOffset: [pick(-40, 40), pick(-40, 40)],
        puddleAmount: pick(0.45, 0.75),
    };
};
