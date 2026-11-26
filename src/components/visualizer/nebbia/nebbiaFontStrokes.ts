import type { StrokesGpuGlyph } from '../../../services/analysis/beatThisGpu';
import { measureGlyph, type Glyph, type Pt } from './nebbiaGlyphs';

// src/components/visualizer/nebbia/nebbiaFontStrokes.ts
// 雾笺的字体笔画：中日文字（汉字、假名）用所选字体画出来，交给笔顺模型（bihua full6 + own2，GPU worker 里跑，
// beatThisGpu.ts runStrokesGpu）得到按书写顺序的笔迹和每个墨像素在整字书写里的位置；画的时候按这个位置把字体自己的墨
// 一笔一笔显出来（nebbiaMaskGl.ts 的字块），笔迹本身给笔尖、水珠用。
// 模型输入照 ~/bihua hf/code/preprocess.py：墨的外框等比放进 256² 画布、最长边占 [-0.8, 0.8]，三通道是墨、墨内距离 / 12、
// 墨外距离 / 24（cv2 DIST_L2 3×3 的倒角距离）。这里不是把位图再缩放，而是按算好的变换直接用字体重画一遍。
// 结果按「字体 + 字」缓存在内存里，跨歌复用；缓存和推理队列在 nebbiaFontStrokesQueue.ts。

const R = 256;
/** 字块边长：模型网格的一半（雾笺的遮罩是半分辨率，字块再大也看不出来）。 */
export const FONT_TILE = 128;
const SPAN = 0.8;
/** 量外框用的字号（em 像素）和画布：字可能伸出 em 框，四周留一个 em。 */
const EM = 256;
/** 同 nebbiaSkeleton.ts：字号 0.78 em，基线在 0.8 em。 */
const FONT_EM = 0.78;
const BASELINE = 0.8;

/** 一个字的字体墨：字块（RG8：墨、书写位置 0..1，墨外按最近的墨延伸）和它在字内 em 坐标里的位置。 */
export interface NebbiaFontInk {
    readonly id: number;
    readonly tile: Uint8Array;
    /** 字块左上角和边长（em 坐标）。 */
    readonly x0: number;
    readonly y0: number;
    readonly size: number;
    /** 平均笔画宽（em）：水珠挂在笔迹两侧多远。 */
    readonly width: number;
}

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

/** cv2.distanceTransform(DIST_L2, 3)：3×3 倒角（a = 0.955、b = 1.3693），图外不算零。返回每个 on 像素到最近 off 像素的距离。 */
export const chamferDistance = (on: Uint8Array, side: number): Float32Array => {
    const A = 0.955, B = 1.3693, INF = 1e9;
    const d = new Float32Array(side * side);
    for (let i = 0; i < d.length; i += 1) d[i] = on[i] ? INF : 0;
    for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
        const i = y * side + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + A);
        if (y > 0) {
            v = Math.min(v, d[i - side] + A);
            if (x > 0) v = Math.min(v, d[i - side - 1] + B);
            if (x < side - 1) v = Math.min(v, d[i - side + 1] + B);
        }
        d[i] = v;
    }
    for (let y = side - 1; y >= 0; y -= 1) for (let x = side - 1; x >= 0; x -= 1) {
        const i = y * side + x;
        if (!d[i]) continue;
        let v = d[i];
        if (x < side - 1) v = Math.min(v, d[i + 1] + A);
        if (y < side - 1) {
            v = Math.min(v, d[i + side] + A);
            if (x < side - 1) v = Math.min(v, d[i + side + 1] + B);
            if (x > 0) v = Math.min(v, d[i + side - 1] + B);
        }
        d[i] = v;
    }
    return d;
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

/** 书写位置（0..1，墨外 -1）按最近的墨往外延伸几圈：字块缩小、插值时字的边缘不掺进别的值。 */
const spread = (s: Float32Array, side: number, rounds: number) => {
    for (let r = 0; r < rounds; r += 1) {
        const next = s.slice();
        let changed = false;
        for (let y = 0; y < side; y += 1) for (let x = 0; x < side; x += 1) {
            const i = y * side + x;
            if (s[i] >= 0) continue;
            let sum = 0, n = 0;
            if (x > 0 && s[i - 1] >= 0) { sum += s[i - 1]; n += 1; }
            if (x < side - 1 && s[i + 1] >= 0) { sum += s[i + 1]; n += 1; }
            if (y > 0 && s[i - side] >= 0) { sum += s[i - side]; n += 1; }
            if (y < side - 1 && s[i + side] >= 0) { sum += s[i + side]; n += 1; }
            if (n) { next[i] = sum / n; changed = true; }
        }
        s.set(next);
        if (!changed) break;
    }
};

/** 模型结果 → 雾笺的字形：笔迹换到 em 坐标，字块缩到 FONT_TILE²。 */
export const buildGlyph = (canon: { img: Float32Array; a: number; bx: number; by: number }, out: StrokesGpuGlyph): Glyph | null => {
    const { img, a, bx, by } = canon;
    // 画布坐标 → 网格像素 (u + 1) · 128 → em
    const toEm = (u: number, v: number): Pt => [(((u + 1) * R) / 2 - bx) / a, (((v + 1) * R) / 2 - by) / a];
    const polys = out.pens.map(pen => {
        const pts: Pt[] = [];
        for (let i = 0; i + 1 < pen.length; i += 2) pts.push(toEm(pen[i], pen[i + 1]));
        return pts;
    });
    const g = measureGlyph(polys);
    if (!g) return null;
    const s = new Float32Array(R * R);
    let inkSum = 0;
    for (let i = 0; i < s.length; i += 1) {
        s[i] = out.along[i] === 65535 ? -1 : out.along[i] / 65534;
        inkSum += img[i];
    }
    spread(s, R, 6);
    const tile = new Uint8Array(FONT_TILE * FONT_TILE * 2);
    for (let y = 0; y < FONT_TILE; y += 1) for (let x = 0; x < FONT_TILE; x += 1) {
        let ink = 0, sum = 0, n = 0;
        for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
            const i = (y * 2 + dy) * R + x * 2 + dx;
            ink += img[i];
            if (s[i] >= 0) { sum += s[i]; n += 1; }
        }
        const o = (y * FONT_TILE + x) * 2;
        tile[o] = Math.round((ink / 4) * 255);
        tile[o + 1] = n ? Math.round((sum / n) * 255) : 255;
    }
    // 墨面积 / 笔迹总长 = 平均笔画宽（em）
    const width = inkSum / (a * a) / Math.max(g.total, 1e-3);
    const ink: NebbiaFontInk = { id: nextInkId++, tile, x0: -bx / a, y0: -by / a, size: R / a, width };
    return { ...g, ink };
};
