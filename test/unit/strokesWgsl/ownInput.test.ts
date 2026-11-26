import { describe, expect, it } from 'vitest';
import { DUR0, PAUSE, SPEED, polylineLength } from '@/services/analysis/strokesWgsl/hostMath';
import {
    avgPool2, nearestOnPolyline, numpySum, own2Trajectory, pointTimes64, pushPenVertices, roundHalfEven, thickLine3,
} from '@/services/analysis/strokesWgsl/ownInput';

// test/unit/strokesWgsl/ownInput.test.ts
// The ownership models' host geometry (src/services/analysis/strokesWgsl/ownInput.ts): numpy's pairwise sum and
// rounding, the f64 time axis, the cv2.line port (pixel sets cv2 5.1 drew for these ends; the full fuzz and
// the bitwise own_x23 check run in the dev shell's scratch tools), the draw order, the pool, segment projection.

/** Sorted pixel indices `thickLine3` sets for 4-bit subpixel ends a, b. */
const pixels = (a: [number, number], b: [number, number]) => {
    const set = new Set<number>();
    thickLine3((x, y) => set.add(y * 256 + x), a, b);
    return [...set].sort((p, q) => p - q);
};

describe('numpySum', () => {
    it('sums short arrays left to right and long ones in numpy\'s pairwise blocks', () => {
        expect(numpySum([1, 2, 3])).toBe(6);
        const a = Float64Array.from({ length: 300 }, (_, i) => Math.fround(Math.sin(i) * 1e-3 + 0.1 * (i % 7)));
        let plain = 0;
        for (const v of a) plain += v;
        expect(numpySum(a)).toBeCloseTo(plain, 10);
        // blocks: 8 accumulators combined as a tree, the rest after them
        const b = Float64Array.from({ length: 11 }, (_, i) => 0.1 * (i + 1));
        const r = Array.from({ length: 8 }, (_, j) => b[j]);
        const expected = ((r[0] + r[1]) + (r[2] + r[3])) + ((r[4] + r[5]) + (r[6] + r[7])) + b[8] + b[9] + b[10];
        expect(numpySum(b)).toBe(expected);
    });
});

describe('roundHalfEven', () => {
    it('rounds ties to even like np.round / cvRound', () => {
        expect([0.5, 1.5, 2.5, -0.5, -1.5, 2.4999, 2.5001].map(roundHalfEven)).toEqual([0, 2, 2, 0, -2, 2, 3]);
    });
});

describe('pointTimes64', () => {
    it('lays pens out as 0.25 + 0.9 * length with 0.18 pauses, normalised to 0..1, in f64', () => {
        const pens = [Float32Array.from([0, 0, 1, 0]), Float32Array.from([0, 1, 0, 2, 0, 3])];
        const times = pointTimes64(pens);
        const d0 = DUR0 + SPEED * 1;
        const d1 = DUR0 + SPEED * 2;
        const total = d0 + PAUSE + d1;
        expect(times[0][0]).toBe(0);
        expect(times[0][1]).toBeCloseTo(d0 / total, 12);
        expect(times[1][0]).toBeCloseTo((d0 + PAUSE) / total, 12);
        expect(times[1][1]).toBeCloseTo((d0 + PAUSE + d1 / 2) / total, 12);
        expect(times[1][2]).toBeCloseTo(1, 12);
        expect(polylineLength(pens[1])).toBe(2);
    });
});

describe('thickLine3 (cv2.line, thickness 3, LINE_8, shift 4)', () => {
    it('draws a point as the radius-2 cap', () => {
        expect(pixels([160, 160], [160, 160])).toEqual([2058, 2313, 2314, 2315, 2568, 2569, 2570, 2571, 2572, 2825, 2826, 2827, 3082]);
    });
    it('matches cv2 for a sloped segment, one crossing the top-left corner and one the bottom-right', () => {
        expect(pixels([800, 808], [1013, 875])).toEqual([
            12594, 12595, 12596, 12597, 12849, 12850, 12851, 12852, 12853, 12854, 12855, 12856, 12857, 13104, 13105, 13106, 13107, 13108, 13109,
            13110, 13111, 13112, 13113, 13114, 13115, 13116, 13361, 13362, 13363, 13364, 13365, 13366, 13367, 13368, 13369, 13370, 13371, 13372,
            13373, 13374, 13375, 13618, 13619, 13620, 13621, 13622, 13623, 13624, 13625, 13626, 13627, 13628, 13629, 13630, 13631, 13632, 13877,
            13878, 13879, 13880, 13881, 13882, 13883, 13884, 13885, 13886, 13887, 13888, 14136, 14137, 14138, 14139, 14140, 14141, 14142, 14143,
            14144, 14145, 14395, 14396, 14397, 14398, 14399, 14400, 14655,
        ]);
        expect(pixels([-40, 100], [90, -30])).toEqual([1, 2, 3, 4, 5, 6, 7, 256, 257, 258, 259, 260, 261, 262, 512, 513, 514, 515, 516, 517, 768, 769, 770, 771, 772, 1024, 1025, 1026, 1027, 1280, 1281, 1282, 1536, 1537, 1792]);
        expect(pixels([4000, 4090], [4200, 3900])).toEqual([
            63743, 63998, 63999, 64253, 64254, 64255, 64508, 64509, 64510, 64511, 64763, 64764, 64765, 64766, 64767, 65018, 65019, 65020, 65021,
            65022, 65023, 65273, 65274, 65275, 65276, 65277, 65278, 65279, 65529, 65530, 65531, 65532, 65533, 65534,
        ]);
    });
});

describe('own2Trajectory', () => {
    it('keeps the earlier pen on top where pens cross, with f32 segment-average times, pooled to 128 x 128', () => {
        const across = Float32Array.from([-0.5, 0, 0.5, 0]);
        const down = Float32Array.from([0, -0.5, 0, 0.5]);
        const pooled = own2Trajectory([across, down]);
        const t = pointTimes64([across, down]);
        expect(pooled.length).toBe(2 * 128 * 128);
        expect(pooled[64 * 128 + 64]).toBe(Math.fround((t[0][0] + t[0][1]) / 2));
        expect(pooled[32 * 128 + 64]).toBe(Math.fround((t[1][0] + t[1][1]) / 2));
        expect(pooled[5]).toBe(0);
        expect(pooled[128 * 128 + 64 * 128 + 64]).toBe(1);
        expect(pooled[128 * 128 + 5]).toBe(0);
    });
});

describe('avgPool2', () => {
    it('averages 2 x 2 blocks', () => {
        const map = Float32Array.from([1, 2, 5, 6, 3, 4, 7, 8, 0, 0, 1, 1, 0, 4, 1, 1]);
        expect(Array.from(avgPool2(map, 4))).toEqual([2.5, 6.5, 1, 1]);
    });
});

describe('nearestOnPolyline', () => {
    const verts = Float32Array.from([0, 0, 0, 0.2, 1, 0, 0.5, 0.4, 1, 1, 1, 0.6]);
    it('projects onto the nearest segment, along / time linear on it', () => {
        const hit = nearestOnPolyline(verts, 0.25, 0.1);
        expect(hit.d2).toBeCloseTo(0.01, 6);
        expect(hit.along).toBeCloseTo(0.125, 6);
        expect(hit.time).toBeCloseTo(0.25, 6);
        const side = nearestOnPolyline(verts, 1.2, 0.5);
        expect(side.along).toBeCloseTo(0.75, 6);
        expect(side.time).toBeCloseTo(0.5, 6);
    });
    it('clamps past the ends and handles a single vertex', () => {
        expect(nearestOnPolyline(verts, -1, -1).time).toBeCloseTo(0.2, 6);
        expect(nearestOnPolyline(verts, 2, 3).time).toBeCloseTo(0.6, 6);
        expect(nearestOnPolyline(Float32Array.from([0.5, 0.5, 0, 0.3]), 0, 0)).toEqual({ d2: 0.5, along: 0, time: Math.fround(0.3) });
    });
});

describe('pushPenVertices', () => {
    it('appends (x, y, along by arc length, time) rows and returns the pen\'s vertex range', () => {
        const rows: number[] = [9, 9, 9, 9];
        const range = pushPenVertices(rows, Float32Array.from([0, 0, 0.3, 0, 0.3, 0.1]), [0.1, 0.2, 0.4]);
        expect(range).toEqual([1, 4]);
        expect(rows.slice(4, 8)).toEqual([0, 0, 0, 0.1]);
        expect(rows[10]).toBeCloseTo(0.75, 6);
        expect(rows.slice(12, 16).map(v => Math.fround(v))).toEqual([Math.fround(0.3), Math.fround(0.1), 1, Math.fround(0.4)]);
        expect(pushPenVertices(rows, Float32Array.from([0.5, 0.5]), [0])).toEqual([4, 5]);
        expect(rows[rows.length - 2]).toBe(0);
    });
});
