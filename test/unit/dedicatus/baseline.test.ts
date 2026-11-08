import { describe, expect, it } from 'vitest';
import {
    baselineGrowth,
    compareWithBaseline,
    parseBaseline,
    serializeBaseline,
    suppressionGrowth,
} from '../../../dev/dedicatus/baseline.mjs';

// test/unit/dedicatus/baseline.test.ts
// Dedicatus 的基线只减不增：新违规（不在基线里）、已修好但还留在基线里（D002）、代码不存在（D003）、
// 比目标分支多出的条目（D001）、ESLint 抑制计数变大（D001）。

const finding = (key: string) => ({ code: key.split(':')[0], file: 'src/a.ts', message: '', key });

describe('dedicatus baseline', () => {
    it('splits findings into fresh and known, and lists stale and unknown entries', () => {
        const result = compareWithBaseline(
            [finding('D101:src/a.ts->src/b.tsx'), finding('D301:src/c.ts')],
            ['D101:src/a.ts->src/b.tsx', 'D102:src/fixed.ts->src/stores/x.tsx', 'D999:src/whatever.ts'],
        );
        expect(result.fresh.map(f => f.key)).toEqual(['D301:src/c.ts']);
        expect(result.known.map(f => f.key)).toEqual(['D101:src/a.ts->src/b.tsx']);
        expect(result.stale).toEqual(['D102:src/fixed.ts->src/stores/x.tsx']);
        expect(result.unknown).toEqual(['D999:src/whatever.ts']);
    });

    it('reports only entries the target branch did not have, and nothing when it has no baseline yet', () => {
        expect(baselineGrowth(['D101:a', 'D301:b'], ['D101:a'])).toEqual(['D301:b']);
        expect(baselineGrowth(['D101:a'], null)).toEqual([]);
    });

    it('serializes sorted, de-duplicated entries that parse back', () => {
        const text = serializeBaseline(['D301:b', 'D101:a', 'D301:b']);
        expect(parseBaseline(text)).toEqual(['D101:a', 'D301:b']);
        expect(() => parseBaseline('{"entries":[1]}')).toThrow();
    });

    it('flags ESLint suppression counts that grew', () => {
        const base = { 'src/a.ts': { 'no-console': { count: 2 } } };
        const current = {
            'src/a.ts': { 'no-console': { count: 3 } },
            'src/b.ts': { '@typescript-eslint/no-explicit-any': { count: 1 } },
            'src/c.ts': {},
        };
        expect(suppressionGrowth(current, base)).toEqual([
            { file: 'src/a.ts', rule: 'no-console', before: 2, after: 3 },
            { file: 'src/b.ts', rule: '@typescript-eslint/no-explicit-any', before: 0, after: 1 },
        ]);
        expect(suppressionGrowth({ 'src/a.ts': { 'no-console': { count: 1 } } }, base)).toEqual([]);
        expect(suppressionGrowth(current, null)).toEqual([]);
    });
});
