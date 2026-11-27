import { CANON, propagateNearest, SPREAD_R } from '../nebbia/nebbiaFontField';

// src/components/visualizer/fontStrokes/strokeReveal.ts
// 手写笔画的遮罩：笔顺模型给的「每个墨像素的书写位置」缩成 128² 的字节图，连同它在字体单位里的位置一起存下来；
// 画的时候先把字用调用方自己的字体和颜色正常画到一张临时画布上，再按当前进度用遮罩把没写到的部分擦掉，
// 最后整张贴回目标画布（目标画布当前的阴影 / 辉光只落在已写出的墨上）。字的边缘全来自 fillText，遮罩只决定「写到哪了」。

/** 遮罩边长：模型网格（256²）的一半。 */
export const REVEAL_SIDE = CANON / 2;
/** 遮罩里「永远写不到」的值（0..254 是书写位置）。 */
export const REVEAL_NEVER = 255;
/** 书写前沿的柔边宽度（占整个书写位置 0..1 的比例）。 */
export const REVEAL_SOFT = 0.05;
/** 同 nebbiaFontGlyph.ts 的 renderCanon：字号 0.78 em，水平中心在 0.5 em，字母基线在 0.8 em。 */
const FONT_EM = 0.78;
const CENTER_X = 0.5;
const BASELINE_Y = 0.8;

/** 一个字的手写遮罩，位置单位是「每 1 px 字号」：相对字的水平中心和字母基线（y 向下）。 */
export interface StrokeReveal {
    /** REVEAL_SIDE² 个字节：0..254 书写位置，255 永远写不到。 */
    readonly mask: Uint8Array;
    /** 遮罩左上角相对字的水平中心 / 字母基线的位置（字体单位 = 像素 / 字号）。 */
    readonly x0: number;
    readonly y0: number;
    /** 遮罩边长（字体单位）。 */
    readonly size: number;
}

/** 模型的书写位置（0..65534）→ 遮罩字节（0..254）。 */
const ALONG_MAX = 65534;

/**
 * 模型网格上的书写位置 → 手写遮罩。先像字块那样把书写位置往墨外按最近的墨延伸一圈（字边缘的抗锯齿像素也要有值），
 * 再 2×2 取有效值的平均缩到 128²。位置换算：网格像素 g → em e = (g − b) / a → 字体单位 (e − 0.5) / 0.78（横）、(e − 0.8) / 0.78（纵）。
 * 整张图都没有有效值时返回 null。
 */
export const buildStrokeReveal = (
    canon: { img: Float32Array; a: number; bx: number; by: number },
    along: Uint16Array,
): StrokeReveal | null => {
    const R = CANON, n = R * R;
    const s = new Float32Array(n), inkMask = new Uint8Array(n);
    let valid = false;
    for (let i = 0; i < n; i += 1) {
        inkMask[i] = canon.img[i] > 0.5 ? 1 : 0;
        s[i] = along[i] === 65535 ? -1 : along[i] / ALONG_MAX;
        if (s[i] >= 0) valid = true;
    }
    if (!valid) return null;
    propagateNearest(s, R, SPREAD_R, inkMask);
    const mask = new Uint8Array(REVEAL_SIDE * REVEAL_SIDE);
    for (let y = 0; y < REVEAL_SIDE; y += 1) for (let x = 0; x < REVEAL_SIDE; x += 1) {
        let sum = 0, count = 0;
        for (let dy = 0; dy < 2; dy += 1) for (let dx = 0; dx < 2; dx += 1) {
            const v = s[(y * 2 + dy) * R + x * 2 + dx];
            if (v >= 0) { sum += v; count += 1; }
        }
        mask[y * REVEAL_SIDE + x] = count ? Math.min(REVEAL_NEVER - 1, Math.round((sum / count) * (REVEAL_NEVER - 1))) : REVEAL_NEVER;
    }
    const { a, bx, by } = canon;
    return {
        mask,
        x0: (-bx / a - CENTER_X) / FONT_EM,
        y0: (-by / a - BASELINE_Y) / FONT_EM,
        size: (R / a) / FONT_EM,
    };
};

const smoothstep = (edge0: number, edge1: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
};

/**
 * 某个进度（0..1）下遮罩的透明度：写到的位置 1，没写到的 0，前沿一段柔边（alpha = 1 − smoothstep(q − soft, q, v)）。
 * 前沿位置 q = progress × (1 + soft)：进度 0 时什么都没有，进度 1 时整张（含柔边）都已写出。写进 out 的 alpha 通道（第 4 个字节）。
 */
export const fillRevealAlpha = (mask: Uint8Array, progress: number, out: Uint8ClampedArray, soft = REVEAL_SOFT) => {
    const q = Math.min(1, Math.max(0, progress)) * (1 + soft);
    for (let i = 0; i < mask.length; i += 1) {
        const v = mask[i] === REVEAL_NEVER ? 2 : mask[i] / (REVEAL_NEVER - 1);
        out[i * 4 + 3] = Math.round((1 - smoothstep(q - soft, q, v)) * 255);
    }
};

/** 字在目标画布世界坐标里的位置：水平中心、字母基线、字号。 */
export interface StrokeRevealPlace {
    cx: number;
    baseline: number;
    fontPx: number;
}

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

interface RevealCanvases {
    scratch: HTMLCanvasElement;
    scratchCtx: CanvasRenderingContext2D;
    maskCanvas: HTMLCanvasElement;
    maskCtx: CanvasRenderingContext2D;
    maskData: ImageData;
}
let canvases: RevealCanvases | null | undefined;
/** 共用的临时画布和遮罩画布，第一次用到时才建。 */
const ensureCanvases = (): RevealCanvases | null => {
    if (canvases !== undefined) return canvases;
    const scratch = document.createElement('canvas');
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskCanvas.height = REVEAL_SIDE;
    const scratchCtx = scratch.getContext('2d'), maskCtx = maskCanvas.getContext('2d');
    canvases = scratchCtx && maskCtx ? { scratch, scratchCtx, maskCanvas, maskCtx, maskData: maskCtx.createImageData(REVEAL_SIDE, REVEAL_SIDE) } : null;
    return canvases;
};
/** 临时画布最大边长（像素），防止极端缩放时分配过大。 */
const SCRATCH_MAX = 4096;
/** 临时画布四周多留的设备像素（辉光之外的抗锯齿边）。 */
const PAD_PX = 2;

/**
 * 把一个字按进度 progress（0..1）写出来：drawGlyph 在临时画布上用调用方的字体 / 颜色把字正常画一遍（坐标是目标画布的世界坐标，
 * 不要带阴影），再用遮罩擦掉没写到的部分，最后贴到 target（target 当前的阴影只落在已写出的墨上）。
 * 临时画布的像素格和 target 的设备像素格对齐（原点取整），贴回来是 1:1，字的亚像素位置和直接 fillText 一致。
 * 画布拿不到、缩放不合法时返回 false，调用方改用普通画法。
 */
export const drawStrokeRevealChar = (
    target: CanvasRenderingContext2D,
    reveal: StrokeReveal,
    progress: number,
    place: StrokeRevealPlace,
    drawGlyph: (ctx: CanvasRenderingContext2D) => void,
): boolean => {
    if (typeof document === 'undefined') return false;
    const m = target.getTransform();
    const s = Math.hypot(m.a, m.b);
    if (!(s > 0) || !Number.isFinite(s) || !Number.isFinite(place.cx + place.baseline + place.fontPx)) return false;
    const rw = reveal.size * place.fontPx;
    const rx = place.cx + reveal.x0 * place.fontPx, ry = place.baseline + reveal.y0 * place.fontPx;
    // 原点落在 target 的整数设备像素上
    const pad = PAD_PX / s;
    const originX = (Math.floor(m.a * (rx - pad) + m.e) - m.e) / m.a;
    const originY = (Math.floor(m.d * (ry - pad) + m.f) - m.f) / m.d;
    const W = Math.ceil((rx + rw + pad - originX) * s), H = Math.ceil((ry + rw + pad - originY) * s);
    if (W < 1 || H < 1 || W > SCRATCH_MAX || H > SCRATCH_MAX) return false;

    const ready = ensureCanvases();
    if (!ready) return false;
    const { scratch, scratchCtx, maskCanvas, maskCtx, maskData } = ready;
    // 只增不减：反复改画布尺寸会清空并重新分配
    if (scratch.width < W || scratch.height < H) {
        scratch.width = Math.max(scratch.width, W);
        scratch.height = Math.max(scratch.height, H);
    }

    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'source-over';
    scratchCtx.clearRect(0, 0, W, H);
    scratchCtx.setTransform(s, 0, 0, s, -originX * s, -originY * s);
    scratchCtx.save();
    drawGlyph(scratchCtx);
    scratchCtx.restore();

    fillRevealAlpha(reveal.mask, progress, maskData.data);
    maskCtx.putImageData(maskData, 0, 0);
    scratchCtx.setTransform(1, 0, 0, 1, 0, 0);
    scratchCtx.globalCompositeOperation = 'destination-in';
    scratchCtx.drawImage(maskCanvas, 0, 0, REVEAL_SIDE, REVEAL_SIDE, (rx - originX) * s, (ry - originY) * s, rw * s, rw * s);
    scratchCtx.globalCompositeOperation = 'source-over';

    target.drawImage(scratch, 0, 0, W, H, originX, originY, W / s, H / s);
    return true;
};
