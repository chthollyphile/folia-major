import { DUR0, PAUSE, SPEED, polylineLength } from './hostMath';

// src/services/analysis/strokesWgsl/ownInput.ts
// The ownership models' host-side input and output geometry (~/bihua hf/code/preprocess.py, example.py):
//   - the trajectory time map / presence map of own1 / own2's input channels 2, 3 (preprocess.render_traj):
//     every pen segment drawn with cv2.line(img, p0, p1, value, 3, LINE_8, shift 4), later pens first so the
//     earlier pen's time stays on top - ported from OpenCV's drawing.cpp (ThickLine -> FillConvexPoly + Line2
//     edges + two radius-2 Circle caps), integer for integer, so the maps match cv2 bitwise;
//   - the time axis in f64 exactly as numpy evaluates point_times (sqrt(dx^2 + dy^2), np.sum's pairwise
//     summation for a pen's length, cumsum for the arc positions): the map's values are f32 of f64 averages;
//   - own2's 2 x 2 average pool of those maps (avg_pool2d, the same f32 sums the GPU does);
//   - the reveal projection: an ink pixel's nearest point on its owner pen, continuous along the segments.

const R = 256;
const XY_SHIFT = 16;
const XY_ONE = 1 << XY_SHIFT;
const HALF = XY_ONE >> 1;

/** `v >> 16` of an int64 (arithmetic: floor). */
const shr = (v: number) => Math.floor(v / XY_ONE);

/** lrint / cvRound / np.round: nearest, ties to even. */
export const roundHalfEven = (v: number): number => {
    const f = Math.floor(v);
    const d = v - f;
    if (d > 0.5) return f + 1;
    if (d < 0.5) return f;
    return f % 2 === 0 ? f : f + 1;
};

/** np.sum of float64 values (numpy's pairwise_sum: blocks of 8 accumulators, halves past 128, identity 0 first). */
export const numpySum = (a: ArrayLike<number>, lo = 0, hi = a.length): number => {
    const n = hi - lo;
    if (n < 8) {
        let res = 0;
        for (let i = lo; i < hi; i += 1) res += a[i];
        return res;
    }
    if (n <= 128) {
        const r = [a[lo], a[lo + 1], a[lo + 2], a[lo + 3], a[lo + 4], a[lo + 5], a[lo + 6], a[lo + 7]];
        let i = 8;
        for (; i < n - (n % 8); i += 8) for (let j = 0; j < 8; j += 1) r[j] += a[lo + i + j];
        let res = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7]));
        for (; i < n; i += 1) res += a[lo + i];
        return res;
    }
    let n2 = Math.floor(n / 2);
    n2 -= n2 % 8;
    return numpySum(a, lo, lo + n2) + numpySum(a, lo + n2, hi);
};

/** Segment lengths of a pen (flat [n, 2]) as np.linalg.norm(np.diff(p), axis=1). */
const segmentLengths = (pen: ArrayLike<number>): Float64Array => {
    const out = new Float64Array(Math.max(0, pen.length / 2 - 1));
    for (let i = 0; i < out.length; i += 1) {
        const dx = pen[2 * i + 2] - pen[2 * i];
        const dy = pen[2 * i + 3] - pen[2 * i + 1];
        out[i] = Math.sqrt(dx * dx + dy * dy);
    }
    return out;
};

/** preprocess.point_times in f64 as numpy computes it: per pen its points' times (whole glyph 0..1). */
export const pointTimes64 = (pens: ArrayLike<number>[]): Float64Array[] => {
    const spans: { t0: number; d: number; length: number; seg: Float64Array }[] = [];
    let t = 0;
    for (const pen of pens) {
        const seg = segmentLengths(pen);
        const length = numpySum(seg);
        const d = DUR0 + length * SPEED;
        spans.push({ t0: t, d, length, seg });
        t += d + PAUSE;
    }
    const total = t - PAUSE;
    return spans.map(({ t0, d, length, seg }) => {
        const out = new Float64Array(seg.length + 1);
        let s = 0;
        for (let i = 0; i < out.length; i += 1) {
            if (i > 0) s += seg[i - 1];
            out[i] = (t0 + (d * s) / Math.max(length, 1e-6)) / total;
        }
        return out;
    });
};

type Put = (x: number, y: number) => void;

/** drawing.cpp hline: pixels xl..xr of row y, clipped to the image. */
const hline = (put: Put, y: number, xl: number, xr: number) => {
    if (y < 0 || y >= R) return;
    for (let x = Math.max(0, xl); x <= Math.min(R - 1, xr); x += 1) put(x, y);
};

/** drawing.cpp clipLine(Size2l) on 16-bit fixed-point ends; null when the line misses the image. */
const clipLine = (p1: [number, number], p2: [number, number]): boolean => {
    const right = R * XY_ONE - 1;
    const bottom = R * XY_ONE - 1;
    let [x1, y1] = p1;
    let [x2, y2] = p2;
    const code = (x: number, y: number) => Number(x < 0) + Number(x > right) * 2 + Number(y < 0) * 4 + Number(y > bottom) * 8;
    let c1 = code(x1, y1);
    let c2 = code(x2, y2);
    if ((c1 & c2) === 0 && (c1 | c2) !== 0) {
        if (c1 & 12) {
            const a = c1 < 8 ? 0 : bottom;
            x1 += Math.trunc(((a - y1) * (x2 - x1)) / (y2 - y1));
            y1 = a;
            c1 = Number(x1 < 0) + Number(x1 > right) * 2;
        }
        if (c2 & 12) {
            const a = c2 < 8 ? 0 : bottom;
            x2 += Math.trunc(((a - y2) * (x2 - x1)) / (y2 - y1));
            y2 = a;
            c2 = Number(x2 < 0) + Number(x2 > right) * 2;
        }
        if ((c1 & c2) === 0 && (c1 | c2) !== 0) {
            if (c1) {
                const a = c1 === 1 ? 0 : right;
                y1 += Math.trunc(((a - x1) * (y2 - y1)) / (x2 - x1));
                x1 = a;
                c1 = 0;
            }
            if (c2) {
                const a = c2 === 1 ? 0 : right;
                y2 += Math.trunc(((a - x2) * (y2 - y1)) / (x2 - x1));
                x2 = a;
                c2 = 0;
            }
        }
    }
    p1[0] = x1; p1[1] = y1; p2[0] = x2; p2[1] = y2;
    return (c1 | c2) === 0;
};

/** drawing.cpp Line2: the 8-connected line between 16-bit fixed-point ends (the polygon's outline). */
const line2 = (put: Put, a: [number, number], b: [number, number]) => {
    const p1: [number, number] = [a[0], a[1]];
    const p2: [number, number] = [b[0], b[1]];
    if (!clipLine(p1, p2)) return;
    let dx = p2[0] - p1[0];
    let dy = p2[1] - p1[1];
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    let xStep: number;
    let yStep: number;
    let ecount: number;
    const swap = () => { const t0 = p1[0]; const t1 = p1[1]; p1[0] = p2[0]; p1[1] = p2[1]; p2[0] = t0; p2[1] = t1; };
    if (ax > ay) {
        if (dx < 0) { dy = -dy; swap(); }
        xStep = XY_ONE;
        yStep = Math.trunc((dy * XY_ONE) / (ax | 1));
        ecount = shr(p2[0] - p1[0]);
    } else {
        if (dy < 0) { dx = -dx; swap(); }
        xStep = Math.trunc((dx * XY_ONE) / (ay | 1));
        yStep = XY_ONE;
        ecount = shr(p2[1] - p1[1]);
    }
    let x1 = p1[0] + HALF;
    let y1 = p1[1] + HALF;
    const at = (x: number, y: number) => { if (x >= 0 && x < R && y >= 0 && y < R) put(x, y); };
    at(shr(p2[0] + HALF), shr(p2[1] + HALF));
    if (ax > ay) {
        x1 = shr(x1);
        for (; ecount >= 0; ecount -= 1) { at(x1, shr(y1)); x1 += 1; y1 += yStep; }
    } else {
        y1 = shr(y1);
        for (; ecount >= 0; ecount -= 1) { at(shr(x1), y1); x1 += xStep; y1 += 1; }
    }
};

/** drawing.cpp FillConvexPoly for LINE_8 at shift 16: Line2 outline, then the scanline fill of the two edges. */
const fillConvexPoly = (put: Put, v: [number, number][]) => {
    const npts = v.length;
    const delta = HALF;
    let imin = 0;
    let edges = npts;
    let xmin = v[0][0];
    let xmax = v[0][0];
    let ymin = v[0][1];
    let ymax = v[0][1];
    let p0 = v[npts - 1];
    for (let i = 0; i < npts; i += 1) {
        const p = v[i];
        if (p[1] < ymin) { ymin = p[1]; imin = i; }
        ymax = Math.max(ymax, p[1]);
        xmax = Math.max(xmax, p[0]);
        xmin = Math.min(xmin, p[0]);
        line2(put, p0, p);
        p0 = p;
    }
    xmin = shr(xmin + delta);
    xmax = shr(xmax + delta);
    ymin = shr(ymin + delta);
    ymax = shr(ymax + delta);
    if (npts < 3 || xmax < 0 || ymax < 0 || xmin >= R || ymin >= R) return;
    ymax = Math.min(ymax, R - 1);
    const edge = [
        { idx: imin, di: 1, x: -XY_ONE, dx: 0, ye: ymin },
        { idx: imin, di: npts - 1, x: -XY_ONE, dx: 0, ye: ymin },
    ];
    let y = ymin;
    do {
        for (const e of edge) {
            if (y < e.ye) continue;
            let idx0 = e.idx;
            let idx = idx0 + e.di;
            if (idx >= npts) idx -= npts;
            while (edges-- > 0) {
                const ty = shr(v[idx][1] + delta);
                if (ty > y) {
                    const xs = v[idx0][0];
                    const xe = v[idx][0];
                    e.ye = ty;
                    e.dx = Math.trunc(((xe - xs) * 2 + (ty - y)) / (2 * (ty - y)));
                    e.x = xs;
                    e.idx = idx;
                    break;
                }
                idx0 = idx;
                idx += e.di;
                if (idx >= npts) idx -= npts;
            }
        }
        if (edges < 0) break;
        if (y >= 0) {
            const [left, right] = edge[0].x > edge[1].x ? [edge[1], edge[0]] : [edge[0], edge[1]];
            const xx1 = shr(left.x + HALF);
            const xx2 = shr(right.x + HALF);
            if (xx2 >= 0 && xx1 < R) hline(put, y, xx1, xx2);
        }
        edge[0].x += edge[0].dx;
        edge[1].x += edge[1].dx;
        y += 1;
    } while (y <= ymax);
};

/** drawing.cpp Circle, filled (the caps of a thick line). */
const circle = (put: Put, cx: number, cy: number, radius: number) => {
    let err = 0;
    let dx = radius;
    let dy = 0;
    let plus = 1;
    let minus = (radius << 1) - 1;
    while (dx >= dy) {
        hline(put, cy - dy, cx - dx, cx + dx);
        hline(put, cy + dy, cx - dx, cx + dx);
        hline(put, cy - dx, cx - dy, cx + dy);
        hline(put, cy + dx, cx - dy, cx + dy);
        dy += 1;
        err += plus;
        plus += 2;
        const mask = err <= 0 ? 0 : -1;
        err -= minus & mask;
        dx += mask;
        minus -= mask & 2;
    }
};

/**
 * cv2.line(img, a, b, color, 3, LINE_8, shift=4) with a, b the 4-bit subpixel integer ends: every pixel it
 * sets, through `put` (pixels may repeat).
 */
export const thickLine3 = (put: Put, a: [number, number], b: [number, number]): void => {
    const p0: [number, number] = [a[0] * 4096, a[1] * 4096];
    const p1: [number, number] = [b[0] * 4096, b[1] * 4096];
    const dx = (p0[0] - p1[0]) / XY_ONE;
    const dy = (p1[1] - p0[1]) / XY_ONE;
    const r2 = dx * dx + dy * dy;
    const thickness = 3 << (XY_SHIFT - 1);
    if (Math.abs(r2) > Number.EPSILON) {
        const r = (thickness + XY_ONE * 0.5) / Math.sqrt(r2);
        const ox = roundHalfEven(dy * r);
        const oy = roundHalfEven(dx * r);
        fillConvexPoly(put, [[p0[0] + ox, p0[1] + oy], [p0[0] - ox, p0[1] - oy], [p1[0] - ox, p1[1] - oy], [p1[0] + ox, p1[1] + oy]]);
    }
    const radius = shr(thickness + HALF);
    circle(put, shr(p0[0] + HALF), shr(p0[1] + HALF), radius);
    circle(put, shr(p1[0] + HALF), shr(p1[1] + HALF), radius);
};

/**
 * preprocess.render_traj at 256 x 256: (time map, presence map). Pens drawn last to first, each segment with
 * the f32 average of its ends' times; canvas -> 4-bit subpixel as np.round((p + 1) / 2 * 256 * 16).
 */
export const renderTrajectory = (pens: ArrayLike<number>[]): { time: Float32Array; presence: Float32Array } => {
    const time = new Float32Array(R * R);
    const presence = new Float32Array(R * R);
    const times = pointTimes64(pens);
    for (let k = pens.length - 1; k >= 0; k -= 1) {
        const pen = pens[k];
        const t = times[k];
        const n = pen.length / 2;
        const q = new Int32Array(pen.length);
        for (let i = 0; i < pen.length; i += 1) q[i] = roundHalfEven(((pen[i] + 1) / 2) * R * 16);
        for (let j = 0; j + 1 < n; j += 1) {
            const value = Math.fround((t[j] + t[j + 1]) / 2);
            thickLine3((x, y) => { time[y * R + x] = value; presence[y * R + x] = 1; }, [q[2 * j], q[2 * j + 1]], [q[2 * j + 2], q[2 * j + 3]]);
        }
    }
    return { time, presence };
};

/** avg_pool2d(x, 2) of one square f32 map (the same f32 sum order as the GPU's AVG_POOL). */
export const avgPool2 = (map: Float32Array, side: number, out = new Float32Array((side / 2) ** 2), at = 0): Float32Array => {
    const half = side / 2;
    for (let y = 0; y < half; y += 1) {
        for (let x = 0; x < half; x += 1) {
            const b = 2 * y * side + 2 * x;
            out[at + y * half + x] = Math.fround(Math.fround(Math.fround(Math.fround(map[b] + map[b + 1]) + map[b + side]) + map[b + side + 1]) * 0.25);
        }
    }
    return out;
};

/** own2's pooled trajectory channels [2, 128, 128] (time, presence) of a glyph's pens. */
export const own2Trajectory = (pens: ArrayLike<number>[], out = new Float32Array(2 * 128 * 128), at = 0): Float32Array => {
    const { time, presence } = renderTrajectory(pens);
    avgPool2(time, R, out, at);
    avgPool2(presence, R, out, at + 128 * 128);
    return out;
};

/**
 * The nearest point to (u, v) on a polyline of vertices (x, y, along, time) - flat, 4 a vertex - over its
 * segments (projection clamped to each), first of equals: { d2, along, time } with along / time linear
 * along the hit segment. A single vertex is its own nearest point. The PROJECT kernel does the same in f32.
 */
export const nearestOnPolyline = (verts: ArrayLike<number>, u: number, v: number): { d2: number; along: number; time: number } => {
    const n = verts.length / 4;
    let best = { d2: (u - verts[0]) ** 2 + (v - verts[1]) ** 2, along: verts[2], time: verts[3] };
    for (let i = 0; i + 1 < n; i += 1) {
        const ax = verts[4 * i];
        const ay = verts[4 * i + 1];
        const ex = verts[4 * i + 4] - ax;
        const ey = verts[4 * i + 5] - ay;
        const len2 = ex * ex + ey * ey;
        const f = len2 > 0 ? Math.min(1, Math.max(0, ((u - ax) * ex + (v - ay) * ey) / len2)) : 0;
        const du = u - (ax + f * ex);
        const dv = v - (ay + f * ey);
        const d2 = du * du + dv * dv;
        if (d2 < best.d2 || i === 0) {
            best = {
                d2,
                along: verts[4 * i + 2] + f * (verts[4 * i + 6] - verts[4 * i + 2]),
                time: verts[4 * i + 3] + f * (verts[4 * i + 7] - verts[4 * i + 3]),
            };
        }
    }
    return best;
};

/**
 * Appends a pen's vertex rows to `out`: (x, y, along 0..1 by arc length, time[v]) - the table nearestOnPolyline
 * and the GPU's PEN_PROJECT read. Returns the pen's first vertex index and its end.
 */
export const pushPenVertices = (out: number[], pen: ArrayLike<number>, times: ArrayLike<number>): [number, number] => {
    const first = out.length / 4;
    const length = polylineLength(pen);
    let s = 0;
    for (let v = 0; v < pen.length / 2; v += 1) {
        if (v > 0) s += Math.hypot(pen[2 * v] - pen[2 * v - 2], pen[2 * v + 1] - pen[2 * v - 1]);
        out.push(pen[2 * v], pen[2 * v + 1], length > 0 ? s / length : 0, times[v]);
    }
    return [first, out.length / 4];
};
