import { describe, expect, it } from 'vitest';
import zhCN from '../../../src/i18n/locales/zh-CN';
import { flattenLocale } from '../../../src/i18n/config';

// test/unit/i18n/flattenLocale.test.ts
// Reference copy of the pre-rewrite flatten. Each recursive return copied the map built so far.

const flattenLocaleBySpread = (obj: Record<string, any>, prefix = ''): Record<string, string> => {
    let result: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'object' && value !== null) {
            result = { ...result, ...flattenLocaleBySpread(value, path) };
        } else {
            result[path] = String(value);
        }
    }
    return result;
};

const expectSameMap = (actual: Record<string, string>, expected: Record<string, string>) => {
    expect(Object.entries(actual)).toEqual(Object.entries(expected));
};

describe('flattenLocale', () => {
    it('matches the spread implementation on zh-CN, including key order', () => {
        expectSameMap(flattenLocale(zhCN), flattenLocaleBySpread(zhCN));
    });

    it('lets a later nested path overwrite a dotted key without moving it', () => {
        const input = {
            first: '1',
            'a.b': 'dotted',
            mid: '2',
            a: { b: 'nested', c: 'child' },
            last: '3',
        };
        const expected = {
            first: '1',
            'a.b': 'nested',
            mid: '2',
            'a.c': 'child',
            last: '3',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('lets a later dotted key overwrite a nested path in place', () => {
        const input = {
            a: { b: 'nested' },
            'a.b': 'dotted',
            z: 'end',
        };
        const expected = {
            'a.b': 'dotted',
            z: 'end',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('indexes arrays, stringifies numbers and null, and skips empty objects', () => {
        const input = {
            items: ['x', 2, null, { n: 0 }],
            count: 3,
            flag: false,
            missing: undefined,
            empty: {},
            nestedEmpty: { d: {} },
            blank: [],
        };
        const expected = {
            'items.0': 'x',
            'items.1': '2',
            'items.2': 'null',
            'items.3.n': '0',
            count: '3',
            flag: 'false',
            missing: 'undefined',
        };
        expectSameMap(flattenLocale(input), expected);
        expectSameMap(flattenLocale(input), flattenLocaleBySpread(input));
    });

    it('keeps an explicit prefix on every key', () => {
        const input = { a: { b: 1 } };
        expectSameMap(flattenLocale(input, 'pre'), { 'pre.a.b': '1' });
        expectSameMap(flattenLocale(input, 'pre'), flattenLocaleBySpread(input, 'pre'));
    });
});
