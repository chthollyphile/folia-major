import type { InkContext } from './nebbiaInk';
import { iceParams, iceSizeScale } from './nebbiaSnowWater';

// src/components/visualizer/nebbia/nebbiaInkIce.ts
// 雪窗上写字留下的水珠（擦痕边的小水珠、收笔水珠、淌下来停住的那颗）也会结冰（原型）：和雪化成的水珠同一套参数（nebbiaSnowWater.ts 的 iceParams），
// 但写字的水珠每帧按时刻重算、不留状态，所以冻了多少都按「这颗水珠留下多久了」（age）直接算出来：
// 留够 freezeAfter 秒（按大小放长，iceSizeScale；每颗再按种子早晚不同）开始从中间往外冻，冻的时候水的透镜慢慢收成更小的冰珠（grow 倍）。
// 和雪化成的不一样，写字的冻在原地不滑（留住结冰的字形），大的冻实时往下坠一两个像素就停。还是跟着字一起起雾、淡没（透明度照写字的水珠）。
// 冰芯记进 ink.ice（ICE_FLOATS 个数一颗），nebbiaSnow.ts 排成 bead 贴图的雪花实例画。

/** 一颗冰芯：x、y（冰芯中心，已经放在水滴下面圆的那团上）、半径、冻了多少（0..1）、转角、透明度。 */
export const ICE_FLOATS = 6;

const hash = (s: number) => { const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** 冰芯放在水滴下面圆的那团（重心）上：比水珠的位置往下 0.42 个半径。 */
const pushCore = (out: number[], x: number, y: number, r: number, ice: number, rot: number, alpha: number) => {
    out.push(x, y + r * 0.42, r * 1.05, ice, rot, alpha);
};

/**
 * 放一颗写字留下的水珠：age 是它留下了多少秒（还在写、还没停住时传负数），seed 定它的早晚、转角。
 * 不是雪窗、关着、太小、还没到时候的照常放；冻了的放在原地（坠一点），冰芯记进 ink.ice。
 */
export const putInkBead = (ink: InkContext, x: number, y: number, r: number, alpha: number, age: number, seed: number, sx = 1, sy = 1) => {
    const ice = ink.ice, p = iceParams;
    if (!ice || p.off || age < 0 || r < p.minR * ice.k) { ink.motion.put(x, y, r, alpha, sx, sy); return; }
    const h = hash(seed), k = ice.k;
    const scale = iceSizeScale(r, k);
    const t = age - p.freezeAfter * scale * (0.7 + 0.6 * h);
    if (t <= 0) { ink.motion.put(x, y, r, alpha, sx, sy); return; }
    const dur = Math.max(1, p.freezeDur * scale), frozen = Math.min(1, t / dur);
    const R = r * Math.max(0.25, p.grow) ** frozen;
    // 冻在原地不滑（留住字形）：大的冻实时往下坠一点就停（看得见的半径每大 minR 坠 0.5 像素，最多 2 像素），缓入缓出
    const sag = Math.min(2 * k, 0.5 * k * Math.max(0, R / (p.minR * k) - 1)) * frozen * frozen * (3 - 2 * frozen);
    ink.motion.put(x, y + sag, R, alpha, sx, sy);
    pushCore(ice.out, x, y + sag, R, frozen, h * Math.PI * 2, alpha);
};
