import type { StrokesGpuGlyph } from '../../../services/analysis/beatThisGpu';
import { clamp } from './nebbiaConstants';
import { measureGlyph, type Glyph, type Pt } from './nebbiaGlyphs';
import { glyphFeatures as rasterFeatures, isModelChar as rasterIsModelChar, renderCanon as rasterRenderCanon } from '../../../services/fontStrokes/fontStrokesRaster';
import { CANON, encodeSigned, halfWidthAt, median, PEN_STEP, penWidthProfile, propagateNearest, relativeWidth, resamplePolyline, SPREAD_R, signedField, type PenSpan } from './nebbiaFontField';

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
// 光栅和模型输入已挪到 services/fontStrokes/fontStrokesRaster.ts；这里原样转出，雾笺和旧队列照旧从这里取。
export const renderCanon = rasterRenderCanon;
export const glyphFeatures = rasterFeatures;
export const isModelChar = rasterIsModelChar;
/**
 * 字体笔画的两种画法：false（默认）= 模型笔迹当普通的中线笔画画（珠子、粗细、手写变形都照骨架字形，笔宽剖面取自字体）；
 * true = 原来的字块（字体自己的墨按书写位置显出来，粗细设置靠有符号距离外扩）。
 */
export const FONT_INK_TILE = false as boolean;
/** 典型笔宽的取值范围（em）。 */
const WIDTH_MIN = 0.02, WIDTH_MAX = 0.12;
/** 字块边长：模型网格的一半（雾笺的遮罩是半分辨率，字块再大也看不出来）。 */
export const FONT_TILE = 128;
let nextInkId = 1;
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
