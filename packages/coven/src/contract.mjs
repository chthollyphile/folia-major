import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { BLOCKED_CODE } from './codes.mjs';
import { TITLE, isTaskId, nextTaskNumber, taskIdOf, taskLabel, tempoLabel } from './catalogue.mjs';
import { covenPath, loadState, nowIso, parseArgs, readJson, requireCurrentFormat, saveState, trackedFilesUnder, writeJson, writeText } from './common.mjs';
import { escalatedItems, recordEscalations, waitingItems } from './escalations.mjs';
import { RISKS, maxRisk, riskRank, scopeRiskOf } from './risk.mjs';
// packages/coven/src/contract.mjs
// 契约：每个任务一份，列出目标、不做什么、能动的路径和验收项。HD2 批准的那一版存成 .approved.json，
// 之后只允许翻验收项的 passes（D804），diff 不能出 scope.paths（D803），有一项没过就不能开 PR（D802）。用法见 usage（coven contract --help）。
//
// 验收种类（verify.kind）由适配层的 checks 定：确定性的由 coven verify 跑出结果，其余由 evaluator 判断。
// 适配层账本里的文件（ledger.files，Folia 是基线和抑制文件）任何任务都可以改，但只许变小（verify 的 D841）。

export const usage = () => [
    'coven contract import <planner 输出的 JSON>        按 order 给任务编号（op<n>-no<k>），写入契约，登记任务和升级',
    'coven contract show <任务>                         给维护者看（HD2）',
    'coven contract approve <任务> --by <账号>           HD2 批准；R0/R1 用 --auto；批准过的只有维护者要求时加 --reapprove',
    'coven contract verdict <任务> <evaluator 输出的 JSON>  按评审结论翻 passes，写评审记录',
].join('\n');

export const ACTIONS = ['refactor', 'issue-to-pr', 'fix'];

const SAFE_PATH = /^[\w@.\-/]+$/;

/** 仓库内的相对路径：不能是绝对路径、不能有 ..，只用常见字符（这些路径会进命令行参数）。 */
export const isRelativePath = value => typeof value === 'string' && value.length > 0 && SAFE_PATH.test(value) && !value.startsWith('/') && !value.split('/').includes('..');

/**
 * 契约格式检查。返回问题列表，空数组表示合格。
 * 风险级（D807）不能低于：条目在范围里算出的级别，以及 scope.paths 能改到的路径的级别（给了 riskRules 时算）。
 * 否则一个 R1 契约把 scope 写成 `.github/workflows/` 就能用 --auto 跳过 HD2。
 * 验收种类和它们各自的格式要求（validate）来自适配层的 checks；requiredKinds 是某种动作必须有的验收（Folia：重构要有 baseline，D806）。
 * @param {any} contract
 * @param {{ checks: Record<string, any>, requiredKinds?: Record<string, string[]>, itemRisks?: Record<string, string>, riskRules?: any, filesUnder?: (dir: string) => string[] }} options
 */
export function validateContract(contract, { checks, requiredKinds = {}, itemRisks = {}, riskRules = null, filesUnder = () => [] }) {
    const problems = [];
    const add = (message, code = null) => problems.push({ code, message });
    if (!contract || typeof contract !== 'object') return [{ code: null, message: '契约不是对象' }];
    if (!isTaskId(contract.task)) add('task 要是 op<n>-no<k> 这样的编号（由 coven contract import 分配）');
    if (!TITLE.test(contract.title ?? '')) add('title 要用小写字母、数字和连字符，最长 48 个字符');
    if (!Array.isArray(contract.items) || contract.items.length === 0 || contract.items.some(item => typeof item !== 'string')) add('items 要是非空的字符串数组（基线 key）');
    if (!RISKS.includes(contract.risk)) add(`risk 只能是 ${RISKS.join('、')}`);
    if (!ACTIONS.includes(contract.action)) add(`action 只能是 ${ACTIONS.join('、')}`);
    if (typeof contract.goal !== 'string' || !contract.goal.trim()) add('goal 不能为空');
    if (!Array.isArray(contract.nonGoals) || contract.nonGoals.some(entry => typeof entry !== 'string')) add('nonGoals 要是字符串数组');
    const paths = contract.scope?.paths;
    if (!Array.isArray(paths) || paths.length === 0) add('scope.paths 不能为空');
    else for (const entry of paths) if (!isRelativePath(entry)) add(`scope.paths 里的 ${JSON.stringify(entry)} 不是仓库内的相对路径`);
    const criteria = contract.criteria;
    if (!Array.isArray(criteria) || criteria.length === 0) add('criteria 不能为空');
    else {
        const ids = new Set();
        for (const criterion of criteria) {
            const label = criterion?.id ?? '?';
            if (!/^c\d+$/.test(criterion?.id ?? '')) add(`验收项 id 要是 c1、c2……（${label}）`);
            else if (ids.has(criterion.id)) add(`验收项 id 重复：${criterion.id}`);
            ids.add(criterion?.id);
            if (typeof criterion?.description !== 'string' || !criterion.description.trim()) add(`${label} 缺 description`);
            if (typeof criterion?.passes !== 'boolean') add(`${label} 缺 passes`);
            const kind = criterion?.verify?.kind;
            const check = typeof kind === 'string' && Object.hasOwn(checks, kind) ? checks[kind] : undefined;
            if (!check) add(`${label} 的 verify.kind 不认识：${kind}（可用：${Object.keys(checks).join('、')}）`);
            else {
                const problem = check.validate?.(criterion.verify);
                if (problem) add(`${label}：${problem}`);
            }
        }
        for (const kind of (typeof contract.action === 'string' && Object.hasOwn(requiredKinds, contract.action) ? requiredKinds[contract.action] : [])) {
            if (!criteria.some(criterion => criterion?.verify?.kind === kind)) {
                add(`${contract.action} 任务要有一项 ${kind} 验收${contract.action === 'refactor' ? '（条目要真的消掉，D806）' : ''}`, contract.action === 'refactor' ? 'D806' : null);
            }
        }
    }
    const computed = (contract.items ?? []).map(item => itemRisks[item]).filter(Boolean);
    const scopeRisk = riskRules && Array.isArray(paths) ? scopeRiskOf(paths.filter(isRelativePath), riskRules, filesUnder) : { risk: null, reasons: [] };
    if (scopeRisk.risk) computed.push(scopeRisk.risk);
    if (computed.length > 0 && RISKS.includes(contract.risk)) {
        const floor = maxRisk(...computed);
        if (riskRank(contract.risk) < riskRank(floor)) {
            const why = scopeRisk.risk === floor ? `；scope 能改到 ${scopeRisk.reasons.slice(0, 3).join('，')}` : '';
            add(`风险级 ${contract.risk} 低于确定性规则算出的 ${floor}（只能往上调${why}）`, 'D807');
        }
    }
    return problems;
}

/** 去掉 passes 以后的规范化 JSON 的哈希：批准之后只有 passes 能变。 */
export function contractFingerprint(contract) {
    const stripped = { ...contract, criteria: (contract.criteria ?? []).map(({ passes: _passes, ...rest }) => rest) };
    return crypto.createHash('sha256').update(stableJson(stripped)).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

/** 和批准的版本比：除了 passes 以外的任何变化都报 D804，列出变的是哪一块。 */
export function compareWithApproved(approved, current) {
    if (contractFingerprint(approved) === contractFingerprint(current)) return [];
    const changed = [];
    for (const field of ['task', 'title', 'items', 'risk', 'action', 'goal', 'nonGoals', 'scope']) {
        if (stableJson(approved[field]) !== stableJson(current[field])) changed.push(field);
    }
    const before = new Map((approved.criteria ?? []).map(criterion => [criterion.id, criterion]));
    const after = new Map((current.criteria ?? []).map(criterion => [criterion.id, criterion]));
    for (const [id, criterion] of before) {
        if (!after.has(id)) changed.push(`删掉了 ${id}`);
        else {
            const { passes: _a, ...restBefore } = criterion;
            const { passes: _b, ...restAfter } = after.get(id);
            if (stableJson(restBefore) !== stableJson(restAfter)) changed.push(`改写了 ${id}`);
        }
    }
    for (const id of after.keys()) if (!before.has(id)) changed.push(`加了 ${id}`);
    return [{ code: 'D804', message: `契约在批准后被改了：${changed.join('、') || '内容'}（只允许翻 passes）` }];
}

/** 路径在不在范围里：范围项以 / 结尾的按目录前缀，否则按整个文件名。账本文件（alwaysInScope）总在范围里。 */
export const inScope = (file, scopePaths, alwaysInScope = []) => [...scopePaths, ...alwaysInScope].some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * diff 有没有出范围（D803）。改名的新旧两个路径都要在范围里。
 * @param {Array<{ path: string, oldPath?: string }>} changed
 * @param {string[]} scopePaths
 * @param {string[]} [alwaysInScope] 适配层账本里的文件
 */
export function checkScope(changed, scopePaths, alwaysInScope = []) {
    const outside = [];
    for (const entry of changed) {
        for (const file of [entry.oldPath, entry.path].filter(Boolean)) {
            if (!inScope(file, scopePaths, alwaysInScope) && !outside.includes(file)) outside.push(file);
        }
    }
    return outside.map(file => ({ code: 'D803', message: `改了契约范围以外的文件：${file}` }));
}

/** 契约里还没过的验收项（D802）。 */
export const failingCriteria = contract => (contract.criteria ?? []).filter(criterion => !criterion.passes).map(criterion => criterion.id);

/**
 * 按 evaluator 的结论翻 passes。确定性的验收项（适配层 checks 里 deterministic 的）以 verify 的结果为准：evaluator 判过、verify 没过的按没过算。
 * @returns {{ contract: object, overridden: string[], missing: string[] }}
 */
export function applyVerdict(contract, verdict, verifyResult, checks) {
    const overridden = [];
    const missing = [];
    const verified = verifyResult?.criteria ?? {};
    const criteria = contract.criteria.map(criterion => {
        const judged = verdict.criteria?.[criterion.id];
        if (!judged || typeof judged.passes !== 'boolean') {
            missing.push(criterion.id);
            return { ...criterion, passes: false };
        }
        let passes = judged.passes;
        const kind = criterion.verify?.kind;
        const deterministic = typeof kind === 'string' && Object.hasOwn(checks, kind) && checks[kind].deterministic;
        if (deterministic && passes && verified[criterion.id] !== true) {
            passes = false;
            overridden.push(criterion.id);
        }
        return { ...criterion, passes };
    });
    return { contract: { ...contract, criteria }, overridden, missing };
}

/** evaluator 的结论能不能放行：判了 pass、验收项全过、没有中等及以上的问题。 */
export function verdictPasses(contract, verdict) {
    const seriousIssues = (verdict.issues ?? []).filter(issue => ['critical', 'high', 'medium'].includes(issue.severity));
    return verdict.verdict === 'pass' && failingCriteria(contract).length === 0 && seriousIssues.length === 0;
}

export function renderContract(contract) {
    const lines = [
        `### ${taskLabel(contract.task, contract.title)} · ${tempoLabel(contract.risk)} · ${contract.action}`,
        '',
        `**目标**：${contract.goal}`,
        '',
        `**不做**：${contract.nonGoals.length > 0 ? contract.nonGoals.join('；') : '无'}`,
        '',
        `**能动的路径**：${contract.scope.paths.map(entry => `\`${entry}\``).join('、')}`,
        '',
        `**条目**：${contract.items.map(item => `\`${item}\``).join('、')}`,
        '',
        '| 项 | 内容 | 验证 | 通过 |',
        '| --- | --- | --- | --- |',
        ...contract.criteria.map(criterion => `| ${criterion.id} | ${cell(criterion.description)} | ${cell(verifyLabel(criterion.verify))} | ${criterion.passes ? '✅' : '⬜'} |`),
    ];
    return lines.join('\n');
}

const cell = text => String(text).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

/** 验收项的验证方式：种类、target，以及适配层自己加的其他字段（表格里要看得到全部，提示里不再另贴一份 JSON）。 */
function verifyLabel({ kind, target, ...rest }) {
    const extra = Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : '';
    return `${kind}${target ? ` \`${[].concat(target).join(' ')}\`` : ''}${extra}`;
}

export function renderReview(task, round, verdict) {
    const issues = verdict.issues ?? [];
    return [
        `# ${taskLabel(task)} 第 ${round} 轮评审：${verdict.verdict}`,
        '',
        verdict.summary ?? '',
        '',
        '## 验收项',
        ...Object.entries(verdict.criteria ?? {}).map(([id, judged]) => `- ${id} ${judged.passes ? '✅' : '❌'} ${judged.evidence ?? ''}`),
        '',
        '## 问题',
        ...(issues.length === 0 ? ['无'] : issues.map(issue => `- [${issue.severity}] ${issue.file ?? ''}${issue.line ? `:${issue.line}` : ''} ${issue.problem}${issue.fix ? `（建议：${issue.fix}）` : ''}`)),
        ...(verdict.escalation ? ['', '## 升级', `${verdict.escalation.code}：${verdict.escalation.question}`, ...(verdict.escalation.options ?? []).map(option => `- ${option}`)] : []),
        '',
    ].join('\n');
}

// ---- 导入、批准、评审结论（纯函数，命令行在下面） ----

export const contractFile = (root, task) => covenPath(root, 'contracts', `${task}.json`);
export const approvedFile = (root, task) => covenPath(root, 'contracts', `${task}.approved.json`);

/** 当前契约是不是就是批准的那一版（指纹一致）。只看批准文件在不在不够：批准后改了契约要重新批准。 */
export function isApprovedCurrent(root, task, contract) {
    const file = approvedFile(root, task);
    return fs.existsSync(file) && readJson(file).fingerprint === contractFingerprint(contract);
}

/**
 * 给 planner 的输出编号：planner 只写 title，任务编号由这里按 order（没写的按出现顺序）接着这次运行已有的号往下分，
 * order 里的标题也换成编号。planner 自己写了 task、标题重复或和已登记的任务撞了、order 里有不认识的标题，都报错。
 * @param {any} state
 * @param {any} plan
 * @returns {{ plan: any, errors: string[] }}
 */
export function numberPlan(state, plan) {
    const errors = [];
    const tasks = plan.tasks ?? [];
    const existingTitles = new Set(Object.values(state.tasks).map(task => task.title).filter(Boolean));
    const titles = new Set();
    for (const contract of tasks) {
        const label = contract.title ?? '?';
        if (contract.task !== undefined) errors.push(`${label}：task 由脚本编号，planner 只写 title`);
        if (!TITLE.test(contract.title ?? '')) errors.push(`${label}：title 要用小写字母、数字和连字符，最长 48 个字符`);
        else if (titles.has(contract.title)) errors.push(`${label}：同一份输出里标题重复`);
        else if (existingTitles.has(contract.title)) errors.push(`${label}：这次运行已经有同名的任务`);
        titles.add(contract.title);
    }
    const order = plan.order ?? [];
    for (const title of order) if (!titles.has(title)) errors.push(`order 里的 ${title} 不是这份输出里的任务标题`);
    if (errors.length > 0) return { plan, errors };
    const sequence = [...order.filter((title, index) => order.indexOf(title) === index), ...tasks.map(contract => contract.title).filter(title => !order.includes(title))];
    const ids = new Map();
    let next = nextTaskNumber(state.run, Object.keys(state.tasks));
    for (const title of sequence) ids.set(title, taskIdOf(state.run, next++));
    return {
        plan: {
            ...plan,
            tasks: tasks.map(contract => ({ task: ids.get(contract.title), ...contract })),
            ...(plan.order ? { order: sequence.filter(title => order.includes(title)).map(title => ids.get(title)) } : {}),
        },
        errors: [],
    };
}

/**
 * 检查（编过号的）planner 输出能不能导入。已经登记过的任务一律拒绝：重新导入会把轮数和花费清零，D811、D813 就形同虚设。
 * 条目要是这个监控 session 认领着（claimed，或者升级时标成了 blocked）、还没分进任务的。
 * @returns {{ errors: string[], uncovered: string[], fromBlocked: string[] }}
 */
export function planImportProblems(state, scope, plan, validateOptions = {}) {
    const itemRisks = Object.fromEntries(scope.items.map(item => [item.key, item.risk]));
    const available = new Set(Object.keys(state.items).filter(key => ['claimed', 'blocked'].includes(state.items[key].claim?.state) && !state.items[key].task));
    const errors = [];
    const covered = new Set();
    const fromBlocked = [];
    const ids = new Set();
    for (const contract of plan.tasks ?? []) {
        if (ids.has(contract.task)) errors.push(`${contract.task}：同一份输出里任务名重复`);
        ids.add(contract.task);
        if (state.tasks[contract.task]) errors.push(`${contract.task}：任务已经登记过，不能重新导入（要改契约就由维护者改了再批准）`);
        for (const problem of validateContract(contract, { itemRisks, ...validateOptions })) errors.push(`${contract.task}：${problem.code ? `${problem.code} ` : ''}${problem.message}`);
        for (const item of contract.items ?? []) {
            if (!available.has(item)) errors.push(`${contract.task}：条目 ${item} 不是这个监控 session 认领着、还没分配的`);
            else if (state.items[item].claim.state === 'blocked') fromBlocked.push(item);
            if (covered.has(item)) errors.push(`${contract.task}：条目 ${item} 分进了两个任务`);
            covered.add(item);
        }
    }
    // 还在等维护者决定（或者决定先放着）的升级条目不能直接分进任务：那样升级会被记成“分进了任务”，HD4 就被绕过去了
    const waiting = waitingItems(state);
    for (const contract of plan.tasks ?? []) {
        for (const item of contract.items ?? []) {
            if (waiting.has(item)) errors.push(`${contract.task}：条目 ${item} 在升级 ${waiting.get(item)} 里等维护者决定（coven state hd HD4 --escalation ${waiting.get(item)} --decision replan …）`);
        }
    }
    const escalated = escalatedItems(state);
    for (const escalation of plan.escalations ?? []) {
        if (!BLOCKED_CODE.test(escalation.code ?? '')) errors.push(`升级项的 code 要是 D8xx（收到 ${escalation.code}）`);
        if (!Array.isArray(escalation.items) || escalation.items.length === 0) errors.push('升级项要写 items（升级的是哪些条目）');
        for (const item of escalation.items ?? []) {
            if (covered.has(item)) errors.push(`条目 ${item} 既分进了任务、又列在升级里（或者升级里重复）`);
            else if (!available.has(item) && !escalated.has(item)) errors.push(`升级的条目 ${item} 不是这个监控 session 认领着的`);
            covered.add(item);
        }
    }
    // 维护者决定重新规划的条目 planner 也要分配，漏了要提示；还在等决定的不算漏
    const uncovered = [...available].filter(item => !covered.has(item) && state.items[item].claim.state === 'claimed' && !waiting.has(item));
    return { errors, uncovered, fromBlocked };
}

/**
 * 把检查过的 planner 输出登记进状态文件（契约文件由调用方写）。升级不删：条目分进任务的记下由哪个任务了结（escalations.mjs）。
 * @returns {{ escalations: string[] }} 新登记的升级编号
 */
export function applyPlanImport(state, plan, now = nowIso()) {
    for (const contract of plan.tasks ?? []) {
        state.tasks[contract.task] = { items: contract.items, title: contract.title, risk: contract.risk, phase: 'planning', rounds: 0, tokens: 0, history: [{ at: now, phase: 'planning' }] };
        for (const item of contract.items) state.items[item].task = contract.task;
        if (!state.order.includes(contract.task)) state.order.push(contract.task);
    }
    const escalations = recordEscalations(state, plan.escalations ?? [], now);
    if (plan.order) state.order = [...plan.order.filter(id => state.tasks[id]), ...state.order.filter(id => !plan.order.includes(id))];
    return { escalations };
}

/**
 * 批准（HD2）前的检查。已经批准过的，只有维护者明确要求重新批准（--reapprove --by）才行，而且不能 --auto。
 * @returns {string[]}
 */
export function approvalProblems({ contract, taskId, task, validateOptions = {}, alreadyApproved, auto, by, reapprove }) {
    const problems = validateContract(contract, validateOptions).map(problem => `${problem.code ? `${problem.code} ` : ''}${problem.message}`);
    if (!task) problems.push('状态文件里没有这个任务');
    // 批准前改契约时不能改任务名、不能换条目：条目归属、认领核对都按状态文件里登记的条目算
    if (contract.task !== taskId) problems.push(`契约里的 task 是 ${contract.task}，不是 ${taskId}`);
    if (task && JSON.stringify([...contract.items].sort()) !== JSON.stringify([...task.items].sort())) problems.push('契约的条目和导入时登记的不一致：换条目要让 planner 重新出一个任务');
    if (contract.risk === 'R4') problems.push('R4 只写方案草稿，不进实现');
    if (auto && riskRank(contract.risk) > riskRank('R1')) problems.push(`${contract.risk} 要维护者批准（HD2），只有 R0/R1 能 --auto`);
    if (!auto && !by) problems.push('写明是谁批准的：--by <账号>（R0/R1 用 --auto）');
    if (alreadyApproved && !reapprove) problems.push('已经批准过：契约批准后不能再改。维护者明确要求改的，用 --reapprove --by <账号>');
    if (reapprove && auto) problems.push('重新批准要维护者本人：--reapprove 不能配 --auto');
    if (task && !alreadyApproved && !['planning', 'spec-review', 'blocked'].includes(task.phase)) problems.push(`任务在 ${task.phase} 阶段，没有批准过的契约却已经往下走了`);
    return problems;
}

/**
 * 评审结论能不能记：任务在评审阶段，结论写的任务和轮数对得上，verify 的结果是这个任务的。
 * @returns {string[]}
 */
export function verdictProblems({ taskId, task, verdict, verify }) {
    const problems = [];
    if (!task) return [`状态文件里没有任务 ${taskId}`];
    if (task.phase !== 'evaluating') problems.push(`任务在 ${task.phase} 阶段，先 coven state phase ${taskId} evaluating`);
    if (verdict.task !== taskId) problems.push(`评审结论写的任务是 ${verdict.task}，不是 ${taskId}`);
    if (verdict.round !== task.rounds) problems.push(`评审结论写的是第 ${verdict.round} 轮，现在是第 ${task.rounds} 轮`);
    if (!['pass', 'fail', 'escalate'].includes(verdict.verdict)) problems.push(`verdict 只能是 pass、fail、escalate，收到 ${verdict.verdict}`);
    if (!verify) problems.push('还没跑 coven verify');
    else if (verify.task !== taskId) problems.push(`verify 的结果是任务 ${verify.task} 的`);
    // evaluator 审的是进 evaluating 时 verify 跑的那个提交；之后 verify 又在新提交上跑过，这份结论就不算数
    if (verdict.head !== task.reviewHead) problems.push(`评审结论写的提交是 ${String(verdict.head).slice(0, 7)}，这一轮要审的是 ${String(task.reviewHead).slice(0, 7)}`);
    if (verify && verify.head !== task.reviewHead) problems.push(`verify 后来又在 ${verify.head.slice(0, 7)} 上跑过：这一轮的结论作废，回 building 重新来`);
    return problems;
}

// ---- 命令行 ----

/** 契约检查要用的东西：范围里的条目风险、配置的风险表、仓库里的文件、适配层的验收种类。 */
export function validateOptionsFor(host, state) {
    const scope = readJson(covenPath(host.root, 'scopes', `${state.scope}.json`));
    return {
        scope,
        options: {
            checks: host.adapter.checks,
            requiredKinds: host.adapter.requiredKinds,
            itemRisks: Object.fromEntries(scope.items.map(item => [item.key, item.risk])),
            riskRules: host.config.risk,
            filesUnder: dir => trackedFilesUnder(host.root, dir),
        },
    };
}

export async function run(host, argv) {
    const { root, adapter } = host;
    const { positional, options } = parseArgs(argv, ['auto', 'reapprove'], ['by']);
    const [command, task, file] = positional;
    const state = requireCurrentFormat(loadState(root));
    if (command === 'import') {
        if (!task) throw new Error('要给 planner 输出的 JSON 文件');
        const numbered = numberPlan(state, readJson(path.resolve(task)));
        if (numbered.errors.length > 0) throw new Error(`planner 的输出不合格，什么都没导入：\n${numbered.errors.join('\n')}`);
        const plan = numbered.plan;
        const { scope, options: validateOptions } = validateOptionsFor(host, state);
        const { errors, uncovered, fromBlocked } = planImportProblems(state, scope, plan, validateOptions);
        if (errors.length > 0) throw new Error(`planner 的输出不合格，什么都没导入：\n${errors.join('\n')}`);
        for (const contract of plan.tasks ?? []) writeJson(contractFile(root, contract.task), contract);
        const { escalations } = applyPlanImport(state, plan);
        saveState(root, state);
        console.log(`登记了 ${(plan.tasks ?? []).length} 个任务，${escalations.length} 条新的升级。`);
        for (const contract of plan.tasks ?? []) console.log(`  ${contract.task}  ${taskLabel(contract.task, contract.title)}`);
        for (const id of escalations) {
            const entry = state.escalations.find(candidate => candidate.id === id);
            console.log(`  升级 ${id}（${entry.code}）：${entry.items.join('、')}${entry.question ? ` —— ${entry.question}` : ''}`);
        }
        if (escalations.length > 0) console.log(`升级的条目先 coven claim set --items <条目,…> --state blocked --code <代码>，再把问题交给维护者；维护者的决定用 coven state hd HD4 --escalation <编号> 记。`);
        if (fromBlocked.length > 0) console.log(`这些条目原来标成 blocked，开工前先 coven claim set --items ${fromBlocked.join(',')} --state claimed`);
        if (uncovered.length > 0) console.log(`这些认领着的条目 planner 没有分配：${uncovered.join('，')}`);
        return;
    }
    if (!task) throw new Error('要指定任务');
    const contract = readJson(contractFile(root, task));
    if (command === 'show') {
        console.log(renderContract(contract));
        return;
    }
    if (command === 'approve') {
        const alreadyApproved = fs.existsSync(approvedFile(root, task));
        const problems = approvalProblems({
            contract, taskId: task, task: state.tasks[task], validateOptions: validateOptionsFor(host, state).options,
            alreadyApproved, auto: Boolean(options.auto), by: options.by, reapprove: Boolean(options.reapprove),
        });
        if (problems.length > 0) throw new Error(`不能批准 ${task}：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
        const by = options.auto ? 'auto（R0/R1 跳过 HD2）' : options.by;
        writeJson(approvedFile(root, task), { approvedAt: nowIso(), by, fingerprint: contractFingerprint(contract), contract });
        // 批准前维护者可能改了标题：账本跟着批准的这一版，show 和运行总结才不会出现两个名字
        state.tasks[task].title = contract.title;
        if (!options.auto) state.interventions.push({ at: nowIso(), kind: 'HD2', note: `${alreadyApproved ? '重新批准' : '批准'} ${task}` });
        saveState(root, state);
        console.log(`已${alreadyApproved ? '重新' : ''}批准 ${task}（${by}）。`);
        return;
    }
    if (command === 'verdict') {
        if (!file) throw new Error('要给 evaluator 输出的 JSON 文件');
        const record = state.tasks[task];
        const verdict = readJson(path.resolve(file));
        const latest = covenPath(root, 'verify', `${task}-latest.json`);
        const verify = fs.existsSync(latest) ? readJson(latest) : null;
        const problems = verdictProblems({ taskId: task, task: record, verdict, verify });
        if (problems.length > 0) throw new Error(`不能记这份评审结论：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
        const { contract: next, overridden, missing } = applyVerdict(contract, verdict, verify, adapter.checks);
        writeJson(contractFile(root, task), next);
        const round = record.rounds;
        writeText(covenPath(root, 'reviews', `${task}-r${round}.md`), renderReview(task, round, verdict));
        // 结论绑定到 verify 跑的那个提交和这一版契约：之后分支又有新提交、或者契约变了，都要重新评审
        record.lastVerdict = {
            round, verdict: verdict.verdict, passes: verdictPasses(next, verdict), escalation: verdict.escalation ?? null,
            head: record.reviewHead, fingerprint: contractFingerprint(next),
        };
        saveState(root, state);
        if (overridden.length > 0) console.log(`这些确定性验收项 verify 没过，按没过算：${overridden.join('、')}`);
        if (missing.length > 0) console.log(`evaluator 没判这些验收项，按没过算：${missing.join('、')}`);
        console.log(record.lastVerdict.passes ? `第 ${round} 轮通过（提交 ${verify.head.slice(0, 7)}），可以 coven pr --task ${task} …` : `第 ${round} 轮没过：问题清单在 .coven/reviews/${task}-r${round}.md`);
        return;
    }
    throw new Error(`用法：\n${usage()}`);
}
