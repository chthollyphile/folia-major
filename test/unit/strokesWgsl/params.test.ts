import { describe, expect, it } from 'vitest';
import { gemmCount } from '@/services/analysis/strokesWgsl/graph';
import { LINEAR_FIELDS, NO_BIAS, SKINNY_ROWS, linearParams, skinnyCount } from '@/services/analysis/strokesWgsl/kernels';
import { SKINNY_UP_TO, sized, type StepOp } from '@/services/analysis/strokesWgsl/layers';

// test/unit/strokesWgsl/params.test.ts
// The strokes runtime's dispatch arithmetic: a Linear's uniform defaults (rows map to themselves unless a side
// is regrouped - a wrong default once fed every glyph the first glyph's reference tokens), workgroup counts,
// and the switch to the skinny (GEMV) body for a decode step's few rows.

const field = (params: number[], name: (typeof LINEAR_FIELDS)[number]) => params[LINEAR_FIELDS.indexOf(name)];

describe('linearParams', () => {
    it('defaults to identity rows, no bias and dense strides', () => {
        const params = linearParams({ m: 10, n: 96, k: 32, w: 4 });
        expect(params.length).toBe(LINEAR_FIELDS.length);
        expect(field(params, 'b')).toBe(NO_BIAS);
        expect(field(params, 'ldx')).toBe(32);
        expect(field(params, 'ldy')).toBe(96);
        expect(field(params, 'rowMul')).toBe(1);
    });

    it('takes the group strides from the group size when only rpz is given', () => {
        const params = linearParams({ m: 80, n: 192, k: 160, w: 0, rpz: 40 });
        expect(field(params, 'xzs')).toBe(40);
        expect(field(params, 'ozs')).toBe(40);
        const regrouped = linearParams({ m: 80, n: 192, k: 160, w: 0, rpz: 40, ozs: 296, ooz: 256 });
        expect(field(regrouped, 'xzs')).toBe(40);
        expect(field(regrouped, 'ozs')).toBe(296);
        expect(field(regrouped, 'ooz')).toBe(256);
    });
});

describe('workgroup counts', () => {
    it('tiles 64 x 64 for the GEMM and SKINNY_ROWS x 8 for the skinny body', () => {
        expect(gemmCount(65, 128, 3)).toEqual([2, 2, 3]);
        expect(skinnyCount(SKINNY_ROWS + 1, 384)).toEqual([48, 2, 1]);
    });

    it('sizes a step op for the active rows, skinny up to its limit', () => {
        const op = (label: string) => ({ label, pipeline: {} as GPUComputePipeline, group: {} as GPUBindGroup, count: [1, 1, 1] as [number, number, number] });
        const step: StepOp = {
            op: op('dense'),
            count: rows => gemmCount(rows * 2, 192),
            skinny: { op: op('dense.skinny'), count: rows => skinnyCount(rows * 2, 192), upTo: SKINNY_UP_TO / 2 },
        };
        expect(sized(step, SKINNY_UP_TO / 2)).toMatchObject({ label: 'dense.skinny', count: skinnyCount(SKINNY_UP_TO, 192) });
        expect(sized(step, SKINNY_UP_TO / 2 + 1)).toMatchObject({ label: 'dense', count: gemmCount(SKINNY_UP_TO + 2, 192) });
    });
});
