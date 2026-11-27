// src/components/visualizer/nebbia/nebbiaGlyphShape.ts
// 雾笺字形的数据结构（几笔中线、累计弧长、字体笔宽倍数）和量弧长：不依赖图标、笔顺数据、笔画服务，字形的各个来源都从这里取。

export type Pt = [number, number];
export interface GlyphStroke {
    pts: Pt[]; cum: number[]; len: number;
    /** 字体笔画（笔迹带字体笔宽）：每个点处的笔宽相对骨架字形笔宽的倍数（nebbiaFontField.ts）。 */
    pw?: number[];
}
export interface Glyph {
    strokes: GlyphStroke[];
    total: number;
    /** 字体笔画走普通中线笔画的字：各点笔宽倍数 pw 的中位数（水珠大小、水痕宽度按它走）。 */
    penRel?: number;
}

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
