import { describe, expect, it } from 'vitest';
import {
    coerceFoliumParamValue,
    filterFoliumParamPatch,
    mergeFoliumParamValues,
    resolveFoliumParamStep,
    sanitizeFoliumParams,
} from '@/mods/folium/params';
import type { FoliumParam } from '@/mods/folium/contract';

// test/unit/mod-system/foliumParams.test.ts
// FoliumParam semantics are shared by every schema-backed surface, so these
// pin the rules a mod author relies on: which schemas are accepted, which
// value a field has before it is touched, and how writes are validated.

const number = (overrides: Partial<FoliumParam> = {}): FoliumParam => ({
    key: 'n', type: 'number', label: {}, min: 0, max: 10, ...overrides,
});

describe('sanitizeFoliumParams', () => {
    it('drops malformed entries and duplicate keys', () => {
        const result = sanitizeFoliumParams([
            null,
            { type: 'number' },
            { key: 'a', type: 'color' },
            { key: 'b', type: 'number', defaultValue: '12' },
            { key: 'c', type: 'boolean', defaultValue: 'yes' },
            { key: 'd', type: 'select', options: [] },
            { key: 'e', type: 'number', defaultValue: 3 },
            { key: 'e', type: 'text' },
        ]);
        expect(result.map((param) => param.key)).toEqual(['e']);
    });

    it('swaps inverted bounds and drops non-finite ones', () => {
        const [param] = sanitizeFoliumParams([{ key: 'x', type: 'number', min: 5, max: 1, step: -1 }]);
        expect(param.min).toBe(1);
        expect(param.max).toBe(5);
        expect(param.step).toBeUndefined();
        const [open] = sanitizeFoliumParams([{ key: 'y', type: 'number', min: Number.NaN }]);
        expect(open.min).toBeUndefined();
    });

    it('keeps only well-formed select options', () => {
        const [param] = sanitizeFoliumParams([{ key: 's', type: 'select', options: [{ value: 'a', label: {} }, { value: 1 }, null] }]);
        expect(param.options?.map((option) => option.value)).toEqual(['a']);
    });

    it('returns an empty list for non-arrays', () => {
        expect(sanitizeFoliumParams(undefined)).toEqual([]);
        expect(sanitizeFoliumParams({ key: 'x' })).toEqual([]);
    });
});

describe('mergeFoliumParamValues', () => {
    it('fills every declared key with its default, including booleans and text', () => {
        const schema = sanitizeFoliumParams([
            { key: 'flag', type: 'boolean', defaultValue: true },
            { key: 'name', type: 'text', defaultValue: 'hi' },
            { key: 'pick', type: 'select', options: [{ value: 'a', label: {} }, { value: 'b', label: {} }] },
            { key: 'size', type: 'number', min: 2 },
        ]);
        expect(mergeFoliumParamValues(schema, undefined)).toEqual({ flag: true, name: 'hi', pick: 'a', size: 2 });
    });

    it('re-validates stored values against the current schema', () => {
        const schema = [number({ max: 5 })];
        expect(mergeFoliumParamValues(schema, { n: 9, stale: 1 })).toEqual({ n: 5 });
        expect(mergeFoliumParamValues(schema, { n: 'nope' })).toEqual({ n: 0 });
    });
});

describe('coerceFoliumParamValue / filterFoliumParamPatch', () => {
    it('clamps numbers and rejects wrong types', () => {
        expect(coerceFoliumParamValue(number(), 42)).toBe(10);
        expect(coerceFoliumParamValue(number(), -1)).toBe(0);
        expect(coerceFoliumParamValue(number(), Number.NaN)).toBeUndefined();
        expect(coerceFoliumParamValue(number(), '3')).toBeUndefined();
    });

    it('only accepts declared select options', () => {
        const select: FoliumParam = { key: 's', type: 'select', label: {}, options: [{ value: 'a', label: {} }] };
        expect(coerceFoliumParamValue(select, 'a')).toBe('a');
        expect(coerceFoliumParamValue(select, 'b')).toBeUndefined();
    });

    it('drops unknown keys and invalid values from a patch', () => {
        expect(filterFoliumParamPatch([number()], { n: 3, other: 1 })).toEqual({ n: 3 });
        expect(filterFoliumParamPatch([number()], { n: 'x' })).toEqual({});
    });
});

describe('resolveFoliumParamStep', () => {
    it('keeps a declared step', () => {
        expect(resolveFoliumParamStep({ step: 5, min: 0, max: 100 })).toBe(5);
    });

    it('steps integer-bounded knobs by 1 and fractional ones by 0.01', () => {
        expect(resolveFoliumParamStep({ min: 320, max: 3840 })).toBe(1);
        expect(resolveFoliumParamStep({})).toBe(1);
        expect(resolveFoliumParamStep({ min: 0.6, max: 1.4 })).toBe(0.01);
        expect(resolveFoliumParamStep({ min: 0, max: 99.9 })).toBe(0.01);
    });
});
