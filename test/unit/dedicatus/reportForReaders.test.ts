import { describe, expect, it } from 'vitest';
import { pickStyleFixTargets } from '../../../dev/dedicatus/eslint/fixStyle.mjs';
import { compressForReaders, FIX_STYLE_COMMAND } from '../../../dev/dedicatus/report.mjs';

// test/unit/dedicatus/reportForReaders.test.ts
// 给人看的输出先合并：一个缩进不对的新文件会有几百条，GitHub 每个步骤只显示前 10 个注解，
// 不合并的话真正要看的项目规则问题（D311、D611……）就被挤掉了（2026-11-08 拿 #1109 演习时看到 1819 条）。

const indent = (file: string, line: number) => ({ code: 'D430', file, line, rule: '@stylistic/indent', message: 'Expected indentation of 4 spaces but found 2.', key: `D430:${file}:${line}` });
const strict = (file: string, line: number) => ({ code: 'D490', file, line, rule: '@typescript-eslint/no-unnecessary-condition', message: 'Unnecessary conditional.', key: `D490:${file}:${line}` });

describe('dedicatus output for readers', () => {
    it('puts project rules first, folds style per file and rule, and many of one generic rule into one line', () => {
        const fresh = [
            ...[1, 2, 3, 4, 5].map(line => indent('src/cast.tsx', line)),
            ...[10, 11, 12, 13].map(line => strict('src/cast.tsx', line)),
            strict('src/other.ts', 7),
            { code: 'D311', file: 'src/play.ts', line: 165, message: '等待之后直接 setLyrics()', key: 'D311:x' },
            { code: 'D611', file: 'electron/client.cjs', line: 530, message: '疑似读取别的应用的凭据', key: 'D611:x' },
        ];
        const { findings, styleCount } = compressForReaders(fresh);
        expect(styleCount).toBe(5);
        expect(findings.map(finding => `${finding.code} ${finding.file}:${finding.line}`)).toEqual([
            'D311 src/play.ts:165',
            'D611 electron/client.cjs:530',
            'D490 src/cast.tsx:10',
            'D490 src/other.ts:7',
            'D430 src/cast.tsx:1',
        ]);
        expect(findings[2].message).toContain('共 4 处');
        expect(findings[4].message).toContain('5 处');
        expect(findings[4].message).toContain(FIX_STYLE_COMMAND);
    });

    it('leaves a few findings of one rule as they are', () => {
        const fresh = [strict('src/a.ts', 1), strict('src/a.ts', 2)];
        expect(compressForReaders(fresh).findings).toEqual(fresh);
    });
});

describe('lint:fix-style picks the files to fix', () => {
    it('fixes changed code files and skips files that are old style already', () => {
        const suppressions = {
            'src/App.tsx': { '@stylistic/indent': { count: 120 } },
            'src/stores/x.ts': { '@typescript-eslint/no-explicit-any': { count: 2 } },
        };
        const changed = ['src/App.tsx', 'src/lan/Cast.tsx', 'src/stores/x.ts', 'README.md', 'src/lan/Cast.tsx', 'electron/lan.cjs'];
        expect(pickStyleFixTargets(changed, suppressions)).toEqual({
            targets: ['electron/lan.cjs', 'src/lan/Cast.tsx', 'src/stores/x.ts'],
            legacy: ['src/App.tsx'],
        });
    });
});
