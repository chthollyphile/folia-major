import { resolveLucideIconNode } from '../../../services/lucideIconResolver';
import { clamp } from './nebbiaConstants';
import { ICON_PREFIX } from './nebbiaChars';
import { skeletonPolys } from './nebbiaSkeleton';
import { getNebbiaStrokeMedians } from './nebbiaStrokes';

// src/components/visualizer/nebbia/nebbiaGlyphs.ts
// 字形 = 按书写顺序的几笔中线（em 坐标 0..1，y 向下）。来源依次是：lucide 图标（每个 SVG 元素一笔）、
// AnimCJK 笔顺数据、主题字体的骨架追踪。另有手写变形（warpGlyph）和沿笔画取点（pointAt）。

export type Pt = [number, number];
export interface GlyphStroke { pts: Pt[]; cum: number[]; len: number }
export interface Glyph { strokes: GlyphStroke[]; total: number }

/** 量出每一笔的累计弧长；太短的笔画丢掉。 */
export const measureGlyph = (polys: Pt[][]): Glyph | null => {
    let total = 0;
    const strokes = polys.filter(p => p.length > 1).map(pts => {
        const cum = [0];
        for (let i = 1; i < pts.length; i += 1) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
        total += cum[cum.length - 1];
        return { pts, cum, len: cum[cum.length - 1] };
    }).filter(s => s.len > 0.005);
    return strokes.length ? { strokes, total } : null;
};

// Catmull-Rom 细分，稀疏的中线点变成顺滑曲线
const catmull = (pts: Pt[], n: number): Pt[] => {
    if (pts.length < 3) return pts;
    const out: Pt[] = [];
    for (let i = 0; i < pts.length - 1; i += 1) {
        const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
        for (let k = 0; k < n; k += 1) {
            const t = k / n, t2 = t * t, t3 = t2 * t;
            const at = (j: 0 | 1) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
            out.push([at(0), at(1)]);
        }
    }
    out.push(pts[pts.length - 1]);
    return out;
};

let iconSvg: SVGSVGElement | null = null;
// lucide 图标：每个 SVG 元素按出现顺序是一笔，用浏览器沿路径取点；路径里的跳笔拆开
const iconPolys = (name: string): Pt[][] | null => {
    const nodes = resolveLucideIconNode(name);
    if (!nodes || typeof document === 'undefined') return null;
    if (!iconSvg) {
        iconSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconSvg.setAttribute('viewBox', '0 0 24 24');
        iconSvg.style.cssText = 'position:absolute;width:24px;height:24px;left:-99px;top:-99px;visibility:hidden;pointer-events:none';
        document.body.appendChild(iconSvg);
    }
    const polys: Pt[][] = [];
    for (const [tag, attrs] of nodes) {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag) as SVGGeometryElement;
        for (const [k, v] of Object.entries(attrs)) if (k !== 'key') el.setAttribute(k, String(v));
        iconSvg.appendChild(el);
        const len = typeof el.getTotalLength === 'function' ? el.getTotalLength() : 0, step = 0.35;
        let cur: Pt[] = [], prev: Pt | null = null;
        for (let l = 0; len > 0 && l <= len + 1e-6; l += step) {
            const p = el.getPointAtLength(Math.min(l, len)), q: Pt = [p.x / 24, p.y / 24];
            if (prev && Math.hypot(q[0] - prev[0], q[1] - prev[1]) > step * 3 / 24) { if (cur.length > 1) polys.push(cur); cur = []; }
            cur.push(q);
            prev = q;
        }
        if (cur.length > 1) polys.push(cur);
        el.remove();
    }
    return polys.length ? polys : null;
};

/**
 * 字形缓存，按字体分开（骨架跟主题字体走）。笔顺数据或图标晚到时调 clear()，下次重新取。
 */
export class NebbiaGlyphCache {
    private cache = new Map<string, Glyph | null>();
    private font = '';

    constructor(private fontFamily: string, private fontWeight: number) {
        this.font = `${fontWeight} ${fontFamily}`;
    }

    /** 换字体时清空缓存；返回字体是否真的变了。 */
    setFont(fontFamily: string, fontWeight: number): boolean {
        const font = `${fontWeight} ${fontFamily}`;
        if (font === this.font) return false;
        this.fontFamily = fontFamily;
        this.fontWeight = fontWeight;
        this.font = font;
        this.cache.clear();
        return true;
    }

    clear() {
        this.cache.clear();
    }

    /** 主题字体是否已经能用（没在等加载）；没有 FontFaceSet 时当作能用。 */
    fontReady(): boolean {
        try {
            return document.fonts?.check(`${this.fontWeight} 16px ${this.fontFamily}`) ?? true;
        } catch {
            return true;
        }
    }

    get(ch: string): Glyph | null {
        const hit = this.cache.get(ch);
        if (hit !== undefined) return hit;
        let polys: Pt[][] | null = null;
        const medians = getNebbiaStrokeMedians(ch);
        if (ch.startsWith(ICON_PREFIX)) polys = iconPolys(ch.slice(ICON_PREFIX.length));
        else if (medians) polys = medians.map(m => catmull(m.map(([x, y]): Pt => [x / 1024, y / 1024]), 6));
        else if (ch.trim()) polys = skeletonPolys(ch, this.fontFamily, this.fontWeight);
        const glyph = polys ? measureGlyph(polys) : null;
        this.cache.set(ch, glyph);
        return glyph;
    }
}

/**
 * 手写变形：整字有点斜、有点扁或瘦、带一点弯；每一笔各自偏一点、转一点、长短不一，沿笔画还有一点手抖。
 * j 是变形幅度；笔画多的字每笔的偏移收小，部件位置还对。
 */
export const warpGlyph = (g: Glyph, rnd: () => number, j: number): Glyph => {
    if (j <= 0) return g;
    const r = () => rnd() * 2 - 1;
    const shear = r() * 0.16 * j, sx = 1 + r() * 0.1 * j, sy = 1 + r() * 0.1 * j;
    const bx = r() * 0.035 * j, by = r() * 0.035 * j, px = rnd() * 6.28, py = rnd() * 6.28;
    const whole = ([x, y]: Pt): Pt => {
        let u = (x - 0.5) * sx, v = (y - 0.5) * sy;
        u += v * shear;
        u += bx * Math.sin(v * Math.PI * 1.6 + px);
        v += by * Math.sin(u * Math.PI * 1.6 + py);
        return [u + 0.5, v + 0.5];
    };
    const sj = clamp(8 / g.strokes.length, 0.35, 1);
    const polys = g.strokes.map(st => {
        const pts = st.pts, n = pts.length;
        const cx = pts.reduce((a, p) => a + p[0], 0) / n, cy = pts.reduce((a, p) => a + p[1], 0) / n;
        const rot = r() * 0.09 * j * sj, len = 1 + r() * 0.1 * j * sj, ox = r() * 0.022 * j * sj, oy = r() * 0.022 * j * sj;
        const cr = Math.cos(rot), sr = Math.sin(rot), [x0, y0] = pts[0];
        const tremor = 0.006 * j, tf = 18 + rnd() * 14, tp = rnd() * 6.28;
        return pts.map(([x, y], i): Pt => {
            // 以起笔点为原点伸缩（写长写短），绕中心转一点，再整体挪一点
            let u = x0 + (x - x0) * len, v = y0 + (y - y0) * len;
            const du = u - cx, dv = v - cy;
            u = cx + du * cr - dv * sr + ox;
            v = cy + du * sr + dv * cr + oy;
            // 手抖：垂直于笔画方向的细小起伏
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
            const tx = b[0] - a[0], ty = b[1] - a[1], tl = Math.hypot(tx, ty) || 1;
            const k = Math.sin(st.cum[i] * tf + tp) * tremor;
            return whole([u - ty / tl * k, v + tx / tl * k]);
        });
    });
    return measureGlyph(polys) ?? g;
};

/** 折线上弧长 s 处的点和法线：[x, y, nx, ny]。 */
export const pointAt = (st: GlyphStroke, s: number): [number, number, number, number] => {
    const { pts, cum } = st;
    let i = 1;
    while (i < pts.length - 1 && cum[i] < s) i += 1;
    const a = pts[i - 1], b = pts[i], L = Math.max(1e-6, cum[i] - cum[i - 1]), k = clamp((s - cum[i - 1]) / L);
    const dx = (b[0] - a[0]) / L, dy = (b[1] - a[1]) / L;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, -dy, dx];
};
