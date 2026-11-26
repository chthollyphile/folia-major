// src/components/visualizer/nebbia/nebbiaSegments.ts
// 擦痕遮罩的线段收集器：用法照 2D 画布（setTransform、moveTo / lineTo、stroke），但不光栅化，
// 只把每段折线变换到遮罩像素后记成「两端点 + 线宽 + 亮度」，每帧由 nebbiaMaskGl.ts 一次实例化画完。
// 圆头、圆角的折线描边正好是各段圆头线段的并集，所以按段拆开、在 GPU 上取最大值，和画布上 lighten 叠出来的一样
// （只有几笔交叠处的抗锯齿边缘有一两级的差别）。

import type { NebbiaFontInk } from './nebbiaFontGlyph';
import { CANON, GROW_MAX, GROW_MIN } from './nebbiaFontField';

/** 每段 6 个数：x0, y0, x1, y1, 线宽（遮罩像素）, 亮度 0..1。 */
export const SEGMENT_FLOATS = 6;
/** 每个字块 11 个数：左上角 (x, y)、字块 u、v 两条边（遮罩像素）、贴图层（画时填）、显到的书写位置、亮度、羽化宽（书写位置单位）、墨边外扩（模型网格像素）。 */
export const TILE_FLOATS = 11;

/** 点 (x, y) 到第 p 段（segs[p..p+3] 是两头；雪窗、凝露和歌词的水联动时用）的距离。 */
export const segDist = (x: number, y: number, segs: readonly number[], p: number): number => {
    const ax = segs[p], ay = segs[p + 1], dx = segs[p + 2] - ax, dy = segs[p + 3] - ay, l2 = dx * dx + dy * dy;
    const u = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2)) : 0;
    return Math.hypot(x - ax - dx * u, y - ay - dy * u);
};

export class NebbiaSegments {
    data = new Float32Array(SEGMENT_FLOATS * 4096);
    /** 这一帧收了几段。 */
    count = 0;
    /** 这一帧的字体墨字块（nebbiaMaskGl.ts 按 inks[i] 填贴图层）。 */
    tiles = new Float32Array(TILE_FLOATS * 64);
    inks: NebbiaFontInk[] = [];
    private a = 1; private b = 0; private c = 0; private d = 1; private e = 0; private f = 0;
    /** 当前变换的缩放（矩阵都是旋转 × 等比缩放）。 */
    private k = 1;
    /** 当前路径的点（已变换），一个子路径一段，NaN 分开。 */
    private path: number[] = [];

    /** 每帧开头清空。 */
    clear() {
        this.count = 0;
        this.inks.length = 0;
        this.path.length = 0;
    }

    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
        this.a = a; this.b = b; this.c = c; this.d = d; this.e = e; this.f = f;
        this.k = Math.hypot(a, b);
    }

    moveTo(x: number, y: number) {
        if (this.path.length) this.path.push(NaN, NaN);
        this.lineTo(x, y);
    }

    lineTo(x: number, y: number) {
        this.path.push(this.a * x + this.c * y + this.e, this.b * x + this.d * y + this.f);
    }

    /** 描当前路径（宽度在当前变换下），再清掉路径。只有一个点的子路径不画（和画布一样）。 */
    stroke(width: number, v: number) {
        const p = this.path, w = width * this.k;
        for (let i = 2; i < p.length; i += 2) {
            if (Number.isNaN(p[i]) || Number.isNaN(p[i - 2])) continue;
            this.push(p[i - 2], p[i - 1], p[i], p[i + 1], w, v);
        }
        p.length = 0;
    }

    /**
     * 描当前路径，每一段的宽 = base × 两端倍数 rel 的平均（rel 按路径点的序号取，超出的用最后一个），不小于 minWidth（宽度在当前变换下）。
     * 相邻段宽度不同时圆头线段互相盖住，接缝处不会有缺口。
     */
    strokeProfile(rel: readonly number[], base: number, minWidth: number, v: number) {
        const p = this.path, last = rel.length - 1;
        for (let i = 2, j = 1; i < p.length; i += 2, j += 1) {
            if (Number.isNaN(p[i]) || Number.isNaN(p[i - 2])) continue;
            const w = Math.max(minWidth, base * (rel[Math.min(j - 1, last)] + rel[Math.min(j, last)]) * 0.5);
            this.push(p[i - 2], p[i - 1], p[i], p[i + 1], w * this.k, v);
        }
        p.length = 0;
    }

    /**
     * 一个字的字体墨：字块在当前变换下（字内 em 坐标）的位置是 ink.x0、ink.y0、边长 ink.size；书写位置不超过 reveal 的墨显出来，
     * feather 是显出的前沿有多宽（书写位置单位），v 是亮度，grow 是墨边外扩多少（em，一侧，负为内缩；0 = 字体原样）。
     */
    tile(ink: NebbiaFontInk, reveal: number, v: number, feather: number, grow = 0) {
        const n = this.inks.length;
        if ((n + 1) * TILE_FLOATS > this.tiles.length) {
            const grown = new Float32Array(this.tiles.length * 2);
            grown.set(this.tiles);
            this.tiles = grown;
        }
        const o = n * TILE_FLOATS, t = this.tiles, { x0, y0, size } = ink;
        t[o] = this.a * x0 + this.c * y0 + this.e; t[o + 1] = this.b * x0 + this.d * y0 + this.f;
        t[o + 2] = this.a * size; t[o + 3] = this.b * size;
        t[o + 4] = this.c * size; t[o + 5] = this.d * size;
        t[o + 6] = 0; t[o + 7] = reveal; t[o + 8] = v; t[o + 9] = feather;
        t[o + 10] = grow === 0 ? 0 : Math.max(GROW_MIN, Math.min(GROW_MAX, (grow * CANON) / ink.size));
        this.inks.push(ink);
    }

    private push(x0: number, y0: number, x1: number, y1: number, w: number, v: number) {
        if ((this.count + 1) * SEGMENT_FLOATS > this.data.length) {
            const grown = new Float32Array(this.data.length * 2);
            grown.set(this.data);
            this.data = grown;
        }
        const o = this.count * SEGMENT_FLOATS, dt = this.data;
        dt[o] = x0; dt[o + 1] = y0; dt[o + 2] = x1; dt[o + 3] = y1; dt[o + 4] = w; dt[o + 5] = v;
        this.count += 1;
    }
}
