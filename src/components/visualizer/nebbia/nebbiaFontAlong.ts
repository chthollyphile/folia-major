import { CANON } from './nebbiaFontField';
import { clamp } from './nebbiaConstants';

// src/components/visualizer/nebbia/nebbiaFontAlong.ts
// 用笔画服务存下的轮廓和中线还原墨像素的笔画归属和书写位置（纯计算）：服务只存中线和轮廓，雾笺的笔宽按当前字重的墨现量，
// 量法（penWidthProfile）要的是 own2 那样的每像素书写位置，这里按轮廓归属 + 投影到那一笔的中线重新算出来。

/** 书写位置里「不是墨」的值（同 own2 的 along）。 */
export const ALONG_OFF_INK = 65535;
/** 算书写位置的墨阈值：同 own2 判墨（full6 输入的墨通道 > 0.1）。 */
const ALONG_INK_MIN = 0.1;

type EmPoint = readonly [number, number];

/** 点到折线最近点：距离² 和那里的弧长（每段投影夹在段内，相等时取前面的，同 own2 的 nearestOnPolyline）。 */
const nearestOnPen = (pen: readonly EmPoint[], cum: readonly number[], x: number, y: number): { d2: number; s: number } => {
    if (pen.length === 1) return { d2: (x - pen[0][0]) ** 2 + (y - pen[0][1]) ** 2, s: 0 };
    let best = Infinity, s = 0;
    for (let i = 0; i + 1 < pen.length; i += 1) {
        const ax = pen[i][0], ay = pen[i][1], vx = pen[i + 1][0] - ax, vy = pen[i + 1][1] - ay;
        const l2 = vx * vx + vy * vy;
        const t = l2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2) : 0;
        const d2 = (ax + t * vx - x) ** 2 + (ay + t * vy - y) ** 2;
        if (d2 < best) { best = d2; s = cum[i] + t * (cum[i + 1] - cum[i]); }
    }
    return { d2: best, s };
};

/** 点到若干闭合环（flat）边上的最近距离²。 */
const ringsDist2 = (rings: readonly (readonly number[])[], x: number, y: number): number => {
    let best = Infinity;
    for (const r of rings) {
        const n = r.length >> 1;
        for (let i = 0; i < n; i += 1) {
            const j = (i + 1) % n;
            const ax = r[2 * i], ay = r[2 * i + 1], vx = r[2 * j] - ax, vy = r[2 * j + 1] - ay;
            const l2 = vx * vx + vy * vy;
            const t = l2 > 0 ? clamp(((x - ax) * vx + (y - ay) * vy) / l2) : 0;
            const d2 = (ax + t * vx - x) ** 2 + (ay + t * vy - y) ** 2;
            if (d2 < best) best = d2;
        }
    }
    return best;
};

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

/**
 * 当前字重的墨上每个像素的书写位置（同 own2 的 along：归属那一笔上最近点的弧长加上前面各笔的长度，按整字笔迹总长归一成 0..65534；
 * 不是墨 ALONG_OFF_INK）。归属 = 轮廓盖住这个像素的那一笔；被几笔同时盖住（简化留下的重叠）时取其中中线最近的，
 * 都没盖住（简化削掉的边、比轮廓延伸范围还粗的墨）时取轮廓离它最近的那一笔（没有轮廓的笔——模型没分到墨——不参与）。
 * pens：各笔中线（em）；outlines：各笔的轮廓环（em × units，flat）；img：side² 的墨（0..1）；grid：em = (网格像素 − b) / a，像素中心在 +0.5（同 own2）。
 */
export const alongFromOutlines = (
    pens: readonly (readonly EmPoint[])[], outlines: readonly (readonly ArrayLike<number>[])[], units: number,
    img: ArrayLike<number>, grid: { a: number; bx: number; by: number }, side = CANON,
): Uint16Array => {
    const n = side * side;
    const out = new Uint16Array(n).fill(ALONG_OFF_INK);
    const cums = pens.map(p => {
        const cum = [0];
        for (let i = 1; i < p.length; i += 1) cum.push(cum[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
        return cum;
    });
    const starts: number[] = [];
    let total = 0;
    for (const c of cums) { starts.push(total); total += c[c.length - 1]; }
    if (total <= 0) return out;
    // 各笔的轮廓栅格化：owner 记第一笔，同一像素再被别的笔盖住时记进 extra
    const owner = new Int16Array(n).fill(-1);
    const extra = new Map<number, number[]>();
    const ringsPx: { k: number; rings: number[][] }[] = [];
    outlines.forEach((rings, k) => {
        if (k >= pens.length || !pens[k].length || !rings.length) return;
        const px = rings.map(r => {
            const q = new Array<number>(r.length);
            for (let i = 0; i < r.length; i += 2) { q[i] = (r[i] / units) * grid.a + grid.bx; q[i + 1] = (r[i + 1] / units) * grid.a + grid.by; }
            return q;
        });
        ringsPx.push({ k, rings: px });
        fillRings(px, side, i => {
            if (img[i] <= ALONG_INK_MIN) return;
            if (owner[i] < 0) { owner[i] = k; return; }
            const list = extra.get(i);
            if (list) list.push(k); else extra.set(i, [owner[i], k]);
        });
    });
    if (!ringsPx.length) return out;
    for (let i = 0; i < n; i += 1) {
        if (img[i] <= ALONG_INK_MIN) continue;
        const x = i % side, y = (i - x) / side;
        const ex = (x + 0.5 - grid.bx) / grid.a, ey = (y + 0.5 - grid.by) / grid.a;
        let k = owner[i], s = 0;
        const several = extra.get(i);
        if (several) {
            let best = Infinity;
            for (const c of several) {
                const hit = nearestOnPen(pens[c], cums[c], ex, ey);
                if (hit.d2 < best) { best = hit.d2; k = c; s = hit.s; }
            }
        } else {
            if (k < 0) {
                let best = Infinity;
                for (const r of ringsPx) {
                    const d2 = ringsDist2(r.rings, x + 0.5, y + 0.5);
                    if (d2 < best) { best = d2; k = r.k; }
                }
            }
            s = nearestOnPen(pens[k], cums[k], ex, ey).s;
        }
        out[i] = Math.round(Math.min(1, (starts[k] + s) / total) * 65534);
    }
    return out;
};
