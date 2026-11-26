import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaFontField.ts
// 字体墨的纯计算（不碰画布、GL）：倒角距离、书写位置往墨外延伸、墨边的有符号距离（笔画粗细设置用它把字体墨变粗变细）、
// 笔迹上每点的半笔宽（水珠挂到真实的墨边上），以及笔画粗细设置换算成的字体墨外观（nebbiaInk.ts 用）。

/** 模型网格边长。 */
export const CANON = 256;
/** 有符号距离在字块里的量程（模型网格像素）：字节 = 128 + 距离 × SD_SCALE，墨内为正。 */
export const SD_RANGE = 16;
export const SD_SCALE = 127 / SD_RANGE;
/** 笔画粗细最多让墨边外扩 / 内缩多少个模型网格像素，书写位置往墨外延伸的距离比外扩多留 2 个。 */
export const GROW_MAX = 12;
export const GROW_MIN = -8;
export const SPREAD_R = GROW_MAX + 2;
/** 笔画粗细设置的基准：等于它时字体墨原样显出（和 DEFAULT_NEBBIA_TUNING.strokeWidth 一致，有测试守着）。 */
export const REF_STROKE_WIDTH = 0.09;

/** cv2.distanceTransform(DIST_L2, 3)：3×3 倒角（a = 0.955、b = 1.3693），图外不算零。返回每个 on 像素到最近 off 像素的距离。 */
export const chamferDistance = (on: Uint8Array, side: number): Float32Array => {
    const A = 0.955, B = 1.3693, INF = 1e9;
    const d = new Float32Array(side * side);
    for (let i = 0; i < d.length; i += 1) d[i] = on[i] ? INF : 0;
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
        const i = y * side + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + A);
        if (y > 0) {
            v = Math.min(v, d[i - side] + A);
            if (x > 0) v = Math.min(v, d[i - side - 1] + B);
            if (x < side - 1) v = Math.min(v, d[i - side + 1] + B);
        }
        d[i] = v;
    }
    for (let y = side - 1; y >= 0; y -= 1) for (let x = side - 1; x >= 0; x -= 1) {
        const i = y * side + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x < side - 1) v = Math.min(v, d[i + 1] + A);
        if (y < side - 1) {
            v = Math.min(v, d[i + side] + A);
            if (x < side - 1) v = Math.min(v, d[i + side + 1] + B);
            if (x > 0) v = Math.min(v, d[i + side - 1] + B);
        }
        d[i] = v;
    }
    return d;
};

/**
 * 把 v（负数 = 没有值）按最近的有值像素往外延伸，最多 maxR 个像素（两遍倒角，一遍代替原来的多轮平均）。
 * inside 为 1 的像素不受 maxR 限制（墨里没有值的像素也要补上）；超出的仍是 -1。
 */
export const propagateNearest = (v: Float32Array, side: number, maxR: number, inside?: Uint8Array) => {
    const A = 0.955, B = 1.3693, INF = 1e9;
    const d = new Float32Array(v.length);
    for (let i = 0; i < d.length; i += 1) d[i] = v[i] >= 0 ? 0 : INF;
    const relax = (i: number, j: number, cost: number) => {
        if (d[j] + cost < d[i]) { d[i] = d[j] + cost; v[i] = v[j]; }
    };
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
        const i = y * side + x;
        if (x > 0) relax(i, i - 1, A);
        if (y > 0) {
            relax(i, i - side, A);
            if (x > 0) relax(i, i - side - 1, B);
            if (x < side - 1) relax(i, i - side + 1, B);
        }
    }
    for (let y = side - 1; y >= 0; y -= 1) for (let x = side - 1; x >= 0; x -= 1) {
        const i = y * side + x;
        if (x < side - 1) relax(i, i + 1, A);
        if (y < side - 1) {
            relax(i, i + side, A);
            if (x < side - 1) relax(i, i + side + 1, B);
            if (x > 0) relax(i, i + side - 1, B);
        }
    }
    for (let i = 0; i < v.length; i += 1) if (d[i] > maxR && !inside?.[i]) v[i] = -1;
};

/** 每个像素到墨边的有符号距离（像素，墨内为正）：边上的墨像素中心离边 0.5。 */
export const signedField = (ink: Uint8Array, side: number): Float32Array => {
    const n = side * side, out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) out[i] = 1 - ink[i];
    const din = chamferDistance(ink, side), dout = chamferDistance(out, side);
    const sd = new Float32Array(n);
    for (let i = 0; i < n; i += 1) sd[i] = ink[i] ? din[i] - 0.5 : -(dout[i] - 0.5);
    return sd;
};

/** 有符号距离 → 字节（量程外截掉）。着色器按同一个 SD_SCALE 还原。 */
export const encodeSigned = (sd: number): number => Math.round(clamp(128 + sd * SD_SCALE, 0, 255));

/** 笔迹点（模型网格像素）处的半笔宽（模型网格像素）：取周围 3×3 里离墨边最远的（笔迹点不一定正在中线上），下限半个像素。 */
export const halfWidthAt = (sd: Float32Array, side: number, x: number, y: number): number => {
    const cx = Math.round(x), cy = Math.round(y);
    let best = 0.5;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const px = cx + dx, py = cy + dy;
        if (px < 0 || py < 0 || px >= side || py >= side) continue;
        best = Math.max(best, sd[py * side + px]);
    }
    return best;
};

export const median = (values: number[]): number => {
    if (!values.length) return 0;
    const s = [...values].sort((p, q) => p - q), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 字体墨的外观：笔画粗细设置 strokeWidth 相对基准的倍数、墨边外扩（em，一侧，负为内缩）、水痕 / 笔尖用的笔宽（em）、水珠大小倍数。 */
export interface FontInkLook { ratio: number; grow: number; width: number; beadScale: number }

/**
 * inkWidth 是字体自己的典型笔宽（em，中位数）；thin 是骨架字形按笔画数收细的系数，水珠大小对着骨架字形的比例算。
 * strokeWidth 等于基准时 grow 恰好为 0，字体墨原样显出。
 */
export const fontInkLook = (inkWidth: number, strokeWidth: number, thin: number): FontInkLook => {
    const ratio = strokeWidth / REF_STROKE_WIDTH;
    const grow = Math.max(inkWidth * (ratio - 1) / 2, -inkWidth * 0.4);
    const width = inkWidth + grow * 2;
    // 水珠大小对着骨架字形（笔宽 REF × thin）的比例：细字体的水珠缩小，粗字体不放大
    const beadScale = clamp(width / (REF_STROKE_WIDTH * thin), 0.5, 1);
    return { ratio, grow, width, beadScale };
};

/** 笔迹的半笔宽数组里取 s 处的值（em）；按累计弧长插值。 */
export const interpolateAt = (cum: readonly number[], values: readonly number[], s: number): number => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i += 1;
    const L = Math.max(1e-6, cum[i] - cum[i - 1]), k = clamp((s - cum[i - 1]) / L);
    return values[i - 1] + (values[i] - values[i - 1]) * k;
};
