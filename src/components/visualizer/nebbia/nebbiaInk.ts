import { clamp, NEBBIA_FIXED, MASK_SCALE, smooth } from './nebbiaConstants';
import { windDrift, type NebbiaGlassMotion } from './nebbiaDrops';
import { type Drip, type LaidChar } from './nebbiaScene';
import { pointAt, type GlyphStroke } from './nebbiaGlyphs';
import type { NebbiaSegments } from './nebbiaSegments';

// src/components/visualizer/nebbia/nebbiaInk.ts
// 在擦痕遮罩（半分辨率，亮 = 擦开；线段先收进 nebbiaSegments.ts，再由 nebbiaMaskGl.ts 在 GPU 上画）上画手指写的字：按演唱时长一笔一笔写，笔尖前推着一颗收笔水珠，
// 擦痕边凝出小水珠，少数笔画写完后淌下一颗水珠、留下水痕。着色器再按噪声给遮罩取阈值，边缘毛糙。

export interface InkContext {
    ctx: NebbiaSegments;
    motion: NebbiaGlassMotion;
    strokeWidth: number;
    writeSpeed: number;
    busSpeed: number;
}


/** 水珠流下来的水痕：宽度接近水珠本身，边缘起伏，越往上越细；wob(y) 是 y 处的横向偏移，和水珠头同一条。 */
export const strokeTrail = (ctx: NebbiaSegments, x: number, y0: number, y1: number, width: number, v: number, seed: number, wob: (y: number) => number) => {
    if (y1 - y0 < 2) return;
    for (let y = y0; y < y1; y += 4) {
        const ye = Math.min(y1, y + 5);
        const along = (y - y0) / Math.max(1, y1 - y0);
        const w = width * (0.72 + 0.28 * along) * (0.85 + 0.3 * (0.5 + 0.5 * Math.sin(y * 0.19 + seed * 3)));
        ctx.moveTo(x + wob(y), y);
        ctx.lineTo(x + wob(ye), ye);
        ctx.stroke(w, v);
    }
};

// 某一笔在 [0, len] 上画到 l 的部分，放进 p 的当前路径
const partialPath = (p: NebbiaSegments, st: GlyphStroke, l: number) => {
    const { pts, cum } = st;
    p.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i += 1) {
        if (cum[i] >= l) {
            const k = (l - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
            p.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * k, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * k);
            return;
        }
        p.lineTo(pts[i][0], pts[i][1]);
    }
};

// 字内 em 坐标 → 屏幕 CSS 像素
const toScreen = (c: LaidChar, u: number, v: number): [number, number] => {
    const cs = Math.cos(c.rot), sn = Math.sin(c.rot), lx = (u - 0.5) * c.s, ly = (v - 0.5) * c.s;
    return [c.x + cs * lx - sn * ly, c.y + sn * lx + cs * ly];
};

// 一颗往下淌的水珠：从笔画最低处出发，走走停停，越走越小，留下一道擦开的水痕
const drawDrip = (ink: InkContext, c: LaidChar, st: GlyphStroke, d: Drip, age: number, width: number, clarity: number, beadV: number) => {
    let bx = 0, by = -1e9;
    for (const q of st.pts) { const [x, y] = toScreen(c, q[0], q[1]); if (y > by) { bx = x; by = y; } }
    by += width * c.s * 0.35;
    const u = clamp(age / d.dur), f = u - Math.sin(u * 6 * Math.PI) / (6 * Math.PI);
    const dist = d.len * f, r = d.r * (1 - 0.35 * u);
    const wob = (y: number) => Math.sin(y * 0.07 + d.seed) * 1.6 + Math.sin(y * 0.023 + d.seed * 2) * 2.5 + windDrift(y, ink.busSpeed);
    if (dist > 1 && clarity > 0.002) strokeTrail(ink.ctx, bx, by, by + dist, r * 1.5, clarity * 0.95, d.seed, y => wob(y - by));
    // 走的时候被拉长，停下来变回圆一点；身后零星留下小水珠
    const speed = 1 - Math.cos(u * 6 * Math.PI);
    for (let y = 14 + (d.seed % 7) * 2; y < dist - r * 2; y += 18 + ((y * 7 + d.seed * 13) % 11)) ink.motion.put(bx + wob(y), by + y, r * (0.3 + 0.2 * (((y + d.seed) * 0.37) % 1)), beadV);
    ink.motion.put(bx + wob(dist), by + dist + r * 0.3, r, beadV, 1, 1 + 0.35 * speed * (u < 1 ? 1 : 0));
};

/**
 * 画一个字到时刻 T：从 c.wt 起用 c.wd 秒写完（整句的书写节奏在 nebbiaScene.ts 的 applyAppear）。clarity 管擦痕，beadV 管擦痕边的水珠
 * （水珠比擦痕晚很久才被雾吞掉）；alive(x, y) 为 0 的地方水珠已经被手指抹走。慢慢显现的字一次画全，不带水珠。
 */
export const drawChar = (ink: InkContext, c: LaidChar, T: number, clarityIn: number, beadIn = clarityIn, alive: ((x: number, y: number) => number) | null = null) => {
    const g = c.glyph;
    const fadeIn = c.appearDur > 0;
    if (!g || T < (fadeIn ? c.t : c.wt)) return;
    const { ctx, motion } = ink;
    let clarity = clarityIn, beadV = beadIn;
    if (fadeIn) { const a = smooth(clamp((T - c.t) / c.appearDur)); clarity *= a; beadV *= a; }
    const wd = c.wd;
    const gap = Math.min(0.06 / ink.writeSpeed, wd * 0.08);
    const inkTime = wd - gap * (g.strokes.length - 1);
    let local = T - (fadeIn ? c.t : c.wt);
    const k = MASK_SCALE, cs = Math.cos(c.rot), sn = Math.sin(c.rot);
    ctx.setTransform(cs * c.s * k, sn * c.s * k, -sn * c.s * k, cs * c.s * k, (c.x - c.s / 2 * (cs - sn)) * k, (c.y - c.s / 2 * (sn + cs)) * k);
    // 笔画多的字笔画收细一点，不然挤在一起糊成一团；最细 8 像素的下限也跟着收，不然字小时下限盖过了收细
    const thin = clamp(Math.sqrt(9 / g.strokes.length), 0.55, 1);
    const width = Math.max(ink.strokeWidth * thin, 8 * thin / c.s);
    const drips: [GlyphStroke, Drip, number][] = [];
    g.strokes.forEach((st, si) => {
        const dur = fadeIn ? 0 : inkTime * st.len / g.total;
        if (local <= 0) return;
        const p = dur > 0 ? clamp(local / dur) : 1;
        const drawn = (p * 0.4 + smooth(p) * 0.6) * st.len;
        if (clarity > 0.002) { partialPath(ctx, st, drawn); ctx.stroke(width, clarity); }
        if (!fadeIn) {
            for (const b of c.beads[si]) {
                if (b.s > drawn) break;
                const off = width / 2 + (b.r * 0.7 + b.j * 1.5) / c.s;
                const [x, y] = toScreen(c, b.x + b.nx * off, b.y + b.ny * off);
                const bv = alive ? beadV * alive(x, y) : beadV;
                motion.put(x, y, b.r * (0.55 + 0.45 * bv), bv, 1 + b.j * 0.25, 1 + (1 - b.j) * 0.3);
            }
            // 收笔水珠：笔尖推着走的水越堆越多，写到哪跟到哪；大小跟字号走，字太小就不留
            if (NEBBIA_FIXED.endBead > 0 && drawn > 0 && c.s >= NEBBIA_FIXED.endBeadMin) {
                const e = c.ends[si];
                const [ux, uy] = pointAt(st, drawn), [vx, vy] = pointAt(st, Math.max(0, drawn - 2 / c.s));
                let dx = ux - vx, dy = uy - vy;
                const dl = Math.hypot(dx, dy) || 1;
                dx /= dl; dy /= dl;
                const r = c.s * (0.031 + 0.018 * e.h) * NEBBIA_FIXED.endBead * (0.5 + 0.5 * smooth(p));
                const [x, y] = toScreen(c, ux + (dx * r * 0.35) / c.s, uy + (dy * r * 0.35 + r * 0.15) / c.s);
                const ev = alive ? beadV * alive(x, y) : beadV;
                motion.put(x, y, r * (0.6 + 0.4 * ev), ev, 1, 1.12 + e.j * 0.12);
            }
            const d = c.drips[si];
            if (d && p >= 1 && local - dur > d.delay) drips.push([st, d, local - dur - d.delay]);
        }
        local -= dur + (fadeIn ? 0 : gap);
    });
    ctx.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, 0, 0);
    for (const [st, d, age] of drips) drawDrip(ink, c, st, d, age, width, clarity, beadV);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
};
