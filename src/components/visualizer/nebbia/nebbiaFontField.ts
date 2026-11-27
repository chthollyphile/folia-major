import { CANON, chamferDistance } from '../../../services/fontStrokes/fontStrokesRaster';
import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaFontField.ts
// 字体墨的纯计算（不碰画布、GL）：倒角距离、书写位置往墨外延伸、墨边的有符号距离（笔画粗细设置用它把字体墨变粗变细）、
// 笔迹上每点的半笔宽（水珠挂到真实的墨边上），以及笔画粗细设置换算成的字体墨外观（nebbiaInk.ts 用）。

export { CANON };
/** 有符号距离在字块里的量程（模型网格像素）：字节 = 128 + 距离 × SD_SCALE，墨内为正。 */
export const SD_RANGE = 16;
export const SD_SCALE = 127 / SD_RANGE;
/** 笔画粗细最多让墨边外扩 / 内缩多少个模型网格像素，书写位置往墨外延伸的距离比外扩多留 2 个。 */
export const GROW_MAX = 12;
export const GROW_MIN = -8;
export const SPREAD_R = GROW_MAX + 2;
/** 笔画粗细设置的基准：等于它时字体墨原样显出（和 DEFAULT_NEBBIA_TUNING.strokeWidth 一致，有测试守着）。 */
export const REF_STROKE_WIDTH = 0.09;

// CANON 和倒角距离已挪到 services/fontStrokes/fontStrokesRaster.ts（笔画服务不依赖样式目录），这里转出。
export { chamferDistance };

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

// ---- 笔迹宽度剖面（雾笺的字体笔画走普通的中线笔画，宽度跟着字体变）----

/** 笔迹重采样的点距（em）：和骨架字形（AnimCJK 细分后）的点密度相当。 */
export const PEN_STEP = 0.012;
/** 字体典型笔宽（em，宋、黑、楷的中位数在 0.035..0.06 之间）：剖面里等于它的地方，笔宽恰好是骨架字形的笔宽。 */
export const FONT_REF_WIDTH = 0.055;
/** 字体笔宽剖面和均匀笔宽之间的混合（内部常量，不是设置）：1 = 完全照字体，0 = 和骨架字形一样粗细。 */
export const FONT_PROFILE_BLEND = 0.9;

/** 折线按弧长等距重采样（保留首尾点），点距约 step；太短的退成两点。 */
export const resamplePolyline = (pts: readonly [number, number][], step: number): [number, number][] => {
    if (pts.length < 2) return pts.map(p => [p[0], p[1]]);
    const cum = [0];
    for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[cum.length - 1];
    const n = Math.max(2, Math.ceil(len / step) + 1);
    const out: [number, number][] = [];
    let j = 1;
    for (let k = 0; k < n; k += 1) {
        const l = (len * k) / (n - 1);
        while (j < pts.length - 1 && cum[j] < l) j += 1;
        const L = Math.max(1e-9, cum[j] - cum[j - 1]), t = clamp((l - cum[j - 1]) / L);
        out.push([pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t]);
    }
    return out;
};

/** 一笔的位置：在整字笔迹里从弧长 start 开始，长 len，重采样成 n 个点（n ≥ 2）。 */
export interface PenSpan { start: number; len: number; n: number }

/**
 * 每笔各采样点处的字体笔宽（em）：把墨像素按书写位置（along，0..1 对应整字笔迹总长 total）分进各笔各采样点的格子，
 * 笔宽 = 格子里的墨面积 / 格子对应的弧长（不靠采样点处的距离，笔迹偏离中线也不受影响）。
 * area[i] 是像素 i 的墨量（0..1），pxPerEm 是模型网格每 em 的像素数。没有墨的格子用同一笔的中位数补，再轻轻平滑。
 */
export const penWidthProfile = (along: ArrayLike<number>, area: ArrayLike<number>, pxPerEm: number, total: number, spans: readonly PenSpan[]): number[][] => {
    const sums = spans.map(sp => new Float64Array(sp.n));
    const hit = spans.map(sp => new Uint8Array(sp.n));
    const pixel = 1 / (pxPerEm * pxPerEm);
    for (let i = 0; i < along.length; i += 1) {
        if (along[i] === 65535 || area[i] <= 0) continue;
        const u = (along[i] / 65534) * total;
        // 各笔首尾相接：二分找 u 落在哪一笔，超出的归到最近的笔
        let lo = 0, hi = spans.length - 1;
        while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (spans[mid].start <= u) lo = mid; else hi = mid - 1; }
        const sp = spans[lo], h = sp.len / (sp.n - 1);
        const j = Math.max(0, Math.min(sp.n - 1, Math.round((u - sp.start) / h)));
        sums[lo][j] += area[i] * pixel;
        hit[lo][j] = 1;
    }
    return spans.map((sp, k) => {
        const h = sp.len / (sp.n - 1);
        const raw: number[] = [];
        for (let j = 0; j < sp.n; j += 1) if (hit[k][j]) raw.push(sums[k][j] / (j === 0 || j === sp.n - 1 ? h / 2 : h));
        const med = median(raw) || FONT_REF_WIDTH;
        // 首尾的格子只有半格弧长、又带着笔锋，夹在中位数的 0.5..1.6 倍里
        let w = Array.from({ length: sp.n }, (_, j) => (hit[k][j] ? clamp(sums[k][j] / (j === 0 || j === sp.n - 1 ? h / 2 : h), med * 0.5, med * 1.6) : med));
        for (let pass = 0; pass < 3; pass += 1) w = w.map((v, j) => (w[Math.max(0, j - 1)] + 2 * v + w[Math.min(w.length - 1, j + 1)]) / 4);
        return w;
    });
};

/** 字体笔宽（em）→ 相对骨架字形笔宽的倍数（1 = 一样粗）：照 FONT_PROFILE_BLEND 混合均匀笔宽，倍数夹在 0.35..2.2。 */
export const relativeWidth = (w: number): number => 1 + FONT_PROFILE_BLEND * (clamp(w / FONT_REF_WIDTH, 0.35, 2.2) - 1);
