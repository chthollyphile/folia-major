import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { validateAdapter } from '../src/adapter.mjs';
import { configPathOf, validateConfig } from '../src/host.mjs';
import { scopeItems } from '../src/scope.mjs';
import { verifyTask } from '../src/verify.mjs';
import fixture, { LEDGER_FILE, outcomes, riskRules } from './fixtures/adapter.mjs';

// packages/coven/test/harness.test.mjs
// harness 和项目之间的接缝：适配层的形状检查、配置文件在哪找、范围从适配层的来源来，
// 以及 verify 在一个临时 git 仓库里用假适配层把每道关口走一遍（不碰 Folia 的任何文件，证明 harness 真的独立）。

const adapter = validateAdapter(fixture);

describe('coven adapter interface', () => {
    it('lists everything wrong with an adapter at once', () => {
        expect(() => validateAdapter({ id: 'x', sources: { Bad: {} }, checks: { a: { deterministic: true } }, requiredKinds: { refactor: ['nope'] }, prompts: {} }))
            .toThrow(/来源名 Bad[\s\S]*sources\.Bad\.list[\s\S]*baseRisk[\s\S]*checks\.a 是确定性的[\s\S]*requiredKinds\.refactor 里的 nope[\s\S]*prompts\.planner/);
    });

    it('fills the optional parts with defaults', () => {
        const minimal = validateAdapter({ ...fixture, ledger: undefined, requiredKinds: undefined, worktree: undefined });
        expect(minimal.ledger.files).toEqual([]);
        expect(minimal.ledger.growth({})).toEqual([]);
        expect(minimal.requiredKinds).toEqual({});
        expect(minimal.worktree).toEqual({ flags: [] });
    });

    it('turns source items into scope items with a risk from the adapter base and the config paths', () => {
        const items = scopeItems(adapter, { root: '.', sources: ['todo'], options: {}, riskRules });
        expect(items.map(item => [item.key, item.risk])).toEqual([['todo:src/a.ts', 'R2'], ['todo:src/app/registry.ts', 'R3'], ['todo:style', 'R0']]);
        expect(items[1].reasons).toEqual(['src/app/registry.ts：启动顺序']);
        expect(scopeItems(adapter, { root: '.', sources: ['todo'], options: { tags: ['y'] }, riskRules }).map(item => item.key)).toEqual(['todo:src/app/registry.ts']);
        expect(() => scopeItems(adapter, { root: '.', sources: ['nope'], options: {}, riskRules })).toThrow('没有来源 nope');
    });
});

describe('coven host config', () => {
    let root;
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-host-'));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it('finds the config by env, then package.json, then coven.config.json', () => {
        expect(() => configPathOf(root, {})).toThrow('找不到 Coven 配置');
        fs.writeFileSync(path.join(root, 'coven.config.json'), '{}');
        expect(configPathOf(root, {})).toBe(path.join(root, 'coven.config.json'));
        fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ coven: { config: 'tools/coven.json' } }));
        expect(configPathOf(root, {})).toBe(path.join(root, 'tools/coven.json'));
        expect(configPathOf(root, { COVEN_CONFIG: 'x.json' })).toBe(path.join(root, 'x.json'));
    });

    it('says which config fields are missing', () => {
        expect(() => validateConfig({ repo: 'o/r' }, 'coven.json')).toThrow(/coven\.json 缺这些字段：adapter、leaseHours/);
    });
});

describe('coven verify gates on a scratch repository', () => {
    let repo;
    const git = (...args) => {
        const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
    };
    const write = (file, text) => {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), text);
    };
    const commit = message => {
        git('add', '-A');
        git('commit', '-q', '-m', message);
    };
    const contract = {
        task: 'woo1-no1', title: 'fix-a', items: ['todo:src/a.ts'], risk: 'R2', action: 'refactor', goal: 'g', nonGoals: [], scope: { paths: ['src/a.ts'] },
        criteria: [
            { id: 'c1', description: '条目消掉', verify: { kind: 'baseline' }, passes: false },
            { id: 'c2', description: '单测', verify: { kind: 'unit', target: ['t.test'] }, passes: false },
            { id: 'c3', description: '读 diff', verify: { kind: 'review' }, passes: false },
        ],
    };
    const host = () => ({ root: repo, config: { risk: riskRules }, adapter });
    const run = (overrides = {}) => verifyTask(host(), { taskId: 'woo1-no1', worktree: repo, base: 'coven/woo1', contract, approved: { contract }, ...overrides });
    const byId = result => Object.fromEntries(result.checks.map(check => [check.id, check]));

    beforeEach(() => {
        repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-verify-'));
        git('init', '-q', '-b', 'main');
        write('src/a.ts', 'a\n');
        write('src/app/registry.ts', 'r\n');
        write(LEDGER_FILE, JSON.stringify(['todo:src/a.ts']));
        commit('base');
        git('branch', 'coven/woo1');
        git('switch', '-q', '-c', 'coven/woo1-no1');
        Object.assign(outcomes, { typecheck: true, unit: true, baseline: true });
    });
    afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    it('passes a clean, in-scope change and runs the deterministic checks in order', () => {
        write('src/a.ts', 'fixed\n');
        write(LEDGER_FILE, JSON.stringify([]));
        commit('fix a');
        const result = run();
        expect(result.ok).toBe(true);
        expect(result.checks.map(check => check.id)).toEqual(['clean', 'D804', 'D803', 'D807', 'D841', 'c2', 'c1']);
        expect(result.criteria).toEqual({ c2: true, c1: true });
        expect(result.changed).toEqual(['M ledger.json', 'M src/a.ts']);
    });

    it('stops at the gates and does not run workspace code past them', () => {
        write('src/app/registry.ts', 'touched\n');
        write('src/b.ts', 'new\n');
        write(LEDGER_FILE, JSON.stringify(['todo:src/a.ts', 'todo:new']));
        commit('too much');
        write('src/a.ts', 'dirty\n');
        const checks = byId(run({ contract: { ...contract, goal: 'changed after approval' } }));
        expect(checks.clean.ok).toBe(false);
        expect(checks.D804.ok).toBe(false);
        expect(checks.D803.summary).toContain('src/app/registry.ts');
        expect(checks.D807.summary).toContain('改到的路径是 R3');
        expect(checks.D841.summary).toContain('账本多了 todo:new');
        expect(checks.c1.summary).toMatch(/^没跑：先过 clean、D804、D803、D807/);
    });

    it('reports a failed deterministic check with the adapter code', () => {
        write('src/a.ts', 'fixed\n');
        commit('fix a');
        outcomes.baseline = false;
        const checks = byId(run());
        expect(checks.c1).toMatchObject({ ok: false, code: 'D806' });
        expect(run({ approved: null }).checks.find(check => check.id === 'D801')).toMatchObject({ ok: false });
    });
});

describe('coven adapter interface hardening', () => {
    const broken = overrides => () => validateAdapter({ ...fixture, ...overrides });

    it('rejects stateful key patterns, unknown actions, directory ledgers, clashing options and missing prompt fields', () => {
        expect(broken({ itemKeyPattern: /todo:\S+/g })).toThrow('不能带 g 或 y');
        expect(broken({ requiredKinds: { refactr: ['baseline'] } })).toThrow('requiredKinds 的 refactr 不是认识的动作');
        expect(broken({ requiredKinds: { refactor: ['toString'] } })).toThrow('toString 不在 checks 里');
        expect(broken({ ledger: { files: ['dev/ledger/'], growth: () => [] } })).toThrow('不能是目录');
        expect(broken({ sources: { todo: { ...fixture.sources.todo, options: ['name'] } } })).toThrow('和 coven scope 自己的选项重名');
        expect(broken({ prompts: { ...fixture.prompts, generator: () => ({ setup: 'x' }) } })).toThrow(/prompts\.generator 返回的片段缺字段.*steps/);
        expect(broken({ worktree: { flags: ['worktree'] } })).toThrow('worktree.flags');
    });

    it('does not take names from the object prototype as check kinds', async () => {
        const { validateContract } = await import('../src/contract.mjs');
        const { checks, requiredKinds } = await import('./fixtures/adapter.mjs');
        const contract = {
            task: 'op1-no1', title: 'a', items: ['todo:src/a.ts'], risk: 'R2', action: 'refactor', goal: 'g', nonGoals: [], scope: { paths: ['src/'] },
            criteria: [
                { id: 'c1', description: '基线', verify: { kind: 'baseline' }, passes: false },
                { id: 'c2', description: '原型上的名字', verify: { kind: 'constructor' }, passes: false },
            ],
        };
        expect(validateContract(contract, { checks, requiredKinds }).map(problem => problem.message).join('\n')).toContain('verify.kind 不认识：constructor');
    });
});

describe('coven claim key parsing with an adapter pattern', () => {
    it('prefers the adapter key pattern over the first backticked token', async () => {
        const { parseClaimComment } = await import('../src/claim.mjs');
        const comment = { id: 1, author: 'a', association: 'OWNER', createdAt: '2026-11-09T01:00:00Z', body: 'coven: claimed @a · 手动修 `src/a.ts` 里的 todo:src/a.ts' };
        expect(parseClaimComment(comment, { leaseHours: 12 }).item).toBe('src/a.ts');
        expect(parseClaimComment(comment, { leaseHours: 12, itemPattern: adapter.itemKeyPattern }).item).toBe('todo:src/a.ts');
    });
});

describe('coven setup guard', () => {
    it('refuses to set up the supervisor checkout when no worktree is given', async () => {
        const { run } = await import('../src/setup.mjs');
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-setup-guard-'));
        try {
            fs.mkdirSync(path.join(root, '.coven'));
            fs.writeFileSync(path.join(root, '.coven', 'state.json'), '{}');
            let called = null;
            const host = { root, adapter: { ...adapter, worktree: { flags: ['lint'], setup: ctx => { called = ctx; } } } };
            await expect(run(host, [])).rejects.toThrow('不是工作 worktree');
            await run(host, ['--worktree', root, '--lint']);
            expect(called).toMatchObject({ worktree: root, flags: { lint: true } });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});

describe('coven command line help', () => {
    let root;
    const bin = fileURLToPath(new URL('../bin/coven.mjs', import.meta.url));
    const coven = (...args) => spawnSync(process.execPath, [bin, ...args], { cwd: root, encoding: 'utf8' });
    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-help-'));
        spawnSync('git', ['init', '-q'], { cwd: root });
        const config = {
            adapter: fileURLToPath(new URL('fixtures/adapter.mjs', import.meta.url)), repo: 'o/r', leaseHours: 12, timeZone: 'UTC', timeZoneLabel: 'UTC',
            concurrency: 1, maxReviewRounds: 2, risk: riskRules,
            roles: { planner: { model: 'm', effort: 'high' }, generator: { model: 'm', effort: 'high' }, evaluator: { model: 'm', effort: 'high' } },
        };
        fs.writeFileSync(path.join(root, 'coven.config.json'), JSON.stringify(config));
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    // Op. 1：只有 scope 认 --help，别的命令把它当成不认识的选项
    it('answers --help for every command without doing anything', () => {
        for (const command of ['scope', 'state', 'claim', 'prompt', 'contract', 'verify', 'pr', 'setup', 'compass']) {
            const result = coven(command, '--help');
            expect(result.status, `${command}: ${result.stderr}`).toBe(0);
            expect(result.stdout).toContain(`coven ${command}`);
        }
        expect(coven('scope', '--help').stdout).toContain('todo');
        expect(coven('--help').stdout).toContain('coven <命令> --help');
        expect(fs.existsSync(path.join(root, '.coven'))).toBe(false);
    });

    // Op. 1：新检出里 state show 报“找不到 state.json”，像出错；手册第 0 步正要靠它判断“没有运行”
    it('says there is no run instead of failing when state.json is missing', () => {
        const result = coven('state', 'show');
        expect(result.status).toBe(0);
        expect(result.stdout).toContain('没有进行中的运行');
        expect(coven('claim', 'status').stderr).toContain('只有监控 session 能执行');
    });
});

describe('coven second-round hardening', () => {
    it('reports bad requiredKinds values and worktree hooks instead of crashing', () => {
        expect(() => validateAdapter({ ...fixture, requiredKinds: { refactor: 5 } })).toThrow('要是验收种类的数组');
        expect(() => validateAdapter({ ...fixture, worktree: { setup: 'npm ci' } })).toThrow('worktree.setup 要是函数');
    });

    it('passes the real config to the prompt fragments when checking them', () => {
        const reads = { ...fixture, prompts: { ...fixture.prompts, planner: ({ config }) => ({ ...fixture.prompts.planner(), itemsIntro: `范围 ${config.risk.r4.length}` }) } };
        expect(() => validateAdapter(reads)).toThrow('用桩数据调用时出错');
        expect(() => validateAdapter(reads, { config: { risk: riskRules } })).not.toThrow();
    });

    it('lists problems for an action named after a prototype member', async () => {
        const { validateContract } = await import('../src/contract.mjs');
        const { checks, requiredKinds } = await import('./fixtures/adapter.mjs');
        const contract = { task: 'op1-no1', title: 'a', items: ['x'], risk: 'R2', action: 'constructor', goal: 'g', nonGoals: [], scope: { paths: ['src/'] }, criteria: [{ id: 'c1', description: 'd', verify: { kind: 'review' }, passes: false }] };
        expect(validateContract(contract, { checks, requiredKinds }).map(problem => problem.message).join('\n')).toContain('action 只能是');
        expect(() => scopeItems(adapter, { root: '.', sources: ['constructor'], options: {}, riskRules })).toThrow('没有来源 constructor');
    });
});
