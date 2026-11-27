import { EM_UNITS, extendOwners, OUTLINE_SIDE, quantizeEm, simplifyRing, traceMaskRings, type FontStrokesGlyph } from './fontStrokesOutline';
import { chamferDistance, INFERENCE_WEIGHT, renderCanon, renderInkAt } from './fontStrokesRaster';

// src/services/fontStrokes/fontStrokesFit.ts
// 存下的 400 笔身怎么落到显示字重的墨上（「各自膨胀」，照 ~/bihua tools/td_demo/om_expand.py 的 dilate）：
// 每条笔身各自往外膨胀 r，和显示字重的墨相交；没被任何膨胀笔身盖住的墨（剩下的墨）归离它最近的笔身。
// r = 显示字重比 400 多出来的墨离 400 墨的距离的第 95 百分位（一个字、一个字重一个值，不随字号变：都在模型网格上量）。
// 这里只算 r 和每笔「剩下的墨」的轮廓（em × EM_UNITS，同 outlines），膨胀本身交给画法（canvas 描边 2r、SVG 同理），
// 按字形缓存（跟着内存里的字形记录走）。雾笺只要单一归属：膨胀后取最近的笔身就是「最近笔身」，见 nebbiaFontAlong.ts。

/** 墨阈值（同 glyphFeatures、om_expand 的 > 0.5）。 */
const INK_MIN = 0.5;
/** r 取多出来的墨的距离的这个分位。 */
export const REACH_QUANTILE = 0.95;
/** 笔刷 = 到中线的最大距离 × 2 × 1.2（同 fontStrokesOutline 的 BRUSH_FACTOR）。 */
const BRUSH_FACTOR = 2 * 1.2;
/** 存盘笔刷的单位：1/256 em。 */
const BRUSH_PER_EM = 256;
/** 膨胀半径比 r 多出的网格像素，见 StrokeFit.dilate。 */
const DILATE_SLACK_PX = 0.5;
/** 剩下的墨往外多留几个网格像素（只长进最近笔身也是这一笔的像素）：和膨胀的边重叠，盖住描边简化（半个像素）和两种栅格化的出入。 */
const LEFTOVER_GROW = 2;
/** 剩下的墨小于这个面积（网格像素²）的环丢掉。 */
const MIN_LEFTOVER_AREA = 2;
/** 预热（字还没开写时先算）两次之间至少隔多少毫秒：一帧最多预热一个字。 */
const WARM_GAP_MS = 12;

/** r 怎么取整（网格像素）：raw 不取整；round / ceil 同 om_expand（它要整数的圆盘核，默认 ceil）。 */
export type ReachRounding = 'raw' | 'round' | 'ceil';

/** 一个字在一个显示字重下的落法。长度单位都是 em × EM_UNITS（同 outlines、pens）。 */
export interface StrokeFit {
    /**
     * 每条笔身往外膨胀多少（画多边形时的半径）：网格上的 r 再加 DILATE_SLACK_PX。轮廓在像素中心外约半格、简化又可能往里削半格，
     * 不加的话栅格上离笔身 ≤ r 的墨（不算剩下的墨）在 canvas 上可能差一线没盖住，两笔膨胀区相接处会透出细缝（大字号看得见）。
     */
    dilate: number;
    /** 每笔剩下的墨：若干环（同 outlines 的绕向约定），没有时空数组。已往外多留 LEFTOVER_GROW 个网格像素，和膨胀的边重叠，不留缝。 */
    leftover: Int16Array[][];
    /** 每笔在这个字重下的笔刷宽：存的笔刷 + 2 × 1.2 × dilate，剩下的墨离中线更远时按它放宽。 */
    brush: Float32Array;
    /** 网格像素里的 r（取整后），探针和单测看。 */
    reachPx: number;
}

/** 一笔的轮廓环（网格像素坐标，flat）按 nonzero 填充：像素中心（+0.5）落在里面的像素调 put(i)。逐行求各边的交点、按绕数取段。 */
export const fillRings = (rings: readonly (readonly number[])[], side: number, put: (i: number) => void) => {
    let y0 = Infinity, y1 = -Infinity;
    for (const r of rings) for (let i = 1; i < r.length; i += 2) { y0 = Math.min(y0, r[i]); y1 = Math.max(y1, r[i]); }
    const rowFrom = Math.max(0, Math.floor(y0 - 0.5)), rowTo = Math.min(side - 1, Math.ceil(y1 - 0.5));
    const xs: { x: number; w: number }[] = [];
    for (let row = rowFrom; row <= rowTo; row += 1) {
        const yc = row + 0.5;
        xs.length = 0;
        for (const r of rings) {
            const n = r.length >> 1;
            for (let i = 0; i < n; i += 1) {
                const j = (i + 1) % n;
                const ay = r[2 * i + 1], by = r[2 * j + 1];
                if ((ay <= yc) === (by <= yc)) continue;
                const ax = r[2 * i], bx = r[2 * j];
                xs.push({ x: ax + ((yc - ay) * (bx - ax)) / (by - ay), w: by > ay ? 1 : -1 });
            }
        }
        if (xs.length < 2) continue;
        xs.sort((p, q) => p.x - q.x);
        let wind = 0;
        for (let k = 0; k + 1 < xs.length; k += 1) {
            wind += xs[k].w;
            if (!wind) continue;
            const from = Math.max(0, Math.ceil(xs[k].x - 0.5)), to = Math.min(side - 1, Math.ceil(xs[k + 1].x - 0.5) - 1);
            for (let x = from; x <= to; x += 1) put(row * side + x);
        }
    }
};

/** em × units 的环 → 网格像素坐标的环（px = em · a + b）。 */
export const ringsToGrid = (rings: readonly ArrayLike<number>[], units: number, grid: { a: number; bx: number; by: number }): number[][] => rings.map(r => {
    const q = new Array<number>(r.length);
    for (let i = 0; i < r.length; i += 2) { q[i] = (r[i] / units) * grid.a + grid.bx; q[i + 1] = (r[i + 1] / units) * grid.a + grid.by; }
    return q;
});

/**
 * 各笔笔身在网格上的标号图：像素中心落在第 k 笔轮廓里记 k（几笔都盖住时记先画的那笔；onOverlap 拿到 (像素, 已记的笔, 这一笔)）。
 * 笔数超过 127 的部分不记（Int8，同 own2 归属图）。
 */
export const rasterizeBodies = (
    outlines: readonly (readonly ArrayLike<number>[])[], units: number, grid: { a: number; bx: number; by: number }, side = OUTLINE_SIDE,
    onOverlap?: (i: number, first: number, k: number) => void,
): Int8Array => {
    const body = new Int8Array(side * side).fill(-1);
    outlines.forEach((rings, k) => {
        if (k > 127 || !rings.length) return;
        fillRings(ringsToGrid(rings, units, grid), side, i => {
            if (body[i] < 0) body[i] = k;
            else if (onOverlap) onOverlap(i, body[i], k);
        });
    });
    return body;
};

/** 升序数组的第 q 分位（线性插值，同 numpy.percentile 的默认）。 */
const quantileSorted = (sorted: Float32Array, q: number): number => {
    if (!sorted.length) return 0;
    const at = q * (sorted.length - 1), lo = Math.floor(at), hi = Math.min(sorted.length - 1, lo + 1);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};

/**
 * 膨胀量 r（网格像素）：显示字重的墨里不在 400 墨上的像素，到 400 墨的距离（倒角距离，近似欧氏）的第 q 分位，按 rounding 取整。
 * 显示字重不比 400 粗（没有多出来的墨）时 0。
 */
export const strokeReachPx = (
    ink400: ArrayLike<number>, inkW: ArrayLike<number>, side = OUTLINE_SIDE, rounding: ReachRounding = 'raw', q = REACH_QUANTILE,
): number => {
    const n = side * side;
    const off = new Uint8Array(n);
    let extra = 0;
    for (let i = 0; i < n; i += 1) {
        off[i] = ink400[i] > INK_MIN ? 0 : 1;
        if (off[i] && inkW[i] > INK_MIN) extra += 1;
    }
    if (!extra) return 0;
    const d = chamferDistance(off, side);
    const ds = new Float32Array(extra);
    let at = 0;
    for (let i = 0; i < n; i += 1) if (off[i] && inkW[i] > INK_MIN) ds[at++] = d[i];
    ds.sort();
    const r = quantileSorted(ds, q);
    return rounding === 'ceil' ? Math.ceil(r - 1e-6) : rounding === 'round' ? Math.round(r) : r;
};

/** 点到折线（flat）的距离。 */
const distToPen = (x: number, y: number, pen: ArrayLike<number>): number => {
    const n = pen.length >> 1;
    if (!n) return Infinity;
    if (n === 1) return Math.hypot(x - pen[0], y - pen[1]);
    let best = Infinity;
    for (let i = 0; i + 1 < n; i += 1) {
        const ax = pen[2 * i], ay = pen[2 * i + 1], vx = pen[2 * i + 2] - ax, vy = pen[2 * i + 3] - ay;
        const l2 = vx * vx + vy * vy;
        const t = l2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / l2)) : 0;
        best = Math.min(best, (ax + t * vx - x) ** 2 + (ay + t * vy - y) ** 2);
    }
    return Math.sqrt(best);
};

export interface FitOptions {
    /** 默认 ceil：r 不会小于量到的第 95 百分位，覆盖率不会比 raw 低（round 可能往下取）；和 raw/round 的差别在比对图上看不出来。 */
    rounding?: ReachRounding;
}

/**
 * 纯计算：字形记录 + 同一网格上的 400 墨和显示字重的墨 → 这个字重下的落法（见文件头）。grid 是这个字 400 的 renderCanon 变换
 * （存的笔身就是在这个网格上描的）。剩下的墨：显示字重的墨里离所有笔身都比 r 远的像素，归最近的笔身（并列取先遇到的），
 * 再在同一笔的范围里往外多留 LEFTOVER_GROW 个像素，和膨胀的边重叠。
 */
export const fitStrokesToInk = (
    glyph: FontStrokesGlyph, ink400: ArrayLike<number>, inkW: ArrayLike<number>, grid: { a: number; bx: number; by: number },
    options: FitOptions = {},
): StrokeFit => {
    const side = OUTLINE_SIDE, n = side * side;
    const penCount = glyph.pens.length;
    const reachPx = strokeReachPx(ink400, inkW, side, options.rounding ?? 'ceil');
    const unitsPerPx = EM_UNITS / grid.a;
    const dilate = (reachPx + DILATE_SLACK_PX) * unitsPerPx;
    const body = rasterizeBodies(glyph.outlines, EM_UNITS, grid, side);
    const offBody = new Uint8Array(n);
    let any = false;
    for (let i = 0; i < n; i += 1) { offBody[i] = body[i] < 0 ? 1 : 0; if (!offBody[i]) any = true; }
    const leftover: Int16Array[][] = Array.from({ length: penCount }, () => []);
    const brush = Float32Array.from({ length: penCount }, (_, k) => (glyph.brush[k] ? (glyph.brush[k] * EM_UNITS) / BRUSH_PER_EM + BRUSH_FACTOR * dilate : 0));
    if (!any) return { dilate, leftover, brush, reachPx };
    const dist = chamferDistance(offBody, side);
    const nearest = extendOwners(body, 2 * side, side);
    // 剩下的墨（标号 = 最近的笔身），按笔记外框
    const rest = new Int8Array(n).fill(-1);
    const boxes: number[][] = Array.from({ length: penCount }, () => [side, side, -1, -1]);
    for (let i = 0; i < n; i += 1) {
        if (!(inkW[i] > INK_MIN) || dist[i] <= reachPx || nearest[i] < 0 || nearest[i] >= penCount) continue;
        const k = nearest[i];
        rest[i] = k;
        const x = i % side, y = (i - x) / side, b = boxes[k];
        b[0] = Math.min(b[0], x - LEFTOVER_GROW); b[1] = Math.min(b[1], y - LEFTOVER_GROW); b[2] = Math.max(b[2], x + LEFTOVER_GROW); b[3] = Math.max(b[3], y + LEFTOVER_GROW);
    }
    for (let k = 0; k < penCount; k += 1) {
        const [x0, y0, x1, y1] = boxes[k];
        if (x1 < 0 || !glyph.brush[k]) continue;
        const bx0 = Math.max(0, x0), by0 = Math.max(0, y0), bx1 = Math.min(side - 1, x1), by1 = Math.min(side - 1, y1);
        const w = bx1 - bx0 + 1, h = by1 - by0 + 1;
        const mask = new Uint8Array(w * h);
        // 往外多留 LEFTOVER_GROW 个像素（方形邻域），只长进最近笔身也是这一笔的像素
        for (let y = by0; y <= by1; y += 1) for (let x = bx0; x <= bx1; x += 1) {
            const i = y * side + x;
            if (nearest[i] !== k) continue;
            let hit = rest[i] === k;
            for (let dy = -LEFTOVER_GROW; dy <= LEFTOVER_GROW && !hit; dy += 1) for (let dx = -LEFTOVER_GROW; dx <= LEFTOVER_GROW && !hit; dx += 1) {
                const nx = x + dx, ny = y + dy;
                if (nx >= 0 && ny >= 0 && nx < side && ny < side && rest[ny * side + nx] === k) hit = true;
            }
            if (hit) mask[(y - by0) * w + (x - bx0)] = 1;
        }
        let far = 0;
        for (const raw of traceMaskRings(mask, w, h)) {
            const ring = simplifyRing(raw);
            let area = 0;
            const m = ring.length >> 1;
            for (let i = 0; i < m; i += 1) { const j = (i + 1) % m; area += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1]; }
            if (ring.length < 6 || Math.abs(area / 2) < MIN_LEFTOVER_AREA) continue;
            const q = new Int16Array(ring.length);
            for (let i = 0; i < ring.length; i += 2) {
                q[i] = quantizeEm((ring[i] + bx0 - grid.bx) / grid.a);
                q[i + 1] = quantizeEm((ring[i + 1] + by0 - grid.by) / grid.a);
                far = Math.max(far, distToPen(q[i], q[i + 1], glyph.pens[k]));
            }
            leftover[k].push(q);
        }
        if (Number.isFinite(far)) brush[k] = Math.max(brush[k], BRUSH_FACTOR * far);
    }
    return { dilate, leftover, brush, reachPx };
};

/** 按字形记录缓存：字形 → 字重 → 落法（null = 画不出来，不再试）。字形记录被内存工作集淘汰时跟着没。 */
const fits = new WeakMap<FontStrokesGlyph, Map<number, StrokeFit | null>>();
let lastWarm = -Infinity;

/** 量一个字的落法：400 按 renderCanon 定网格（和推理时同一个网格），显示字重的墨用同一网格画。 */
const measureFit = (glyph: FontStrokesGlyph, ch: string, family: string, weight: number): StrokeFit | null => {
    const canon = renderCanon(ch, family, INFERENCE_WEIGHT);
    if (!canon) return null;
    const inkW = weight === INFERENCE_WEIGHT ? canon.img : renderInkAt(ch, family, weight, canon);
    if (!inkW) return null;
    return fitStrokesToInk(glyph, canon.img, inkW, canon);
};

/**
 * 一个字在显示字重 weight 下的落法（同步，第一次算约几毫秒，之后查缓存）。family 是这份笔画的字体栈（fontStackOfKey）。
 * 没有 document（单测、worker）或画不出墨时 null，调用方按笔身原样画。
 */
export const getStrokeFit = (glyph: FontStrokesGlyph, ch: string, family: string, weight: number): StrokeFit | null => {
    let byWeight = fits.get(glyph);
    if (!byWeight) { byWeight = new Map(); fits.set(glyph, byWeight); }
    const hit = byWeight.get(weight);
    if (hit !== undefined) return hit;
    if (typeof document === 'undefined') return null;
    const fit = measureFit(glyph, ch, family, weight);
    byWeight.set(weight, fit);
    return fit;
};

/** 预热：字还没开写时先算好落法，一帧最多算一个（两次至少隔 WARM_GAP_MS），开写那一帧就不用现算。 */
export const warmStrokeFit = (glyph: FontStrokesGlyph, ch: string, family: string, weight: number) => {
    if (fits.get(glyph)?.has(weight)) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - lastWarm < WARM_GAP_MS) return;
    lastWarm = now;
    getStrokeFit(glyph, ch, family, weight);
};
