import { FLAKE_STAGES, type FlakeKind } from './nebbiaSnowFlakes';
import { FLAKE_FLOATS } from './nebbiaSnowGl';
import type { WaterDrop } from './nebbiaSnowWater';
import { ICE_FLOATS } from './nebbiaInkIce';

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
 * 排一片雪的实例（FLAKE_FLOATS 个数，写到 out 的 o 处）：从远处飘过来，按透视变大：先是窗外远层那么小、那么淡、那么糊的一点，跟着窗外的雪往下落，
 * 越近长得越快，最后一下子变大、变清楚、贴上；一路转着、轻轻晃，快到时慢下来；
 * 贴上去轻轻压扁一下再回来，不弹；化的时候冰往上缩一点，水在底下积。
 */
/** 飘过来时出发的地方离玻璃是贴上时的几倍远（出发时看着是贴上时的 1/这个，和窗外远层的雪差不多大）。 */
const APPROACH_Z = 5;

const packFlake = (f: Flake, out: Float32Array, o: number) => {
    let x = f.x, y = f.y, r = f.r, scx = 1, scy = 1, alpha = 0.92, focus = 1;
    const p = Math.min(1, f.age / f.app);
    if (p < 1) {
        // 离落点还差 q（前面像窗外的雪一样匀速落，快到才慢下来），路线往一侧弯，再加上越近越小的飘晃
        const q = (1 - p) ** 1.2, bend = Math.sin(Math.PI * p) * f.curl, fl = f.fa * q;
        x += f.ox * q - f.oy * bend + Math.sin(f.age * f.ff + f.fp) * fl;
        y += f.oy * q + f.ox * bend + Math.cos(f.age * f.ff * 0.7 + f.fp) * fl;
        // 离玻璃的远近 z 匀速从 APPROACH_Z 倍减到 1，看着的大小是 1/z；清楚的程度跟着大小走（远的一直糊，最后才对上焦）；刚出现时淡入
        const s = 1 / (1 + (APPROACH_Z - 1) * (1 - p));
        r *= s; focus = (s - 1 / APPROACH_Z) / (1 - 1 / APPROACH_Z);
        alpha *= Math.min(1, p / 0.15) * (0.35 + 0.65 * focus);
    } else {
        const e = Math.exp(-(f.age - f.app) * 14);
        scx = 1 + 0.07 * e; scy = 1 - 0.08 * e;
        y -= f.r * 0.1 * f.melt;
    }
    out[o] = x; out[o + 1] = y; out[o + 2] = r; out[o + 3] = f.rot;
    out[o + 4] = Math.min(f.melt * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001); out[o + 5] = f.kind.row; out[o + 6] = alpha; out[o + 7] = focus;
    out[o + 8] = scx; out[o + 9] = scy;
};

/** 全部雪排进 buf 的第 start 片起（前面留给窗外的雪；不够大时换一个更大的），返回用到的那个。 */
export const packFlakes = (flakes: readonly Flake[], buf: Float32Array, start = 0): Float32Array => {
    const n = start + flakes.length;
    if (buf.length < n * FLAKE_FLOATS) buf = new Float32Array(Math.ceil(n * 1.5) * FLAKE_FLOATS);
    for (let i = 0; i < flakes.length; i += 1) packFlake(flakes[i], buf, (start + i) * FLAKE_FLOATS);
    return buf;
};

/**
 * 结了冰的水珠的冰芯（nebbiaSnowWater.ts 的 ice > 0）排在 buf 的第 start 片起：冰芯和看得见的水珠差不多大、放在水滴下面圆的那团（重心）上，冻得越透阶段越靠前
 * （bead 贴图的阶段倒过来用，冰芯从中间往外长），跟着水珠被拉长的样子压扁；返回用到的 buf 和排了几颗。
 */
export const packIce = (drops: readonly WaterDrop[], radius: (d: WaterDrop) => number, beads: readonly FlakeKind[], buf: Float32Array, start: number): [Float32Array, number] => {
    let n = 0;
    for (const d of drops) if (d.ice > 0 && !d.dead) n += 1;
    if (buf.length < (start + n) * FLAKE_FLOATS) {
        const next = new Float32Array(Math.ceil((start + n) * 1.5) * FLAKE_FLOATS);
        next.set(buf.subarray(0, start * FLAKE_FLOATS));
        buf = next;
    }
    let o = start * FLAKE_FLOATS;
    for (const d of drops) {
        if (!(d.ice > 0) || d.dead) continue;
        const kind = beads[Math.floor(d.rot * 10) % beads.length];
        // 水珠精灵是水滴形（上面尖、下面圆），重心在圆的那团里，比水珠的位置偏下；被拉长时更靠下
        const r = radius(d);
        buf[o] = d.x; buf[o + 1] = d.y + r * (0.42 + 0.2 * d.sy); buf[o + 2] = r * 1.05; buf[o + 3] = d.rot + d.tilt;
        buf[o + 4] = Math.min((1 - d.ice) * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001); buf[o + 5] = kind.row;
        buf[o + 6] = 0.9 * Math.min(1, d.ice * 5); buf[o + 7] = 1;
        buf[o + 8] = 1 + d.sx * 0.5; buf[o + 9] = 1 + d.sy * 0.5;
        o += FLAKE_FLOATS;
    }
    return [buf, n];
};

/** 写字留下的水珠结的冰芯（nebbiaInkIce.ts 收的，ICE_FLOATS 个数一颗，位置已经放好）排在 buf 的第 start 片起；返回用到的 buf 和排了几颗。 */
export const packInkIce = (ice: readonly number[], beads: readonly FlakeKind[], buf: Float32Array, start: number): [Float32Array, number] => {
    const n = ice.length / ICE_FLOATS;
    if (buf.length < (start + n) * FLAKE_FLOATS) {
        const next = new Float32Array(Math.ceil((start + n) * 1.5) * FLAKE_FLOATS);
        next.set(buf.subarray(0, start * FLAKE_FLOATS));
        buf = next;
    }
    for (let i = 0; i < n; i += 1) {
        const q = i * ICE_FLOATS, o = (start + i) * FLAKE_FLOATS, frozen = ice[q + 3]!;
        buf[o] = ice[q]!; buf[o + 1] = ice[q + 1]!; buf[o + 2] = ice[q + 2]!; buf[o + 3] = ice[q + 4]!;
        buf[o + 4] = Math.min((1 - frozen) * (FLAKE_STAGES - 1), FLAKE_STAGES - 1.001);
        buf[o + 5] = beads[Math.floor(Math.abs(ice[q + 4]!) * 10) % beads.length]!.row;
        buf[o + 6] = 0.9 * Math.min(1, frozen * 5) * ice[q + 5]!; buf[o + 7] = 1;
        buf[o + 8] = 1; buf[o + 9] = 1;
    }
    return [buf, n];
};
