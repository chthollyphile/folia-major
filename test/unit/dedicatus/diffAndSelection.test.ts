import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    baselineGrowth,
    baselineGrowthWithTransfers,
    migrateBaseline,
    migrateSuppressions,
    renameKey,
    suppressionGrowth,
    suppressionGrowthWithTransfers,
} from '../../../dev/dedicatus/baseline.mjs';
import { findNoteChanges, isNoteComment, noteBlockLines } from '../../../dev/dedicatus/checks/notes.mjs';
import { addedFiles, changedLines, movedLines, parseDiff, renames, withUntracked, writtenLines } from '../../../dev/dedicatus/diff.mjs';
import { untrackedFiles } from '../../../dev/dedicatus/git.mjs';
import { actualCounts, codeForMessage, selectNewFindings, staleSuppressions, toFindings } from '../../../dev/dedicatus/eslint/run.mjs';

// test/unit/dedicatus/diffAndSelection.test.ts
// Dedicatus 读 diff 的几处：文件头只在 `diff --git` 和第一个 hunk 之间认、改名、新写的行和挪过来的行；
// `@note` 按整条注释（含续行）保护；ESLint 抑制计数超了以后只报新写的行，其余合成一条或交给目标分支；
// 挪文件、拆文件时基线和抑制跟着代码搬家，不算增长。

const source = (...lines: string[]) => lines.join('\n');

const diff = source(
    'diff --git a/src/a.ts b/src/a.ts',
    'index 1111111..2222222 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -3,3 +2,1 @@',
    // 内容行 `-- removed sql comment` 删掉后在 diff 里长得像文件头
    '--- removed sql comment',
    '-// @note keep me',
    '-x();',
    '+y();',
    'diff --git a/src/old.ts b/src/new.ts',
    'similarity index 100%',
    'rename from src/old.ts',
    'rename to src/new.ts',
    'diff --git a/src/gone.ts b/src/gone.ts',
    'deleted file mode 100644',
    '--- a/src/gone.ts',
    '+++ /dev/null',
    '@@ -1,2 +0,0 @@',
    '-// @note Version Control: Project Folia version 0.5.27-a16525c',
    '-// @note Version Control: Project Folia version 0.5.27-a16525c',
    'diff --git a/src/kept.ts b/src/kept.ts',
    '--- a/src/kept.ts',
    '+++ b/src/kept.ts',
    '@@ -0,0 +5,2 @@',
    '+  // @note Version Control: Project Folia version 0.5.27-a16525c',
    "+const s = 'mentions @note in a string';",
);

describe('dedicatus diff parsing', () => {
    const files = parseDiff(diff);

    // 2026-11-08 云端实测：代理常在 git add 之前跑检查，git diff 不含未跟踪的新文件，里面的问题一条都不报
    it('counts files not yet added to git as new, every line written', () => {
        const dir = mkdtempSync(path.join(tmpdir(), 'dedicatus-untracked-'));
        try {
            execFileSync('git', ['init', '--quiet'], { cwd: dir });
            mkdirSync(path.join(dir, 'src'));
            writeFileSync(path.join(dir, 'src/fresh.ts'), 'const a = 1;\nexport default a;\n');
            writeFileSync(path.join(dir, 'cover.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 1]));
            writeFileSync(path.join(dir, '.gitignore'), 'ignored.ts\n');
            writeFileSync(path.join(dir, 'ignored.ts'), 'x\n');
            const untracked = untrackedFiles(dir);
            expect(untracked.map(entry => entry.file).sort()).toEqual(['.gitignore', 'src/fresh.ts']);
            const merged = withUntracked([], untracked.filter(entry => entry.file === 'src/fresh.ts'));
            expect(addedFiles(merged)).toEqual(new Set(['src/fresh.ts']));
            expect(writtenLines(merged).get('src/fresh.ts')).toEqual(new Set([1, 2]));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });

    it('does not add an untracked file twice when the diff already has it', () => {
        const merged = withUntracked(files, [{ file: files[0].newPath ?? '', text: 'x\n' }]);
        expect(merged).toHaveLength(files.length);
    });

    it('reads headers only before the first hunk, and records renames, new files and deletions', () => {
        expect(files.map(file => [file.oldPath, file.newPath])).toEqual([
            ['src/a.ts', 'src/a.ts'],
            ['src/old.ts', 'src/new.ts'],
            ['src/gone.ts', null],
            ['src/kept.ts', 'src/kept.ts'],
        ]);
        expect(files[0].removed.map(entry => [entry.oldLine, entry.text])).toEqual([
            [3, '-- removed sql comment'],
            [4, '// @note keep me'],
            [5, 'x();'],
        ]);
        expect(renames(files)).toEqual(new Map([['src/old.ts', 'src/new.ts']]));
        expect(changedLines(files).get('src/a.ts')).toEqual(new Set([2]));
        expect(changedLines(files).get('src/kept.ts')).toEqual(new Set([5, 6]));
    });

    it('tells moved lines from written ones', () => {
        const split = parseDiff(source(
            'diff --git a/src/big.ts b/src/big.ts',
            '--- a/src/big.ts',
            '+++ b/src/big.ts',
            '@@ -10,5 +10,0 @@',
            '-export const parse = (raw: any) => raw.value;',
            '-export const parseAll = (rows: any[]) => rows.map(parse);',
            '-',
            '-export const parseFirst = (rows: any[]) => parse(rows[0]);',
            '-}',
            'diff --git a/src/big/part.ts b/src/big/part.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/big/part.ts',
            '@@ -0,0 +1,6 @@',
            '+    export const parse = (raw: any) => raw.value;',
            '+export const parseAll = (rows: any[]) => rows.map(parse);',
            '+',
            '+export const parseFirst = (rows: any[]) => parse(rows[0]);',
            '+export const fresh = (input: any) => input;',
            '+}',
        ));
        expect(addedFiles(split)).toEqual(new Set(['src/big/part.ts']));
        // 连成一段的三行（中间的空行不打断）算挪过来的
        expect(movedLines(split).get('src/big/part.ts')).toEqual(new Set([1, 2, 4]));
        // 太短的 `}` 不算挪动：宁可当成新写的
        expect(writtenLines(split).get('src/big/part.ts')).toEqual(new Set([3, 5, 6]));
    });

    it('does not count a lone common line that happens to match a removed one as moved', () => {
        const fresh = parseDiff(source(
            'diff --git a/src/panel.tsx b/src/panel.tsx',
            '--- a/src/panel.tsx',
            '+++ b/src/panel.tsx',
            '@@ -20,2 +20,0 @@',
            '-            <AnimatePresence>',
            '-    } catch (error) {',
            'diff --git a/src/cast.tsx b/src/cast.tsx',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/cast.tsx',
            '@@ -0,0 +1,4 @@',
            '+  const devices = useDevices();',
            '+  <AnimatePresence>',
            '+  const label = devices.length;',
            '+  } catch (error) {',
        ));
        expect(movedLines(fresh).get('src/cast.tsx')).toBeUndefined();
        expect(writtenLines(fresh).get('src/cast.tsx')).toEqual(new Set([1, 2, 3, 4]));
    });

    it('gives a lone match back, so it does not cut a block really moved into another file', () => {
        const both = parseDiff(source(
            'diff --git a/src/big.ts b/src/big.ts',
            '--- a/src/big.ts',
            '+++ b/src/big.ts',
            '@@ -30,3 +30,0 @@',
            '-    try { load(source as any); }',
            '-    } catch (error) {',
            '-        report(error as any);',
            // 排在前面的新文件碰巧也有一行 `} catch (error) {`
            'diff --git a/src/a/coincidence.ts b/src/a/coincidence.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/a/coincidence.ts',
            '@@ -0,0 +1,3 @@',
            '+    try { start(); }',
            '+    } catch (error) {',
            '+    console.warn(\'[A] failed\', error);',
            'diff --git a/src/b/part.ts b/src/b/part.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/b/part.ts',
            '@@ -0,0 +1,3 @@',
            '+    try { load(source as any); }',
            '+    } catch (error) {',
            '+        report(error as any);',
        ));
        expect(movedLines(both).get('src/a/coincidence.ts')).toBeUndefined();
        expect(movedLines(both).get('src/b/part.ts')).toEqual(new Set([1, 2, 3]));
    });

    it('does not count two neighbouring lines that were removed from two different places', () => {
        const scattered = parseDiff(source(
            'diff --git a/src/a.ts b/src/a.ts',
            '--- a/src/a.ts',
            '+++ b/src/a.ts',
            '@@ -10,1 +10,0 @@',
            '-        startTime: line.startTime,',
            '@@ -80,1 +79,0 @@',
            '-        fullText: line.text,',
            'diff --git a/src/lines.ts b/src/lines.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/lines.ts',
            '@@ -0,0 +1,2 @@',
            '+        startTime: line.startTime,',
            '+        fullText: line.text,',
        ));
        expect(movedLines(scattered).get('src/lines.ts')).toBeUndefined();
    });

    it('counts a small two-line function moved into a new file, and asks to adopt its old debt', () => {
        const split = parseDiff(source(
            'diff --git a/src/big.ts b/src/big.ts',
            '--- a/src/big.ts',
            '+++ b/src/big.ts',
            '@@ -40,3 +40,0 @@',
            '-export function toKey(song: any) {',
            '-    return `${song.source}:${song.id}`;',
            '-}',
            'diff --git a/src/keys.ts b/src/keys.ts',
            'new file mode 100644',
            '--- /dev/null',
            '+++ b/src/keys.ts',
            '@@ -0,0 +1,4 @@',
            '+export function toKey(song: any) {',
            '+    return `${song.source}:${song.id}`;',
            '+}',
            '+export const fresh = (input: any) => input;',
        ));
        const moved = movedLines(split);
        expect(moved.get('src/keys.ts')).toEqual(new Set([1, 2]));
        const any = '@typescript-eslint/no-explicit-any';
        const finding = (line: number) => ({ code: 'D403', file: 'src/keys.ts', line, column: 1, rule: any, message: 'm', key: `D403:src/keys.ts:${line}:1:${any}` });
        const result = selectNewFindings([finding(1), finding(4)], {
            suppressions: {},
            written: writtenLines(split),
            moved,
            newFiles: addedFiles(split),
            touched: new Set(['src/keys.ts']),
        });
        expect(result.map(item => item.key)).toEqual(['D403:src/keys.ts:4:1:@typescript-eslint/no-explicit-any', 'D002:src/keys.ts:adopt']);
    });
});

describe('dedicatus @note guard', () => {
    it('protects the whole comment: the @note line and the comment lines right after it', () => {
        expect(isNoteComment('  // @note x')).toBe(true);
        expect(isNoteComment(' * @note x')).toBe(true);
        expect(isNoteComment("const s = '@note';")).toBe(false);
        expect(noteBlockLines(source(
            'const a = 1;',
            '// @note 第一行',
            '// 续行',
            '',
            '// 普通注释',
            '/**',
            ' * @note 块注释',
            ' * 续行',
            ' */',
            'run();',
        ))).toEqual(new Set([2, 3, 7, 8, 9]));
    });

    it('reports removed @note lines and continuations, pairing moved copies one for one', () => {
        const files = parseDiff(diff);
        expect(findNoteChanges(files)).toEqual([
            { file: 'src/a.ts', line: 2, text: '// @note keep me' },
            { file: 'src/gone.ts', line: null, text: '// @note Version Control: Project Folia version 0.5.27-a16525c' },
        ]);

        const continuation = parseDiff(source(
            'diff --git a/src/p.ts b/src/p.ts',
            '--- a/src/p.ts',
            '+++ b/src/p.ts',
            '@@ -3 +3 @@',
            '-// 以前这里有两套导航并存',
            '+// 改写过的续行',
        ));
        const old = source('const a = 1;', '// @note 导航只留一套', '// 以前这里有两套导航并存', 'run();');
        expect(findNoteChanges(continuation, () => old)).toEqual([{ file: 'src/p.ts', line: 3, text: '// 以前这里有两套导航并存' }]);
        expect(findNoteChanges(continuation)).toEqual([]);
    });
});

describe('dedicatus eslint selection', () => {
    const finding = (file: string, line: number, rule: string, code: string) => ({
        code, file, line, column: 1, rule, message: 'm', key: `${code}:${file}:${line}:1:${rule}`,
    });
    const any = '@typescript-eslint/no-explicit-any';
    const indent = '@stylistic/indent';
    const keys = (list: { key: string }[]) => list.map(item => item.key);

    it('without a base, keeps unrecorded rules and folds an exceeded count into one finding', () => {
        const suppressions = { 'src/a.ts': { [any]: { count: 3 }, [indent]: { count: 5 } } };
        const findings = [
            ...[1, 2, 3, 10].map(line => finding('src/a.ts', line, any, 'D403')),
            ...[1, 2, 3, 4, 5, 6].map(line => finding('src/a.ts', line, indent, 'D430')),
            finding('src/b.ts', 1, any, 'D403'),
        ];
        const result = selectNewFindings(findings, { suppressions, written: null });
        expect(result).toHaveLength(2);
        expect(result[0].message).toContain('多了 1 条');
        expect(result[1].key).toBe('D403:src/b.ts:1:1:@typescript-eslint/no-explicit-any');
    });

    it('with a base, keeps written lines, folds the rest of a touched file into a notice and leaves untouched files alone', () => {
        const suppressions = { 'src/a.ts': { [any]: { count: 3 } } };
        const findings = [
            ...[1, 2, 3, 10, 20].map(line => finding('src/a.ts', line, any, 'D403')),
            finding('src/untouched.ts', 4, any, 'D403'),
        ];
        const result = selectNewFindings(findings, {
            suppressions,
            written: new Map([['src/a.ts', new Set([10])]]),
            touched: new Set(['src/a.ts']),
        });
        expect(keys(result)).toEqual(['D403:src/a.ts:10:1:@typescript-eslint/no-explicit-any', 'D403:src/a.ts:folded:@typescript-eslint/no-explicit-any']);
        expect(result[1]).toMatchObject({ level: 'notice' });
    });

    it('asks to migrate a renamed file and to adopt debt moved into a new file', () => {
        const suppressions = { 'src/old.ts': { [any]: { count: 2 } } };
        const renamed = selectNewFindings([finding('src/new.ts', 1, any, 'D403'), finding('src/new.ts', 2, any, 'D403')], {
            suppressions, written: new Map(), renameMap: new Map([['src/old.ts', 'src/new.ts']]), touched: new Set(['src/new.ts']),
        });
        expect(keys(renamed)).toEqual(['D002:src/new.ts:migrate']);

        const split = selectNewFindings([finding('src/big/part.ts', 1, any, 'D403'), finding('src/big/part.ts', 2, any, 'D403')], {
            suppressions: {},
            written: new Map([['src/big/part.ts', new Set([2])]]),
            moved: new Map([['src/big/part.ts', new Set([1])]]),
            newFiles: new Set(['src/big/part.ts']),
            touched: new Set(['src/big/part.ts']),
        });
        expect(keys(split)).toEqual(['D403:src/big/part.ts:2:1:@typescript-eslint/no-explicit-any', 'D002:src/big/part.ts:adopt']);
    });

    // #1048 演习：新加的 isRemoteStageSource 让旧 hook 缺依赖，问题报在没改的依赖数组那一行
    it('claims hook dependency problems whose hook holds a written line, naming a written variable first', () => {
        const root = path.resolve('/repo');
        const source = [
            'export function useThing() {', //  1
            '    const a = useCallback(() => {', //  2  旧的：多了 currentTime
            '        tick();', //  3
            '    }, [currentTime]);', //  4
            '    const b = useCallback(() => {', //  5
            '        if (isRemoteStageSource()) stop();', //  6  新写的行
            '    }, []);', //  7
            '    const c = useCallback(() => {', //  8
            '        log(currentTime); // 改了注释', //  9  新写的行，但问题和它无关
            '    }, [currentTime, setDuration]);', // 10
            '}', // 11
        ].join('\n');
        const deps = 'react-hooks/exhaustive-deps';
        const findings = toFindings(root, [{
            filePath: path.join(root, 'src', 'thing.ts'),
            source,
            messages: [
                { ruleId: deps, line: 4, column: 8, message: "React Hook useCallback has an unnecessary dependency: 'currentTime'." },
                { ruleId: deps, line: 7, column: 8, message: "React Hook useCallback has a missing dependency: 'isRemoteStageSource'." },
                { ruleId: deps, line: 10, column: 8, message: "React Hook useCallback has an unnecessary dependency: 'setDuration'." },
            ],
        }]);
        expect(findings[1]).toMatchObject({ span: [5, 7], names: ['isRemoteStageSource'] });
        const result = selectNewFindings(findings, {
            suppressions: { 'src/thing.ts': { [deps]: { count: 2 } } },
            written: new Map([['src/thing.ts', new Set([6, 9])]]),
            touched: new Set(['src/thing.ts']),
            writtenWords: new Map([['src/thing.ts', new Set(['if', 'isRemoteStageSource', 'stop', 'log', 'currentTime'])]]),
        });
        // 只多了 1 条：认领 hook 里有新写的行、又点名了新写的变量的那条；输出里不带挑选用的字段
        expect(result.map(item => item.line)).toEqual([7]);
        expect(result[0]).not.toHaveProperty('span');
        expect(result[0]).not.toHaveProperty('names');
    });

    it('keeps directive problems and finds codes written after a rule prefix', () => {
        const directive = { code: 'D420', file: 'src/a.ts', line: 1, message: 'Unused', key: 'D420:x' };
        expect(selectNewFindings([directive], { suppressions: {}, written: null })).toEqual([directive]);
        expect(codeForMessage({ ruleId: 'no-restricted-globals', message: "Unexpected use of 'localStorage'. D411：组件不直接读写 localStorage。" })).toBe('D411');
        const root = path.resolve('/repo');
        const [mapped] = toFindings(root, [{
            filePath: path.join(root, 'src', 'a.tsx'),
            messages: [{ ruleId: 'no-restricted-globals', message: "Unexpected use of 'localStorage'. D411：组件不直接读写 localStorage。", line: 1, column: 1 }],
        }]);
        expect(mapped.message).toBe("Unexpected use of 'localStorage'. 组件不直接读写 localStorage。");
    });

    it('counts reported plus bulk-suppressed problems and finds over-recorded suppressions', () => {
        const root = path.resolve('/repo');
        const counts = actualCounts(root, [{
            filePath: path.join(root, 'src', 'a.ts'),
            messages: [{ ruleId: any, line: 1 }],
            suppressedMessages: [
                { ruleId: any, line: 2, suppressions: [{ kind: 'file' }] },
                { ruleId: any, line: 3, suppressions: [{ kind: 'directive' }] },
            ],
        }]);
        expect(counts.get('src/a.ts')?.get(any)).toEqual({ count: 2, lines: [1, 2] });
        expect(staleSuppressions({ 'src/a.ts': { [any]: { count: 3 } }, 'src/gone.ts': { [any]: { count: 1 } } }, counts)).toEqual([
            { file: 'src/a.ts', rule: any, recorded: 3, actual: 2 },
            { file: 'src/gone.ts', rule: any, recorded: 1, actual: 0 },
        ]);
    });
});

describe('dedicatus debt that moves with the code', () => {
    const renameMap = new Map([['src/old.ts', 'src/new.ts']]);

    it('moves baseline keys and suppressions to a renamed path without counting it as growth', () => {
        expect(renameKey('D101:src/old.ts->src/components/x.tsx', renameMap)).toBe('D101:src/new.ts->src/components/x.tsx');
        expect(renameKey('D301:src/old.ts', renameMap)).toBe('D301:src/new.ts');
        expect(migrateBaseline(['D301:src/old.ts', 'D301:src/other.ts'], renameMap)).toEqual(['D301:src/new.ts', 'D301:src/other.ts']);

        const base = { 'src/old.ts': { r: { count: 2 } } };
        const migrated = migrateSuppressions(base, renameMap);
        expect(migrated).toEqual({ 'src/new.ts': { r: { count: 2 } } });
        expect(suppressionGrowth(migrated, base, renameMap)).toEqual([]);
        expect(baselineGrowth(['D301:src/new.ts'], ['D301:src/old.ts'], renameMap)).toEqual([]);
    });

    it('lets a new file take over debt only as far as it moved out of other files', () => {
        const newFiles = new Set(['src/big/part.ts']);
        const base = { 'src/big.ts': { r: { count: 5 } } };
        const current = { 'src/big.ts': { r: { count: 2 } }, 'src/big/part.ts': { r: { count: 4 } } };
        // 新文件里只有 3 条落在挪过来的行上：多登记的那 1 条是新写的，照样算增长
        const result = suppressionGrowthWithTransfers(current, base, new Map(), newFiles, new Map([['src/big/part.ts\u0000r', 3]]));
        expect(result.transferred).toEqual([{ file: 'src/big/part.ts', rule: 'r', count: 3 }]);
        expect(result.growth).toEqual([{ file: 'src/big/part.ts', rule: 'r', before: 3, after: 4 }]);

        const graph = baselineGrowthWithTransfers(
            ['D102:src/big/part.ts->src/stores/s.tsx', 'D102:src/other.ts->src/stores/s.tsx'],
            ['D102:src/big.ts->src/stores/s.tsx'],
            new Map(),
            newFiles,
        );
        expect(graph).toEqual({ growth: ['D102:src/other.ts->src/stores/s.tsx'], transferred: ['D102:src/big/part.ts->src/stores/s.tsx'] });
    });
});
