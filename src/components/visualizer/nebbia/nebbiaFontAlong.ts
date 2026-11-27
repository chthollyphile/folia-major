import { extendOwners } from '../../../services/fontStrokes/fontStrokesOutline';
import { rasterizeBodies } from '../../../services/fontStrokes/fontStrokesFit';
import { CANON } from './nebbiaFontField';
import { clamp } from './nebbiaConstants';

// 环的栅格化挪到了笔画服务（fontStrokesFit.ts，canvas 写字的「剩下的墨」也用），这里转出。
export { fillRings } from '../../../services/fontStrokes/fontStrokesFit';

// src/components/visualizer/nebbia/nebbiaFontAlong.ts
// 用笔画服务存下的轮廓和中线还原墨像素的笔画归属和书写位置（纯计算）：服务只存中线和轮廓，雾笺的笔宽按当前字重的墨现量，
// 量法（penWidthProfile）要的是 own2 那样的每像素书写位置，这里按轮廓归属 + 投影到那一笔的中线重新算出来。
// 轮廓是 400 的笔身；当前字重更粗时归属照「各自膨胀」（fontStrokesFit.ts）：每条笔身膨胀 r、剩下的墨归最近的笔身。
// 这里只要单一归属，膨胀后几笔都盖住的像素取离它最近的笔身，所以结果就是「最近的笔身」，和 r 取多少无关。

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

/**
 * 当前字重的墨上每个像素的书写位置（同 own2 的 along：归属那一笔上最近点的弧长加上前面各笔的长度，按整字笔迹总长归一成 0..65534；
 * 不是墨 ALONG_OFF_INK）。归属 = 笔身盖住这个像素的那一笔；被几笔同时盖住（简化留下的重叠）时取其中中线最近的，
 * 都没盖住（比 400 粗出来的墨、简化削掉的边）时取最近的笔身（倒角距离；没有轮廓的笔——模型没分到墨——不参与）。
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
    // 各笔的笔身栅格化：body 记第一笔，墨上同一像素再被别的笔盖住时记进 extra
    const extra = new Map<number, number[]>();
    const usable = outlines.map((rings, k) => (k < pens.length && pens[k].length && rings.length ? rings : []));
    const body = rasterizeBodies(usable, units, grid, side, (i, first, k) => {
        if (img[i] <= ALONG_INK_MIN) return;
        const list = extra.get(i);
        if (list) list.push(k); else extra.set(i, [first, k]);
    });
    if (!usable.some(r => r.length)) return out;
    // 没被盖住的墨：最近的笔身
    const nearest = extendOwners(body, 2 * side, side);
    for (let i = 0; i < n; i += 1) {
        if (img[i] <= ALONG_INK_MIN) continue;
        const x = i % side, y = (i - x) / side;
        const ex = (x + 0.5 - grid.bx) / grid.a, ey = (y + 0.5 - grid.by) / grid.a;
        let k = nearest[i], s = 0;
        const several = extra.get(i);
        if (several) {
            let best = Infinity;
            for (const c of several) {
                const hit = nearestOnPen(pens[c], cums[c], ex, ey);
                if (hit.d2 < best) { best = hit.d2; k = c; s = hit.s; }
            }
        } else {
            if (k < 0) continue;
            s = nearestOnPen(pens[k], cums[k], ex, ey).s;
        }
        out[i] = Math.round(Math.min(1, (starts[k] + s) / total) * 65534);
    }
    return out;
};
