import { describe, expect, it } from 'vitest';
import {
    DUR0, PAUSE, PEN_SAMPLES, SPEED, joinSegments, ownExtra, pointTimes, polylineLength, resamplePen, segFeat, snapRamp,
} from '@/services/analysis/strokesWgsl/hostMath';

// test/unit/strokesWgsl/hostMath.test.ts
// Host-side stroke-order math (src/services/analysis/strokesWgsl/hostMath.ts): the snap ramp, seg_feat
// layout, joining continued segments into pens, arc-length resampling, the reveal time axis, own1's extras.

/** A [16, 2] segment from (x0, y) to (x1, y), flat. */
const line = (x0: number, x1: number, y = 0) => Float32Array.from({ length: 32 }, (_, i) => (i % 2 ? y : x0 + ((x1 - x0) * (i >> 1)) / 15));

describe('snapRamp', () => {
    it('runs 1 -> 0 over 16 points like torch.linspace in f32', () => {
        const ramp = snapRamp();
        expect(ramp.length).toBe(16);
        expect(ramp[0]).toBe(1);
        expect(ramp[15]).toBe(0);
        for (let i = 1; i < 16; i += 1) expect(ramp[i]).toBeLessThan(ramp[i - 1]);
        expect(ramp[8]).toBeCloseTo(7 / 15, 6);
    });
});

describe('segFeat', () => {
    it('is the 32 coordinates then sin / cos of points 0, 5, 10, 15', () => {
        const seg = line(-0.5, 0.5, 0.25);
        const feat = segFeat(seg);
        expect(feat.length).toBe(160);
        expect(Array.from(feat.subarray(0, 32))).toEqual(Array.from(seg));
        expect(feat[32]).toBeCloseTo(Math.sin(-0.5 * Math.PI), 6);
        expect(feat[32 + 8]).toBeCloseTo(Math.cos(-0.5 * Math.PI), 6);
        expect(feat[32 + 16 + 1]).toBeCloseTo(Math.sin(0.25 * 2 * Math.PI), 6);
        expect(feat[128]).toBeCloseTo(Math.sin(0.5 * Math.PI), 6);
    });
});

describe('joinSegments', () => {
    it('appends a continued segment without its first point, and starts a pen otherwise', () => {
        const segs = new Float32Array(96);
        segs.set(line(0, 1), 0);
        segs.set(line(1, 2), 32);
        segs.set(line(0, 1, 0.5), 64);
        const pens = joinSegments(segs, [0, 1, 0]);
        expect(pens.map(p => p.length / 2)).toEqual([31, 16]);
        expect(pens[0][2 * 30]).toBe(2);
        expect(pens[1][1]).toBe(0.5);
        expect(joinSegments(segs, [0, 1, 0], 1).length).toBe(1);
    });
});

describe('resamplePen', () => {
    it('spaces points evenly by arc length along a bent polyline, ends kept', () => {
        const pen = [0, 0, 1, 0, 1, 1];
        const out = resamplePen(pen, 5);
        expect(Array.from(out)).toEqual([0, 0, 0.5, 0, 1, 0, 1, 0.5, 1, 1]);
        expect(resamplePen(pen).length).toBe(2 * PEN_SAMPLES);
    });

    it('repeats the first point for a degenerate pen', () => {
        expect(Array.from(resamplePen([0.3, 0.4, 0.3, 0.4], 3))).toEqual([0.3, 0.4, 0.3, 0.4, 0.3, 0.4].map(Math.fround));
    });
});

describe('pointTimes', () => {
    it('lays pens out as 0.25 + 0.9 * length with 0.18 pauses, normalised to 0..1', () => {
        const pens = [Float32Array.from([0, 0, 1, 0]), Float32Array.from([0, 1, 0, 2, 0, 3])];
        const { times, total } = pointTimes(pens);
        const d0 = DUR0 + SPEED * 1;
        const d1 = DUR0 + SPEED * 2;
        expect(total).toBeCloseTo(d0 + PAUSE + d1, 6);
        expect(times[0][0]).toBe(0);
        expect(times[0][1]).toBeCloseTo(d0 / total, 6);
        expect(times[1][0]).toBeCloseTo((d0 + PAUSE) / total, 6);
        expect(times[1][1]).toBeCloseTo((d0 + PAUSE + d1 / 2) / total, 6);
        expect(times[1][2]).toBeCloseTo(1, 6);
        expect(polylineLength(pens[1])).toBe(2);
    });
});

describe('ownExtra', () => {
    it('is start, end, k/n, k/8, resampled length, n/10', () => {
        const resampled = resamplePen([0, 0, 1, 0]);
        const out = new Float32Array(10);
        ownExtra(resampled, 2, 4, out, 2);
        expect(Array.from(out.subarray(2, 6))).toEqual([0, 0, 1, 0]);
        expect(out[6]).toBeCloseTo(0.5, 6);
        expect(out[7]).toBeCloseTo(0.25, 6);
        expect(out[8]).toBeCloseTo(1, 5);
        expect(out[9]).toBeCloseTo(0.4, 6);
    });
});
