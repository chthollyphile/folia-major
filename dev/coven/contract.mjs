import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, covenPath, loadConfig, loadState, nowIso, parseArgs, readJson, runCli, saveState, trackedFilesUnder, writeJson, writeText } from './common.mjs';
import { RISKS, maxRisk, riskRank, scopeRiskOf } from './risk.mjs';
// dev/coven/contract.mjs
// 契约：每个任务一份，列出目标、不做什么、能动的路径和验收项。HD2 批准的那一版存成 .approved.json，
// 之后只允许翻验收项的 passes（D804），diff 不能出 scope.paths（D803），有一项没过就不能开 PR（D802）。
//
//   npm run coven:contract -- import <planner 输出的 JSON>   写入各任务的契约，在状态文件里登记任务和分组
//   npm run coven:contract -- show <任务>                      给维护者看（HD2）
//   npm run coven:contract -- approve <任务> --by <账号>       HD2 批准；R0/R1 用 --auto 跳过 HD2；批准过的只有维护者要求时 --reapprove
//   npm run coven:contract -- verdict <任务> <evaluator 输出的 JSON>   按评审结论翻 passes，写评审记录

/** verify.mjs 能自己跑出结果的验收项；其余由 evaluator 判断（读代码、浏览器预览、桌面版、组件测试）。 */
export const DETERMINISTIC_KINDS = ['typecheck', 'unit', 'dedicatus', 'baseline'];
export const JUDGED_KINDS = ['review', 'preview', 'desktop', 'component'];
export const ACTIONS = ['refactor', 'issue-to-pr', 'fix'];

/** 任何任务都可以改的文件：基线和抑制只许变小，由 verify 的 baseline 检查和 Dedicatus 的 D001 把关。 */
export const ALWAYS_IN_SCOPE = ['dev/dedicatus/baseline.json', 'eslint-suppressions.json'];

const TASK_ID = /^[a-z0-9][a-z0-9-]{0,60}$/;
const SAFE_PATH = /^[\w@.\-/]+$/;

const isRelativePath = value => typeof value === 'string' && value.length > 0 && SAFE_PATH.test(value) && !value.startsWith('/') && !value.split('/').includes('..');

/**
 * 契约格式检查。返回问题列表，空数组表示合格。
 * 风险级（D807）不能低于：条目在范围里算出的级别，以及 scope.paths 能改到的路径的级别（给了 riskRules 时算）。
 * 否则一个 R1 契约把 scope 写成 `.github/workflows/` 就能用 --auto 跳过 HD2。
 * @param {any} contract
 * @param {{ itemRisks?: Record<string, string>, riskRules?: any, filesUnder?: (dir: string) => string[] }} [options]
 */
export function validateContract(contract, { itemRisks = {}, riskRules = null, filesUnder = () => [] } = {}) {
    const problems = [];
    const add = (message, code = null) => problems.push({ code, message });
    if (!contract || typeof contract !== 'object') return [{ code: null, message: '契约不是对象' }];
    if (!TASK_ID.test(contract.task ?? '')) add('task 要用小写字母、数字和连字符');
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
            if (![...DETERMINISTIC_KINDS, ...JUDGED_KINDS].includes(kind)) add(`${label} 的 verify.kind 不认识：${kind}`);
            if (kind === 'unit') {
                const targets = [].concat(criterion.verify.target ?? []);
                if (targets.length === 0 || targets.some(target => !isRelativePath(target))) add(`${label} 的 unit 要写 target（测试文件的相对路径）`);
            }
            if (kind === 'dedicatus' && criterion.verify.target !== undefined && !['graph', 'all'].includes(criterion.verify.target)) add(`${label} 的 dedicatus target 只能是 graph 或 all`);
        }
        if (contract.action === 'refactor' && !criteria.some(criterion => criterion?.verify?.kind === 'baseline')) {
            add('重构任务要有一项 baseline 验收（条目从基线消掉，D806）', 'D806');
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
    for (const field of ['task', 'items', 'risk', 'action', 'goal', 'nonGoals', 'scope']) {
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

/** 路径在不在范围里：范围项以 / 结尾的按目录前缀，否则按整个文件名。 */
export const inScope = (file, scopePaths) => [...scopePaths, ...ALWAYS_IN_SCOPE].some(entry => (entry.endsWith('/') ? file.startsWith(entry) : file === entry));

/**
 * diff 有没有出范围（D803）。改名的新旧两个路径都要在范围里。
 * @param {Array<{ path: string, oldPath?: string }>} changed
 */
export function checkScope(changed, scopePaths) {
    const outside = [];
    for (const entry of changed) {
        for (const file of [entry.oldPath, entry.path].filter(Boolean)) {
            if (!inScope(file, scopePaths) && !outside.includes(file)) outside.push(file);
        }
    }
    return outside.map(file => ({ code: 'D803', message: `改了契约范围以外的文件：${file}` }));
}

/** 契约里还没过的验收项（D802）。 */
export const failingCriteria = contract => (contract.criteria ?? []).filter(criterion => !criterion.passes).map(criterion => criterion.id);

/**
 * 按 evaluator 的结论翻 passes。确定性的验收项以 verify 的结果为准：evaluator 判过、verify 没过的按没过算。
 * @returns {{ contract: object, overridden: string[], missing: string[] }}
 */
export function applyVerdict(contract, verdict, verifyResult) {
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
        if (DETERMINISTIC_KINDS.includes(criterion.verify.kind) && passes && verified[criterion.id] !== true) {
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
        `### ${contract.task}（${contract.risk}，${contract.action}）`,
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
        ...contract.criteria.map(criterion => `| ${criterion.id} | ${criterion.description.replace(/\|/g, '\\|')} | ${criterion.verify.kind}${criterion.verify.target ? ` \`${[].concat(criterion.verify.target).join(' ')}\`` : ''} | ${criterion.passes ? '✅' : '⬜'} |`),
    ];
    return lines.join('\n');
}

export function renderReview(task, round, verdict) {
    const issues = verdict.issues ?? [];
    return [
        `# ${task} 第 ${round} 轮评审：${verdict.verdict}`,
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
 * 检查 planner 的输出能不能导入。已经登记过的任务一律拒绝：重新导入会把轮数和花费清零，D811、D813 就形同虚设。
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
    for (const escalation of plan.escalations ?? []) {
        if (!/^D8\d\d$/.test(escalation.code ?? '')) errors.push(`升级项的 code 要是 D8xx（收到 ${escalation.code}）`);
        for (const item of escalation.items ?? []) {
            if (covered.has(item)) errors.push(`条目 ${item} 既分进了任务、又列在升级里（或者升级里重复）`);
            else if (!available.has(item) && !state.escalations.some(entry => entry.items.includes(item))) errors.push(`升级的条目 ${item} 不是这个监控 session 认领着的`);
            covered.add(item);
        }
    }
    const uncovered = [...available].filter(item => !covered.has(item) && state.items[item].claim.state === 'claimed' && !state.escalations.some(entry => entry.items.includes(item)));
    return { errors, uncovered, fromBlocked };
}

/** 把检查过的 planner 输出登记进状态文件（契约文件由调用方写）。 */
export function applyPlanImport(state, plan, now = nowIso()) {
    const imported = new Set();
    for (const contract of plan.tasks ?? []) {
        state.tasks[contract.task] = { items: contract.items, risk: contract.risk, phase: 'planning', rounds: 0, tokens: 0, history: [{ at: now, phase: 'planning' }] };
        for (const item of contract.items) {
            state.items[item].task = contract.task;
            imported.add(item);
        }
        if (!state.order.includes(contract.task)) state.order.push(contract.task);
    }
    // 升级过的条目分进了任务，就不再算升级
    state.escalations = [...state.escalations.map(entry => ({ ...entry, items: entry.items.filter(item => !imported.has(item)) })), ...(plan.escalations ?? [])].filter(entry => entry.items.length > 0);
    if (plan.order) state.order = [...plan.order.filter(id => state.tasks[id]), ...state.order.filter(id => !plan.order.includes(id))];
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
    if (task.phase !== 'evaluating') problems.push(`任务在 ${task.phase} 阶段，先 coven:state -- phase ${taskId} evaluating`);
    if (verdict.task !== taskId) problems.push(`评审结论写的任务是 ${verdict.task}，不是 ${taskId}`);
    if (verdict.round !== task.rounds) problems.push(`评审结论写的是第 ${verdict.round} 轮，现在是第 ${task.rounds} 轮`);
    if (!['pass', 'fail', 'escalate'].includes(verdict.verdict)) problems.push(`verdict 只能是 pass、fail、escalate，收到 ${verdict.verdict}`);
    if (!verify) problems.push('还没跑 coven:verify');
    else if (verify.task !== taskId) problems.push(`verify 的结果是任务 ${verify.task} 的`);
    // evaluator 审的是进 evaluating 时 verify 跑的那个提交；之后 verify 又在新提交上跑过，这份结论就不算数
    if (verdict.head !== task.reviewHead) problems.push(`评审结论写的提交是 ${String(verdict.head).slice(0, 7)}，这一轮要审的是 ${String(task.reviewHead).slice(0, 7)}`);
    if (verify && verify.head !== task.reviewHead) problems.push(`verify 后来又在 ${verify.head.slice(0, 7)} 上跑过：这一轮的结论作废，回 building 重新来`);
    return problems;
}

// ---- 命令行 ----

function validateOptionsFor(state) {
    const scope = readJson(covenPath(ROOT, 'scopes', `${state.scope}.json`));
    return {
        scope,
        options: {
            itemRisks: Object.fromEntries(scope.items.map(item => [item.key, item.risk])),
            riskRules: loadConfig(ROOT).risk,
            filesUnder: dir => trackedFilesUnder(ROOT, dir),
        },
    };
}

function main() {
    const { positional, options } = parseArgs(process.argv.slice(2), ['auto', 'reapprove'], ['by']);
    const [command, task, file] = positional;
    const state = loadState(ROOT);
    if (command === 'import') {
        if (!task) throw new Error('要给 planner 输出的 JSON 文件');
        const plan = readJson(path.resolve(task));
        const { scope, options: validateOptions } = validateOptionsFor(state);
        const { errors, uncovered, fromBlocked } = planImportProblems(state, scope, plan, validateOptions);
        if (errors.length > 0) throw new Error(`planner 的输出不合格，什么都没导入：\n${errors.join('\n')}`);
        for (const contract of plan.tasks ?? []) writeJson(contractFile(ROOT, contract.task), contract);
        applyPlanImport(state, plan);
        saveState(ROOT, state);
        console.log(`登记了 ${(plan.tasks ?? []).length} 个任务，${(plan.escalations ?? []).length} 条新的升级。`);
        if (fromBlocked.length > 0) console.log(`这些条目原来标成 blocked，开工前先 npm run coven:claim -- set --items ${fromBlocked.join(',')} --state claimed`);
        if (uncovered.length > 0) console.log(`这些认领着的条目 planner 没有分配：${uncovered.join('，')}`);
        return;
    }
    if (!task) throw new Error('要指定任务');
    const contract = readJson(contractFile(ROOT, task));
    if (command === 'show') {
        console.log(renderContract(contract));
        return;
    }
    if (command === 'approve') {
        const alreadyApproved = fs.existsSync(approvedFile(ROOT, task));
        const problems = approvalProblems({
            contract, taskId: task, task: state.tasks[task], validateOptions: validateOptionsFor(state).options,
            alreadyApproved, auto: Boolean(options.auto), by: options.by, reapprove: Boolean(options.reapprove),
        });
        if (problems.length > 0) throw new Error(`不能批准 ${task}：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
        const by = options.auto ? 'auto（R0/R1 跳过 HD2）' : options.by;
        writeJson(approvedFile(ROOT, task), { approvedAt: nowIso(), by, fingerprint: contractFingerprint(contract), contract });
        if (!options.auto) state.interventions.push({ at: nowIso(), kind: 'HD2', note: `${alreadyApproved ? '重新批准' : '批准'} ${task}` });
        saveState(ROOT, state);
        console.log(`已${alreadyApproved ? '重新' : ''}批准 ${task}（${by}）。`);
        return;
    }
    if (command === 'verdict') {
        if (!file) throw new Error('要给 evaluator 输出的 JSON 文件');
        const record = state.tasks[task];
        const verdict = readJson(path.resolve(file));
        const latest = covenPath(ROOT, 'verify', `${task}-latest.json`);
        const verify = fs.existsSync(latest) ? readJson(latest) : null;
        const problems = verdictProblems({ taskId: task, task: record, verdict, verify });
        if (problems.length > 0) throw new Error(`不能记这份评审结论：\n${problems.map(problem => `- ${problem}`).join('\n')}`);
        const { contract: next, overridden, missing } = applyVerdict(contract, verdict, verify);
        writeJson(contractFile(ROOT, task), next);
        const round = record.rounds;
        writeText(covenPath(ROOT, 'reviews', `${task}-r${round}.md`), renderReview(task, round, verdict));
        // 结论绑定到 verify 跑的那个提交和这一版契约：之后分支又有新提交、或者契约变了，都要重新评审
        record.lastVerdict = {
            round, verdict: verdict.verdict, passes: verdictPasses(next, verdict), escalation: verdict.escalation ?? null,
            head: record.reviewHead, fingerprint: contractFingerprint(next),
        };
        saveState(ROOT, state);
        if (overridden.length > 0) console.log(`这些确定性验收项 verify 没过，按没过算：${overridden.join('、')}`);
        if (missing.length > 0) console.log(`evaluator 没判这些验收项，按没过算：${missing.join('、')}`);
        console.log(record.lastVerdict.passes ? `第 ${round} 轮通过（提交 ${verify.head.slice(0, 7)}），可以 npm run coven:pr -- --task ${task} …` : `第 ${round} 轮没过：问题清单在 .coven/reviews/${task}-r${round}.md`);
        return;
    }
    throw new Error('用法：npm run coven:contract -- import <文件> | show <任务> | approve <任务> (--by <账号> [--reapprove] | --auto) | verdict <任务> <文件>');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli(main);
