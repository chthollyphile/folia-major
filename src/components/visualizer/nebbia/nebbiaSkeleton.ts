// src/components/visualizer/nebbia/nebbiaSkeleton.ts
// 没有笔顺数据的字（拉丁字母、标点、笔顺数据没加载时的中日文）：用主题字体把字画出来，
// 细化成单像素骨架（Zhang-Suen），再追踪成折线、化简、磨圆。笔顺按从上到下、从左到右估。

const SK = 96;
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

type Pt = [number, number];

// Zhang-Suen 细化：两遍交替剥掉边界像素，直到只剩一像素宽的骨架
const thin = (img: Uint8Array) => {
    const at = (x: number, y: number) => (x < 0 || y < 0 || x >= SK || y >= SK ? 0 : img[y * SK + x]);
    let changed = true;
    while (changed) {
        changed = false;
        for (let pass = 0; pass < 2; pass += 1) {
            const del: number[] = [];
            for (let y = 0; y < SK; y += 1) for (let x = 0; x < SK; x += 1) {
                if (!img[y * SK + x]) continue;
                const n = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
                const b = n.reduce((s, v) => s + v, 0);
                if (b < 2 || b > 6) continue;
                let a = 0;
                for (let i = 0; i < 8; i += 1) if (!n[i] && n[(i + 1) % 8]) a += 1;
                if (a !== 1) continue;
                if (pass === 0 ? (n[0] * n[2] * n[4] || n[2] * n[4] * n[6]) : (n[0] * n[2] * n[6] || n[0] * n[4] * n[6])) continue;
                del.push(y * SK + x);
            }
            for (const i of del) img[i] = 0;
            if (del.length) changed = true;
        }
    }
};

// 骨架 → 折线：先从端点出发走，再收拾剩下的环；每步优先沿原方向
const trace = (img: Uint8Array): Pt[][] => {
    const N: Pt[] = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [-1, -1], [1, -1]];
    const on = (x: number, y: number) => x >= 0 && y >= 0 && x < SK && y < SK && img[y * SK + x] === 1;
    const deg = (x: number, y: number) => N.reduce((s, [dx, dy]) => s + (on(x + dx, y + dy) ? 1 : 0), 0);
    const seen = new Uint8Array(SK * SK);
    const polys: Pt[][] = [];
    const walk = (sx: number, sy: number) => {
        let x = sx, y = sy;
        const p: Pt[] = [[x, y]];
        seen[y * SK + x] = 1;
        let dir: Pt | null = null;
        for (;;) {
            let best: [number, number, number, number] | null = null, bestScore = -9;
            for (const [dx, dy] of N) {
                const nx = x + dx, ny = y + dy;
                if (!on(nx, ny) || seen[ny * SK + nx]) continue;
                const score = dir ? (dx * dir[0] + dy * dir[1]) / Math.hypot(dx, dy) : 0;
                if (score > bestScore) { bestScore = score; best = [nx, ny, dx, dy]; }
            }
            if (!best) break;
            [x, y] = best;
            dir = [best[2], best[3]];
            seen[y * SK + x] = 1;
            p.push([x, y]);
        }
        if (p.length >= 4) polys.push(p);
        // 短的多是细化在交叉处留下的毛刺，扔掉；但不连着别的笔画的是一个点（粗字重下「我」右上的点细化后只剩几个像素），留下
        else if (isolated(p)) polys.push(p.length > 1 ? p : [p[0], [p[0][0] + 1, p[0][1] + 1]]);
    };
    const isolated = (p: Pt[]) => p.every(([px, py]) => N.every(([dx, dy]) => !on(px + dx, py + dy)
        || p.some(([qx, qy]) => qx === px + dx && qy === py + dy)));
    for (let y = 0; y < SK; y += 1) for (let x = 0; x < SK; x += 1) if (img[y * SK + x] && deg(x, y) === 1 && !seen[y * SK + x]) walk(x, y);
    for (let y = 0; y < SK; y += 1) for (let x = 0; x < SK; x += 1) if (img[y * SK + x] && !seen[y * SK + x]) walk(x, y);
    return polys;
};

// Ramer-Douglas-Peucker 化简
const rdp = (pts: Pt[], eps: number): Pt[] => {
    if (pts.length < 3) return pts;
    const a = pts[0], b = pts[pts.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let idx = 0, dmax = 0;
    for (let i = 1; i < pts.length - 1; i += 1) {
        const d = Math.abs((b[0] - a[0]) * (a[1] - pts[i][1]) - (a[0] - pts[i][0]) * (b[1] - a[1])) / L;
        if (d > dmax) { dmax = d; idx = i; }
    }
    return dmax > eps ? [...rdp(pts.slice(0, idx + 1), eps).slice(0, -1), ...rdp(pts.slice(idx), eps)] : [a, b];
};

// Chaikin 磨角
const chaikin = (input: Pt[], iterations: number): Pt[] => {
    let pts = input;
    for (let k = 0; k < iterations && pts.length > 2; k += 1) {
        const o: Pt[] = [pts[0]];
        for (let i = 0; i < pts.length - 1; i += 1) {
            const p = pts[i], q = pts[i + 1];
            o.push([p[0] * 0.75 + q[0] * 0.25, p[1] * 0.75 + q[1] * 0.25], [p[0] * 0.25 + q[0] * 0.75, p[1] * 0.25 + q[1] * 0.75]);
        }
        o.push(pts[pts.length - 1]);
        pts = o;
    }
    return pts;
};

/** 一个字的骨架笔画（em 坐标 0..1，y 向下），fontFamily / fontWeight 是主题字体；画不出来时 null。 */
export const skeletonPolys = (ch: string, fontFamily: string, fontWeight: number): Pt[][] | null => {
    if (typeof document === 'undefined') return null;
    if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = SK;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return null;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, SK, SK);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = `${fontWeight} ${SK * 0.78}px ${fontFamily}`;
    ctx.fillText(ch, SK / 2, SK * 0.8);
    const data = ctx.getImageData(0, 0, SK, SK).data;
    const img = new Uint8Array(SK * SK);
    for (let i = 0; i < SK * SK; i += 1) img[i] = data[i * 4] > 110 ? 1 : 0;
    thin(img);
    const polys = trace(img).map(p => chaikin(rdp(p, 1.2), 2).map(([x, y]): Pt => [x / SK, y / SK]));
    // 每条线从更靠左上的一端开始；整体从上到下、从左到右
    for (const p of polys) if (p[0][1] + p[0][0] * 0.6 > p[p.length - 1][1] + p[p.length - 1][0] * 0.6) p.reverse();
    const minOf = (p: Pt[], axis: 0 | 1) => p.reduce((m, q) => Math.min(m, q[axis]), Infinity);
    polys.sort((a, b) => (minOf(a, 1) - minOf(b, 1)) * 0.6 + (minOf(a, 0) - minOf(b, 0)));
    return polys.length ? polys : null;
};
