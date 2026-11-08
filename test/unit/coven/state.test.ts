import { describe, expect, it } from 'vitest';
import { contractFingerprint } from '../../../dev/coven/contract.mjs';
import { prPreflight, renderPrBody } from '../../../dev/coven/pr.mjs';
import { auditWrites, claimChangeFor, createState, runRecord, transition } from '../../../dev/coven/state.mjs';
import type { CovenTask } from '../../../dev/coven/state.mjs';
import { baselineShrink, growthProblems, parseNameStatus } from '../../../dev/coven/verify.mjs';

// test/unit/coven/state.test.ts
// 监控 session 的账本：阶段流转里的关口（HD2、两轮评审 D811、预算 D813）、运行记录、运行后审计，
// 以及 verify 的基线判断（D806）和开 PR 前的把关。

const task = (overrides: Partial<CovenTask> = {}): CovenTask => ({ items: ['D102:a->b'], risk: 'R2', phase: 'planning', rounds: 0, costUsd: 0, history: [], ...overrides });

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
        expect(transition(task({ phase: 'spec-review', costUsd: 5 }), 'building', { approved: true, budget: { perTaskUsd: 5 } })).toContain('D813');
        expect(transition(task({ phase: 'spec-review' }), 'building', { approved: true, budget: { perRunUsd: 20 }, runCostUsd: 21 })).toContain('D813');
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
    it('names the run by the maintainer\'s local date', () => {
        const state = createState({ scope: 'arch', owner: 'alice', integrationBranch: 'coven/run-2026-11-09', trackingIssue: null, dryRun: true, now: '2026-11-08T17:00:00.000Z', timeZone: 'Asia/Shanghai' });
        expect(state.run).toBe('2026-11-09-arch');
    });

    it('counts interventions, rounds, cost and escalations', () => {
        const state = createState({ scope: 'arch', owner: 'alice', integrationBranch: 'coven/run-2026-11-09', trackingIssue: 42, dryRun: true, now: '2026-11-09T01:00:00.000Z' });
        state.tasks.a = { ...task({ phase: 'done', rounds: 2, costUsd: 1.5, pr: 1201 }), history: [{ at: '2026-11-09T01:10:00.000Z', phase: 'planning' }, { at: '2026-11-09T02:40:00.000Z', phase: 'done' }] };
        state.tasks.b = { ...task({ phase: 'blocked', code: 'D811', rounds: 2, costUsd: 0.5 }), history: [{ at: '2026-11-09T01:10:00.000Z', phase: 'planning' }] };
        state.escalations = [{ items: ['D190:x->y'], code: 'D812', question: 'tuningRegistry 按路径被找，挪还是放行？' }];
        state.interventions = [{ kind: 'HD1' }, { kind: 'HD2' }, { kind: 'HD2' }, { kind: 'HD4' }];
        const record = runRecord(state, '2026-11-09T03:00:00.000Z');
        expect(record.interventions).toEqual({ HD1: 1, HD2: 2, HD4: 1 });
        expect(record.tasks.find(entry => entry.task === 'a')).toMatchObject({ minutes: 90, rounds: 2, pr: 1201 });
        expect(record.escalations.map(entry => entry.code)).toEqual(['D812', 'D811']);
        expect(record.totals).toMatchObject({ tasks: 2, done: 1, prs: 1, blocked: 1, costUsd: 2 });
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

    it('catches a new baseline entry or a moved suppression even when the totals shrank (D001)', () => {
        const ledgers = {
            baseEntries: ['D102:a.ts->b.ts', 'D190:c.ts->d.ts'],
            headEntries: ['D102:new.ts->z.ts'],
            baseSuppressions: { 'src/demo/a.ts': { '@stylistic/indent': { count: 5 } } },
            headSuppressions: { 'src/utils/b.ts': { '@stylistic/indent': { count: 1 } } },
            renameMap: new Map<string, string>(),
            newFiles: new Set<string>(),
        };
        const problems = growthProblems(ledgers);
        expect(problems).toEqual(['基线多了 D102:new.ts->z.ts', 'src/utils/b.ts 的 @stylistic/indent 抑制 0 → 1']);
        // 挪文件时条目跟着改名走，不算增长
        expect(growthProblems({
            ...ledgers,
            headEntries: ['D102:moved.ts->b.ts'],
            headSuppressions: { 'src/demo/moved.ts': { '@stylistic/indent': { count: 5 } } },
            renameMap: new Map([['a.ts', 'moved.ts'], ['src/demo/a.ts', 'src/demo/moved.ts']]),
        })).toEqual([]);
    });

    it('wants a lint item to bring its suppressions under the prefix to zero', () => {
        const before = { 'src/utils/a.ts': { '@typescript-eslint/consistent-type-imports': { count: 3 } }, 'src/utils/b.ts': { '@typescript-eslint/consistent-type-imports': { count: 1 } } };
        const partly = { 'src/utils/b.ts': { '@typescript-eslint/consistent-type-imports': { count: 1 } } };
        const input = { items: ['lint:@typescript-eslint/consistent-type-imports@src/utils/'], baseEntries: [], headEntries: [], baseSuppressions: before, findingKeys: new Set<string>() };
        expect(baselineShrink({ ...input, headSuppressions: partly })).toMatchObject({ ok: false, shrank: true });
        expect(baselineShrink({ ...input, headSuppressions: {} })).toMatchObject({ ok: true });
    });
});

describe('coven pr preflight', () => {
    const contract = {
        task: 'a', items: ['D102:a->b'], risk: 'R2', action: 'refactor', goal: 'g', nonGoals: [], scope: { paths: ['src/'] },
        criteria: [{ id: 'c1', description: '基线', verify: { kind: 'baseline' }, passes: true }],
    };
    const config = { integrationBranchPrefix: 'coven/run-' };
    const verify = { task: 'a', head: 'abc1234def', base: 'coven/run-2026-11-09', mergeBase: 'm', ok: true, criteria: { c1: true }, changed: ['M src/a.ts'], checks: [{ id: 'c1', kind: 'baseline', ok: true, summary: '已消掉' }] };
    const passed = { round: 1, passes: true, head: 'abc1234def', fingerprint: contractFingerprint(contract) };
    const stateWith = (overrides: Partial<CovenTask> = {}) => ({
        run: '2026-11-09-arch', integrationBranch: 'coven/run-2026-11-09',
        tasks: { a: { ...task({ phase: 'evaluating', rounds: 1, lastVerdict: passed }), ...overrides } },
    });
    const input = { config, taskId: 'a', contract, approved: { contract }, verify, branch: 'coven/task-2026-11-09-a', branchHead: 'abc1234def', reviewExists: true };

    it('lets a fully verified and reviewed task through', () => {
        expect(prPreflight({ ...input, state: stateWith() })).toEqual([]);
        const body = renderPrBody({ state: stateWith(), taskId: 'a', contract, verify, reviewText: '# a 第 1 轮评审：pass\n\n只是改引用。' });
        expect(body).toContain('coven/run-2026-11-09');
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
        expect(text).toContain('重跑 coven:verify');
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

    it('wants verify against the integration branch and a coven task branch', () => {
        const text = prPreflight({ ...input, state: stateWith(), verify: { ...verify, base: 'HEAD~1' }, branch: 'main' }).join('\n');
        expect(text).toContain('不要用 --base');
        expect(text).toContain('coven/task-');
    });
});
