import { CANON, chamferDistance } from '../../../services/fontStrokes/fontStrokesRaster';
import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaFontField.ts
// 字体墨的纯计算（不碰画布、GL）：倒角距离、笔迹数组按弧长插值，以及雾笺字体笔画的笔宽剖面（墨按书写位置分格量笔宽）。

export { CANON };
// CANON 和倒角距离已挪到 services/fontStrokes/fontStrokesRaster.ts（笔画服务不依赖样式目录），这里转出。
export { chamferDistance };

export const median = (values: number[]): number => {
    if (!values.length) return 0;
    const s = [...values].sort((p, q) => p - q), m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
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
