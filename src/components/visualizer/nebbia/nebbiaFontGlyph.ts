import { EM_UNITS, type FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import { measureGlyph, type Glyph, type Pt } from './nebbiaGlyphShape';
import { alongFromOutlines } from './nebbiaFontAlong';
import { CANON, median, PEN_STEP, penWidthProfile, relativeWidth, resamplePolyline, type PenSpan } from './nebbiaFontField';

// src/components/visualizer/nebbia/nebbiaFontGlyph.ts
// 字体笔画的字形：笔画服务（services/fontStrokes）存下的中线做成雾笺的中线笔画，每个点带字体笔宽倍数。
// 笔宽按当前字重的墨现量：当前字重的字画到模型网格（renderCanon），用存下的轮廓还原每个墨像素归哪一笔、写到哪（nebbiaFontAlong.ts），
// 再照原来的量法（penWidthProfile，墨按书写位置分格）算。服务按雾笺的显示字重推理（字体键带字重），轮廓和现画的墨是同一个字重。

/** 模型网格上一个字的墨和 网格像素 → em 的变换（em = (px − b) / a），同 fontStrokesRaster.renderCanon。 */
export interface FontCanon { img: Float32Array; a: number; bx: number; by: number }

/**
 * 中线（em，书写顺序）+ 每个墨像素的书写位置（0..65534，65535 不是墨）+ 墨 → 雾笺的中线笔画字形：
 * 笔迹重采样到骨架字形的点密度，每个点带字体笔宽倍数（按书写位置分格算，不采样笔迹点处的距离）。
 */
export const penGlyph = (polys: Pt[][], along: ArrayLike<number>, img: Float32Array, a: number): Glyph | null => {
    // 整字笔迹总长按原始笔迹算（书写位置按它归一）；太短的笔画 measureGlyph 会丢，这里先挑好
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
        const widths = penWidthProfile(along, img, a, total, spans);
        const rel: number[] = [];
        g.strokes.forEach((st, k) => { st.pw = widths[k].map(relativeWidth); rel.push(...st.pw); });
        g.penRel = median(rel);
    }
    return g;
};

/** 模型直接给的画布坐标笔迹（-1..1，y 向下）→ em 折线：画布坐标 → 网格像素 (u + 1) · 128 → em。 */
export const modelPolys = (canon: Omit<FontCanon, 'img'>, pens: readonly Float32Array[]): Pt[][] => pens.map(pen => {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < pen.length; i += 2) pts.push([(((pen[i] + 1) * CANON) / 2 - canon.bx) / canon.a, (((pen[i + 1] + 1) * CANON) / 2 - canon.by) / canon.a]);
    return pts;
});

/** 服务存下的中线（em × EM_UNITS）→ em 折线。 */
export const strokesPolys = (strokes: FontStrokesGlyph): Pt[][] => strokes.pens.map(pen => {
    const pts: Pt[] = [];
    for (let i = 0; i + 1 < pen.length; i += 2) pts.push([pen[i] / EM_UNITS, pen[i + 1] / EM_UNITS]);
    return pts;
});

/** 服务存下的笔画 + 当前字重画到网格上的墨 → 雾笺的字形（书写位置从轮廓还原）。 */
export const buildFontStrokesNebbiaGlyph = (strokes: FontStrokesGlyph, canon: FontCanon): Glyph | null => {
    const polys = strokesPolys(strokes);
    const along = alongFromOutlines(polys, strokes.outlines, EM_UNITS, canon.img, canon);
    return penGlyph(polys, along, canon.img, canon.a);
};
