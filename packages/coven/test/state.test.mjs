import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { prLabel, requireCurrentFormat } from '../src/common.mjs';
import { applyPlanImport, contractFingerprint } from '../src/contract.mjs';
import { applyDecision, closeOpenEscalations, decisionProblems } from '../src/escalations.mjs';
import { mergeLocally, prPreflight, renderPrBody } from '../src/pr.mjs';
import { auditWrites, claimChangeFor, createState, pushCreatedRef, renderSummary, runRecord, runTokens, transition } from '../src/state.mjs';
import { parseNameStatus } from '../src/verify.mjs';

// packages/coven/test/state.test.mjs
// 监控 session 的账本：阶段流转里的关口（HD2、两轮评审 D811、预算 D813）、运行记录、运行后审计，
// verify 读 diff，开 PR 前的把关，以及干跑合并在本地真的把工作分支合进集成分支。

/** @param {Partial<import('../src/state.mjs').CovenTask>} [overrides] */
const task = (overrides = {}) => ({ items: ['D102:a->b'], risk: 'R2', phase: 'planning', rounds: 0, tokens: 0, history: [], ...overrides });

describe('coven task phases', () => {
    it('does not start building an R2 task before HD2, but lets R0/R1 skip it once auto-approved', () => {
        expect(transition(task(), 'building', { approved: false })).toContain('HD2');
        const quick = task({ risk: 'R1' });
        expect(transition(quick, 'building', { approved: false })).toContain('--auto');
        expect(transition(quick, 'building', { approved: true })).toBeNull();
        expect(quick.phase).toBe('building');
        expect(transition(task({ risk: 'R4' }), 'building', { approved: true })).toContain('R4');
    });

    it('counts rounds on evaluating and stops at the limit with D811', () => {
        const record = task({ phase: 'spec-review' });
        expect(transition(record, 'building', { approved: true })).toBeNull();
        expect(transition(record, 'evaluating')).toBeNull();
        expect(transition(record, 'building', { approved: true, maxRounds: 2 })).toBeNull();
        expect(transition(record, 'evaluating')).toBeNull();
        expect(record.rounds).toBe(2);
        expect(transition(record, 'building', { approved: true, maxRounds: 2 })).toContain('D811');
        expect(transition(record, 'blocked', { code: 'D811' })).toBeNull();
        expect(record).toMatchObject({ phase: 'blocked', code: 'D811' });
    });

    it('stops at the budget with D813 and requires a D8xx code to block', () => {
        expect(transition(task({ phase: 'spec-review', tokens: 2_000_000 }), 'building', { approved: true, budget: { perTaskTokens: 2_000_000 } })).toContain('D813');
        expect(transition(task({ phase: 'spec-review', tokens: 1_999_999 }), 'building', { approved: true, budget: { perTaskTokens: 2_000_000, perRunTokens: null } })).toBeNull();
        expect(transition(task({ phase: 'spec-review' }), 'building', { approved: true, budget: { perRunTokens: 10_000_000 }, runTokens: 10_000_001 })).toContain('D813');
        expect(transition(task(), 'blocked', {})).toContain('原因代码');
    });

    it('needs a maintainer to unblock, so blocked → building cannot dodge the round limit', () => {
        const record = task({ phase: 'evaluating', rounds: 2 });
        expect(transition(record, 'blocked', { code: 'D811' })).toBeNull();
        expect(transition(record, 'building', { approved: true, maxRounds: 2 })).toContain('--unblock-by');
        expect(transition(record, 'building', { approved: true, maxRounds: 2, unblockedBy: 'alice' })).toBeNull();
        expect(record.history.at(-1)).toMatchObject({ phase: 'building', unblockedBy: 'alice' });
        // 放弃不用解封
        const parked = task({ phase: 'blocked', code: 'D812' });
        expect(transition(parked, 'released')).toBeNull();
    });

    it('opens a PR only after a passing review and never moves a finished task', () => {
        const record = task({ phase: 'evaluating', rounds: 1 });
        expect(transition(record, 'pr')).toContain('评审没有通过');
        record.lastVerdict = { round: 1, passes: true };
        expect(transition(record, 'pr')).toBeNull();
        expect(transition(record, 'done')).toBeNull();
        expect(transition(record, 'released')).toContain('已经 done');
    });

    it('maps phases to claim comment states', () => {
        expect(claimChangeFor('blocked', { code: 'D812' })).toEqual({ state: 'blocked', code: 'D812' });
        expect(claimChangeFor('done')).toEqual({ state: 'done' });
        expect(claimChangeFor('building', { from: 'blocked' })).toEqual({ state: 'claimed' });
        expect(claimChangeFor('evaluating', { from: 'building' })).toBeNull();
    });
});

describe('coven run record and audit', () => {
    it('names the run by its opus number and keeps the maintainer\'s local date', () => {
        const state = createState({ run: 'op3', scope: 'fugue-boundaries', owner: 'alice', trackingIssue: null, dryRun: false, now: '2026-11-08T17:00:00.000Z', timeZone: 'Asia/Shanghai' });
        expect(state).toMatchObject({ run: 'op3', integrationBranch: 'coven/op3', date: '2026-11-09' });
    });

    it('takes an opus number only when the push created the branch', () => {
        // 两边都从同一个 origin/main 切出时，远端已有的分支 git 只报“已是最新”、退出码 0
        const branch = 'refs/heads/coven/op3';
        const tag = 'refs/tags/coven-op3';
        const both = `To origin\n*\t${branch}:${branch}\t[new branch]\n*\t${tag}:${tag}\t[new tag]\nDone\n`;
        expect([branch, tag].every(ref => pushCreatedRef(both, ref))).toBe(true);
        expect(pushCreatedRef(`To origin\n=\t${branch}:${branch}\t[up to date]\nDone\n`, branch)).toBe(false);
        expect(pushCreatedRef(`To origin\n!\t${branch}:${branch}\t[rejected] (stale info)\nDone\n`, branch)).toBe(false);
        expect(pushCreatedRef('To origin\n*\trefs/heads/coven/op31:refs/heads/coven/op31\t[new branch]\n', branch)).toBe(false);
    });

    it('counts interventions, rounds, tokens and escalations', () => {
        const state = createState({ run: 'woo1', scope: 'fugue', owner: 'alice', trackingIssue: 42, dryRun: true, now: '2026-11-09T01:00:00.000Z' });
        state.tasks.a = { ...task({ phase: 'done', rounds: 2, tokens: 1_500_000, pr: 1201 }), history: [{ at: '2026-11-09T01:10:00.000Z', phase: 'planning' }, { at: '2026-11-09T02:40:00.000Z', phase: 'done' }] };
        state.tasks.b = { ...task({ phase: 'blocked', code: 'D811', rounds: 2, tokens: 500_000 }), history: [{ at: '2026-11-09T01:10:00.000Z', phase: 'planning' }] };
        state.escalations = [{ items: ['D190:x->y'], code: 'D812', question: 'tuningRegistry 按路径被找，挪还是放行？' }];
        state.interventions = [{ kind: 'HD1' }, { kind: 'HD2' }, { kind: 'HD2' }, { kind: 'HD4' }];
        const record = runRecord(state, '2026-11-09T03:00:00.000Z');
        expect(record.interventions).toEqual({ HD1: 1, HD2: 2, HD4: 1 });
        expect(record.tasks.find(entry => entry.task === 'a')).toMatchObject({ minutes: 90, rounds: 2, pr: 1201 });
        expect(record.escalations.map(entry => entry.code)).toEqual(['D812', 'D811']);
        expect(record.totals).toMatchObject({ tasks: 2, done: 1, prs: 1, blocked: 1, tokens: 2_000_000 });
    });

    // Op. 1：planner 没出任务时用量记不上；D812 在导入任务时被删掉；HD4 只记了次数，看不出选了什么
    it('keeps the escalation, the maintainer decision, every intervention and run-level tokens in the record', () => {
        const ITEM = 'D190:src/components/app/home/explore/exploreFeedMemory.ts';
        const state = createState({ run: 'op1', scope: 'fugue-explore', owner: 'alice', trackingIssue: 42, dryRun: false, now: '2026-11-09T07:13:00.000Z' });
        state.items[ITEM] = { claim: { state: 'blocked', code: 'D812' } };
        applyPlanImport(state, { tasks: [], escalations: [{ items: [ITEM], code: 'D812', question: '挪出 components 后 D411 变 D508，怎么办？', options: ['挪进 stores、改走 storagePrimitives', '放行'] }] }, '2026-11-09T07:20:00.000Z');
        // planner 一个任务都没出：用量记到运行本身
        state.costs.push({ at: '2026-11-09T07:21:00.000Z', task: null, role: 'planner', tokens: 186_648, approx: true });
        expect(runTokens(state)).toBe(186_648);
        expect(decisionProblems(state, { id: 'e1', outcome: 'replan' }).join('\n')).toMatch(/--by[\s\S]*--note/);
        expect(decisionProblems(state, { id: 'e9', outcome: 'replan', by: 'alice', note: 'x' })[0]).toContain('没有升级 e9');
        applyDecision(state, { id: 'e1', outcome: 'replan', by: 'alice', note: '选一：挪进 src/stores/，storeContract 加放行边', now: '2026-11-09T07:25:00.000Z' });
        state.interventions.push({ at: '2026-11-09T07:25:00.000Z', kind: 'HD4', note: '@alice 对 e1（D812）：replan —— 选一' });
        state.items[ITEM].claim = { state: 'claimed' };
        applyPlanImport(state, { tasks: [{ task: 'op1-no1', title: 'explore-feed-memory-into-stores', items: [ITEM], risk: 'R2' }] }, '2026-11-09T07:30:00.000Z');
        state.tasks['op1-no1'].tokens = 112_328;
        state.costs.push({ at: '2026-11-09T07:40:00.000Z', task: 'op1-no1', role: 'generator', tokens: 112_328, approx: true });
        expect(decisionProblems(state, { id: 'e1', outcome: 'release', by: 'alice', note: 'x' })[0]).toContain('已经了结（分进了 op1-no1）');

        const record = runRecord(state, '2026-11-09T07:46:00.000Z');
        expect(record.escalations).toEqual([expect.objectContaining({
            id: 'e1', code: 'D812', options: ['挪进 stores、改走 storagePrimitives', '放行'],
            decision: expect.objectContaining({ outcome: 'replan', by: 'alice' }), resolution: expect.objectContaining({ how: 'tasks', tasks: ['op1-no1'] }),
        })]);
        expect(record.tasks[0]).toMatchObject({ codes: ['D812'], escalations: ['e1'], approxTokens: true });
        expect(record.interventionLog).toEqual([{ at: '2026-11-09T07:25:00.000Z', kind: 'HD4', note: '@alice 对 e1（D812）：replan —— 选一' }]);
        expect(record.totals).toMatchObject({ tokens: 298_976, approxTokens: true, overhead: { planner: 186_648 } });
        const summary = renderSummary(record);
        expect(summary).toContain('用量：约 298976 token（含估算值），其中不属于任务的 planner 186648');
        expect(summary).toContain('| 约 112328 | ');
        expect(summary).toContain('| D812、e1 |');
        expect(summary).toContain('  - 决定（HD4，@alice）：replan —— 选一：挪进 src/stores/，storeContract 加放行边');
        expect(summary).toContain('  - 结果：分进了 op1-no1');
        expect(summary).toContain('- 2026-11-09 07:25Z HD4：@alice 对 e1（D812）：replan —— 选一');
    });

    it('releases an escalation outright when the maintainer decides not to do it', () => {
        const state = createState({ run: 'op1', scope: 'fugue', owner: 'alice', trackingIssue: 42, dryRun: false });
        state.items['D190:a'] = { claim: { state: 'blocked', code: 'D812' } };
        applyPlanImport(state, { tasks: [], escalations: [{ items: ['D190:a'], code: 'D812' }] }, '2026-11-09T01:00:00.000Z');
        expect(decisionProblems(state, { id: 'e1', outcome: 'later', by: 'alice', note: 'x' })[0]).toContain('replan、release、hold');
        applyDecision(state, { id: 'e1', outcome: 'release', by: 'alice', note: '不做', now: '2026-11-09T02:00:00.000Z' });
        expect(state.escalations[0].resolution).toEqual({ at: '2026-11-09T02:00:00.000Z', how: 'released' });
        expect(runRecord(state).escalations[0]).toMatchObject({ resolution: { how: 'released' } });
    });

    it('marks escalations still open at finish as closed by the finish, not as waiting forever', () => {
        const state = createState({ run: 'op1', scope: 'fugue', owner: 'alice', trackingIssue: 42, dryRun: false });
        state.items['D190:a'] = { claim: { state: 'blocked', code: 'D812' } };
        applyPlanImport(state, { tasks: [], escalations: [{ items: ['D190:a'], code: 'D812', question: '?' }] }, '2026-11-09T01:00:00.000Z');
        closeOpenEscalations(state, '2026-11-09T05:00:00.000Z');
        expect(renderSummary(runRecord(state))).toContain('  - 结果：收尾时还没了结，认领已释放');
    });

    it('reports GitHub writes that did not go through the scripts', () => {
        const logged = [
            { action: 'comment.create', commentId: 11 },
            { action: 'comment.edit', commentId: 11 },
            { action: 'pr.create', pr: 1201 },
            { action: 'comment.create', commentId: 'dry-1', dryRun: true },
        ];
        const result = auditWrites(logged, {
            comments: [{ id: 11, url: 'c11' }, { id: 12, url: 'c12' }],
            prs: [{ number: 1201, url: 'p1201' }, { number: 1202, url: 'p1202' }],
        });
        expect(result.unexpectedComments.map(entry => entry.id)).toEqual([12]);
        expect(result.unexpectedPrs.map(entry => entry.number)).toEqual([1202]);
    });
});

describe('coven verify', () => {
    it('reads renames from git diff --name-status', () => {
        expect(parseNameStatus('M\tsrc/a.ts\nR100\tsrc/components/x.ts\tsrc/services/x.ts\nA\tsrc/new.ts\n')).toEqual([
            { status: 'M', path: 'src/a.ts' },
            { status: 'R', oldPath: 'src/components/x.ts', path: 'src/services/x.ts' },
            { status: 'A', path: 'src/new.ts' },
        ]);
    });
});

describe('coven pr preflight', () => {
    const contract = {
        task: 'op3-no1', title: 'a', items: ['D102:a->b'], risk: 'R2', action: 'refactor', goal: 'g', nonGoals: [], scope: { paths: ['src/'] },
        criteria: [{ id: 'c1', description: '基线', verify: { kind: 'baseline' }, passes: true }],
    };
    const verify = { task: 'op3-no1', head: 'abc1234def', base: 'coven/op3', mergeBase: 'm', ok: true, criteria: { c1: true }, changed: ['M src/a.ts'], checks: [{ id: 'c1', kind: 'baseline', ok: true, summary: '已消掉' }] };
    const passed = { round: 1, passes: true, head: 'abc1234def', fingerprint: contractFingerprint(contract) };
    const stateWith = (overrides = {}) => ({
        run: 'op3', scope: 'fugue-boundaries', integrationBranch: 'coven/op3',
        tasks: { 'op3-no1': { ...task({ phase: 'evaluating', rounds: 1, lastVerdict: passed }), ...overrides } },
    });
    const input = { taskId: 'op3-no1', contract, approved: { contract }, verify, branch: 'coven/op3-no1', branchHead: 'abc1234def', reviewExists: true };

    it('lets a fully verified and reviewed task through', () => {
        expect(prPreflight({ ...input, state: stateWith() })).toEqual([]);
        const body = renderPrBody({ state: stateWith(), taskId: 'op3-no1', contract, verify, reviewText: '# Op. 3 No. 1 第 1 轮评审：pass\n\n只是改引用。' });
        expect(body.split('\n')[0]).toBe('> Coven Op. 3 No. 1 "a" · Fugue "boundaries" · Andante（R2） · 评审 1 轮 · 用量 0 token');
        expect(body).toContain('coven/op3');
        expect(body).toContain('只是改引用。');
    });

    it('blocks stale verify results, unapproved or failing contracts, a failed review and main as the base', () => {
        const problems = prPreflight({
            ...input,
            state: { ...stateWith({ lastVerdict: { ...passed, round: 0 } }), integrationBranch: 'main' },
            contract: { ...contract, criteria: [{ ...contract.criteria[0], passes: false }] },
            approved: null,
            branchHead: 'fff0000',
        });
        const text = problems.join('\n');
        expect(text).toContain('D801');
        expect(text).toContain('D802');
        expect(text).toContain('重跑 coven verify');
        expect(text).toContain('评审没有通过');
        expect(text).toContain('不直接进 main');
    });

    it('does not ship a commit or a contract the evaluator did not see', () => {
        // 评审在 A 上通过，之后又提交了 B，verify 也在 B 上重跑过了
        const newer = { ...verify, head: 'bbbbbbbbbb' };
        expect(prPreflight({ ...input, state: stateWith(), verify: newer, branchHead: 'bbbbbbbbbb' }).join('\n')).toContain('新提交要重新评审');
        const reworded = { ...contract, goal: '换了说法' };
        expect(prPreflight({ ...input, state: stateWith(), contract: reworded, approved: { contract: reworded } }).join('\n')).toContain('评审之后契约变了');
    });

    it('does not open a PR for a branch with no changes', () => {
        expect(prPreflight({ ...input, state: stateWith(), verify: { ...verify, changed: [] } }).join('\n')).toContain('没有任何改动');
    });

    it('wants verify against the integration branch and a coven task branch', () => {
        const text = prPreflight({ ...input, state: stateWith(), verify: { ...verify, base: 'HEAD~1' }, branch: 'main' }).join('\n');
        expect(text).toContain('不要用 --base');
        expect(text).toContain('coven/op3-no1');
    });
});

describe('coven state format', () => {
    it('refuses to continue a run from before the catalogue names', () => {
        expect(() => requireCurrentFormat({ version: 1, run: '2026-11-08-arch-1108' })).toThrow('finish --force');
        const current = createState({ run: 'op3', scope: 'fugue', owner: 'alice', trackingIssue: null, dryRun: false });
        expect(requireCurrentFormat(current)).toBe(current);
    });
});

describe('coven dry-run merge', () => {
    const git = (cwd, ...args) => {
        const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
        if (result.status !== 0) throw new Error(result.stderr);
        return result.stdout.trim();
    };

    it('merges the task branch into the local integration branch without checking anything out', () => {
        const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'coven-merge-'));
        // 模拟没配 git 身份的机器（CI 的 runner 就是这样）：干跑合并照样要能建合并提交
        const saved = { global: process.env.GIT_CONFIG_GLOBAL, nosystem: process.env.GIT_CONFIG_NOSYSTEM };
        const emptyConfig = path.join(repo, '..', `${path.basename(repo)}.gitconfig`);
        fs.writeFileSync(emptyConfig, '');
        process.env.GIT_CONFIG_GLOBAL = emptyConfig;
        process.env.GIT_CONFIG_NOSYSTEM = '1';
        try {
            git(repo, 'init', '-q', '-b', 'main');
            fs.writeFileSync(path.join(repo, 'a.txt'), 'a\n');
            git(repo, 'add', '.');
            git(repo, 'commit', '-q', '-m', 'base');
            git(repo, 'branch', 'coven/woo1');
            git(repo, 'switch', '-q', '-c', 'coven/woo1-no1');
            fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
            git(repo, 'add', '.');
            git(repo, 'commit', '-q', '-m', 'task');
            git(repo, 'switch', '-q', 'main');
            const before = git(repo, 'rev-parse', 'coven/woo1');
            const merged = mergeLocally(repo, { into: 'coven/woo1', from: 'coven/woo1-no1', message: 'Merge coven/woo1-no1' });
            expect(git(repo, 'rev-parse', 'coven/woo1')).toBe(merged);
            expect(git(repo, 'rev-list', '--parents', '-n', '1', merged).split(' ')).toEqual([merged, before, git(repo, 'rev-parse', 'coven/woo1-no1')]);
            // 后面的任务从集成分支切出时看得到前面任务的文件
            expect(git(repo, 'show', 'coven/woo1:b.txt')).toBe('b');
            expect(git(repo, 'log', '-1', '--format=%an <%ae>', merged)).toBe('Coven <coven@localhost>');
            // 检出着的分支不移动它
            expect(() => mergeLocally(repo, { into: 'main', from: 'coven/woo1-no1', message: 'x' })).toThrow('检出着');
            // 合过了再合一次（上次合完、记账之前中断了）：不再造新的合并提交
            expect(mergeLocally(repo, { into: 'coven/woo1', from: 'coven/woo1-no1', message: 'again' })).toBe(merged);
            expect(git(repo, 'rev-parse', 'coven/woo1')).toBe(merged);
        } finally {
            for (const [name, value] of [['GIT_CONFIG_GLOBAL', saved.global], ['GIT_CONFIG_NOSYSTEM', saved.nosystem]]) {
                if (value === undefined) delete process.env[name];
                else process.env[name] = value;
            }
            fs.rmSync(repo, { recursive: true, force: true });
            fs.rmSync(emptyConfig, { force: true });
        }
    });

    it('labels a dry-run PR without a fake number', () => {
        expect(prLabel(1201)).toBe('PR #1201');
        expect(prLabel('dry-woo1-no1')).toBe('干跑 PR');
        expect(prLabel(null)).toBe('');
    });
});
