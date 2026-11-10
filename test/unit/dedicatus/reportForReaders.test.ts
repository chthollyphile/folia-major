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

    it('leaves a few findings of one rule as they are, and findings without a line or a rule untouched', () => {
        const fresh = [strict('src/a.ts', 1), strict('src/a.ts', 2)];
        expect(compressForReaders(fresh).findings).toEqual(fresh);
        const notice = { code: 'D430', file: 'src/old.tsx', rule: '@stylistic/indent', level: 'notice', message: '另有 89 条不在新写的行上', key: 'D430:src/old.tsx:folded' };
        const stale = { code: 'D002', file: 'eslint-suppressions.json', message: '抑制记多了', key: 'D002:x' };
        const logs = [1, 2, 3, 4].map(line => ({ code: 'D413', file: 'src/b.ts', line, rule: 'dedicatus/log-module-prefix', message: '缺模块前缀', key: `D413:${line}` }));
        const { findings } = compressForReaders([notice, stale, ...logs]);
        expect(findings.filter(finding => finding.code !== 'D413')).toEqual([stale, notice]);
        // warning 级的合成一行，级别不变（按代码表）
        expect(findings.filter(finding => finding.code === 'D413')).toHaveLength(1);
    });

    it('puts the notices without a line last, after style', () => {
        const notice = (file: string) => ({ code: 'D490', file, rule: '@typescript-eslint/no-unsafe-call', level: 'notice', message: '另有 4 条不在新写的行上', key: `D490:${file}:folded` });
        const fresh = [notice('src/a.ts'), notice('src/b.ts'), indent('src/c.ts', 1), strict('src/d.ts', 9), { code: 'D311', file: 'src/play.ts', line: 3, message: 'x', key: 'D311:z' }];
        expect(compressForReaders(fresh).findings.map(finding => `${finding.code} ${finding.file}`)).toEqual([
            'D311 src/play.ts', 'D490 src/d.ts', 'D430 src/c.ts', 'D490 src/a.ts', 'D490 src/b.ts',
        ]);
    });

    it('only sorts, without folding, for the local text output', () => {
        const fresh = [indent('src/cast.tsx', 1), indent('src/cast.tsx', 2), { code: 'D311', file: 'src/play.ts', line: 9, message: 'x', key: 'D311:y' }];
        const { findings, styleCount } = compressForReaders(fresh, { fold: false });
        expect(findings.map(finding => finding.code)).toEqual(['D311', 'D430', 'D430']);
        expect(styleCount).toBe(2);
    });
});

describe('lint:fix-style picks the files to fix', () => {
    const allStyle = { '@stylistic/indent': { count: 9 }, '@stylistic/quotes': { count: 2 }, '@stylistic/eol-last': { count: 1 }, '@stylistic/linebreak-style': { count: 1 } };

    it('fixes every style rule that has no old debt in the file, the same rules CI reports', () => {
        const suppressions = {
            'src/App.tsx': { '@stylistic/indent': { count: 120 } },
            'src/services/x.ts': { '@typescript-eslint/no-explicit-any': { count: 2 } },
            'src/legacy.ts': allStyle,
        };
        const changed = ['src/App.tsx', 'src/lan/Cast.tsx', 'src/services/x.ts', 'README.md', 'src/lan/Cast.tsx', 'electron/lan.cjs', 'src/legacy.ts']
            .map(file => ({ file }));
        expect(pickStyleFixTargets(changed, suppressions)).toEqual({
            groups: [
                { files: ['electron/lan.cjs', 'src/lan/Cast.tsx', 'src/services/x.ts'], keep: [] },
                // 只记了缩进旧账：引号、换行照修，缩进不动
                { files: ['src/App.tsx'], keep: ['@stylistic/indent'] },
            ],
            skipped: ['src/legacy.ts'],
        });
    });

    it('looks up the old debt of a renamed file under its old path', () => {
        const suppressions = { 'src/old.ts': { '@stylistic/indent': { count: 40 } } };
        expect(pickStyleFixTargets([{ file: 'src/new.ts', from: 'src/old.ts' }], suppressions).groups)
            .toEqual([{ files: ['src/new.ts'], keep: ['@stylistic/indent'] }]);
    });
});
