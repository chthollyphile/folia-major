// src/services/fontStrokes/fontStrokesOutline.ts
// 笔画轮廓（纯函数，不碰画布）：own2 的归属图（每个墨像素属于哪一笔）→ 先并掉碎斑 → 按笔描边（marching squares，
// 一笔可有多个环，洞的方向相反）→ 简化（容差约半个网格像素）→ em 坐标的 Int16 多边形。再按每笔中线量笔刷宽度（轮廓到中线的最大距离 × 2 × 1.2）。
// 推理按显示字重（字体键带字重），轮廓就是这个字重的墨上 own2 分给每笔的区域，只往墨外延伸一点（OUTLINE_EXTEND_EM，
// 相邻笔在中间接上）：盖住显示时的抗锯齿边和亚像素位置的出入，不用再按字重膨胀。
// 坐标：em = (网格像素 − b) / a（同 fontStrokesRaster.renderCanon）；存盘一律 em × EM_UNITS 取整。

/** 模型网格边长。 */
export const OUTLINE_SIDE = 256;
/** 存盘的 em 单位数：1 em = 2048 个单位（约 1/15 个网格像素的精度，Int16 能表示到 ±16 em）。 */
export const EM_UNITS = 2048;
/** 碎斑：同一笔的连通块小于这么多像素、又贴着别的笔时并给邻居。 */
const SPECK_PIXELS = 6;
/** 描边简化的容差（网格像素）。 */
const SIMPLIFY_TOLERANCE = 0.5;
/** 轮廓环小于这个面积（网格像素²）的丢掉。 */
const MIN_RING_AREA = 3;
/** 笔刷宽度的量化单位：1/256 em。 */
const BRUSH_UNITS = 256;
/** 笔刷 = 轮廓到中线最大距离 × 2 × 1.2。 */
const BRUSH_FACTOR = 2 * 1.2;
/**
 * 轮廓往墨外延伸多少 em（同一字重下盖住抗锯齿边、亚像素位置的出入；相邻笔在中间接上，不会盖到别的笔的墨上）。
 * 取法见开发壳探针：同字重、64 px dpr 2 和 22 px dpr 1 下所有笔写完时遮罩 ∩ 字 / 字 ≥ 99.95% 的最小值。
 */
export const OUTLINE_EXTEND_EM = 0.01;

/** 网格像素 → em：em = (px − b) / a。 */
export interface OutlineGrid { a: number; bx: number; by: number }

/** 一个字存盘的结果。 */
export interface FontStrokesGlyph {
    /** 每笔一条中线（书写顺序），flat [x, y]，em × EM_UNITS。 */
    pens: Int16Array[];
    /** 每笔的轮廓：若干环，flat [x, y]，em × EM_UNITS；外环和洞的绕向相反（nonzero 填充时洞被扣掉）。 */
    outlines: Int16Array[][];
    /** 每笔的笔刷宽度，单位 1/256 em，0 = 这一笔没有轮廓。 */
    brush: Uint8Array;
}

/** 把同一笔里太小的连通块并给贴着它的别的笔（多数邻居）；不贴别的笔的留着，描边时由面积阈值处理。原地改。 */
export const absorbSpecks = (owner: Int8Array, side = OUTLINE_SIDE, minPixels = SPECK_PIXELS) => {
    const n = side * side;
    const seen = new Uint8Array(n);
    const stack: number[] = [];
    for (let start = 0; start < n; start += 1) {
        if (seen[start] || owner[start] < 0) continue;
        const k = owner[start];
        const comp: number[] = [];
        stack.length = 0;
        stack.push(start);
        seen[start] = 1;
        const votes = new Map<number, number>();
        while (stack.length) {
            const i = stack.pop();
            if (i === undefined) break;
            comp.push(i);
            const x = i % side, y = (i - x) / side;
            for (let d = 0; d < 4; d += 1) {
                const nx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), ny = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
                if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue;
                const j = ny * side + nx;
                if (owner[j] === k) {
                    if (!seen[j]) { seen[j] = 1; stack.push(j); }
                } else if (owner[j] >= 0) votes.set(owner[j], (votes.get(owner[j]) ?? 0) + 1);
            }
        }
        if (comp.length >= minPixels || !votes.size) continue;
        let best = -1, bestVotes = 0;
        for (const [o, v] of votes) if (v > bestVotes) { best = o; bestVotes = v; }
        for (const i of comp) owner[i] = best;
    }
};

/**
 * 每笔往墨外延伸 maxR 个像素：非墨像素取最近的墨像素的归属（8SSEDT 偏移向量两遍扫描，欧氏距离的近似），
 * 相邻两笔的区域在各自最近的中间接上。返回新的归属图；maxR ≤ 0 时原样复制。
 * 存盘时用它往外延伸 OUTLINE_EXTEND_EM；雾笺的「没被轮廓盖住的墨归最近的轮廓」（nebbiaFontAlong.ts）用它（maxR 取很大）当最近轮廓的标号。
 */
export const extendOwners = (owner: Int8Array, maxR: number, side = OUTLINE_SIDE): Int8Array => {
    const out = Int8Array.from(owner);
    if (maxR <= 0) return out;
    const n = side * side;
    const INF = 1 << 28;
    const dx = new Int16Array(n), dy = new Int16Array(n);
    const dist = new Int32Array(n);
    const src = new Int8Array(n);
    for (let i = 0; i < n; i += 1) {
        if (owner[i] >= 0) { dist[i] = 0; src[i] = owner[i]; } else { dist[i] = INF; src[i] = -1; }
    }
    const probe = (x: number, y: number, ox: number, oy: number) => {
        const nx = x + ox, ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= side || ny >= side) return;
        const j = ny * side + nx, i = y * side + x;
        if (dist[j] >= INF) return;
        const cx = dx[j] + ox, cy = dy[j] + oy;
        const d = cx * cx + cy * cy;
        if (d < dist[i]) { dist[i] = d; dx[i] = cx; dy[i] = cy; src[i] = src[j]; }
    };
    for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) { probe(x, y, -1, 0); probe(x, y, 0, -1); probe(x, y, -1, -1); probe(x, y, 1, -1); }
        for (let x = side - 1; x >= 0; x -= 1) probe(x, y, 1, 0);
    }
    for (let y = side - 1; y >= 0; y -= 1) {
        for (let x = side - 1; x >= 0; x -= 1) { probe(x, y, 1, 0); probe(x, y, 0, 1); probe(x, y, -1, 1); probe(x, y, 1, 1); }
        for (let x = 0; x < side; x += 1) probe(x, y, -1, 0);
    }
    const limit = maxR * maxR;
    for (let i = 0; i < n; i += 1) if (owner[i] < 0 && dist[i] < INF && dist[i] <= limit) out[i] = src[i];
    return out;
};

/** marching squares 一个格子里的有向线段（顶 T、右 R、底 B、左 L 四条边的中点），内部在固定的一侧；下标 = 四角位码 TL8 TR4 BR2 BL1。 */
const T = 0, Rt = 1, B = 2, L = 3;
const CELL_SEGMENTS: number[][] = [
    [], [L, B], [B, Rt], [L, Rt], [Rt, T], [L, T, Rt, B], [B, T], [L, T],
    [T, L], [T, B], [T, Rt, B, L], [T, Rt], [Rt, L], [Rt, B], [B, L], [],
];

/**
 * 一个 0/1 掩码的轮廓环：返回若干环，每环是网格像素坐标（像素中心在 +0.5）的点列；外环和洞绕向相反。
 * 轮廓取在相邻的墨 / 非墨像素中心的正中间；斜着相接的两个像素当作连着。
 */
export const traceMaskRings = (mask: Uint8Array, width: number, height = width): number[][] => {
    // 外面补一圈零，格子 (cx, cy) 覆盖补边后的像素 (cx..cx+1, cy..cy+1)
    const W = width + 2, H = height + 2;
    const m = new Uint8Array(W * H);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) m[(y + 1) * W + x + 1] = mask[y * width + x];
    const next = new Map<number, number>();
    // 格子数：横 W - 1、竖 H - 1；边编号按 cells 列排（cells 取 W，避开越界）
    const cells = W;
    const edgeId = (cx: number, cy: number, which: number) => {
        // 顶边 = 水平边 (cx, cy)，底边 = 水平边 (cx, cy + 1)，左边 = 竖直边 (cx, cy)，右边 = 竖直边 (cx + 1, cy)
        if (which === T) return (cy * cells + cx) * 2;
        if (which === B) return ((cy + 1) * cells + cx) * 2;
        if (which === L) return (cy * cells + cx) * 2 + 1;
        return (cy * cells + cx + 1) * 2 + 1;
    };
    for (let cy = 0; cy < H - 1; cy += 1) {
        for (let cx = 0; cx < W - 1; cx += 1) {
            const code = (m[cy * W + cx] ? 8 : 0) | (m[cy * W + cx + 1] ? 4 : 0) | (m[(cy + 1) * W + cx + 1] ? 2 : 0) | (m[(cy + 1) * W + cx] ? 1 : 0);
            const seg = CELL_SEGMENTS[code];
            for (let s = 0; s < seg.length; s += 2) next.set(edgeId(cx, cy, seg[s]), edgeId(cx, cy, seg[s + 1]));
        }
    }
    // 边中点 → 网格像素坐标：补边后的坐标减 1，再加 0.5 到像素中心的约定
    const pointOf = (id: number): [number, number] => {
        const vertical = id & 1;
        const cell = id >> 1;
        const cx = cell % cells, cy = (cell - cx) / cells;
        return vertical ? [cx - 1 + 0.5, cy - 1 + 0.5 + 0.5] : [cx - 1 + 0.5 + 0.5, cy - 1 + 0.5];
    };
    const rings: number[][] = [];
    const visited = new Set<number>();
    for (const start of next.keys()) {
        if (visited.has(start)) continue;
        const ring: number[] = [];
        let id = start;
        while (!visited.has(id)) {
            visited.add(id);
            const [x, y] = pointOf(id);
            ring.push(x, y);
            const to = next.get(id);
            if (to === undefined) break;
            id = to;
        }
        if (ring.length >= 6) rings.push(ring);
    }
    return rings;
};

/** 点到线段的距离²。 */
const segDist2 = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const vx = bx - ax, vy = by - ay;
    const len2 = vx * vx + vy * vy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / len2)) : 0;
    const qx = ax + t * vx - px, qy = ay + t * vy - py;
    return qx * qx + qy * qy;
};

/** Douglas-Peucker 简化闭合环：以环上离起点最远的点把环切成两段分别简化。返回简化后的 flat 点列。 */
export const simplifyRing = (ring: number[], tolerance = SIMPLIFY_TOLERANCE): number[] => {
    const n = ring.length / 2;
    if (n <= 3) return ring.slice();
    let far = 0, farD = -1;
    for (let i = 1; i < n; i += 1) {
        const d = (ring[2 * i] - ring[0]) ** 2 + (ring[2 * i + 1] - ring[1]) ** 2;
        if (d > farD) { farD = d; far = i; }
    }
    const keep = new Uint8Array(n);
    keep[0] = 1;
    keep[far] = 1;
    const tol2 = tolerance * tolerance;
    // 显式栈：[from, to]（环上下标，to 可以是 n 表示回到 0）
    const stack: [number, number][] = [[0, far], [far, n]];
    while (stack.length) {
        const top = stack.pop();
        if (!top) break;
        const [from, to] = top;
        const ax = ring[2 * from], ay = ring[2 * from + 1];
        const bi = to % n;
        const bx = ring[2 * bi], by = ring[2 * bi + 1];
        let worst = -1, worstD = tol2;
        for (let i = from + 1; i < to; i += 1) {
            const d = segDist2(ring[2 * i], ring[2 * i + 1], ax, ay, bx, by);
            if (d > worstD) { worstD = d; worst = i; }
        }
        if (worst >= 0) { keep[worst] = 1; stack.push([from, worst], [worst, to]); }
    }
    const out: number[] = [];
    for (let i = 0; i < n; i += 1) if (keep[i]) out.push(ring[2 * i], ring[2 * i + 1]);
    return out;
};

/** 环的有向面积（网格像素²）。 */
const ringArea = (ring: number[]): number => {
    let s = 0;
    const n = ring.length / 2;
    for (let i = 0; i < n; i += 1) {
        const j = (i + 1) % n;
        s += ring[2 * i] * ring[2 * j + 1] - ring[2 * j] * ring[2 * i + 1];
    }
    return s / 2;
};

/** 模型输出的画布坐标笔迹（flat，-1..1，y 向下）→ em 坐标。 */
export const penToEm = (pen: Float32Array, grid: OutlineGrid): Float32Array => {
    const out = new Float32Array(pen.length);
    const half = OUTLINE_SIDE / 2;
    for (let i = 0; i + 1 < pen.length; i += 2) {
        out[i] = ((pen[i] + 1) * half - grid.bx) / grid.a;
        out[i + 1] = ((pen[i + 1] + 1) * half - grid.by) / grid.a;
    }
    return out;
};

/** 点（em）到折线（em，flat）的距离。 */
const distToPolyline = (x: number, y: number, pen: Float32Array): number => {
    const n = pen.length / 2;
    if (n === 0) return Infinity;
    if (n === 1) return Math.hypot(x - pen[0], y - pen[1]);
    let best = Infinity;
    for (let i = 0; i + 1 < n; i += 1) best = Math.min(best, segDist2(x, y, pen[2 * i], pen[2 * i + 1], pen[2 * i + 2], pen[2 * i + 3]));
    return Math.sqrt(best);
};

export const quantizeEm = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v * EM_UNITS)));
const quantize = quantizeEm;
/** 延伸最多多少个网格像素（字很小时 a 很大，em 换成像素会很远）。 */
const EXTEND_MAX_PX = 40;

export interface BuildOptions {
    /**
     * 往墨外延伸多少 em（相邻笔在中间接上），默认 OUTLINE_EXTEND_EM。只给开发探针比对别的延伸量用：
     * 格式 1 存的是 400 推理延伸 0.06 em 的轮廓，粗字重下写到一半时相邻笔交界处会缺一块。
     */
    extendEm?: number;
}

/**
 * 归属图 + 笔迹 → 一个字存盘的结果。owner：256² 每像素的笔下标（-1 = 不是墨）；pens：模型的画布坐标笔迹；grid：这个字的网格变换。
 * 轮廓就是这个字重的墨上 own2 分给这一笔的区域（并掉碎斑后），往墨外延伸 OUTLINE_EXTEND_EM（相邻笔在中间接上）。
 * 不改 owner。笔数 > 127 的字（Int8 装不下）多出的笔没有归属，轮廓为空。
 */
export const buildFontStrokesGlyph = (owner: Int8Array, pens: Float32Array[], grid: OutlineGrid, options: BuildOptions = {}): FontStrokesGlyph => {
    const side = OUTLINE_SIDE;
    const merged = Int8Array.from(owner);
    absorbSpecks(merged, side);
    const extendPx = Math.min(EXTEND_MAX_PX, (options.extendEm ?? OUTLINE_EXTEND_EM) * grid.a);
    const bodies = extendPx > 0 ? extendOwners(merged, extendPx, side) : merged;
    const penCount = pens.length;
    // 每笔的像素范围，描边只扫自己的包围盒
    const boxes: number[][] = Array.from({ length: penCount }, () => [side, side, -1, -1]);
    for (let i = 0; i < bodies.length; i += 1) {
        const k = bodies[i];
        if (k < 0 || k >= penCount) continue;
        const x = i % side, y = (i - x) / side, b = boxes[k];
        if (x < b[0]) b[0] = x;
        if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x;
        if (y > b[3]) b[3] = y;
    }
    const penEm = pens.map(p => penToEm(p, grid));
    const outlines: Int16Array[][] = [];
    const brush = new Uint8Array(penCount);
    for (let k = 0; k < penCount; k += 1) {
        const [x0, y0, x1, y1] = boxes[k];
        const rings: Int16Array[] = [];
        let maxDist = 0;
        if (x1 >= 0) {
            const w = x1 - x0 + 1, h = y1 - y0 + 1;
            const mask = new Uint8Array(w * h);
            for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) mask[y * w + x] = bodies[(y0 + y) * side + x0 + x] === k ? 1 : 0;
            for (const raw of traceMaskRings(mask, w, h)) {
                const ring = simplifyRing(raw);
                if (ring.length < 6 || Math.abs(ringArea(ring)) < MIN_RING_AREA) continue;
                const q = new Int16Array(ring.length);
                for (let i = 0; i < ring.length; i += 2) {
                    const px = ring[i] + x0, py = ring[i + 1] + y0;
                    const ex = (px - grid.bx) / grid.a, ey = (py - grid.by) / grid.a;
                    q[i] = quantize(ex);
                    q[i + 1] = quantize(ey);
                    maxDist = Math.max(maxDist, distToPolyline(ex, ey, penEm[k]));
                }
                rings.push(q);
            }
        }
        outlines.push(rings);
        brush[k] = rings.length ? Math.min(255, Math.ceil(maxDist * BRUSH_FACTOR * BRUSH_UNITS)) : 0;
    }
    const penOut = penEm.map(p => {
        const q = new Int16Array(p.length);
        for (let i = 0; i < p.length; i += 1) q[i] = quantize(p[i]);
        return q;
    });
    return { pens: penOut, outlines, brush };
};
