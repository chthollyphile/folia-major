import { describe, expect, it } from 'vitest';
import {
    TEXTURE_POOL_MAX_RESOLUTION_DROP,
    snapResolutionToTexturePool,
    texturePoolAxis,
} from '@/components/visualizer/pixi/pixiTextureBudget';

// test/unit/visualizer/pixiTextureBudget.test.ts
// Pixi bills a filter pass for its power-of-two pool bucket, not for the frame inside it, so the
// cost of `textureResolution` is a step function: on an Intel iGPU, growing tempera's window
// from 640x640 to 700x700 (+18% area) took resident GEM from 628 to 822 MiB, purely because
// 1.5x700 crosses 1024. These lock the snap that gives back only the resolution that buys a
// smaller bucket, and - just as important - the refusal to snap when the boundary is far away.

/** The bucket pair a full-viewport pass lands in, as `TexturePool.getOptimalTexture` computes it. */
const bucket = (width: number, height: number, resolution: number) => [
    texturePoolAxis(width, resolution),
    texturePoolAxis(height, resolution),
];

describe('texturePoolAxis', () => {
    it('mirrors Pixi\'s ceil-then-nextPow2 bucketing', () => {
        expect(texturePoolAxis(781, 1.5)).toBe(2048); // 1171.5 -> 1172 -> 2048
        expect(texturePoolAxis(781, 1)).toBe(1024);
        expect(texturePoolAxis(1024, 1)).toBe(1024); // already a power of two, stays put
        expect(texturePoolAxis(1025, 1)).toBe(2048);
    });

    it('does not round a boundary back up over float error', () => {
        // 1024/850 * 850 lands a hair above 1024 in binary floating point; Pixi's `- 1e-6` is
        // what keeps that from becoming a 2048 bucket, and the snap depends on it holding.
        expect(texturePoolAxis(850, 1024 / 850)).toBe(1024);
        expect(texturePoolAxis(781, 1024 / 781)).toBe(1024);
    });
});

describe('snapResolutionToTexturePool', () => {
    it('gives up 20% of a 1.5x default to quarter the pooled targets', () => {
        // The measured case: 781x850 at 1.5 rasterises to 1172x1275 and lands in 2048x2048,
        // 71% of which is never drawn into.
        expect(bucket(781, 850, 1.5)).toEqual([2048, 2048]);

        const snapped = snapResolutionToTexturePool(781, 850, 1.5);

        expect(snapped).toBeCloseTo(1024 / 850, 6);
        expect(bucket(781, 850, snapped)).toEqual([1024, 1024]);
    });

    it('prefers the axis that drops both buckets over the one that gives up least', () => {
        // Width alone snaps at 1024/1030 and reaches 1024x1024. Height snaps lower, at 512/520,
        // but takes width past its own boundary on the way and reaches 1024x512 - another half,
        // for another 0.9% of resolution. Ranking by bucket area is what finds that.
        expect(bucket(1030, 520, 1)).toEqual([2048, 1024]);

        const snapped = snapResolutionToTexturePool(1030, 520, 1);

        expect(snapped).toBeCloseTo(512 / 520, 6);
        expect(bucket(1030, 520, snapped)).toEqual([1024, 512]);
    });

    it('keeps the requested resolution when the nearest boundary costs too much', () => {
        // 2000x1200 at 1.5 would need 1.024 to drop the width bucket - a 32% cut. Paying for
        // the bucket is the lesser evil; softening the whole picture by a third is not.
        expect(snapResolutionToTexturePool(2000, 1200, 1.5)).toBe(1.5);
    });

    it('never returns more than it was asked for, or less than the drop allows', () => {
        const sizes = [320, 480, 640, 781, 850, 1024, 1030, 1280, 1920, 2560];
        const floors = [0.5, 1, 1.25, 1.5, 2, 3];
        sizes.forEach(width => sizes.forEach(height => floors.forEach(resolution => {
            const snapped = snapResolutionToTexturePool(width, height, resolution);
            expect(snapped).toBeLessThanOrEqual(resolution);
            expect(snapped).toBeGreaterThanOrEqual(resolution * (1 - TEXTURE_POOL_MAX_RESOLUTION_DROP));
            // A snap that did not shrink the bucket would be sharpness given away for nothing.
            const [poolWidth, poolHeight] = bucket(width, height, snapped);
            const [wasWidth, wasHeight] = bucket(width, height, resolution);
            if (snapped !== resolution) expect(poolWidth * poolHeight).toBeLessThan(wasWidth * wasHeight);
        })));
    });

    it('honours a caller-supplied tolerance in both directions', () => {
        // 781x850 needs a 19.7% cut, so a 10% budget must refuse it and a 25% one must take it.
        expect(snapResolutionToTexturePool(781, 850, 1.5, 0.1)).toBe(1.5);
        expect(snapResolutionToTexturePool(781, 850, 1.5, 0.25)).toBeCloseTo(1024 / 850, 6);
        // Zero tolerance is the off switch, and callers get exactly what they asked for.
        expect(snapResolutionToTexturePool(781, 850, 1.5, 0)).toBe(1.5);
    });

    it('passes degenerate viewports straight through', () => {
        // A host measured before layout reports 0, and the runtimes fall back to their own
        // minimums - but this must not invent a resolution out of a divide by zero either.
        [0, -1, Number.NaN, Number.POSITIVE_INFINITY].forEach(bad => {
            expect(snapResolutionToTexturePool(bad, 850, 1.5)).toBe(1.5);
            expect(snapResolutionToTexturePool(781, bad, 1.5)).toBe(1.5);
        });
        expect(snapResolutionToTexturePool(781, 850, 0)).toBe(0);
    });
});
