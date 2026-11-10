// src/components/visualizer/pixi/pixiTextureBudget.ts
// Snaps a renderer resolution down to Pixi's power-of-two texture pool, so a full-viewport
// filter pass stops paying for pixels nothing ever draws into.
//
// `TexturePool.getOptimalTexture` rounds every render target up to a power of two per axis
// (`nextPow2(ceil(frame * resolution - 1e-6))`) and keys the pool on that pair. A pass is
// therefore billed for the *bucket*, not for the frame: at the default `textureResolution` of
// 1.5 an 781x850 viewport rasterises to 1172x1275 and lands in a 2048x2048 texture - 16 MiB
// holding 5.7 MiB of picture, 71% of it waste. Tempera and sonnet each run several such passes
// plus the pooled copies the inversion filter's backdrop needs, so the waste multiplies.
//
// The cost is a step function, which is the part that is easy to get wrong: measured on an
// Intel iGPU, growing the window from 640x640 to 700x700 (+18% area) raised tempera's resident
// GEM from 628 to 822 MiB (+31%), because 1.5x700 crosses 1024 and every pooled target doubles
// on both axes at once. Nothing about the picture changed to justify that.
//
// So instead of lowering the resolution across the board - which costs sharpness everywhere and
// still lands in whatever bucket it lands in - this gives back only the resolution that buys a
// smaller bucket. On that same 781x850 viewport it returns 1.2047 rather than 1.5: 20% softer,
// but the pooled targets go 2048x2048 -> 1024x1024, a quarter of the memory, and the frame now
// fills 92% of its texture instead of 29%. Sharpness per byte goes up, not down.
//
// Deliberately conservative: it only ever considers a *single* step down per axis, and only
// accepts one inside `TEXTURE_POOL_MAX_RESOLUTION_DROP`. A viewport whose nearest boundary is
// far away (2000x1200 at 1.5 would need 1.024, a 32% drop) keeps the resolution it asked for -
// paying for the bucket is the lesser evil there.

/**
 * Pixi's own `nextPow2` (`maths/misc/pow2`), reproduced rather than imported.
 *
 * The pool's bucket maths is what this module has to predict exactly, so it has to be the same
 * function; but importing it from `pixi.js` would make this module - and the tuning resolvers
 * that call it - drag the whole renderer into any bundle and any test that touches them, while
 * everything else about Pixi here is behind `loadPixi`'s dynamic import.
 */
const nextPow2 = (value: number) => {
    let v = value + (value === 0 ? 1 : 0);
    v -= 1;
    v |= v >>> 1;
    v |= v >>> 2;
    v |= v >>> 4;
    v |= v >>> 8;
    v |= v >>> 16;
    return v + 1;
};

/**
 * The pooled texture size Pixi allocates for one axis of a full-viewport pass, in device pixels.
 * Mirrors `TexturePool.getOptimalTexture`, epsilon included - that `- 1e-6` is what keeps a
 * candidate landing exactly on a boundary from rounding back up over float error.
 */
export const texturePoolAxis = (cssSize: number, resolution: number) => (
    nextPow2(Math.ceil((cssSize * resolution) - 1e-6))
);

/**
 * How much resolution a snap may give up, as a fraction of what was asked for.
 *
 * A step down always halves one axis of the bucket, so the memory won is 2x or 4x; 25% is the
 * point past which the softening starts to read as a lower-quality render rather than as the
 * same render costing less. The default 1.5 tolerates anything down to 1.125, which covers the
 * common desktop viewports - a 781x850 one needs 1.2047 - without reaching for 1.0.
 */
export const TEXTURE_POOL_MAX_RESOLUTION_DROP = 0.25;

/**
 * The highest resolution that puts this axis one pool bucket lower, or null when there is no
 * bucket below (a single-pixel bucket has nothing under it).
 */
const stepDownCandidate = (cssSize: number, resolution: number) => {
    const bucket = texturePoolAxis(cssSize, resolution);
    if (bucket < 2) return null;
    return (bucket / 2) / cssSize;
};

/**
 * Returns the resolution to actually render at: `resolution` itself, or the highest value within
 * `maxDrop` of it that lands the pooled render targets in a smaller bucket.
 *
 * Both axes are tried because they are not interchangeable - the axis that needs the *larger*
 * cut can be the one that pays for itself twice, by dropping the other axis on the way past. On
 * 1030x520 at 1.0, snapping for width alone (0.994) halves the bucket to 1024x1024, while
 * snapping for height (0.985) reaches 1024x512: another half, for another 0.9% of resolution.
 * So candidates are ranked by the bucket area they produce, not by how little they give up.
 */
export const snapResolutionToTexturePool = (
    cssWidth: number,
    cssHeight: number,
    resolution: number,
    maxDrop: number = TEXTURE_POOL_MAX_RESOLUTION_DROP,
): number => {
    if (![cssWidth, cssHeight, resolution].every(value => Number.isFinite(value) && value > 0)) {
        return resolution;
    }
    const lowest = resolution * (1 - Math.min(Math.max(maxDrop, 0), 1));
    const candidates = [
        stepDownCandidate(cssWidth, resolution),
        stepDownCandidate(cssHeight, resolution),
    ].filter((candidate): candidate is number => (
        candidate !== null && candidate > 0 && candidate < resolution && candidate >= lowest
    ));

    let best = resolution;
    // Bucket area is monotonic in resolution, so the incumbent can only ever be beaten outright.
    let bestArea = texturePoolAxis(cssWidth, resolution) * texturePoolAxis(cssHeight, resolution);
    candidates.forEach(candidate => {
        const area = texturePoolAxis(cssWidth, candidate) * texturePoolAxis(cssHeight, candidate);
        if (area >= bestArea) return;
        bestArea = area;
        best = candidate;
    });
    return best;
};
