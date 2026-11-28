// src/services/analysis/strokesWgsl/hostMath.ts
// The host-side pieces of the stroke-order pipeline (~/bihua hf/code/preprocess.py, seqmodel.py), as plain
// functions over Float32Arrays: full6's segments joined into pens, a pen resampled by arc length, the
// animation time constants (ownInput.pointTimes64 is the axis), own2's per-pen extra features, and the f32 fourier / seg_feat that the GPU kernels
// compute too (kept here as the reference their test compares against).
//
// Conventions (HANDOFF_FOLIA.md §2): canvas coordinates (x, y) in [-1, 1], pixel ((x+1)/2*256, (y+1)/2*256);
// a segment is K = 16 points; a pen takes 0.25 + length * 0.9, pens 0.18 apart, normalised to 0..1.

export const SEG_POINTS = 16;
export const PEN_SAMPLES = 32;
export const PAUSE = 0.18;
export const DUR0 = 0.25;
export const SPEED = 0.9;

/** torch.linspace(1, 0, 16) in float32: the first half start + step*i, the second end - step*(n-1-i). */
export const snapRamp = (): Float32Array => {
    const n = SEG_POINTS;
    const step = Math.fround(-1 / (n - 1));
    return Float32Array.from({ length: n }, (_, i) => (i < n / 2 ? Math.fround(1 + Math.fround(step * i)) : Math.fround(0 - Math.fround(step * (n - 1 - i)))));
};

/** fourier(p) of one point in f32: p[c] * 2^i * pi (i = 0..7) as [c][sin x8, cos x8], 32 values. */
export const fourierPoint = (x: number, y: number, out: Float32Array, at = 0): void => {
    const pi = Math.fround(Math.PI);
    [x, y].forEach((v, c) => {
        for (let i = 0; i < 8; i += 1) {
            const a = Math.fround(Math.fround(v) * Math.fround(2 ** i * pi));
            out[at + c * 16 + i] = Math.sin(a);
            out[at + c * 16 + 8 + i] = Math.cos(a);
        }
    });
};

/** seg_feat of one segment ([16, 2] flat): the 32 coordinates, then fourier of points 0, 5, 10, 15 - 160 values. */
export const segFeat = (seg: ArrayLike<number>): Float32Array => {
    const out = new Float32Array(160);
    for (let i = 0; i < 32; i += 1) out[i] = seg[i];
    [0, 5, 10, 15].forEach((k, j) => fourierPoint(seg[2 * k], seg[2 * k + 1], out, 32 + j * 32));
    return out;
};

/** full6's segments ([T, 16, 2] flat) and continue flags -> pens (flat [n, 2] each): a continued segment joins the last pen without its first point. */
export const joinSegments = (segs: Float32Array, cont: ArrayLike<number>, count = cont.length): Float32Array[] => {
    const pens: number[][] = [];
    for (let t = 0; t < count; t += 1) {
        const seg = Array.from(segs.subarray(t * 32, t * 32 + 32));
        if (cont[t] && pens.length) pens[pens.length - 1].push(...seg.slice(2));
        else pens.push(seg);
    }
    return pens.map(pen => Float32Array.from(pen));
};

/** Arc length of a polyline (flat [n, 2]). */
export const polylineLength = (pen: ArrayLike<number>): number => {
    let length = 0;
    for (let i = 2; i < pen.length; i += 2) length += Math.hypot(pen[i] - pen[i - 2], pen[i + 1] - pen[i - 1]);
    return length;
};

/** preprocess.resample: a polyline resampled to n points evenly by arc length, direction kept. */
export const resamplePen = (pen: ArrayLike<number>, n = PEN_SAMPLES): Float32Array => {
    const count = pen.length / 2;
    const s = new Float64Array(count);
    for (let i = 1; i < count; i += 1) s[i] = s[i - 1] + Math.hypot(pen[2 * i] - pen[2 * i - 2], pen[2 * i + 1] - pen[2 * i - 1]);
    const out = new Float32Array(2 * n);
    const total = s[count - 1];
    if (!(total >= 1e-6)) {
        for (let j = 0; j < n; j += 1) { out[2 * j] = pen[0]; out[2 * j + 1] = pen[1]; }
        return out;
    }
    let seg = 0;
    for (let j = 0; j < n; j += 1) {
        const t = (total * j) / (n - 1);
        while (seg < count - 2 && s[seg + 1] < t) seg += 1;
        const span = s[seg + 1] - s[seg];
        const f = span > 0 ? Math.min(1, Math.max(0, (t - s[seg]) / span)) : 0;
        out[2 * j] = pen[2 * seg] + (pen[2 * seg + 2] - pen[2 * seg]) * f;
        out[2 * j + 1] = pen[2 * seg + 1] + (pen[2 * seg + 3] - pen[2 * seg + 1]) * f;
    }
    return out;
};

/**
 * own2's 8 extra query features of pen k of n (resampled [32, 2] flat), as ownhead.py:
 * start xy, end xy, k/n, k/8, length of the resampled polyline, n/10 - in f32.
 */
export const ownExtra = (resampled: Float32Array, k: number, n: number, out: Float32Array, at = 0): void => {
    let length = 0;
    for (let i = 1; i < PEN_SAMPLES; i += 1) {
        const dx = Math.fround(resampled[2 * i] - resampled[2 * i - 2]);
        const dy = Math.fround(resampled[2 * i + 1] - resampled[2 * i - 1]);
        length = Math.fround(length + Math.fround(Math.sqrt(Math.fround(dx * dx + dy * dy))));
    }
    const nn = Math.max(n, 1);
    out.set([resampled[0], resampled[1], resampled[2 * PEN_SAMPLES - 2], resampled[2 * PEN_SAMPLES - 1], k / nn, k / 8, length, nn / 10], at);
};
