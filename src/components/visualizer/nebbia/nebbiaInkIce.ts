import type { InkContext } from './nebbiaInk';
import { iceParams, iceSizeScale, ICE_SLIDE_AT } from './nebbiaSnowWater';

// src/components/visualizer/nebbia/nebbiaInkIce.ts
// 雪窗上写字留下的水珠（擦痕边的小水珠、收笔水珠、淌下来停住的那颗）也会结冰（原型）：和雪化成的水珠同一套参数（nebbiaSnowWater.ts 的 iceParams），
// 但写字的水珠每帧按时刻重算、不留状态，所以冻了多少、滑了多远都按「这颗水珠留下多久了」（age）直接算出来：
// 留够 freezeAfter 秒（按大小放长，iceSizeScale；每颗再按种子早晚不同）开始从中间往外冻，冻的时候挂霜长大，冻到 ICE_SLIDE_AT 起步慢慢往下挪、左右轻轻晃，
// 大的边滑边左右来回转，身后每隔一段留一颗冻住的小冰点。还是跟着字一起起雾、淡没（透明度照写字的水珠）。
// 冰芯记进 ink.ice（ICE_FLOATS 个数一颗），nebbiaSnow.ts 排成 bead 贴图的雪花实例画。

/** 一颗冰芯：x、y（冰芯中心，已经放在水滴下面圆的那团上）、半径、冻了多少（0..1）、转角、透明度。 */
export const ICE_FLOATS = 6;

const hash = (s: number) => { const x = Math.sin(s * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };

/** 冰芯放在水滴下面圆的那团（重心）上：比水珠的位置往下 0.42 个半径。 */
const pushCore = (out: number[], x: number, y: number, r: number, ice: number, rot: number, alpha: number) => {
    out.push(x, y + r * 0.42, r * 1.05, ice, rot, alpha);
};

/**
 * 放一颗写字留下的水珠：age 是它留下了多少秒（还在写、还没停住时传负数），seed 定它的早晚、快慢、转角。
 * 不是雪窗、关着、太小、还没到时候的照常放；冻了的放在滑到的位置，冰芯和身后的小冰点记进 ink.ice。
 */
export const putInkBead = (ink: InkContext, x: number, y: number, r: number, alpha: number, age: number, seed: number, sx = 1, sy = 1) => {
    const ice = ink.ice, p = iceParams;
    if (!ice || p.off || age < 0 || r < p.minR * ice.k) { ink.motion.put(x, y, r, alpha, sx, sy); return; }
    const h = hash(seed), h2 = hash(seed + 17.3), k = ice.k;
    const scale = iceSizeScale(r, k);
    const t = age - p.freezeAfter * scale * (0.7 + 0.6 * h);
    if (t <= 0) { ink.motion.put(x, y, r, alpha, sx, sy); return; }
    const dur = Math.max(1, p.freezeDur * scale), frozen = Math.min(1, t / dur);
    const R = r * Math.max(1, p.grow) ** frozen;
    // 往下挪：冻到 ICE_SLIDE_AT 起步，用 0.15 × freezeDur 秒加速到匀速
    const v = p.slide * k * (0.65 + 0.7 * h2), ramp = 0.15 * dur, tau = t - ICE_SLIDE_AT * dur;
    const dist = tau <= 0 ? 0 : tau < ramp ? v * tau * tau / (2 * ramp) : v * (tau - ramp / 2);
    const wob = (d: number) => (d > 0 ? 1.5 * k * Math.sin(d / (20 * k) + h * 6) : 0);
    // 身后的小冰点（不滑）：只留到画面底下；这一帧的冰芯攒到 2.5 × maxIce 颗就不再留（几百颗一起滑时不封顶会上千）
    const end = Math.min(dist - R, ice.H + 100 - y), budget = p.maxIce * 2.5 * ICE_FLOATS;
    for (let s = 12 * k; s < end && ice.out.length < budget; s += 14 * k * (0.8 + 0.4 * hash(s + seed))) {
        const rr = R * 0.22;
        ink.motion.put(x + wob(s), y + s, rr, alpha);
        pushCore(ice.out, x + wob(s), y + s, rr, 1, h * 7 + s, alpha);
    }
    const by = y + dist;
    if (by > ice.H + 100) return;
    // 大的边滑边左右来回转
    const over = R / k - p.spinR, tilt = over > 0 && dist > 0 ? p.spin * Math.min(1, over / 6) * Math.sin(dist / (14 * k) + h * 3) : 0;
    ink.motion.put(x + wob(dist), by, R, alpha, sx, sy * (dist > 0 ? 1.15 : 1));
    pushCore(ice.out, x + wob(dist), by, R, frozen, h * Math.PI * 2 + tilt, alpha);
};
