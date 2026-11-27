import { resolveLucideIconNode } from '../../../services/lucideIconResolver';
import { clamp } from './nebbiaConstants';
import { ICON_PREFIX } from './nebbiaChars';
import { skeletonPolys } from './nebbiaSkeleton';
import { getNebbiaStrokeMedians } from './nebbiaStrokes';
import { getFontStrokes, isModelChar } from '../../../services/fontStrokes';
import { renderCanon } from '../../../services/fontStrokes/fontStrokesRaster';
import { buildFontStrokesNebbiaGlyph } from './nebbiaFontGlyph';
import { measureGlyph, type Glyph, type GlyphStroke, type Pt } from './nebbiaGlyphShape';

// src/components/visualizer/nebbia/nebbiaGlyphs.ts
// 字形 = 按书写顺序的几笔中线（em 坐标 0..1，y 向下）。来源依次是：lucide 图标（每个 SVG 元素一笔）、
// AnimCJK 笔顺数据、主题字体的骨架追踪；开了字体笔画时，汉字和假名先用笔画服务（services/fontStrokes）对着主题字体算出的笔迹（按当前字重的墨定逐点粗细，nebbiaFontGlyph.ts）。
// 另有手写变形（warpGlyph）和沿笔画取点（pointAt）。

export type { Glyph, GlyphStroke, Pt } from './nebbiaGlyphShape';
export { measureGlyph } from './nebbiaGlyphShape';

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
    /** 字体笔画做成的字形（按字，同一个字一直给同一个对象，局部换字形靠它判断有没有新字；换字体、字重、字体晚到时清掉）。 */
    private model = new Map<string, Glyph | null>();
    private font = '';
    /** 字体笔画的字体键（fontStrokesKeyOf）：汉字、假名先取笔画服务对着这个字体算的笔迹（还没算好的照旧）；null = 不用。 */
    private strokesKey: string | null = null;

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
        this.model.clear();
        return true;
    }

    /** 换字体笔画的字体键；返回是否变了。 */
    setFontStrokesKey(key: string | null): boolean {
        if (key === this.strokesKey) return false;
        this.strokesKey = key;
        this.model.clear();
        return true;
    }

    get fontStrokesKey() { return this.strokesKey; }

    clear() {
        this.cache.clear();
        this.model.clear();
    }

    /** 主题字体是否已经能用（没在等加载）；没有 FontFaceSet 时当作能用。 */
    fontReady(): boolean {
        try {
            return document.fonts?.check(`${this.fontWeight} 16px ${this.fontFamily}`) ?? true;
        } catch {
            return true;
        }
    }

    /** 当前字体。 */
    get family() { return this.fontFamily; }
    get weight() { return this.fontWeight; }

    /** 这个字能做字体笔画字形、还没做：服务里有笔画、主题字体已加载好（没加载好时量的会是回退字体，等加载好整首重排再做）。 */
    modelPending(ch: string): boolean {
        return !!this.pendingStrokes(ch);
    }

    /** 能做、还没做的字的笔画（同 modelPending）。 */
    private pendingStrokes(ch: string) {
        if (!this.strokesKey || this.model.has(ch) || !isModelChar(ch)) return null;
        const strokes = getFontStrokes(this.strokesKey, ch);
        return strokes && this.fontReady() ? strokes : null;
    }

    /**
     * 现做这个字的字体笔画字形（一个字几毫秒，调用方按帧预算分批，见 nebbiaFontLines.ts）：当前字重的字画到模型网格、
     * 用存下的轮廓还原像素归属和书写位置、量笔宽（nebbiaFontGlyph.ts）。做过就不再做（服务的内存挤掉了也不变回去）。
     */
    buildModel(ch: string) {
        const strokes = this.pendingStrokes(ch);
        if (!strokes) return;
        const canon = renderCanon(ch, this.fontFamily, this.fontWeight);
        this.model.set(ch, canon ? buildFontStrokesNebbiaGlyph(strokes, canon) : null);
    }

    /** 字形：汉字、假名的字体笔画字形做好了就用它（get 自己不做，见 buildModel），否则骨架字形。 */
    get(ch: string): Glyph | null {
        if (this.strokesKey && isModelChar(ch)) {
            const model = this.model.get(ch);
            if (model) return model;
        }
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
    const out = measureGlyph(polys);
    if (!out) return g;
    // 字体笔宽剖面跟着各笔走（变形不改点数）
    if (g.penRel !== undefined && out.strokes.length === g.strokes.length) {
        out.strokes.forEach((st, i) => { st.pw = g.strokes[i].pw; });
        out.penRel = g.penRel;
    }
    return out;
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
