// src/components/visualizer/backgrounds/nomand/ascii/asciiImageMaps.ts
// What the ASCII effect reads from the picture once, after living-ascii's maps.js (MIT,
// Copyright (c) 2026 Yusen): heavily and lightly blurred luminance for the relighting, and the
// direction the texture runs at every point (structure tensor), which the stroke glyphs follow.
// The analysis runs on a copy ASCII_MAP_WIDTH wide, so blur sizes mean the same for any picture
// and a large one does not stall the song change; the blurs are scaled down from the 640 px the
// original was tuned at.

export const ASCII_MAP_WIDTH = 320;
const SIGMA_SCALE = ASCII_MAP_WIDTH / 640;

export interface AsciiImageMaps {
    /**
     * RGBA, rows bottom-up to match GL texture coordinates:
     * R ridge height, G clump height, BA texture direction as a doubled-angle vector (0.5 = 0)
     * whose length is how clearly the texture runs one way.
     */
    data: Uint8Array;
    width: number;
    height: number;
    /** The picture's dominant direction (radians, y up, pointing rightward): the default wind. */
    dominant: number;
}

/** Separable gaussian blur with clamped edges. */
const blur = (src: Float32Array, w: number, h: number, sigma: number) => {
    const r = Math.max(1, Math.ceil(sigma * 3));
    const k = new Float32Array(2 * r + 1);
    let sum = 0;
    for (let i = -r; i <= r; i++) {
        k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
        sum += k[i + r];
    }
    for (let i = 0; i < k.length; i++) k[i] /= sum;
    const tmp = new Float32Array(w * h);
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            let s = 0;
            for (let i = -r; i <= r; i++) s += src[row + Math.min(w - 1, Math.max(0, x + i))] * k[i + r];
            tmp[row + x] = s;
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let s = 0;
            for (let i = -r; i <= r; i++) s += tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x] * k[i + r];
            out[y * w + x] = s;
        }
    }
    return out;
};

/** Stretches the 1st..99th percentile to 0..1. */
const normalise = (a: Float32Array) => {
    const sorted = Float32Array.from(a).sort();
    const lo = sorted[Math.floor(a.length * 0.01)];
    const hi = sorted[Math.floor(a.length * 0.99)];
    const span = Math.max(hi - lo, 1e-6);
    return a.map(v => Math.min(1, Math.max(0, (v - lo) / span)));
};

/** Builds the maps from RGBA pixels (top-down, as getImageData gives them). */
export const deriveAsciiImageMaps = (pixels: Uint8ClampedArray, w: number, h: number): AsciiImageMaps => {
    const lum = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            lum[(h - 1 - y) * w + x] = (0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]) / 255;
        }
    }
    const ridge = normalise(blur(lum, w, h, 14 * SIGMA_SCALE));
    const clump = normalise(blur(lum, w, h, 3.5 * SIGMA_SCALE));
    const fine = blur(lum, w, h, Math.max(0.6, 1.0 * SIGMA_SCALE));
    const gxx = new Float32Array(w * h);
    const gyy = new Float32Array(w * h);
    const gxy = new Float32Array(w * h);
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx = (fine[i + 1] - fine[i - 1]) * 0.5;
            const gy = (fine[i + w] - fine[i - w]) * 0.5;
            gxx[i] = gx * gx;
            gyy[i] = gy * gy;
            gxy[i] = gx * gy;
        }
    }
    const tensorSigma = 4 * SIGMA_SCALE;
    const jxx = blur(gxx, w, h, tensorSigma);
    const jyy = blur(gyy, w, h, tensorSigma);
    const jxy = blur(gxy, w, h, tensorSigma);
    const data = new Uint8Array(w * h * 4);
    let sx = 0;
    let sy = 0;
    for (let i = 0; i < w * h; i++) {
        const tr = jxx[i] + jyy[i] + 1e-9;
        // The texture runs perpendicular to the luminance gradient: negate its doubled angle.
        const vx = -(jxx[i] - jyy[i]) / tr;
        const vy = -(2 * jxy[i]) / tr;
        sx += vx;
        sy += vy;
        data[i * 4] = ridge[i] * 255;
        data[i * 4 + 1] = clump[i] * 255;
        data[i * 4 + 2] = (0.5 + 0.5 * vx) * 255;
        data[i * 4 + 3] = (0.5 + 0.5 * vy) * 255;
    }
    // In (-π/2, π/2]: already points rightward. Near vertical, the wind blows upward.
    let dominant = 0.5 * Math.atan2(sy, sx);
    if (Math.abs(Math.cos(dominant)) < 0.2) dominant = Math.PI / 2;
    return { data, width: w, height: h, dominant };
};

/** Draws the picture ASCII_MAP_WIDTH wide and derives its maps; throws on a tainted picture. */
export const deriveAsciiImageMapsFromImage = (image: HTMLImageElement | ImageBitmap): AsciiImageMaps => {
    const w = ASCII_MAP_WIDTH;
    const h = Math.max(2, Math.round((ASCII_MAP_WIDTH * image.height) / Math.max(1, image.width)));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2d context unavailable');
    context.drawImage(image, 0, 0, w, h);
    return deriveAsciiImageMaps(context.getImageData(0, 0, w, h).data, w, h);
};
