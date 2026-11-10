import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import adapter, { baseRisk, baselineHints, baselineItems, baselineShrink, growthProblems, lintHints, lintItems, lintKey } from '../../../dev/coven/adapter.mjs';
import config from '../../../dev/coven/config.json';
import { blockedPackagesIn, missingPackageNotes, withoutPackages } from '../../../dev/coven/setupWorktree.mjs';
import { validateAdapter } from '../../../packages/coven/src/adapter.mjs';
import { evaluatorVars, generatorVars, plannerVars, readTemplate, renderTemplate } from '../../../packages/coven/src/prompt.mjs';
import { riskOf } from '../../../packages/coven/src/risk.mjs';

// test/unit/coven/foliaAdapter.test.ts
// Coven 的 Folia 适配层（dev/coven/adapter.mjs）：条目从 Dedicatus 基线和 ESLint 抑制来、风险按 config.json 的敏感路径表、
// 账本是基线和抑制文件（只减不增，D841；条目要真的消掉，D806）、角色提示里的 Folia 部分、云端装不上包时的准备步骤。
// harness 本身的测试在 packages/coven/test/。

const rules = config.risk;
const risk = (code: string, paths: string[]) => riskOf(baseRisk({ code }), paths, rules);

describe('folia adapter shape', () => {
    it('passes the harness interface check', () => {
        expect(() => validateAdapter(adapter)).not.toThrow();
        expect(Object.keys(adapter.sources)).toEqual(['baseline', 'lint']);
        expect(adapter.ledger?.files).toEqual(['dev/dedicatus/baseline.json', 'eslint-suppressions.json']);
    });
});

describe('folia risk', () => {
    it('starts from the code and goes up for sensitive paths', () => {
        expect(risk('D431', ['src/stores/useLibraryStore.ts']).risk).toBe('R0');
        expect(risk('D405', ['src/utils/format.ts']).risk).toBe('R1');
        expect(risk('D102', ['src/utils/lyrics/lyricMatchSources.ts', 'src/stores/useOnlineProviderAccountStore.ts']).risk).toBe('R2');
        const store = risk('D101', ['src/stores/useVisualizerSettingsStore.ts', 'src/components/visualizer/registry.tsx']);
        expect(store.risk).toBe('R3');
        expect(store.reasons.join('\n')).toContain('registry.tsx');
        expect(risk('D190', ['src/services/onlineMusic/kugou/kugouProvider.ts']).risk).toBe('R3');
        expect(risk('D431', ['electron/main.cjs']).risk).toBe('R3');
        expect(risk('D190', ['dev/dedicatus/rules.mjs']).risk).toBe('R4');
        expect(risk('D431', ['package.json']).risk).toBe('R4');
    });
});

describe('folia scope sources', () => {
    const entries = [
        'D101:src/stores/useVisualizerSettingsStore.ts->src/components/visualizer/registry.tsx',
        'D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts',
        'D190:src/utils/themeColorMath.ts->src/components/visualizer/colorMix.ts',
        'D301:src/components/command-palette/commandRegistry.ts',
        'D999:retired/or/unknown.ts',
    ];

    it('turns baseline entries into items, filtered by code prefix', () => {
        const all = baselineItems(entries);
        expect(all.map(item => item.code)).toEqual(['D101', 'D102', 'D190', 'D301']);
        expect(all[1]).toMatchObject({ kind: 'baseline', action: 'refactor', paths: ['src/utils/lyrics/lyricMatchSources.ts', 'src/stores/useOnlineProviderAccountStore.ts'] });
        expect(all[3].paths).toEqual(['src/components/command-palette/commandRegistry.ts']);
        expect(baselineItems(entries, { codes: ['D1'] }).map(item => item.code)).toEqual(['D101', 'D102', 'D190']);
        expect(baselineItems(entries, { codes: ['D190', 'D301'] }).map(item => item.code)).toEqual(['D190', 'D301']);
    });

    it('folds suppressions into one item per rule and path prefix, with the risk counted per file', () => {
        const suppressions = {
            'src/demo/a.ts': { '@stylistic/indent': { count: 3 }, '@stylistic/quotes': { count: 1 } },
            'src/demo/b.ts': { '@stylistic/indent': { count: 2 } },
            'src/utils/c.ts': { '@stylistic/indent': { count: 9 } },
        };
        const items = lintItems(suppressions, { rules: ['@stylistic/indent', '@stylistic/quotes', '@stylistic/eol-last'], prefixes: ['src/demo/'] });
        expect(items).toEqual([
            expect.objectContaining({ key: lintKey('@stylistic/indent', 'src/demo/'), code: 'D430', files: ['src/demo/a.ts', 'src/demo/b.ts'], riskPaths: ['src/demo/a.ts', 'src/demo/b.ts'], count: 5, note: '2 个文件，5 处' }),
            expect.objectContaining({ key: 'lint:@stylistic/quotes@src/demo/', code: 'D431', count: 1 }),
        ]);
        expect(baseRisk(items[0])).toBe('R0');
        // 套在一起的前缀只按外面那个出条目：两个条目盖住同样的文件，分进两个任务就会改同一批文件
        expect(lintItems(suppressions, { rules: ['@stylistic/indent'], prefixes: ['src/demo/', 'src/', 'src/demo/'] }).map(item => item.key)).toEqual([lintKey('@stylistic/indent', 'src/')]);
    });

    // Compass 里给来源选项列候选值
    it('offers the codes in the baseline and the rules and folders in the suppressions as option hints', () => {
        expect(baselineHints(['D190:a.ts->b.ts', 'D190:c.ts->d.ts', 'D301:e.ts', 'D999:gone.ts']).codes).toEqual([
            { value: 'D190', label: expect.any(String), count: 2 },
            { value: 'D301', label: expect.any(String), count: 1 },
        ]);
        const hints = lintHints({
            'src/demo/a.ts': { '@stylistic/indent': { count: 3 }, '@stylistic/quotes': { count: 1 } },
            'src/demo/deep/b.ts': { '@stylistic/indent': { count: 2 } },
            'root.ts': { '@stylistic/quotes': { count: 9 } },
        }, { maxPaths: 3 });
        expect(hints.rules).toEqual([
            { value: '@stylistic/quotes', label: 'D431', count: 10 },
            { value: '@stylistic/indent', label: 'D430', count: 5 },
        ]);
        // 目录到第三层，按抑制数排，截到 maxPaths；根目录下的文件不算目录
        expect(hints.paths).toEqual([{ value: 'src/', label: '各规则合计', count: 6 }, { value: 'src/demo/', label: '各规则合计', count: 6 }, { value: 'src/demo/deep/', label: '各规则合计', count: 2 }]);
        expect(typeof adapter.sources.lint.hints).toBe('function');
    });
});

describe('folia ledger and baseline check', () => {
    it('wants the item gone from the baseline and from the findings (D806)', () => {
        const item = 'D190:src/utils/themeColorMath.ts->src/components/visualizer/colorMix.ts';
        const base = { baseEntries: [item, 'D301:x.ts'], baseSuppressions: {}, headSuppressions: {} };
        expect(baselineShrink({ ...base, items: [item], headEntries: ['D301:x.ts'], findingKeys: new Set() })).toMatchObject({ ok: true, shrank: true });
        // 只删了基线，代码没修：Dedicatus 还能查出来（D190 是 warning，光看有没有 error 会漏）
        const cheated = baselineShrink({ ...base, items: [item], headEntries: ['D301:x.ts'], findingKeys: new Set([item]) });
        expect(cheated.ok).toBe(false);
        expect(cheated.items[item].detail).toContain('只删了基线');
        // 基线一条没少
        expect(baselineShrink({ ...base, items: [item], headEntries: [item, 'D301:x.ts'], findingKeys: new Set([item]) })).toMatchObject({ ok: false, shrank: false });
    });

    it('catches a new baseline entry or a moved suppression even when the totals shrank (D841)', () => {
        const ledgers = {
            baseEntries: ['D102:a.ts->b.ts', 'D190:c.ts->d.ts'],
            headEntries: ['D102:new.ts->z.ts'],
            baseSuppressions: { 'src/demo/a.ts': { '@stylistic/indent': { count: 5 } } },
            headSuppressions: { 'src/utils/b.ts': { '@stylistic/indent': { count: 1 } } },
            renameMap: new Map<string, string>(),
            newFiles: new Set<string>(),
        };
        expect(growthProblems(ledgers)).toEqual(['基线多了 D102:new.ts->z.ts', 'src/utils/b.ts 的 @stylistic/indent 抑制 0 → 1']);
        // 挪文件时条目跟着改名走，不算增长
        expect(growthProblems({
            ...ledgers,
            headEntries: ['D102:moved.ts->b.ts'],
            headSuppressions: { 'src/demo/moved.ts': { '@stylistic/indent': { count: 5 } } },
            renameMap: new Map([['a.ts', 'moved.ts'], ['src/demo/a.ts', 'src/demo/moved.ts']]),
        })).toEqual([]);
    });

    it('counts deleting a ledger file as growth, not as shrinking to nothing', () => {
        const read = (files: Record<string, string>) => (file: string) => files[file] ?? null;
        const base = { 'dev/dedicatus/baseline.json': '{"entries":["D102:a->b"]}', 'eslint-suppressions.json': '{}' };
        const growth = adapter.ledger!.growth;
        expect(growth({ readBase: read(base), readHead: read({ 'eslint-suppressions.json': '{}' }), renameMap: new Map(), newFiles: new Set() }))
            .toEqual(['删掉了 dev/dedicatus/baseline.json（账本只能变小，不能删）']);
        expect(growth({ readBase: read(base), readHead: read({ ...base, 'dev/dedicatus/baseline.json': '{"entries":[]}' }), renameMap: new Map(), newFiles: new Set() })).toEqual([]);
    });

    it('wants a lint item to bring its suppressions under the prefix to zero', () => {
        const before = { 'src/utils/a.ts': { '@typescript-eslint/consistent-type-imports': { count: 3 } }, 'src/utils/b.ts': { '@typescript-eslint/consistent-type-imports': { count: 1 } } };
        const partly = { 'src/utils/b.ts': { '@typescript-eslint/consistent-type-imports': { count: 1 } } };
        const input = { items: ['lint:@typescript-eslint/consistent-type-imports@src/utils/'], baseEntries: [], headEntries: [], baseSuppressions: before, findingKeys: new Set<string>() };
        expect(baselineShrink({ ...input, headSuppressions: partly })).toMatchObject({ ok: false, shrank: true });
        expect(baselineShrink({ ...input, headSuppressions: {} })).toMatchObject({ ok: true });
    });

    it('checks the shape of unit and dedicatus criteria', () => {
        expect(adapter.checks.unit.validate?.({ kind: 'unit', target: ['test/unit/a.test.ts; curl evil'] })).toContain('unit 要写 target');
        expect(adapter.checks.unit.validate?.({ kind: 'unit', target: ['test/unit/a.test.ts'] })).toBeNull();
        expect(adapter.checks.dedicatus.validate?.({ kind: 'dedicatus', target: 'everything' })).toContain('不用写 target');
        // 旧契约里的 graph、all 照样认
        expect(adapter.checks.dedicatus.validate?.({ kind: 'dedicatus' })).toBeNull();
        expect(adapter.checks.dedicatus.validate?.({ kind: 'dedicatus', target: 'graph' })).toBeNull();
    });

    // Op. 1：挪出 src/components/ 后 D411 变成 D508，只跑模块图的 verify 看不见，要到 CI 的 lint 才暴露
    it('always lints the changed files, even when the contract only asked for the module graph', () => {
        const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-folia-lint-'));
        try {
            const calls: string[][] = [];
            const memoStore = new Map<string, unknown>();
            const ctx = (criterion: object) => ({
                worktree, mergeBase: 'base1', criterion, contract: { items: [] },
                memo: <T>(key: string, compute: () => T): T => {
                    if (!memoStore.has(key)) memoStore.set(key, compute());
                    return memoStore.get(key) as T;
                },
                run: (_command: string, args: string[]) => {
                    calls.push(args);
                    return { ok: true, status: 0, seconds: 1, output: JSON.stringify({ fresh: [{ level: 'error', code: 'D508', file: 'src/demo/feedMemory.ts', line: 3, key: 'k' }], known: [] }) };
                },
                readAt: () => null,
            });
            const missing = adapter.checks.dedicatus.run?.(ctx({ id: 'c2', verify: { kind: 'dedicatus', target: 'graph' } }) as never);
            expect(missing).toMatchObject({ ok: false, summary: expect.stringContaining('npm run lint:install') });
            expect(calls).toEqual([]);

            memoStore.clear();
            fs.mkdirSync(path.join(worktree, 'dev/dedicatus/lint/node_modules'), { recursive: true });
            const result = adapter.checks.dedicatus.run?.(ctx({ id: 'c2', verify: { kind: 'dedicatus', target: 'graph' } }) as never);
            expect(result).toMatchObject({ ok: false, summary: expect.stringContaining('D508 src/demo/feedMemory.ts:3') });
            adapter.checks.baseline.run?.(ctx({ id: 'c1', verify: { kind: 'baseline' } }) as never);
            // baseline 共用同一次 Dedicatus 的结果，只跑一遍
            expect(calls).toEqual([['dev/dedicatus/cli.mjs', '--json', '--base', 'base1', '--all']]);
        } finally {
            fs.rmSync(worktree, { recursive: true, force: true });
        }
    });
});

describe('folia role prompts', () => {
    const ITEM = 'D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts';
    const contract = {
        task: 'op3-no1', title: 'lyric-match-sources', items: [ITEM], risk: 'R3', action: 'refactor', goal: 'g', nonGoals: [], scope: { paths: ['src/utils/lyrics/'] },
        criteria: [
            { id: 'c1', description: '基线', verify: { kind: 'baseline' }, passes: false },
            { id: 'c2', description: '模块图和 lint', verify: { kind: 'dedicatus', target: 'all' }, passes: false },
        ],
    };
    const state = {
        run: 'op3', scope: 'fugue-boundaries', integrationBranch: 'coven/op3', startedAt: '2026-11-09T01:00:00.000Z',
        items: { [ITEM]: { claim: { state: 'claimed' } } },
        tasks: { 'op3-no1': { rounds: 1 } },
    };
    const checked = validateAdapter(adapter);

    it('fills every template slot with the Folia rules', () => {
        const scope = { items: [{ key: ITEM, kind: 'baseline', risk: 'R2', reasons: [] }] };
        const planner = renderTemplate(readTemplate('planner'), plannerVars(state, scope, config, checked));
        expect(planner).toContain('`skills/file-modularization/SKILL.md`');
        expect(planner).toContain('{"kind":"baseline"}');
        expect(planner).toContain('"title": "lyric-match-sources"');
        expect(planner).toContain('挪进 `src/stores/` 以后报 D508');
        expect(checked.worktree.flags).toEqual([]);
        const generator = renderTemplate(readTemplate('generator'), generatorVars(state, config, checked, contract, null));
        // 准备步骤总是装 ESLint 隔离环境（verify 每次都跑 ESLint）；装不上的包不要自己绕
        expect(generator).toContain('`npm run coven:setup`（装依赖和 ESLint 隔离环境）');
        expect(generator).not.toContain('--lint');
        expect(generator).toContain('`npm run dedicatus -- --all`');
        expect(generator).toContain('不要自己想办法绕');
        expect(generator).toContain('npm run dedicatus -- --migrate-renames');
        expect(generator).toContain('先 cd 进你的 worktree 根目录');
        expect(generator).toContain('提交信息写中文');
        const verify = { mergeBase: 'abc', head: 'def1234', checks: [] };
        const evaluator = renderTemplate(readTemplate('evaluator'), evaluatorVars(state, config, checked, contract, verify, 'D:/wt'));
        expect(evaluator).toContain('`?skipStartup&mockSong`');
        expect(evaluator).toContain('`skills/development-workflow` 的严重度标准');
    });
});

describe('folia worktree setup', () => {
    const lock = {
        packages: {
            '': { dependencies: { kugoumusicapi: 'https://github.com/MakcRe/KuGouMusicApi/archive/refs/tags/v1.6.0.tar.gz', react: '^19' } },
            'node_modules/kugoumusicapi': { resolved: 'https://github.com/MakcRe/KuGouMusicApi/archive/refs/tags/v1.6.0.tar.gz' },
            'node_modules/kugoumusicapi/node_modules/express': { version: '4' },
            'node_modules/react': { version: '19' },
        },
    };

    it('recognizes a blocked package by name or by its download address', () => {
        expect(blockedPackagesIn('npm error 403 Forbidden - GET https://github.com/makcre/kugoumusicapi/archive/refs/tags/v1.6.0.tar.gz', lock).map(entry => entry.name)).toEqual(['kugoumusicapi']);
        expect(blockedPackagesIn('npm error code ETIMEDOUT registry.npmjs.org/react', lock)).toEqual([]);
        // 提到了包名，但不是下载失败（lock 对不上、文件被占用）：不能悄悄跳过这个包
        expect(blockedPackagesIn("npm error Invalid: lock file's kugoumusicapi@1.6.0 does not satisfy kugoumusicapi@1.7.0", lock)).toEqual([]);
        expect(blockedPackagesIn('npm error EPERM: operation not permitted, unlink node_modules/kugoumusicapi/package.json', lock)).toEqual([]);
    });

    it('drops a package from copies of package.json and the lock, leaving the originals alone', () => {
        const pkg = { dependencies: { kugoumusicapi: 'x', react: '^19' } };
        const stripped = withoutPackages(pkg, lock, ['kugoumusicapi']);
        expect(stripped.pkg.dependencies).toEqual({ react: '^19' });
        expect(Object.keys(stripped.lock.packages)).toEqual(['', 'node_modules/react']);
        expect(stripped.lock.packages[''].dependencies).toEqual({ react: '^19' });
        expect(pkg.dependencies.kugoumusicapi).toBe('x');
        expect(lock.packages['node_modules/kugoumusicapi']).toBeDefined();
    });

    it('tells verify which registered packages are missing', () => {
        const worktree = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-setup-'));
        try {
            fs.writeFileSync(path.join(worktree, 'package.json'), JSON.stringify({ dependencies: { kugoumusicapi: 'x' } }));
            expect(missingPackageNotes(worktree)).toEqual([]);
            fs.mkdirSync(path.join(worktree, 'node_modules'));
            expect(missingPackageNotes(worktree)).toEqual([expect.stringContaining('没装 kugoumusicapi')]);
            fs.mkdirSync(path.join(worktree, 'node_modules', 'kugoumusicapi'));
            expect(missingPackageNotes(worktree)).toEqual([]);
        } finally {
            fs.rmSync(worktree, { recursive: true, force: true });
        }
    });
});
