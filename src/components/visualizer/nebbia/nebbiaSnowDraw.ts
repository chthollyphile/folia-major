import { FLAKE_STAGES, type FlakeKind } from './nebbiaSnowFlakes';
import { FLAKE_FLOATS } from './nebbiaSnowGl';
import type { WaterDrop } from './nebbiaSnowWater';

// src/components/visualizer/nebbia/nebbiaSnowDraw.ts
// 雪窗的雪花怎么摆（nebbiaSnow.ts 用）：每片雪算出这一帧的位置、大小、压扁、透明度、融化阶段，排成实例交给 WebGL 画（nebbiaSnowGl.ts）。

export interface Flake {
    x: number; y: number; r: number; rot: number; spin: number; kind: FlakeKind;
    age: number; hold: number; dur: number; melt: number;
    /** 飘过来：用 app 秒，从落点偏 (ox, oy) 处出发，路线往一侧弯 curl，飘晃频率 ff、幅度 fa、相位 fp。 */
    app: number; ox: number; oy: number; curl: number; ff: number; fa: number; fp: number;
    /** 已经化出来的水（质量）；还在化的雪底下钉住的水珠，每处疙瘩一颗。 */
    water: number; drops: (WaterDrop | null)[] | null;
    /** 落在水上：水已经并进去了，雪只是很快化没。 */
    quick: boolean;
}

/**
 * 排一片雪的实例（FLAKE_FLOATS 个数，写到 out 的 o 处）：飘过来时从糊到清、转着、左右晃，越近越慢；
 * 贴上去轻轻压扁一下再回来，不弹；化的时候冰往上缩一点，水在底下积。
 */
const packFlake = (f: Flake, out: Float32Array, o: number) => {
    let x = f.x, y = f.y, scx = 1, scy = 1, alpha = 0.92;
    const p = Math.min(1, f.age / f.app);
    if (p < 1) {
        // 离落点还差 q（先快后慢），路线往一侧弯，再加上越近越小的飘晃
        const q = (1 - p) ** 2, bend = Math.sin(Math.PI * p) * f.curl, fl = f.fa * q;
        x += f.ox * q - f.oy * bend + Math.sin(f.age * f.ff + f.fp) * fl;
        y += f.oy * q + f.ox * bend + Math.cos(f.age * f.ff * 0.7 + f.fp) * fl;
        scx = scy = 0.7 + 0.3 * p; alpha *= 0.45 + 0.55 * p;
    } else {
        const e = Math.exp(-(f.age - f.app) * 14);
        scx = 1 + 0.07 * e; scy = 1 - 0.08 * e;
        y -= f.r * 0.1 * f.melt;
    }
    out[o] = x; out[o + 1] = y; out[o + 2] = f.r; out[o + 3] = f.rot;
    out[o + 4] = Math.min(f.melt * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001); out[o + 5] = f.kind.row; out[o + 6] = alpha; out[o + 7] = p;
    out[o + 8] = scx; out[o + 9] = scy;
};

/** 全部雪排进 buf（不够大时换一个更大的），返回用到的那个。 */
export const packFlakes = (flakes: readonly Flake[], buf: Float32Array): Float32Array => {
    if (buf.length < flakes.length * FLAKE_FLOATS) buf = new Float32Array(Math.ceil(flakes.length * 1.5) * FLAKE_FLOATS);
    for (let i = 0; i < flakes.length; i += 1) packFlake(flakes[i], buf, i * FLAKE_FLOATS);
    return buf;
};
