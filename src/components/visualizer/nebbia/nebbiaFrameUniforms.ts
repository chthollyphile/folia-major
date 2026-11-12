import { NEBBIA_FIXED } from './nebbiaConstants';
import type { NebbiaAquaUniforms, NebbiaUniforms } from './nebbiaGlUtils';
import type { NebbiaSpot } from './nebbiaSpot';
import type { NebbiaRain, NebbiaSceneryPart, NebbiaTuning } from './types';

// src/components/visualizer/nebbia/nebbiaFrameUniforms.ts
// 主着色器这一帧的 uniform（从 createNebbiaRuntime.ts 拆出）：tuning、车身颠簸的位移、聚光灯，W、H 是 CSS 像素。
// 聚光灯的光源：街景在远处楼底，水族箱在水面上方（画面上沿外），横向位置都按 spotX；水族箱跟拍时光斑半径乘 aqua.spotScale。

/** 窗外各样在 uScenery 里的位，和 nebbiaSceneGlsl.ts 的 SCN_* 一致；聚光灯不占位，关掉时强度给 0。 */
const SCENERY_BITS: Partial<Record<NebbiaSceneryPart, number>> = { buildings: 1, lights: 2, cars: 4, road: 8 };
/** 雨：下（16）、斜着落（32）。 */
const RAIN_BITS: Record<NebbiaRain, number> = { slant: 16 | 32, straight: 16, off: 0 };

export const nebbiaFrameUniforms = (
    t: NebbiaTuning, [sx, sy]: [number, number], spot: NebbiaSpot, W: number, H: number, time: number, aqua: NebbiaAquaUniforms | null = null,
): NebbiaUniforms => {
    const asp = W / H;
    const srcY = aqua ? -0.04 : 0.595;
    return {
        time,
        mist: t.mist, edge: NEBBIA_FIXED.edge, refract: NEBBIA_FIXED.refract, bus: t.busSpeed, glint: NEBBIA_FIXED.glint, neon: t.neon,
        glassShift: [-sx * 0.35 / W, -sy * 0.35 / H], sceneShift: [-sx / W, -sy / H],
        spotSrc: [t.spotX * asp, srcY], spotSrc2: [(1 - t.spotX) * asp, srcY],
        spotTgt: [spot.x / W * asp, spot.y / H],
        spotR: Math.max(0.02, spot.r / H * 0.75) * (aqua?.spotScale ?? 1), spotI: t.scenery.includes('spot') ? spot.i * t.spot : 0,
        scenery: t.scenery.reduce((bits, part) => bits | (SCENERY_BITS[part] ?? 0), t.glass === 'snow' && !aqua ? 0 : RAIN_BITS[t.rain]),
        dewGlint: t.dewGlint,
        aqua,
    };
};
