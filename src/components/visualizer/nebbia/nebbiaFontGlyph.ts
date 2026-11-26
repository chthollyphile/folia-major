import type { StrokesGpuGlyph } from '../../../services/analysis/beatThisGpu';
import { clamp } from './nebbiaConstants';
import { measureGlyph, type Glyph, type Pt } from './nebbiaGlyphs';
import { CANON, chamferDistance, encodeSigned, halfWidthAt, median, PEN_STEP, penWidthProfile, propagateNearest, relativeWidth, resamplePolyline, SPREAD_R, signedField, type PenSpan } from './nebbiaFontField';

// src/components/visualizer/nebbia/nebbiaFontGlyph.ts
// 字体墨的字形：把字用所选字体画成模型网格（256²）上的墨、算模型输入特征，再把模型结果（笔迹 + 每个墨像素的书写位置）
// 做成雾笺的字形：笔迹换到 em 坐标并带上每点的半笔宽，字块（RGB8：墨、书写位置、到墨边的有符号距离）缩到 FONT_TILE²。
// 模型输入照 ~/bihua hf/code/preprocess.py：墨的外框等比放进 256² 画布、最长边占 [-0.8, 0.8]，三通道是墨、墨内距离 / 12、
// 墨外距离 / 24（cv2 DIST_L2 3×3 的倒角距离）。这里不是把位图再缩放，而是按算好的变换直接用字体重画一遍。

/** 一个字的字体墨：字块（RGB8：墨、书写位置 0..1、到墨边的有符号距离；书写位置和距离在墨外延伸一圈）和它在字内 em 坐标里的位置。 */
export interface NebbiaFontInk {
    readonly id: number;
    readonly tile: Uint8Array;
    /** 字块左上角和边长（em 坐标）。 */
    readonly x0: number;
    readonly y0: number;
    readonly size: number;
    /** 典型笔画宽（em，笔迹上各点笔宽的中位数）：水痕、笔尖的宽，也是笔画粗细设置缩放的基准。 */
    readonly width: number;
}

const R = CANON;
/**
 * 字体笔画的两种画法：false（默认）= 模型笔迹当普通的中线笔画画（珠子、粗细、手写变形都照骨架字形，笔宽剖面取自字体）；
 * true = 原来的字块（字体自己的墨按书写位置显出来，粗细设置靠有符号距离外扩）。
 */
export const FONT_INK_TILE = false;
/** 典型笔宽的取值范围（em）。 */
const WIDTH_MIN = 0.02, WIDTH_MAX = 0.12;
/** 字块边长：模型网格的一半（雾笺的遮罩是半分辨率，字块再大也看不出来）。 */
export const FONT_TILE = 128;
const SPAN = 0.8;
/** 量外框用的字号（em 像素）和画布：字可能伸出 em 框，四周留一个 em。 */
const EM = 256;
/** 同 nebbiaSkeleton.ts：字号 0.78 em，基线在 0.8 em。 */
const FONT_EM = 0.78;
const BASELINE = 0.8;

/** 交给模型的字：汉字、平假名、片假名（模型训练时就有假名，同 AnimCJK 日文和 KanjiVG；拉丁字母等照旧走 AnimCJK 或骨架）。 */
export const isModelChar = (ch: string) => ch.length === 1 && (
    (ch >= '\u4e00' && ch <= '\u9fff') || (ch >= '\u3041' && ch <= '\u3096') || (ch >= '\u30a1' && ch <= '\u30fa') || ch === '\u30fc' || ch === '\u3005');

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let nextInkId = 1;

const context = () => {
    if (!ctx) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = EM * 3;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return ctx;
};

/** 用当前变换画一个字（白字黑底），读回 side² 的灰度（0..1）。 */
const drawChar = (c: CanvasRenderingContext2D, ch: string, font: string, side: number, transform: [number, number, number]): Float32Array => {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = '#000';
    c.fillRect(0, 0, side, side);
    c.setTransform(transform[0], 0, 0, transform[0], transform[1], transform[2]);
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    c.font = font;
    c.fillText(ch, EM * 0.5, EM * BASELINE);
    c.setTransform(1, 0, 0, 1, 0, 0);
    const data = c.getImageData(0, 0, side, side).data;
    const out = new Float32Array(side * side);
    for (let i = 0; i < out.length; i += 1) out[i] = data[i * 4] / 255;
    return out;
};

/**
 * 字 → 模型网格上的墨（0..1）和 网格像素 → em 坐标 的变换（em = (px - b) / a）。画不出墨时 null。
 * 先在 em 像素里量墨的外框（阈值 0.5，同 preprocess.canon），再按外框直接重画到 256²。
 */
export const renderCanon = (ch: string, fontFamily: string, fontWeight: number): { img: Float32Array; a: number; bx: number; by: number } | null => {
    if (typeof document === 'undefined') return null;
    const c = context();
    if (!c) return null;
    const font = `${fontWeight} ${EM * FONT_EM}px ${fontFamily}`;
    const side = EM * 3;
    const probe = drawChar(c, ch, font, side, [1, EM, EM]);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
        if (probe[y * side + x] <= 0.5) continue;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
    if (x1 < 0) return null;
    // em 像素里的外框（hi 取 max + 1，同 canon）；画布坐标 u = (p - c) · k，网格像素 (u + 1) · 128
    const lx = x0 - EM, ly = y0 - EM, hx = x1 + 1 - EM, hy = y1 + 1 - EM;
    const k = (2 * SPAN) / Math.max(hx - lx, hy - ly, 1e-3);
    const a = (k * R) / 2;
    const bx = R / 2 - a * (lx + hx) / 2, by = R / 2 - a * (ly + hy) / 2;
    const full = drawChar(c, ch, font, side, [a, bx, by]);
    const img = new Float32Array(R * R);
    for (let y = 0; y < R; y += 1) img.set(full.subarray(y * side, y * side + R), y * R);
    return { img, a: a * EM, bx, by };
};

/** full6 的三通道输入 [3, 256, 256]：墨、clip(墨内距离 / 12)、clip(墨外距离 / 24)。 */
export const glyphFeatures = (img: Float32Array): Float32Array<ArrayBuffer> => {
    const n = R * R;
    const ink = new Uint8Array(n), out = new Uint8Array(n);
    for (let i = 0; i < n; i += 1) { ink[i] = img[i] > 0.5 ? 1 : 0; out[i] = 1 - ink[i]; }
    const din = chamferDistance(ink, R), dout = chamferDistance(out, R);
    const f = new Float32Array(3 * n);
    f.set(img, 0);
    for (let i = 0; i < n; i += 1) {
        f[n + i] = Math.min(1, din[i] / 12);
        f[2 * n + i] = Math.min(1, dout[i] / 24);
    }
    return f;
};

/** 模型结果 → 雾笺的字形：笔迹换到 em 坐标（带半笔宽），字块缩到 FONT_TILE²。 */
export const buildGlyph = (canon: { img: Float32Array; a: number; bx: number; by: number }, out: StrokesGpuGlyph): Glyph | null => {
    const { img, a, bx, by } = canon;
    // 画布坐标 → 网格像素 (u + 1) · 128 → em
    const toPx = (u: number, v: number): Pt => [((u + 1) * R) / 2, ((v + 1) * R) / 2];
    const polys = out.pens.map(pen => {
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < pen.length; i += 2) { const [px, py] = toPx(pen[i], pen[i + 1]); pts.push([(px - bx) / a, (py - by) / a]); }
        return pts;
    });
    if (!FONT_INK_TILE) return buildPenGlyph(canon, polys, out);
    const g = measureGlyph(polys);
    if (!g) return null;
    const n = R * R;
    const inkMask = new Uint8Array(n), s = new Float32Array(n);
    for (let i = 0; i < n; i += 1) {
        inkMask[i] = img[i] > 0.5 ? 1 : 0;
        s[i] = out.along[i] === 65535 ? -1 : out.along[i] / 65534;
    }
    // 笔画粗细要把墨外扩，外扩出来的像素也要有书写位置：按最近的墨一遍延伸出去
    propagateNearest(s, R, SPREAD_R, inkMask);
    const sd = signedField(inkMask, R);
    // 每一笔各点的半笔宽（em）；中位数当这个字的典型笔宽
    const widths: number[] = [];
    for (const st of g.strokes) {
        st.hw = st.pts.map(([x, y]) => {
            const h = halfWidthAt(sd, R, x * a + bx, y * a + by) / a;
            widths.push(h * 2);
            return h;
        });
    }
    let inkSum = 0;
    for (let i = 0; i < n; i += 1) inkSum += img[i];
    // 笔迹取不到有效值时退回 墨面积 / 笔迹总长
    const width = widths.length ? clamp(median(widths), WIDTH_MIN, WIDTH_MAX) : clamp(inkSum / (a * a) / Math.max(g.total, 1e-3), WIDTH_MIN, WIDTH_MAX);
    const tile = new Uint8Array(FONT_TILE * FONT_TILE * 3);
    for (let y = 0; y < FONT_TILE; y += 1) for (let x = 0; x < FONT_TILE; x += 1) {
        let ink = 0, sum = 0, cnt = 0, dist = 0;
        for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
            const i = (y * 2 + dy) * R + x * 2 + dx;
            ink += img[i];
            dist += sd[i];
            if (s[i] >= 0) { sum += s[i]; cnt += 1; }
        }
        const o = (y * FONT_TILE + x) * 3;
        tile[o] = Math.round((ink / 4) * 255);
        tile[o + 1] = cnt ? Math.round((sum / cnt) * 255) : 255;
        tile[o + 2] = encodeSigned(dist / 4);
    }
    const ink: NebbiaFontInk = { id: nextInkId++, tile, x0: -bx / a, y0: -by / a, size: R / a, width };
    return { ...g, ink };
};

/** 模型笔迹 → 普通的中线笔画字形：笔迹重采样到骨架字形的点密度，每个点带字体笔宽倍数（按书写位置分格算，不采样笔迹点处的距离）。 */
const buildPenGlyph = (canon: { img: Float32Array; a: number; bx: number; by: number }, polys: Pt[][], out: StrokesGpuGlyph): Glyph | null => {
    const { img, a } = canon;
    // 整字笔迹总长按原始笔迹算（模型的书写位置按它归一）；太短的笔画 measureGlyph 会丢，这里先挑好
    const lens = polys.map(p => p.reduce((sum, q, i) => (i ? sum + Math.hypot(q[0] - p[i - 1][0], q[1] - p[i - 1][1]) : 0), 0));
    const total = lens.reduce((x, y) => x + y, 0);
    const spans: PenSpan[] = [], kept: Pt[][] = [];
    let start = 0;
    polys.forEach((p, i) => {
        if (p.length > 1 && lens[i] > 0.005) {
            const pts = resamplePolyline(p, PEN_STEP);
            kept.push(pts);
            spans.push({ start, len: lens[i], n: pts.length });
        }
        start += lens[i];
    });
    const g = measureGlyph(kept);
    if (!g) return null;
    if (g.strokes.length === spans.length) {
        const widths = penWidthProfile(out.along, img, a, total, spans);
        const rel: number[] = [];
        g.strokes.forEach((st, k) => { st.pw = widths[k].map(relativeWidth); rel.push(...st.pw); });
        g.penRel = median(rel);
    }
    return g;
};
