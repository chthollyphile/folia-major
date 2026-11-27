import { EM_UNITS, type FontStrokesGlyph } from '../../../services/fontStrokes/fontStrokesOutline';
import { BASELINE, FONT_EM } from '../../../services/fontStrokes/fontStrokesRaster';
import { polylineLength, resolveStrokeProgress } from './strokeWriteTiming';

// src/components/visualizer/fontStrokes/strokeWriteCanvas.ts
// canvas 写字（照 AnimCJK）：每笔按进度沿中线画一段圆头笔刷（宽 brush），裁到这一笔自己的轮廓里，所有笔合起来做遮罩，
// 再用调用方自己的 fillText（同字体、字号、字重、颜色）把字画进遮罩（source-in），贴回目标画布——目标画布当前的辉光只落在写出的墨上。
// 写完的笔直接填自己的轮廓并往外描 1 个设备像素（相邻两笔的轮廓共用一条边，不描会在抗锯齿处透出细缝）。所有笔写完时直接画整字。
// 笔画数据来自 services/fontStrokes：em 坐标（× EM_UNITS），字号 FONT_EM em、水平中心 0.5 em、字母基线 BASELINE em（同 renderCanon）。

/** 笔刷宽度的单位：1/256 em（同 fontStrokesOutline 的 BRUSH_UNITS）。 */
const BRUSH_PER_EM = 256;
/** 一笔最少按这么长（em）分时间：点、短撇不至于一闪而过。 */
const MIN_STROKE_EM = 0.04;
/** 写完的笔往外描多少设备像素，盖住相邻笔共用边上的抗锯齿缝。 */
const SEAM_PX = 1;
/** 临时画布四周多留的设备像素。 */
const PAD_PX = 2;
/** 临时画布最大边长（像素），防止极端缩放时分配过大。 */
const SCRATCH_MAX = 4096;

/** 字在目标画布世界坐标里的位置：水平中心、字母基线、字号（px）。 */
export interface StrokeWritePlace {
    cx: number;
    baseline: number;
    fontPx: number;
}

/** 笔画坐标（em × EM_UNITS）→ 世界坐标：world = t + u · k。 */
export const strokeUnitsToWorld = ({ cx, baseline, fontPx }: StrokeWritePlace): { k: number; tx: number; ty: number } => {
    const perEm = fontPx / FONT_EM;
    return { k: perEm / EM_UNITS, tx: cx - 0.5 * perEm, ty: baseline - BASELINE * perEm };
};

/** 字母基线比 textBaseline = 'middle' 那条线低多少 px（字体盒的上沿是同一个点，两种基线各量一次上升量相减）。 */
const dropCache = new Map<string, number>();
let probeCtx: CanvasRenderingContext2D | null = null;
export const alphabeticDropBelowMiddle = (font: string): number => {
    const cached = dropCache.get(font);
    if (cached !== undefined) return cached;
    if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d');
    if (!probeCtx) return 0;
    probeCtx.font = font;
    probeCtx.textBaseline = 'alphabetic';
    const alphabetic = probeCtx.measureText('字').fontBoundingBoxAscent;
    probeCtx.textBaseline = 'middle';
    const middle = probeCtx.measureText('字').fontBoundingBoxAscent;
    const drop = Number.isFinite(alphabetic - middle) ? alphabetic - middle : 0;
    if (dropCache.size > 64) dropCache.clear();
    dropCache.set(font, drop);
    return drop;
};

/** textAlign 'left' + textBaseline 'middle' 在 (x, middleY) 画的一个字 → 它的写字位置（字心 = x + 字宽一半，字母基线 = middle 往下 alphabeticDropBelowMiddle）。 */
export const placeLeftMiddleGlyph = (ctx: CanvasRenderingContext2D, grapheme: string, x: number, middleY: number, fontPx: number): StrokeWritePlace => ({
    cx: x + ctx.measureText(grapheme).width * 0.5,
    baseline: middleY + alphabeticDropBelowMiddle(ctx.font),
    fontPx,
});

/** 一个字画的时候要的东西（第一次画时建，跟着字的记录走）。坐标都是 em × EM_UNITS。 */
interface PreparedGlyph {
    outlines: (Path2D | null)[];
    pens: (Path2D | null)[];
    lengths: Float32Array;
    /** 分时间的权重：没有轮廓的笔 0（不画、不占时间）。 */
    weights: Float32Array;
    brush: Float32Array;
    /** 每笔此刻的进度（每次画时重写）。 */
    progress: Float32Array;
    /** 所有轮廓的外框 [x0, y0, x1, y1]；没有轮廓时 null。 */
    box: [number, number, number, number] | null;
}
const prepared = new WeakMap<FontStrokesGlyph, PreparedGlyph>();

const ringsPath = (rings: Int16Array[]): Path2D | null => {
    if (!rings.length) return null;
    const path = new Path2D();
    for (const ring of rings) {
        for (let i = 0; i + 1 < ring.length; i += 2) {
            if (i === 0) path.moveTo(ring[i], ring[i + 1]); else path.lineTo(ring[i], ring[i + 1]);
        }
        path.closePath();
    }
    return path;
};

const penPath = (pen: Int16Array): Path2D | null => {
    if (pen.length < 4) return null;
    const path = new Path2D();
    path.moveTo(pen[0], pen[1]);
    for (let i = 2; i + 1 < pen.length; i += 2) path.lineTo(pen[i], pen[i + 1]);
    return path;
};

/** 每笔的分时权重：有轮廓的笔按中线长度（至少 MIN_STROKE_EM），没有轮廓的笔 0。纯函数，单测用。 */
export const strokeWriteWeights = (glyph: FontStrokesGlyph): Float32Array => {
    const n = glyph.pens.length;
    const weights = new Float32Array(n);
    for (let k = 0; k < n; k += 1) {
        if (!glyph.outlines[k]?.length || !glyph.brush[k]) continue;
        weights[k] = Math.max(polylineLength(glyph.pens[k]), MIN_STROKE_EM * EM_UNITS);
    }
    return weights;
};

const prepare = (glyph: FontStrokesGlyph): PreparedGlyph => {
    const hit = prepared.get(glyph);
    if (hit) return hit;
    const n = glyph.pens.length;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const rings of glyph.outlines) for (const ring of rings) for (let i = 0; i + 1 < ring.length; i += 2) {
        if (ring[i] < x0) x0 = ring[i];
        if (ring[i] > x1) x1 = ring[i];
        if (ring[i + 1] < y0) y0 = ring[i + 1];
        if (ring[i + 1] > y1) y1 = ring[i + 1];
    }
    const entry: PreparedGlyph = {
        outlines: Array.from({ length: n }, (_, k) => ringsPath(glyph.outlines[k] ?? [])),
        pens: glyph.pens.map(penPath),
        lengths: Float32Array.from(glyph.pens, pen => polylineLength(pen)),
        weights: strokeWriteWeights(glyph),
        brush: Float32Array.from(glyph.brush, b => (b * EM_UNITS) / BRUSH_PER_EM),
        progress: new Float32Array(n),
        box: x1 >= x0 ? [x0, y0, x1, y1] : null,
    };
    prepared.set(glyph, entry);
    return entry;
};

let scratch: HTMLCanvasElement | null = null;
let scratchCtx: CanvasRenderingContext2D | null = null;
/** 共用的临时画布，只增不减（反复改尺寸会清空并重新分配）。 */
const ensureScratch = (w: number, h: number): CanvasRenderingContext2D | null => {
    if (!scratch) {
        scratch = document.createElement('canvas');
        scratchCtx = scratch.getContext('2d');
    }
    if (!scratchCtx) return null;
    if (scratch.width < w || scratch.height < h) {
        scratch.width = Math.max(scratch.width, w);
        scratch.height = Math.max(scratch.height, h);
    }
    return scratchCtx;
};
const dash = [0, 0];
const noDash: number[] = [];

export interface StrokeWriteOptions {
    /** 所有笔都写完时也走遮罩（量轮廓和墨对不对得上用）；默认写完直接画整字。 */
    forceMask?: boolean;
}

/**
 * 按整字进度 progress（0..1，已缓出）把一个字写出来。drawGlyph 用调用方的字体 / 字号 / 字重 / 颜色在给它的画布上把字正常画一遍
 * （世界坐标，不要带阴影）；写到的部分贴到 target（target 当前的阴影 / 辉光只落在写出的墨上）。
 * 临时画布的像素格和 target 的设备像素格对齐（原点取整），贴回来是 1:1，字的亚像素位置和直接 fillText 一致。
 * 所有笔写完时直接在 target 上 drawGlyph。画布拿不到、变换带旋转或尺寸不合法时返回 false，调用方改用普通画法。
 */
export const drawStrokeWriteGlyph = (
    target: CanvasRenderingContext2D,
    glyph: FontStrokesGlyph,
    progress: number,
    place: StrokeWritePlace,
    drawGlyph: (ctx: CanvasRenderingContext2D) => void,
    options: StrokeWriteOptions = {},
): boolean => {
    if (typeof document === 'undefined' || typeof Path2D === 'undefined') return false;
    const g = prepare(glyph);
    if (!g.box) return false;
    const strokeProgress = resolveStrokeProgress(g.weights, progress, g.progress);
    let done = true;
    for (let k = 0; k < strokeProgress.length; k += 1) if (g.weights[k] > 0 && strokeProgress[k] < 1) { done = false; break; }
    if (done && !options.forceMask) {
        target.save();
        drawGlyph(target);
        target.restore();
        return true;
    }

    const m = target.getTransform();
    if (m.b !== 0 || m.c !== 0 || !(m.a > 0) || !(m.d > 0)) return false;
    const { k, tx, ty } = strokeUnitsToWorld(place);
    if (!(k > 0) || !Number.isFinite(tx + ty)) return false;
    const [bx0, by0, bx1, by1] = g.box;
    // 外框（设备像素），原点落在 target 的整数设备像素上
    const ox = Math.floor(m.a * (tx + bx0 * k) + m.e - PAD_PX), oy = Math.floor(m.d * (ty + by0 * k) + m.f - PAD_PX);
    const W = Math.ceil(m.a * (tx + bx1 * k) + m.e + PAD_PX) - ox, H = Math.ceil(m.d * (ty + by1 * k) + m.f + PAD_PX) - oy;
    if (!(W >= 1 && H >= 1 && W <= SCRATCH_MAX && H <= SCRATCH_MAX)) return false;
    const ctx = ensureScratch(W, H);
    if (!ctx || !scratch) return false;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, W, H);
    // 遮罩：笔画坐标 → 临时画布的设备像素
    ctx.setTransform(m.a * k, 0, 0, m.d * k, m.a * tx + m.e - ox, m.d * ty + m.f - oy);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#fff';
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash(noDash);
    const unitsPerPx = 1 / (m.a * k);
    for (let s = 0; s < strokeProgress.length; s += 1) {
        const p = strokeProgress[s];
        const outline = g.outlines[s];
        if (!outline || g.weights[s] <= 0 || p <= 0) continue;
        const pen = g.pens[s];
        if (p >= 1 || !pen || g.lengths[s] <= 0) {
            ctx.fill(outline, 'nonzero');
            ctx.lineWidth = 2 * SEAM_PX * unitsPerPx;
            ctx.stroke(outline);
            continue;
        }
        ctx.save();
        ctx.clip(outline, 'nonzero');
        ctx.lineWidth = g.brush[s];
        dash[0] = g.lengths[s] * p;
        dash[1] = g.lengths[s] * 2 + g.brush[s];
        ctx.setLineDash(dash);
        ctx.stroke(pen);
        ctx.restore();
    }
    ctx.setLineDash(noDash);
    // 字只留在遮罩里
    ctx.setTransform(m.a, 0, 0, m.d, m.e - ox, m.f - oy);
    ctx.globalCompositeOperation = 'source-in';
    ctx.save();
    drawGlyph(ctx);
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';

    target.drawImage(scratch, 0, 0, W, H, (ox - m.e) / m.a, (oy - m.f) / m.d, W / m.a, H / m.d);
    return true;
};
