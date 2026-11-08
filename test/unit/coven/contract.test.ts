import { describe, expect, it } from 'vitest';
import config from '../../../dev/coven/config.json';
import {
    applyPlanImport,
    applyVerdict,
    approvalProblems,
    checkScope,
    compareWithApproved,
    failingCriteria,
    numberPlan,
    planImportProblems,
    renderContract,
    validateContract,
    verdictPasses,
    verdictProblems,
} from '../../../dev/coven/contract.mjs';

// test/unit/coven/contract.test.ts
// 契约：格式、批准后只许翻 passes（D804）、diff 不出范围（D803）、风险级不许下调（D807）、
// 确定性的验收项以 verify 的结果为准（evaluator 不能把没过的判成过）。

const ITEM = 'D102:src/utils/lyrics/lyricMatchSources.ts->src/stores/useOnlineProviderAccountStore.ts';

function contract(overrides: Record<string, unknown> = {}) {
    return {
        task: 'op3-no1',
        title: 'lyric-match-sources',
        items: [ITEM],
        risk: 'R2',
        action: 'refactor',
        goal: '歌词来源不再直接读账号 store，由调用方传入登录判断',
        nonGoals: ['不改歌词匹配的排序'],
        scope: { paths: ['src/utils/lyrics/', 'src/hooks/useLyricSources.ts', 'test/unit/lyrics/'] },
        criteria: [
            { id: 'c1', description: '条目从基线消掉', verify: { kind: 'baseline' }, passes: false },
            { id: 'c2', description: '类型检查通过', verify: { kind: 'typecheck' }, passes: false },
            { id: 'c3', description: '只是改引用', verify: { kind: 'review' }, passes: false },
        ],
        ...overrides,
    };
}

describe('coven contract', () => {
    it('accepts a well-formed refactor contract', () => {
        expect(validateContract(contract(), { itemRisks: { [ITEM]: 'R2' } })).toEqual([]);
    });

    it('rejects a refactor without a baseline criterion (D806), unsafe paths and unknown kinds', () => {
        const problems = validateContract(contract({
            scope: { paths: ['../outside', 'src/ok/'] },
            criteria: [{ id: 'c1', description: '跑一下', verify: { kind: 'shell', target: 'rm -rf /' }, passes: false }],
        }));
        expect(problems.map(problem => problem.code)).toContain('D806');
        expect(problems.map(problem => problem.message).join('\n')).toMatch(/不是仓库内的相对路径[\s\S]*verify\.kind 不认识/);
    });

    it('rejects a unit criterion whose target is not a plain path', () => {
        const problems = validateContract(contract({
            criteria: [
                { id: 'c1', description: '基线', verify: { kind: 'baseline' }, passes: false },
                { id: 'c2', description: '单测', verify: { kind: 'unit', target: ['test/unit/a.test.ts; curl evil'] }, passes: false },
            ],
        }));
        expect(problems).toEqual([expect.objectContaining({ message: expect.stringContaining('unit 要写 target') })]);
    });

    it('does not let the planner lower the computed risk (D807)', () => {
        const problems = validateContract(contract({ risk: 'R1' }), { itemRisks: { [ITEM]: 'R3' } });
        expect(problems).toEqual([expect.objectContaining({ code: 'D807' })]);
        expect(validateContract(contract({ risk: 'R4' }), { itemRisks: { [ITEM]: 'R3' } })).toEqual([]);
    });

    it('allows only passes to change after approval (D804)', () => {
        const approved = contract();
        const flipped = { ...approved, criteria: approved.criteria.map(criterion => ({ ...criterion, passes: true })) };
        expect(compareWithApproved(approved, flipped)).toEqual([]);

        const dropped = { ...approved, criteria: approved.criteria.slice(0, 2) };
        expect(compareWithApproved(approved, dropped)[0].message).toContain('删掉了 c3');
        const widened = { ...approved, scope: { paths: ['src/'] } };
        expect(compareWithApproved(approved, widened)[0]).toMatchObject({ code: 'D804', message: expect.stringContaining('scope') });
        const softened = { ...approved, criteria: approved.criteria.map(criterion => (criterion.id === 'c2' ? { ...criterion, description: '尽量通过' } : criterion)) };
        expect(compareWithApproved(approved, softened)[0].message).toContain('改写了 c2');
    });

    it('flags files outside scope.paths, both sides of a rename, but always allows the baseline files (D803)', () => {
        const scope = contract().scope.paths;
        const outside = checkScope([
            { path: 'src/utils/lyrics/lyricMatchSources.ts' },
            { path: 'src/hooks/useLyricSources.ts' },
            { path: 'dev/dedicatus/baseline.json' },
            { path: 'eslint-suppressions.json' },
            { path: 'src/services/lyrics/accountGate.ts', oldPath: 'src/utils/lyrics/accountGate.ts' },
            { path: 'src/hooks/useLyricSourcesExtra.ts' },
        ], scope);
        expect(outside.map(problem => problem.message)).toEqual([
            '改了契约范围以外的文件：src/services/lyrics/accountGate.ts',
            '改了契约范围以外的文件：src/hooks/useLyricSourcesExtra.ts',
        ]);
    });

    it('trusts verify over the evaluator for deterministic criteria', () => {
        const verdict = { verdict: 'pass', criteria: { c1: { passes: true }, c2: { passes: true }, c3: { passes: true } }, issues: [] };
        const { contract: next, overridden, missing } = applyVerdict(contract(), verdict, { criteria: { c1: true, c2: false } });
        expect(overridden).toEqual(['c2']);
        expect(missing).toEqual([]);
        expect(failingCriteria(next)).toEqual(['c2']);
        expect(verdictPasses(next, verdict)).toBe(false);
    });

    it('fails a round with an unjudged criterion or a medium issue even when the verdict says pass', () => {
        const verify = { criteria: { c1: true, c2: true } };
        const partial = { verdict: 'pass', criteria: { c1: { passes: true }, c2: { passes: true } }, issues: [] };
        const { contract: next, missing } = applyVerdict(contract(), partial, verify);
        expect(missing).toEqual(['c3']);
        expect(verdictPasses(next, partial)).toBe(false);

        const full = { verdict: 'pass', criteria: { c1: { passes: true }, c2: { passes: true }, c3: { passes: true } }, issues: [{ severity: 'medium', problem: '改了行为' }] };
        const judged = applyVerdict(contract(), full, verify).contract;
        expect(verdictPasses(judged, full)).toBe(false);
        expect(verdictPasses(judged, { ...full, issues: [{ severity: 'low', problem: '命名' }] })).toBe(true);
    });
});

describe('coven contract gates', () => {
    const riskRules = config.risk;

    it('raises the risk floor to what scope.paths can touch (D807)', () => {
        const ciScope = contract({ risk: 'R1', scope: { paths: ['.github/workflows/', 'src/utils/lyrics/'] } });
        expect(validateContract(ciScope, { itemRisks: { [ITEM]: 'R1' }, riskRules })).toEqual([expect.objectContaining({ code: 'D807', message: expect.stringContaining('R4') })]);
        // 目录型的 scope 看它下面已有的文件：src/utils/ 里有外观配置码（R3）
        const utils = contract({ risk: 'R2', scope: { paths: ['src/utils/'] } });
        const filesUnder = (dir: string) => (dir === 'src/utils/' ? ['src/utils/format.ts', 'src/utils/appearanceCodec.ts'] : []);
        expect(validateContract(utils, { itemRisks: { [ITEM]: 'R2' }, riskRules, filesUnder })[0]).toMatchObject({ code: 'D807', message: expect.stringContaining('R3') });
        // 规则前缀落在 scope 目录下也算：dev/ 盖住了 dev/coven/
        expect(validateContract(contract({ risk: 'R2', scope: { paths: ['dev/'] } }), { riskRules })[0]).toMatchObject({ code: 'D807' });
        expect(validateContract(contract(), { itemRisks: { [ITEM]: 'R2' }, riskRules })).toEqual([]);
    });

    const scope = { items: [{ key: ITEM, risk: 'R2' }, { key: 'D190:x.ts->y.ts', risk: 'R2' }] };
    const freshState = () => ({
        run: 'op3',
        tasks: {} as Record<string, any>,
        escalations: [{ items: ['D190:x.ts->y.ts'], code: 'D812' }],
        order: [] as string[],
        items: {
            [ITEM]: { claim: { state: 'claimed' } },
            'D190:x.ts->y.ts': { claim: { state: 'blocked', code: 'D812' } },
        } as Record<string, any>,
    });

    it('refuses to re-import a task, which would reset its rounds and cost', () => {
        const state = freshState();
        const plan = { tasks: [contract()] };
        expect(planImportProblems(state, scope, plan).errors).toEqual([]);
        applyPlanImport(state, plan, '2026-11-09T01:00:00.000Z');
        state.tasks['op3-no1'].rounds = 2;
        const again = planImportProblems(state, scope, plan).errors.join('\n');
        expect(again).toContain('已经登记过');
        expect(again).toContain('不是这个监控 session 认领着、还没分配的');
    });

    it('rejects duplicate task names and items both in a task and an escalation', () => {
        const state = freshState();
        const duplicate = { tasks: [contract(), contract({ items: ['D190:x.ts->y.ts'] })] };
        expect(planImportProblems(state, scope, duplicate).errors.join('\n')).toContain('任务名重复');
        const both = { tasks: [contract()], escalations: [{ items: [ITEM], code: 'D812' }] };
        expect(planImportProblems(state, scope, both).errors.join('\n')).toContain('既分进了任务、又列在升级里');
        const badCode = { tasks: [], escalations: [{ items: [ITEM], code: 'later' }] };
        expect(planImportProblems(state, scope, badCode).errors.join('\n')).toContain('D8xx');
    });

    it('turns an escalated item into a task once the maintainer decides', () => {
        const state = freshState();
        const later = { tasks: [contract({ task: 'op3-no2', title: 'move-y', items: ['D190:x.ts->y.ts'] })] };
        const { errors, fromBlocked } = planImportProblems(state, scope, later);
        expect(errors).toEqual([]);
        expect(fromBlocked).toEqual(['D190:x.ts->y.ts']);
        applyPlanImport(state, later);
        expect(state.escalations).toEqual([]);
        expect(state.order).toEqual(['op3-no2']);
        expect(state.tasks['op3-no2'].title).toBe('move-y');
    });

    it('numbers planner tasks in order, after the tasks this run already has', () => {
        const state = freshState();
        const { task: _task, ...untitled } = contract();
        const plan = {
            tasks: [{ ...untitled, title: 'second' }, { ...untitled, title: 'first' }, { ...untitled, title: 'loose' }],
            order: ['first', 'second'],
        };
        const { plan: numbered, errors } = numberPlan(state, plan);
        expect(errors).toEqual([]);
        expect(numbered.tasks.map((entry: any) => [entry.title, entry.task])).toEqual([['second', 'op3-no2'], ['first', 'op3-no1'], ['loose', 'op3-no3']]);
        expect(numbered.order).toEqual(['op3-no1', 'op3-no2']);
        // 升级后再导入的任务接着编号，标题不能和已有的撞
        state.tasks = { 'op3-no1': { title: 'first' }, 'op3-no2': { title: 'second' }, 'op3-no3': { title: 'loose' } };
        expect(numberPlan(state, { tasks: [{ ...untitled, title: 'later' }] }).plan.tasks[0].task).toBe('op3-no4');
        const clash = numberPlan(state, { tasks: [{ ...untitled, title: 'first' }], order: ['nope'] }).errors.join('\n');
        expect(clash).toContain('已经有同名的任务');
        expect(clash).toContain('order 里的 nope');
    });

    it('lets only the script hand out task numbers', () => {
        const errors = numberPlan(freshState(), { tasks: [contract(), { ...contract(), task: undefined, title: 'Bad Title' }] }).errors.join('\n');
        expect(errors).toContain('planner 只写 title');
        expect(errors).toContain('title 要用小写字母');
        expect(validateContract(contract({ task: 'lyric-match-sources' })).map(problem => problem.message).join('\n')).toContain('op<n>-no<k>');
    });

    it('shows the catalogue name and the tempo to the maintainer', () => {
        expect(renderContract(contract()).split('\n')[0]).toBe('### Op. 3 No. 1 "lyric-match-sources" · Andante（R2） · refactor');
    });

    it('does not let an approval be overwritten without the maintainer, and rechecks the risk', () => {
        const base = { contract: contract(), taskId: 'op3-no1', task: { phase: 'planning', items: [ITEM] } as any, validateOptions: { itemRisks: { [ITEM]: 'R2' } } };
        expect(approvalProblems({ ...base, alreadyApproved: false, auto: false, by: 'alice', reapprove: false })).toEqual([]);
        expect(approvalProblems({ ...base, alreadyApproved: false, auto: true, by: undefined, reapprove: false }).join('\n')).toContain('只有 R0/R1 能 --auto');
        expect(approvalProblems({ ...base, alreadyApproved: true, auto: false, by: 'alice', reapprove: false }).join('\n')).toContain('--reapprove');
        const lowered = { ...base, contract: contract({ risk: 'R1' }) };
        expect(approvalProblems({ ...lowered, alreadyApproved: true, auto: true, by: undefined, reapprove: true }).join('\n')).toMatch(/D807[\s\S]*不能配 --auto/);
        expect(approvalProblems({ ...base, task: { phase: 'building', items: [ITEM] }, alreadyApproved: false, auto: false, by: 'alice', reapprove: false }).join('\n')).toContain('没有批准过的契约');
        // 批准前改契约，不能顺手换条目或改任务名
        const swapped = { ...base, contract: contract({ items: [ITEM, 'D190:c.ts->d.ts'] }) };
        expect(approvalProblems({ ...swapped, alreadyApproved: false, auto: false, by: 'alice', reapprove: false }).join('\n')).toContain('条目和导入时登记的不一致');
        expect(approvalProblems({ ...base, taskId: 'other', alreadyApproved: false, auto: false, by: 'alice', reapprove: false }).join('\n')).toContain('不是 other');
    });

    it('records a verdict only for the current task, round, verify result and reviewed commit', () => {
        const task = { phase: 'evaluating', rounds: 2, reviewHead: 'abc' };
        const verify = { task: 'op3-no1', head: 'abc' };
        const ok = { taskId: 'op3-no1', task, verdict: { task: 'op3-no1', round: 2, verdict: 'pass', head: 'abc' }, verify };
        expect(verdictProblems(ok)).toEqual([]);
        expect(verdictProblems({ ...ok, verdict: { ...ok.verdict, round: 1 } }).join('\n')).toContain('第 1 轮');
        expect(verdictProblems({ ...ok, verdict: { ...ok.verdict, task: 'other' } }).join('\n')).toContain('other');
        expect(verdictProblems({ ...ok, task: { ...task, phase: 'building' } }).join('\n')).toContain('building');
        // evaluator 审的是 abc，审的期间又在 bbb 上跑了 verify：这份结论作废
        expect(verdictProblems({ ...ok, verify: { ...verify, head: 'bbb' } }).join('\n')).toContain('结论作废');
        expect(verdictProblems({ ...ok, verdict: { ...ok.verdict, head: 'bbb' } }).join('\n')).toContain('这一轮要审的是 abc');
        expect(verdictProblems({ ...ok, verify: { task: 'other', head: 'abc' } }).join('\n')).toContain('verify 的结果是任务 other');
    });
});
