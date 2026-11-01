import { createVisualizerRng } from '../../../visualizerSeedHash';

// src/components/visualizer/machi/scenes/konbini/konbiniSeed.ts
// 便利店按歌变的小东西：同一首歌每次都一样，换一首歌街角就换个样子（车停在哪、有没有第二辆、伞、海报版式、
// 风向、水洼的位置、开门的节奏）。只依赖 seed，不碰 three。

export interface KonbiniVariation {
    /** 第一辆自行车的车位（0 靠左、1 靠门），以及有没有第二辆。 */
    bikeSlot: 0 | 1;
    secondBike: boolean;
    /** 自行车朝向的轻微偏角（弧度）。 */
    bikeYaw: number;
    /** 门口伞架里有没有伞、地上有没有一把撑开晾着的伞。 */
    umbrellaInStand: boolean;
    openUmbrella: boolean;
    /** 玻璃海报版式 0..2。 */
    posterLayout: number;
    /** 雨的风向偏角（弧度，绕 y）与倾斜量（每米下落的水平位移）。 */
    windYaw: number;
    windSlant: number;
    /** 水洼噪声的平移，让每首歌的水洼长在不同地方。 */
    puddleOffset: [number, number];
    /** 水洼覆盖量 0..1。 */
    puddleAmount: number;
    /** 间奏里偶尔开门的相位与间隔（秒）。 */
    doorPhase: number;
    doorInterval: number;
    /** 空调外机风扇转速（圈 / 秒）。 */
    fanSpeed: number;
    /** 商品摆放的打乱种子。 */
    shelfSeed: number;
}

/** seed → 这首歌的街角变化。 */
export const resolveKonbiniVariation = (seed: string | number): KonbiniVariation => {
    const random = createVisualizerRng(`machi:${seed}`);
    const pick = (min: number, max: number) => min + (max - min) * random();
    return {
        bikeSlot: random() < 0.5 ? 0 : 1,
        secondBike: random() < 0.45,
        bikeYaw: pick(-0.12, 0.12),
        umbrellaInStand: random() < 0.75,
        openUmbrella: random() < 0.35,
        posterLayout: Math.floor(random() * 3),
        windYaw: pick(-0.6, 0.6),
        windSlant: pick(0.06, 0.2),
        puddleOffset: [pick(-40, 40), pick(-40, 40)],
        puddleAmount: pick(0.45, 0.75),
        doorPhase: pick(0, 1),
        doorInterval: pick(22, 40),
        fanSpeed: pick(1.6, 3.2),
        shelfSeed: Math.floor(random() * 0xffffffff),
    };
};
