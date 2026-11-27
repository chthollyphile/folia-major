// src/services/fontStrokes/fontStrokesRaster.ts
// 字体笔画的光栅和模型输入：把字用所选字体画成模型网格（256²）上的墨、算 full6 的输入特征。
// 模型输入照 ~/bihua hf/code/preprocess.py：墨的外框等比放进 256² 画布、最长边占 [-0.8, 0.8]，三通道是墨、墨内距离 / 12、
// 墨外距离 / 24（cv2 DIST_L2 3×3 的倒角距离）。这里不是把位图再缩放，而是按算好的变换直接用字体重画一遍。
// 推理一律用字重 400（INFERENCE_WEIGHT）：一个字体只存一份结果，别的字重用时把笔身膨胀到那个字重的墨上（fontStrokesFit.ts）。

/** 模型网格边长。 */
export const CANON = 256;
const R = CANON;
const SPAN = 0.8;
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

/** 推理用的字重：一个字体只算一份。 */
export const INFERENCE_WEIGHT = 400;
/** 量外框用的字号（em 像素）和画布：字可能伸出 em 框，四周留一个 em。 */
export const EM = 256;
/** 同 nebbiaSkeleton.ts：字号 0.78 em，基线在 0.8 em。 */
export const FONT_EM = 0.78;
export const BASELINE = 0.8;

/** 交给模型的字：汉字、平假名、片假名（模型训练时就有假名，同 AnimCJK 日文和 KanjiVG；拉丁字母等照旧走 AnimCJK 或骨架）。 */
export const isModelChar = (ch: string) => ch.length === 1 && (
    (ch >= '\u4e00' && ch <= '\u9fff') || (ch >= '\u3041' && ch <= '\u3096') || (ch >= '\u30a1' && ch <= '\u30fa') || ch === '\u30fc' || ch === '\u3005');

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;

const context = () => {
    if (!ctx) {
        canvas = document.createElement('canvas');
        canvas.width = canvas.height = EM * 3;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    }
    return ctx;
};

/** 用当前变换画一个字（白字黑底），读回 side² 的灰度（0..1）。只清、只读左上角 side²（画到外面的部分不读，下次画时也不碍事）。 */
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
    // 重画只要左上角 R²
    const img = drawChar(c, ch, font, R, [a, bx, by]);
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


/** 用已有的网格变换（某个字重的 renderCanon 结果）画另一个字重的墨：和那份结果同一个坐标系，量轮廓盖不盖得住用。 */
export const renderInkAt = (ch: string, fontFamily: string, fontWeight: number, canon: { a: number; bx: number; by: number }): Float32Array | null => {
    if (typeof document === 'undefined') return null;
    const c = context();
    if (!c) return null;
    return drawChar(c, ch, `${fontWeight} ${EM * FONT_EM}px ${fontFamily}`, R, [canon.a / EM, canon.bx, canon.by]);
};
